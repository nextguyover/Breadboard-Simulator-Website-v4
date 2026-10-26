/**
 * Loads the rendered frame sequences. Frames arrive coarse-to-fine (every 16th, then every
 * 8th, ...) so scrubbing works almost at once and sharpens as the rest stream in.
 */

export type Variant = "d" | "m";

export class FrameSet {
  readonly images: (HTMLImageElement | null)[];
  private loaded = 0;
  onLoad: (() => void) | null = null;

  constructor(
    readonly count: number,
    private readonly url: (i: number) => string,
  ) {
    this.images = new Array(count).fill(null);
  }

  get complete(): boolean {
    return this.loaded === this.count;
  }

  /** The nearest loaded frame to `i`, searching outwards. */
  nearest(i: number): HTMLImageElement | null {
    const n = this.count;
    const c = Math.max(0, Math.min(n - 1, Math.round(i)));
    for (let d = 0; d < n; d++) {
      const a = this.images[c - d];
      if (a) return a;
      const b = this.images[c + d];
      if (b) return b;
    }
    return null;
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

  load(i: number): Promise<void> {
    if (this.images[i]) return Promise.resolve();
    const img = new Image();
    img.decoding = "async";
    img.src = this.url(i);
    return img
      .decode()
      .then(() => {
        this.images[i] = img;
        this.loaded++;
        this.onLoad?.();
      })
      .catch(() => {
        /* a missing frame just stays a gap; nearest() covers it */
      });
  }
}

/** Runs loads with a little parallelism, in the given order. */
export async function loadInOrder(jobs: (() => Promise<void>)[], parallel = 6): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await jobs[next++]();
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}
