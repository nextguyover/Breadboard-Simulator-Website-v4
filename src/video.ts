/**
 * Plays a scroll sequence from a short video clip instead of separate images. The clip is
 * one download, and WebCodecs decodes it (usually in hardware) into a window of ready
 * frames around the scroll position, so scrubbing only ever draws frames that are already
 * decoded.
 *
 * Two tiers keep it from ever going blank:
 * - anchors: every few frames, decoded once at load at reduced size and kept for good, so
 *   there is always a frame close to any scroll position, however fast you scroll;
 * - the window: full size frames from the shown frame out to where the scroll is heading,
 *   kept within a memory budget. Frames outside it are only evicted when the budget needs
 *   the room, so scrolling back usually finds them still there.
 */
import clips from "./data/video.json";
import type { Frames, Variant } from "./frames";

/** One encoded clip, as render/build_video.py describes it. */
interface Clip {
  url: string;
  codec: string;
  width: number;
  height: number;
  bytes: number;
  /** In decode order: [byte offset, size, keyframe 1/0, frame index]. */
  packets: [number, number, number, number][];
  /** The avcC record, base64 (H.264 only). */
  description?: string;
}

type ClipName = "a" | "b-off" | "b-on";
type Library = Record<string, Record<string, Record<string, Clip>>>;

/** Anchor spacing, in frames. */
const ANCHOR_STEP = 8;
/** Chunks queued in the decoder at once: enough to keep it busy, few enough to stay responsive. */
const QUEUE = 6;

function config(clip: Clip): VideoDecoderConfig {
  const c: VideoDecoderConfig = {
    codec: clip.codec,
    codedWidth: clip.width,
    codedHeight: clip.height,
    optimizeForLatency: true,
  };
  if (clip.description) c.description = Uint8Array.from(atob(clip.description), (ch) => ch.charCodeAt(0));
  return c;
}

/**
 * The best clips this browser can decode for a screen variant, preferring AV1 (smaller,
 * 10-bit) over H.264, or null when WebCodecs can't play any of them.
 */
export async function pickClips(variant: Variant): Promise<Record<ClipName, Clip> | null> {
  if (typeof VideoDecoder === "undefined") return null;
  const lib = clips as unknown as Library;
  for (const codec of ["av1", "h264"]) {
    const set = {} as Record<ClipName, Clip>;
    let ok = true;
    for (const name of ["a", "b-off", "b-on"] as ClipName[]) {
      const clip = lib[name]?.[variant]?.[codec];
      if (!clip) {
        ok = false;
        break;
      }
      set[name] = clip;
    }
    if (!ok) continue;
    try {
      const { supported } = await VideoDecoder.isConfigSupported(config(set.a));
      if (supported) return set;
    } catch {
      /* try the next codec */
    }
  }
  return null;
}

interface Gop {
  first: number;
  end: number;
}

export class VideoSet implements Frames {
  readonly count: number;
  onLoad: (() => void) | null = null;
  /** Called once if the clip can't be fetched or decoded; the fallback takes over. */
  onFail: (() => void) | null = null;
  failed = false;
  /** The frame index nearest() last returned, for the stats overlay and eviction. */
  shown = -1;

  private data: Uint8Array | null = null;
  private readonly frames = new Map<number, ImageBitmap>();
  private readonly anchors = new Map<number, ImageBitmap>();
  private readonly anchorIdx: number[] = [];
  private readonly gops: Gop[] = [];
  /** For each frame index, the GOP that holds it. */
  private readonly gopOf: number[];
  /** Frames sent to the decoder and not out yet. */
  private readonly requested = new Set<number>();
  private decoder: VideoDecoder | null = null;
  private center = 0;
  private dir = 1;
  /** The frames wanted in the window, most wanted first. */
  private want: number[] = [];
  private wantSet = new Set<number>();
  /** Widest a decoded frame is kept; wider frames are scaled down to save memory. */
  private maxWidth = Infinity;
  /** How many full size frames the window may hold. */
  private cap = 24;
  private budget: number;
  private flushing = false;

