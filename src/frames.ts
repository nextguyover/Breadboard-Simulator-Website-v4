/**
 * Loads the rendered frame sequences. Frames arrive coarse-to-fine (every 16th, then every
 * 8th, ...) so scrubbing works almost at once and sharpens as the rest stream in.
 */

const PARALLEL_DECODES = 4;

export type Variant = "d" | "m";

/** A scroll sequence the stage can draw from: image frames or a video clip. */
export interface Frames {
  readonly count: number;
  onLoad: (() => void) | null;
  get(i: number): ImageBitmap | null;
  nearest(i: number): ImageBitmap | null;
  focus(i: number, ahead: number, behind?: number): void;
}

/**
 * A frame sequence held compressed in memory (a few KB per frame), with only a window
 * of frames around the scroll position decoded. Decoded 1080p frames are ~8 MB each, so
 * keeping all of them would cost gigabytes; a window keeps scrubbing smooth for far less.
 */
export class FrameSet implements Frames {
  private readonly blobs: (Blob | HTMLImageElement | null)[];
  private readonly bitmaps = new Map<number, ImageBitmap>();
  private readonly decoding = new Set<number>();
  private loaded = 0;
  private center = 0;
  private dir = 1;
  private lo = 0;
  private hi = 2;
  onLoad: (() => void) | null = null;

  constructor(
    readonly count: number,
    private readonly url: (i: number) => string,
  ) {
    this.blobs = new Array(count).fill(null);
  }

  get complete(): boolean {
    return this.loaded === this.count;
  }

  /** The decoded frame `i`, if it is in the window and ready. */
  get(i: number): ImageBitmap | null {
    return this.bitmaps.get(i) ?? null;
  }

  /** The nearest decoded frame to `i`, searching outwards. */
  nearest(i: number): ImageBitmap | null {
    const n = this.count;
    const c = Math.max(0, Math.min(n - 1, Math.round(i)));
    for (let d = 0; d < n; d++) {
      const a = this.bitmaps.get(c - d);
      if (a) return a;
      const b = this.bitmaps.get(c + d);
      if (b) return b;
    }
    return null;
  }

  /**
   * Moves the decoded window to `i`: `ahead` frames in the direction of travel, `behind` the
   * other way. Frees frames outside it and decodes the missing ones, nearest first.
   */
  focus(i: number, ahead: number, behind = ahead): void {
    const c = Math.max(0, Math.min(this.count - 1, Math.round(i)));
    if (c !== this.center) this.dir = c > this.center ? 1 : -1;
    this.center = c;
    [this.lo, this.hi] = this.dir > 0 ? [c - behind, c + ahead] : [c - ahead, c + behind];
    for (const [k, bmp] of this.bitmaps) {
      if (!this.keep(k)) {
        bmp.close();
        this.bitmaps.delete(k);
      }
    }
    this.pump();
  }

  /** In the window, with a little slack so jitter at the edge doesn't thrash. */
  private keep(k: number): boolean {
    return k >= this.lo - 2 && k <= this.hi + 2;
  }

  private pump(): void {
    const c = this.center;
    const span = Math.max(this.hi - c, c - this.lo);
    for (let d = 0; d <= span; d++) {
      // The direction of travel first at each distance.
      for (const k of d ? [c + d * this.dir, c - d * this.dir] : [c]) {
        if (this.decoding.size >= PARALLEL_DECODES) return;
        if (k < this.lo || k > this.hi || k < 0 || k >= this.count) continue;
        if (this.bitmaps.has(k) || this.decoding.has(k)) continue;
        const blob = this.blobs[k];
        if (!blob) continue;
        this.decoding.add(k);
        createImageBitmap(blob)
          .then((bmp) => {
            if (!this.keep(k)) bmp.close();
            else {
              this.bitmaps.set(k, bmp);
              this.onLoad?.();
            }
          })
          .catch(() => {})
          .finally(() => {
            this.decoding.delete(k);
            this.pump();
          });
      }
    }
  }

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

  /** Downloads frame `i`; with `decode`, also waits until it is decoded and drawable. */
  async load(i: number, decode = false): Promise<void> {
    if (!this.blobs[i]) {
      const src = await fetchFrame(this.url(i));
      if (!src) return; // a missing frame just stays a gap; nearest() covers it
      this.blobs[i] = src;
      this.loaded++;
    }
    if (decode && !this.bitmaps.has(i)) {
      const bmp = await createImageBitmap(this.blobs[i]!).catch(() => null);
      if (bmp) this.bitmaps.set(i, bmp);
      this.onLoad?.();
    } else if (i >= this.lo && i <= this.hi) this.pump();
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
export async function loadInOrder(jobs: (() => Promise<void>)[], parallel = 6): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await jobs[next++]();
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}
