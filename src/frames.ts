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
const PARALLEL_DOWNLOADS = 6;
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

/** AVIF where the browser decodes it (about half the size of WebP), else WebP. */
export async function pickFormat(): Promise<string> {
  const formats = info.formats;
  if (!formats.includes("avif")) return "webp";
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

  private readonly blobs: (Blob | HTMLImageElement | null)[];
  private readonly frames = new Map<number, ImageBitmap>();
  private readonly anchors = new Map<number, ImageBitmap>();
  private readonly anchorIdx: number[] = [];
  private readonly decoding = new Set<number>();
  private loaded = 0;
  private center = 0;
  private dir = 1;
  /** The frames wanted in the window, most wanted first. */
  private want: number[] = [];
  private wantSet = new Set<number>();
  /** How many full size frames the window may hold. */
  private readonly cap: number;

  constructor(
    readonly count: number,
    private readonly url: (i: number) => string,
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

  get complete(): boolean {
    return this.loaded === this.count;
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

  /** Download order: the given frames, then coarse to fine, so the whole run scrubs early. */
  order(first: number[] = []): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    const add = (i: number) => {
      if (i >= 0 && i < this.count && !seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
    };
    first.forEach(add);
    add(0);
    add(this.count - 1);
    for (const step of [16, 8, 4, 2, 1]) for (let i = 0; i < this.count; i += step) add(i);
    return out;
  }

  /** Downloads frame `i`; with `decode`, also decodes it at once (the first frame shown). */
  async load(i: number, decode = false): Promise<void> {
    if (!this.blobs[i]) {
      const src = await fetchFrame(this.url(i));
      if (!src) return; // a missing frame just stays a gap; nearest() covers it
      this.blobs[i] = src;
      this.loaded++;
    }
    if (decode && !this.frames.has(i)) {
      const bmp = await createImageBitmap(this.blobs[i]!).catch(() => null);
      if (bmp) this.frames.set(i, bmp);
      this.onLoad?.();
    }
    this.pump();
  }

  /** Decodes what is missing: anchors first, then the window in order. */
  private pump(): void {
    const jobs: [number, boolean][] = [];
    for (const k of this.anchorIdx) if (!this.anchors.has(k)) jobs.push([k, true]);
    for (const k of this.want) if (!this.frames.has(k)) jobs.push([k, false]);
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

/** Fetches a frame as a compressed blob; falls back to an <img> where fetch is blocked (e.g. by a CSP). */
async function fetchFrame(url: string): Promise<Blob | HTMLImageElement | null> {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.blob();
  } catch {
    /* fall through */
  }
  const img = new Image();
  img.src = url;
  return img.decode().then(
    () => img,
    () => null,
  );
}

/** Runs loads with a little parallelism, in the given order. */
export async function loadInOrder(jobs: (() => Promise<void>)[], parallel = PARALLEL_DOWNLOADS): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await jobs[next++]();
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}
