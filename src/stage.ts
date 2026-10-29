/**
 * The fixed backdrop: draws the rendered LED frames, places them for each part of the
 * page, and layers the live LED state (brightness, overdrive, burnt) and smoke on top.
 */
import seqA from "./data/seq-a.json";
import seqB from "./data/seq-b.json";
import { FrameSet, type Frames, type Variant, loadInOrder, pickFormat, pickTier } from "./frames";
import { Smoke } from "./smoke";

type Pt = [number, number];
interface Meta {
  dome: Pt;
  top: Pt;
  legs: Pt;
  glow: number;
}

/** How a frame sits on screen: scale and top-left offset, in canvas pixels. */
interface Placement {
  s: number;
  x: number;
  y: number;
}

/** The phone frames are a centred 1:2 crop of the 16:9 renders. */
const CROP_W = 9 / 32;
const CROP_X = (1 - CROP_W) / 2;
/** How far the dome's crown is above the "top" mark of the turntable frames, in frame heights. */
const DOME_CROWN = 0.065;

export interface LedState {
  /** 0 off, 1 normal brightness, above 1 overdriven. */
  brightness: number;
  burnt: number;
}

export interface StageInput {
  /** Which sequence: the hero lift ("a") or the sticky turntable ("b"). */
  seq: "a" | "b";
  /** Fractional frame index. */
  frame: number;
  /** The frame the scroll position asks for; `frame` eases towards it. */
  target: number;
  /** 0 = cover the screen, 1 = the sticky "live" layout. */
  dock: number;
  /** Nudge of the cover layout, as a fraction of the screen (the hero sits right of the copy). */
  shift: [number, number];
  /** Scale of the cover layout (below 1 shows the whole shot on tall phone screens). */
  zoom: number;
  led: LedState;
  visible: boolean;
}

export class Stage {
  private ctx: CanvasRenderingContext2D;
  private fx: Smoke;
  private variant: Variant;
  private a: FrameSet;
  private bOff: FrameSet;
  private bOn: FrameSet;
  /** Image format the frames download as, settled before the first download. */
  private ext = "webp";
  private w = 0;
  private h = 0;
  private dpr = 1;
  private dirty = true;
  private last = "";
  private onReady: () => void;

  constructor(
    private root: HTMLElement,
    onReady: () => void,
  ) {
    this.onReady = onReady;
    const canvas = root.querySelector<HTMLCanvasElement>(".stage-canvas")!;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.fx = new Smoke(root.querySelector<HTMLCanvasElement>(".stage-fx")!);
    this.variant = Stage.pickVariant();
    this.resize();
    // The smallest frame size that covers the screen: the stage draws a frame at least as
    // wide as this in the cover layout.
    const aspect = this.variant === "m" ? 0.5 : 16 / 9;
    const tier = pickTier(this.variant, Math.max(this.w, this.h * aspect));
    // Decoded frames are big (a 1080p one is ~8 MB), so each sequence gets a memory budget.
    const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
    const mb = 1024 * 1024 * (this.variant === "m" ? 0.5 : 1) * (mem <= 4 ? 0.5 : 1);
    const pad = (i: number) => String(i).padStart(4, "0");
    const set = (dir: string, n: number, budget: number) =>
      new FrameSet(n, (i) => `${import.meta.env.BASE_URL}frames/${dir}/${tier.name}/${pad(i)}.${this.ext}`, tier.size, budget);
    this.a = set("a", seqA.frames.length, 320 * mb);
    this.bOff = set("b/off", seqB.frames.length, 120 * mb);
    this.bOn = set("b/on", seqB.frames.length, 120 * mb);
    for (const s of [this.a, this.bOff, this.bOn]) s.onLoad = () => (this.dirty = true);
  }

  static pickVariant(): Variant {
    return innerWidth / innerHeight < 0.8 ? "m" : "d";
  }

  async load(startFrame: number): Promise<void> {
    const start = Math.round(startFrame);
    this.ext = await pickFormat();
    // The first frame on its own, so the hero shows at once.
    await this.a.load(start, true);
    this.onReady();
    const { a: sa, bOff, bOn } = this;
    const a = sa.order([start]).map((i) => () => sa.load(i));
    const b = bOff.order().flatMap((i) => [() => bOff.load(i), () => bOn.load(i)]);
    // The hero sequence first, but the sticky pose's first frames early so the docked LED never waits.
    await loadInOrder([...a.slice(0, 12), b[0], b[1], ...a.slice(12), ...b.slice(2)]);
  }