  constructor(
    private readonly clip: Clip,
    /** Drawn from until this clip has decoded frames of its own. */
    private readonly fallback: Frames,
    /** Memory the window may use, in bytes. */
    budget: number,
  ) {
    this.budget = budget;
    this.count = clip.packets.length;
    this.gopOf = new Array(this.count).fill(0);
    clip.packets.forEach(([, , key, idx], p) => {
      if (key || !this.gops.length) this.gops.push({ first: p, end: p + 1 });
      else this.gops[this.gops.length - 1].end = p + 1;
      this.gopOf[idx] = this.gops.length - 1;
    });
    // Anchors must decode on their own, so they are the keyframe nearest each step.
    const keys = clip.packets.filter(([, , key]) => key).map(([, , , idx]) => idx);
    const picked = new Set<number>();
    for (let i = 0; i < this.count; i += ANCHOR_STEP) {
      let best = keys[0];
      for (const k of keys) if (Math.abs(k - i) < Math.abs(best - i)) best = k;
      picked.add(best);
    }
    picked.add(keys[keys.length - 1]);
    this.anchorIdx = [...picked].sort((x, y) => x - y);
    this.sizeCap();
  }

  get bytes(): number {
    return this.clip.bytes;
  }

  /** Downloads the clip and decodes the anchors. Resolves false if it couldn't. */
  async load(): Promise<boolean> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${this.clip.url}`);
      if (!res.ok) throw new Error(String(res.status));
      this.data = new Uint8Array(await res.arrayBuffer());
      this.pump();
      return true;
    } catch {
      this.fail();
      return false;
    }
  }

  /** The widest the stage will draw a frame, in device pixels. */
  setMaxWidth(px: number): void {
    this.maxWidth = Math.max(640, Math.round(px));
    this.sizeCap();
  }

  private outSize(maxW: number): [number, number] {
    const { width: w, height: h } = this.clip;
    return w > maxW * 1.1 ? [Math.round(maxW), Math.round((h * maxW) / w)] : [w, h];
  }

  private sizeCap(): void {
    const [w, h] = this.outSize(this.maxWidth);
    this.cap = Math.max(10, Math.min(60, Math.floor(this.budget / (w * h * 4))));
  }

  get(i: number): ImageBitmap | null {
    return this.frames.get(i) ?? null;
  }

  nearest(i: number): ImageBitmap | null {
    const c = Math.max(0, Math.min(this.count - 1, Math.round(i)));
    let best = -1;
    let bmp: ImageBitmap | null = null;
    // A full frame if one is close, else the nearest anchor, else whatever full frame is nearest.
    for (let d = 0; d < this.count; d++) {
      const hit = this.frames.get(c - d) ?? this.frames.get(c + d);
      if (hit) {
        best = this.frames.has(c - d) ? c - d : c + d;
        bmp = hit;
        break;
      }
      if (d > 2 && this.anchors.size) break;
    }
    let ab = -1;
    for (const k of this.anchorIdx) if (this.anchors.has(k) && (ab < 0 || Math.abs(k - c) < Math.abs(ab - c))) ab = k;
    if (ab >= 0 && (!bmp || Math.abs(ab - c) < Math.abs(best - c))) {
      best = ab;
      bmp = this.anchors.get(ab)!;
    }
    if (!bmp) return this.failed || !this.frames.size ? this.fallback.nearest(i) : null;
    this.shown = best;
    return bmp;
  }

  /**
   * Moves the window to frame `i`, reaching out to `target` (where the eased scroll is
   * heading) plus `ahead` more frames beyond it, and `behind` frames the other way.
   */
  focus(i: number, ahead: number, behind = ahead, target = i): void {
    const ready = this.frames.size > 0 || this.anchors.size > 0;
    this.fallback.focus(i, ready ? 0 : ahead, ready ? 0 : behind);
    const n = this.count;
    const clamp = (k: number) => Math.max(0, Math.min(n - 1, Math.round(k)));
    const c = clamp(i);
    const t = clamp(target);
    if (t !== c) this.dir = t > c ? 1 : -1;
    else if (c !== this.center) this.dir = c > this.center ? 1 : -1;
    this.center = c;

    // Most wanted first: the shown frame, on towards the target and past it, then behind.
    const want: number[] = [];
    const end = this.dir > 0 ? Math.max(c, t) + ahead : Math.min(c, t) - ahead;
    for (let k = c; this.dir > 0 ? k <= end : k >= end; k += this.dir) if (k >= 0 && k < n) want.push(k);
    for (let d = 1; d <= behind; d++) {
      const k = c - d * this.dir;
      if (k >= 0 && k < n) want.push(k);
    }
    this.want = want.slice(0, this.cap);
    this.wantSet = new Set(this.want);

    // Only evict when over budget, farthest first, and never the frame on screen.
    if (this.frames.size > this.cap) {
      const spare = [...this.frames.keys()]
        .filter((k) => !this.wantSet.has(k) && k !== this.shown)
        .sort((x, y) => Math.abs(y - c) - Math.abs(x - c));
      for (const k of spare) {
        if (this.frames.size <= this.cap) break;
        this.frames.get(k)!.close();
        this.frames.delete(k);
      }
    }
    this.pump();
  }

  /** The next GOP to decode: anchors first, then the window in order. */
  private next(): Gop | null {
    for (const k of this.anchorIdx) {
      if (!this.anchors.has(k) && !this.requested.has(k)) return { first: this.packetOf(k), end: this.packetOf(k) + 1 };
    }
    for (const k of this.want) {
      if (!this.frames.has(k) && !this.requested.has(k)) return this.gops[this.gopOf[k]];
    }
    return null;
  }

  private packetOf(idx: number): number {
    const g = this.gops[this.gopOf[idx]];
    for (let p = g.first; p < g.end; p++) if (this.clip.packets[p][3] === idx) return p;
    return g.first;
  }

  private pump(): void {
    if (!this.data || this.failed || this.flushing) return;
    const dec = this.ensureDecoder();
    while (dec.decodeQueueSize < QUEUE) {
      const g = this.next();
      if (!g) break;
      for (let p = g.first; p < g.end; p++) {
        const [pos, size, key, idx] = this.clip.packets[p];
        this.requested.add(idx);
        dec.decode(
          new EncodedVideoChunk({
            type: p === g.first || key ? "key" : "delta",
            timestamp: idx,
            data: this.data.subarray(pos, pos + size),
          }),
        );
      }
    }
    // Decoders may hold the last frames back for reordering: drain them once idle.
    if (this.requested.size && dec.decodeQueueSize === 0 && !this.next()) {
      this.flushing = true;
      dec
        .flush()
        .catch(() => {})
        .finally(() => {
          this.flushing = false;
          this.requested.clear();
          this.pump();
        });
    }
  }

  private ensureDecoder(): VideoDecoder {
    if (this.decoder && this.decoder.state === "configured") return this.decoder;
    this.requested.clear();
    this.decoder = new VideoDecoder({
      output: (frame) => this.receive(frame),
      error: () => this.fail(),
    });
    this.decoder.addEventListener("dequeue", () => this.pump());
    this.decoder.configure(config(this.clip));
    return this.decoder;
  }

  private receive(frame: VideoFrame): void {
    const i = frame.timestamp;
    this.requested.delete(i);
    const asAnchor = this.anchorIdx.includes(i) && !this.anchors.has(i);
    const asFrame = this.wantSet.has(i) && !this.frames.has(i);
    if (!asAnchor && !asFrame) {
      frame.close();
      this.pump();
      return;
    }
    // Copy out and release the VideoFrame at once: decoders have a small pool of them.
    const jobs: Promise<void>[] = [];
    const copy = (maxW: number, into: Map<number, ImageBitmap>) => {
      const [w, h] = this.outSize(maxW);
      const opts: ImageBitmapOptions =
        w < frame.displayWidth ? { resizeWidth: w, resizeHeight: h, resizeQuality: "high" } : {};
      jobs.push(
        createImageBitmap(frame, opts)
          .then((bmp) => {
            if (into.has(i) || this.failed) bmp.close();
            else into.set(i, bmp);
          })
          .catch(() => {}),
      );
    };
    if (asFrame) copy(this.maxWidth, this.frames);
    if (asAnchor) copy(Math.min(this.maxWidth / 2, 1280), this.anchors);
    void Promise.all(jobs).finally(() => {
      frame.close();
      this.onLoad?.();
      this.pump();
    });
  }

  private fail(): void {
    if (this.failed) return;
    this.failed = true;
    for (const bmp of this.frames.values()) bmp.close();
    for (const bmp of this.anchors.values()) bmp.close();
    this.frames.clear();
    this.anchors.clear();
    try {
      this.decoder?.close();
    } catch {
      /* already closed */
    }
    this.onFail?.();
  }
}
