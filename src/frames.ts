/**
 * Loads and holds the rendered frame sequences. Every frame is downloaded once and kept
 * compressed (tens of KB each); only frames near the scroll position are decoded, since a
 * decoded 1080p frame is ~8 MB.
 *
 * Two tiers keep scrubbing from ever going blank:
 * - anchors: every few frames, decoded once at reduced size and kept for good, so there is
 *   always a frame close to any scroll position, however fast you scroll;
 * - the window: full size frames from the shown frame out to where the scroll is heading,
 *   kept within a memory budget. Frames outside it are only freed when the budget needs
 *   the room, and never the one on screen, so scrolling back usually finds them ready.
 */
import frameInfo from "./data/frames.json";

const PARALLEL_DECODES = 4;
/** Anchor spacing, in frames. */
const ANCHOR_STEP = 8;

export type Variant = "d" | "m";

/** A scroll sequence the stage can draw from. */
export interface Frames {
  readonly count: number;
  onLoad: (() => void) | null;
  get(i: number): ImageBitmap | null;
  nearest(i: number): ImageBitmap | null;
  /** `target` is where the eased scroll is heading, so decoding can get there first. */
  focus(i: number, ahead: number, behind?: number, target?: number): void;
}

interface Info {
  tiers: Record<string, [number, number]>;
  formats: string[];
}

const info = frameInfo as unknown as Info;

/**
 * The smallest frame size that still covers `drawWidth` device pixels for this screen
 * shape, so a phone never downloads desktop frames and a 4K screen gets the sharpest.
 */
export function pickTier(variant: Variant, drawWidth: number): { name: string; size: [number, number] } {
  const tiers = Object.entries(info.tiers)
    .filter(([name]) => name.startsWith(variant))
    .sort((x, y) => x[1][0] - y[1][0]);
  // A little upscaling is invisible on these soft, dark renders; it saves a whole tier.
  const hit = tiers.find(([, [w]]) => w >= drawWidth * 0.9) ?? tiers[tiers.length - 1];
  return { name: hit[0], size: hit[1] };
}

/**
 * AVIF where the browser decodes it (a quarter or so smaller than WebP), else WebP. Phones
 * get WebP regardless: their AVIF decoding is slow enough to stutter a fast first scroll,
 * and their frames are small, so WebP costs little extra.
 */
export async function pickFormat(variant: Variant): Promise<string> {
  const formats = info.formats;
  if (variant === "m" || !formats.includes("avif")) return "webp";
  const img = new Image();
  // A 1x1 AVIF.
  img.src =
    "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=";
  try {
    await img.decode();
    return img.naturalWidth > 0 ? "avif" : "webp";
  } catch {
    return "webp";
  }
}

export class FrameSet implements Frames {
  onLoad: (() => void) | null = null;
  /** The frame index nearest() last returned. */
  shown = -1;

  private readonly blobs: (Blob | null)[];
  private readonly frames = new Map<number, ImageBitmap>();
  private readonly anchors = new Map<number, ImageBitmap>();
  private readonly anchorIdx: number[] = [];
  private readonly decoding = new Set<number>();
  private center = 0;
  private dir = 1;
  /** The frames wanted in the window, most wanted first. */
  private want: number[] = [];
  private wantSet = new Set<number>();
  /** How many full size frames the window may hold. */
  private readonly cap: number;

