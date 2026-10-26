/**
 * Loads the rendered frame sequences. Frames arrive coarse-to-fine (every 16th, then every
 * 8th, ...) so scrubbing works almost at once and sharpens as the rest stream in.
 */

export type Variant = "d" | "m";

/**
 * A frame sequence held compressed in memory (a few KB per frame), with only a window
 * of frames around the scroll position decoded. Decoded 1080p frames are ~8 MB each, so
 * keeping all of them would cost gigabytes; a window keeps scrubbing smooth for far less.
 */
export class FrameSet {
  private readonly blobs: (Blob | HTMLImageElement | null)[];
  private readonly bitmaps = new Map<number, ImageBitmap>();
  private readonly decoding = new Set<number>();
  private loaded = 0;
  private center = 0;
  private radius = 2;
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

  /** Moves the decoded window: frees frames outside it and decodes the missing ones, nearest first. */
  focus(i: number, radius: number): void {
    const c = Math.max(0, Math.min(this.count - 1, Math.round(i)));
    this.center = c;
    this.radius = radius;
    for (const [k, bmp] of this.bitmaps) {
      // A little slack before freeing, so jitter at the edge doesn't thrash.
      if (Math.abs(k - c) > radius + 2) {
        bmp.close();
        this.bitmaps.delete(k);
      }
    }
    this.pump();
  }

  private pump(): void {
    const c = this.center;
    for (let d = 0; d <= this.radius && this.decoding.size < 3; d++) {
      for (const k of d ? [c + d, c - d] : [c]) {
        if (k < 0 || k >= this.count || this.bitmaps.has(k) || this.decoding.has(k)) continue;
        const blob = this.blobs[k];
        if (!blob) continue;
        this.decoding.add(k);
        createImageBitmap(blob)
          .then((bmp) => {
            if (Math.abs(k - this.center) > this.radius + 2) bmp.close();
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
        if (this.decoding.size >= 3) return;
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
    } else if (Math.abs(i - this.center) <= this.radius) this.pump();
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