  resize(): void {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    const r = this.root.getBoundingClientRect();
    this.w = Math.round(r.width * this.dpr);
    this.h = Math.round(r.height * this.dpr);
    const c = this.ctx.canvas;
    c.width = this.w;
    c.height = this.h;
    this.fx.resize(this.w, this.h, this.dpr);
    this.dirty = true;
  }

  /** Maps a point in the full 16:9 render (0-1) into the current variant's image (0-1). */
  private toImage([x, y]: Pt): Pt {
    return this.variant === "m" ? [(x - CROP_X) / CROP_W, y] : [x, y];
  }

  private cover(iw: number, ih: number): Placement {
    const s = Math.max(this.w / iw, this.h / ih);
    return { s, x: (this.w - iw * s) / 2, y: (this.h - ih * s) / 2 };
  }

  /** The sticky layout: LED beside the copy on wide screens, above it on phones. */
  private docked(iw: number, ih: number): Placement {
    const m = seqB.frames[0] as Meta;
    const wide = this.w / this.h >= 0.8 && this.w / this.dpr > 860;
    // The "top" mark sits a little below the crown of the dome, so measure from the crown.
    const top = this.toImage([m.top[0], m.top[1] - DOME_CROWN]);
    const legs = this.toImage(m.legs);
    const ledH = (legs[1] - top[1]) * ih;
    // Phones: the LED fills the top of the screen above the rig, which pins at 41% down.
    // The nav bar stays hidden there, so only a small margin is left.
    const gapTop = 18 * this.dpr;
    const gapBottom = this.h * 0.41 - 10 * this.dpr;
    const targetH = wide ? this.h * 0.66 : Math.max(this.h * 0.18, gapBottom - gapTop);
    const s = targetH / ledH;
    const cx = (top[0] + legs[0]) / 2;
    const cy = (top[1] + legs[1]) / 2;
    const tx = wide ? 0.73 : 0.5;
    const ty = wide ? 0.56 : (gapTop + targetH / 2) / this.h;
    return { s, x: tx * this.w - cx * iw * s, y: ty * this.h - cy * ih * s };
  }

  update(input: StageInput, dt: number): void {
    // Keep decoded only what the current scroll position can reach soon.
    if (input.seq === "a") {
      this.a.focus(input.frame, 12, 6, input.target);
      this.bOff.focus(0, 4);
      this.bOn.focus(0, 4);
    } else {
      this.a.focus(this.a.count - 1, 4);
      this.bOff.focus(input.frame, 6, 4, input.target);
      this.bOn.focus(input.frame, 6, 4, input.target);
    }
    const smokeBusy = this.fx.update(dt);
    const key = JSON.stringify(input);
    if (!this.dirty && key === this.last && !smokeBusy) return;
    this.last = key;
    this.dirty = false;
    if (!input.visible) return;
    this.draw(input);
  }

  smokeAt(input: StageInput, amount: number): void {
    const p = this.screenPoint(input, "top");
    if (p) this.fx.burst(p[0], p[1], amount);
  }

  /** Where a point of the LED is on screen right now, in canvas pixels. */
  private screenPoint(input: StageInput, which: "dome" | "top"): Pt | null {
    const img = this.frameImage(input.seq, input.frame);
    if (!img) return null;
    const pl = this.place(img, input.dock, input.shift, input.zoom);
    const meta = this.meta(input.seq, input.frame);
    const [x, y] = this.toImage(meta[which]);
    return [pl.x + x * img.width * pl.s, pl.y + y * img.height * pl.s];
  }

  private meta(seq: "a" | "b", frame: number): Meta {
    const frames = (seq === "a" ? seqA.frames : seqB.frames) as Meta[];
    return frames[Math.max(0, Math.min(frames.length - 1, Math.round(frame)))];
  }

  private frameImage(seq: "a" | "b", frame: number): ImageBitmap | null {
    return (seq === "a" ? this.a : this.bOff).nearest(frame);
  }

  private place(img: ImageBitmap, dock: number, shift: [number, number], zoom = 1): Placement {
    const iw = img.width;
    const ih = img.height;
    const c = this.cover(iw, ih);
    c.s *= zoom;
    c.x = (this.w - iw * c.s) / 2 + shift[0] * this.w;
    c.y = (this.h - ih * c.s) / 2 + shift[1] * this.h;
    if (dock <= 0) return c;
    const d = this.docked(iw, ih);
    const k = dock;
    return { s: c.s + (d.s - c.s) * k, x: c.x + (d.x - c.x) * k, y: c.y + (d.y - c.y) * k };
  }