  constructor(
    readonly count: number,
    /** Size of a decoded frame, for the memory budget and the anchors. */
    private readonly size: [number, number],
    /** Memory the window may use, in bytes. */
    budget: number,
  ) {
    this.blobs = new Array(count).fill(null);
    for (let i = 0; i < count; i += ANCHOR_STEP) this.anchorIdx.push(i);
    if (this.anchorIdx[this.anchorIdx.length - 1] !== count - 1) this.anchorIdx.push(count - 1);
    this.cap = Math.max(10, Math.min(60, Math.floor(budget / (size[0] * size[1] * 4))));
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
      const k = this.frames.has(c - d) ? c - d : this.frames.has(c + d) ? c + d : -1;
      if (k >= 0) {
        best = k;
        bmp = this.frames.get(k)!;
        break;
      }
      if (d > 2 && this.anchors.size) break;
    }
    for (const k of this.anchorIdx) {
      const a = this.anchors.get(k);
      if (a && (!bmp || Math.abs(k - c) < Math.abs(best - c))) {
        best = k;
        bmp = a;
      }
    }
    if (bmp) this.shown = best;
    return bmp;
  }

  /**
   * Moves the window to frame `i`, reaching out to `target` (where the eased scroll is
   * heading) plus `ahead` more frames beyond it, and `behind` frames the other way.
   */
  focus(i: number, ahead: number, behind = ahead, target = i): void {
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

    // Only free frames when over budget, farthest first, and never the one on screen.
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

  /**
   * Streams a packed frame set (render/pack_frames.py): one request for the whole sequence,
   * each frame usable as soon as its bytes are in. Resolves once it has all arrived.
   */
  async loadPack(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
    const reader = res.body.getReader();
    let buf = new Uint8Array(0);
    let header: { type: string; frames: [number, number][] } | null = null;
    let next = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        const joined = new Uint8Array(buf.length + value.length);
        joined.set(buf);
        joined.set(value, buf.length);
        buf = joined;
      }
      if (!header && buf.length >= 4) {
        const len = new DataView(buf.buffer, buf.byteOffset).getUint32(0, true);
        if (buf.length >= 4 + len) {
          header = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + len)));
          buf = buf.slice(4 + len);
        }
      }
      if (header) {
        let added = false;
        while (next < header.frames.length && buf.length >= header.frames[next][1]) {
          const [i, size] = header.frames[next++];
          this.blobs[i] = new Blob([buf.subarray(0, size)], { type: header.type });
          buf = buf.slice(size);
          added = true;
        }
        if (added) this.pump();
      }
      if (done) break;
    }
  }

  /** Resolves once frame `i` is decoded and drawable, or after `timeout` ms regardless. */
  async ready(i: number, timeout = 8000): Promise<void> {
    const t0 = performance.now();
    while (!this.frames.has(i) && performance.now() - t0 < timeout) {
      if (!this.wantSet.has(i)) this.focus(i, 0, 0);
      this.pump();
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  /** Decodes what is missing: anchors first, then the window in order. */
  private pump(): void {
    // The frames about to be shown, then the anchors, then the rest of the window.
    const jobs: [number, boolean][] = [];
    const soon = this.want.slice(0, 6);
    for (const k of soon) if (!this.frames.has(k)) jobs.push([k, false]);
    for (const k of this.anchorIdx) if (!this.anchors.has(k)) jobs.push([k, true]);
    for (const k of this.want.slice(6)) if (!this.frames.has(k)) jobs.push([k, false]);
    for (const [k, anchor] of jobs) {
      if (this.decoding.size >= PARALLEL_DECODES) return;
      const blob = this.blobs[k];
      const key = anchor ? -1 - k : k;
      if (!blob || this.decoding.has(key)) continue;
      this.decoding.add(key);
      const [w, h] = this.size;
      const opts: ImageBitmapOptions | undefined = anchor
        ? { resizeWidth: Math.round(w / 2), resizeHeight: Math.round(h / 2), resizeQuality: "medium" }
        : undefined;
      createImageBitmap(blob, opts)
        .then((bmp) => {
          const into = anchor ? this.anchors : this.frames;
          if (into.has(k) || (!anchor && !this.wantSet.has(k))) bmp.close();
          else {
            into.set(k, bmp);
            this.onLoad?.();
          }
        })
        .catch(() => {})
        .finally(() => {
          this.decoding.delete(key);
          this.pump();
        });
    }
  }
}
