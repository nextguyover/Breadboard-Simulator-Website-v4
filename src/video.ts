/**
 * Plays a scroll sequence from a short video clip instead of separate images. The clip is
 * one download, and WebCodecs decodes it (usually in hardware) a GOP at a time into a
 * window of ready frames around the scroll position, so scrubbing only ever draws frames
 * that are already decoded.
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

const PARALLEL = 1;

function config(clip: Clip): VideoDecoderConfig {
  const c: VideoDecoderConfig = { codec: clip.codec, codedWidth: clip.width, codedHeight: clip.height };
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

  private data: Uint8Array | null = null;
  private readonly frames = new Map<number, ImageBitmap>();
  private readonly gops: Gop[] = [];
  /** For each frame index, the GOP that holds it. */
  private readonly gopOf: number[];
  private decoder: VideoDecoder | null = null;
  private busy = 0;
  private center = 0;
  private dir = 1;
  private lo = 0;
  private hi = 2;
  /** Widest a decoded frame is kept; wider frames are scaled down to save memory. */
  private maxWidth = Infinity;

  constructor(
    private readonly clip: Clip,
    /** Drawn from until this clip has decoded frames of its own. */
    private readonly fallback: Frames,
  ) {
    this.count = clip.packets.length;
    this.gopOf = new Array(this.count).fill(0);
    clip.packets.forEach(([, , key, idx], p) => {
      if (key || !this.gops.length) this.gops.push({ first: p, end: p + 1 });
      else this.gops[this.gops.length - 1].end = p + 1;
      this.gopOf[idx] = this.gops.length - 1;
    });
  }

  get bytes(): number {
    return this.clip.bytes;
  }

  /** Downloads the clip. Resolves false if it couldn't. */
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
  }

  get(i: number): ImageBitmap | null {
    return this.frames.get(i) ?? null;
  }

  nearest(i: number): ImageBitmap | null {
    if (!this.frames.size || this.failed) return this.fallback.nearest(i);
    const n = this.count;
    const c = Math.max(0, Math.min(n - 1, Math.round(i)));
    for (let d = 0; d < n; d++) {
      const a = this.frames.get(c - d);
      if (a) return a;
      const b = this.frames.get(c + d);
      if (b) return b;
    }
    return null;
  }

  focus(i: number, ahead: number, behind = ahead): void {
    this.fallback.focus(i, this.frames.size ? 0 : ahead, this.frames.size ? 0 : behind);
    const c = Math.max(0, Math.min(this.count - 1, Math.round(i)));
    if (c !== this.center) this.dir = c > this.center ? 1 : -1;
    this.center = c;
    [this.lo, this.hi] = this.dir > 0 ? [c - behind, c + ahead] : [c - ahead, c + behind];
    for (const [k, bmp] of this.frames) {
      if (!this.keep(k)) {
        bmp.close();
        this.frames.delete(k);
      }
    }
    this.pump();
  }

  private keep(k: number): boolean {
    return k >= this.lo - 2 && k <= this.hi + 2;
  }

  /** The next missing frame in the window, nearest first and the direction of travel first. */
  private wanted(): number {
    const c = this.center;
    const span = Math.max(this.hi - c, c - this.lo);
    for (let d = 0; d <= span; d++) {
      for (const k of d ? [c + d * this.dir, c - d * this.dir] : [c]) {
        if (k < this.lo || k > this.hi || k < 0 || k >= this.count) continue;
        if (!this.frames.has(k)) return k;
      }
    }
    return -1;
  }

  private pump(): void {
    if (!this.data || this.failed || this.busy >= PARALLEL) return;
    const k = this.wanted();
    if (k < 0) return;
    this.busy++;
    this.decodeGop(this.gops[this.gopOf[k]])
      .catch(() => this.fail())
      .finally(() => {
        this.busy--;
        this.onLoad?.();
        this.pump();
      });
  }

  private ensureDecoder(): VideoDecoder {
    if (this.decoder && this.decoder.state === "configured") return this.decoder;
    this.decoder = new VideoDecoder({
      output: (frame) => this.receive(frame),
      error: () => this.fail(),
    });
    this.decoder.configure(config(this.clip));
    return this.decoder;
  }

  private pending: Promise<void>[] = [];

  private receive(frame: VideoFrame): void {
    const i = frame.timestamp;
    if (!this.keep(i) || this.frames.has(i)) {
      frame.close();
      return;
    }
    // Copy out and release the VideoFrame at once: decoders have a small pool of them.
    // A 1440p frame is ~15 MB as a bitmap, so don't keep more pixels than the screen shows.
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    const opts: ImageBitmapOptions =
      w > this.maxWidth
        ? { resizeWidth: Math.round(this.maxWidth), resizeHeight: Math.round((h * this.maxWidth) / w), resizeQuality: "high" }
        : {};
    this.pending.push(
      createImageBitmap(frame, opts)
        .then((bmp) => {
          if (this.keep(i) && !this.frames.has(i)) this.frames.set(i, bmp);
          else bmp.close();
        })
        .catch(() => {})
        .finally(() => frame.close()),
    );
  }

  private async decodeGop(g: Gop): Promise<void> {
    const dec = this.ensureDecoder();
    const data = this.data!;
    for (let p = g.first; p < g.end; p++) {
      const [pos, size, key, idx] = this.clip.packets[p];
      dec.decode(
        new EncodedVideoChunk({
          type: p === g.first || key ? "key" : "delta",
          timestamp: idx,
          data: data.subarray(pos, pos + size),
        }),
      );
    }
    await dec.flush();
    const done = this.pending;
    this.pending = [];
    await Promise.all(done);
  }

  private fail(): void {
    if (this.failed) return;
    this.failed = true;
    for (const bmp of this.frames.values()) bmp.close();
    this.frames.clear();
    try {
      this.decoder?.close();
    } catch {
      /* already closed */
    }
    this.onFail?.();
  }
}