  private draw(input: StageInput): void {
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.w, this.h);

    const set = input.seq === "a" ? this.a : this.bOff;
    const i0 = Math.floor(input.frame);
    const frac = input.frame - i0;
    const base = set.nearest(i0);
    if (!base) return;
    const pl = this.place(base, input.dock, input.shift, input.zoom);
    const dw = base.width * pl.s;
    const dh = base.height * pl.s;
    ctx.imageSmoothingQuality = "high";

    const blend = (s: Frames, alpha: number) => {
      const a = s.get(i0) ?? s.nearest(i0);
      if (!a) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(a, pl.x, pl.y, dw, dh);
      const b = s.get(i0 + 1);
      if (frac > 0.01 && b) {
        ctx.globalAlpha = alpha * frac;
        ctx.drawImage(b, pl.x, pl.y, dw, dh);
      }
    };

    blend(set, 1);
    if (input.seq !== "b") {
      this.feather(pl.x, pl.y, dw, dh);
      return;
    }

    const { brightness, burnt } = input.led;
    const lit = Math.max(0, brightness) * (1 - burnt);
    if (lit > 0.001) {
      blend(this.bOn, Math.min(1, lit));
      if (lit > 1) {
        ctx.globalCompositeOperation = "lighter";
        blend(this.bOn, Math.min(1, (lit - 1) * 0.55));
      }
    }
    // After the lit frames, so their red wash fades out at the frame's edges too.
    this.feather(pl.x, pl.y, dw, dh, input.dock);

    const dome = this.toImage(this.meta("b", input.frame).dome);
    const cx = pl.x + dome[0] * dw;
    const cy = pl.y + dome[1] * dh;
    const r = dh * 0.11;
    if (lit > 0.001) {
      // A soft halo that grows with the current; the frames carry the near glow.
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 1;
      const hr = r * (1.6 + lit * 1.4);
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, hr);
      const k = Math.min(1, lit * 0.5) * 0.35;
      halo.addColorStop(0, `rgba(255,60,40,${k})`);
      halo.addColorStop(0.35, `rgba(255,30,20,${k * 0.35})`);
      halo.addColorStop(1, "rgba(255,0,0,0)");
      ctx.fillStyle = halo;
      // Fill the gradient's whole circle: a smaller square cuts a hard box into the glow.
      ctx.fillRect(cx - hr, cy - hr, hr * 2, hr * 2);
      if (lit > 1.2) {
        const hot = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.9);
        const w = Math.min(0.7, (lit - 1.2) * 0.35);
        hot.addColorStop(0, `rgba(255,235,220,${w})`);
        hot.addColorStop(1, "rgba(255,120,90,0)");
        ctx.fillStyle = hot;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
    if (burnt > 0) {
      // Scorch the dome: darken and brown it where the die cooked.
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = burnt;
      const scorch = ctx.createRadialGradient(cx, cy - r * 0.15, 0, cx, cy, r * 0.75);
      scorch.addColorStop(0, "rgb(40,22,18)");
      scorch.addColorStop(0.6, "rgb(90,60,55)");
      scorch.addColorStop(1, "rgb(255,255,255)");
      ctx.fillStyle = scorch;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  /** Where the frame doesn't reach the screen edge, fade its edge into the black. */
  private feather(x: number, y: number, w: number, h: number, dock = 0): void {
    const { ctx } = this;
    const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    };
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // Docked, the frame is smaller than the screen and its glow needs a longer fade.
    const f = Math.min(w, h) * (0.18 + 0.17 * dock);
    if (x > 0) edge(x, 0, x + f, 0, x, y, f, h);
    if (x + w < this.w) edge(x + w, 0, x + w - f, 0, x + w - f, y, f, h);
    if (y > 0) edge(0, y, 0, y + f, x, y, w, f);
    if (y + h < this.h) edge(0, y + h, 0, y + h - f, x, y + h - f, w, f);
  }

  /** The new LED doesn't smoke: stop the trickle from the old one. */
  stopSmoke(): void {
    this.fx.stop();
  }

  /** The smoke keeps rising from wherever the LED is. */
  trackSmoke(input: StageInput): void {
    const p = this.screenPoint(input, "top");
    if (p) this.fx.setSource(p[0], p[1], this.dpr);
  }
}
