/** Magic smoke: soft grey puffs that billow up from a cooked LED, plus a few sparks. */

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  grow: number;
  rot: number;
  spin: number;
  age: number;
  life: number;
  alpha: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

export class Smoke {
  private ctx: CanvasRenderingContext2D;
  private puffs: Puff[] = [];
  private sparks: Spark[] = [];
  private sprite: HTMLCanvasElement;
  private sx = 0;
  private sy = 0;
  private scale = 1;
  private emitting = 0;
  private w = 0;
  private h = 0;
  private drawn = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.sprite = Smoke.makeSprite();
  }

  /** A lumpy, soft-edged puff made from overlapping blurred blobs. */
  private static makeSprite(): HTMLCanvasElement {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 22; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * size * 0.18;
      const x = size / 2 + Math.cos(a) * d;
      const y = size / 2 + Math.sin(a) * d;
      const r = size * (0.16 + rand() * 0.18);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(255,255,255,0.16)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    return c;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = this.canvas.width = w;
    this.h = this.canvas.height = h;
    this.scale = dpr;
  }

  setSource(x: number, y: number, scale: number): void {
    this.sx = x;
    this.sy = y;
    this.scale = scale;
  }

  /** A pop of smoke and sparks; keeps trickling for `amount` seconds afterwards. */
  burst(x: number, y: number, amount: number): void {
    this.sx = x;
    this.sy = y;
    this.emitting = amount;
    const s = this.scale * (this.h / this.scale / 900);
    for (let i = 0; i < 18; i++) this.addPuff(s, 1.5);
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = (180 + Math.random() * 420) * s;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 0.35 + Math.random() * 0.45 });
    }
  }

  private addPuff(s: number, kick = 1): void {
    this.puffs.push({
      x: this.sx + (Math.random() - 0.5) * 14 * s,
      y: this.sy + (Math.random() - 0.5) * 6 * s,
      vx: (Math.random() - 0.5) * 40 * s * kick,
      vy: (-60 - Math.random() * 70) * s * kick,
      r: (16 + Math.random() * 18) * s,
      grow: (34 + Math.random() * 30) * s,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.8,
      age: 0,
      life: 2.6 + Math.random() * 2.2,
      alpha: 0.55 + Math.random() * 0.35,
    });
  }

  /** Stops new smoke; what's already in the air drifts off and fades as usual. */
  stop(): void {
    this.emitting = 0;
  }

  /** Steps the simulation; returns true while anything is still visible. */
  update(dt: number): boolean {
    dt = Math.min(dt, 0.05);
    const s = this.scale * (this.h / this.scale / 900);
    if (this.emitting > 0) {
      this.emitting -= dt;
      const rate = 26 * Math.min(1, this.emitting / 2 + 0.2);
      if (Math.random() < rate * dt) this.addPuff(s);
    }
    const { ctx } = this;
    const busy = this.puffs.length > 0 || this.sparks.length > 0;
    if (!busy) {
      // Wipe the last frame once, so nothing is left hanging when the final puff goes.
      if (this.drawn) ctx.clearRect(0, 0, this.w, this.h);
      this.drawn = false;
      return false;
    }
    this.drawn = true;
    ctx.clearRect(0, 0, this.w, this.h);

    ctx.globalCompositeOperation = "source-over";
    for (const p of this.puffs) {
      p.age += dt;
      // Drift: rising, slowing, with a gentle sideways curl.
      p.vx += Math.sin(p.age * 1.7 + p.rot) * 14 * s * dt;
      p.vy *= 1 - 0.35 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.grow * dt;
      p.rot += p.spin * dt;
      // Clamped: past the end of its life pow() of a negative is NaN, which canvas ignores,
      // so the puff would be drawn at whatever alpha came before and never cleared.
      const t = Math.min(1, p.age / p.life);
      const fade = t < 0.08 ? t / 0.08 : Math.pow(1 - t, 1.6);
      ctx.globalAlpha = Math.max(0, fade * p.alpha);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const d = p.r * 2;
      ctx.drawImage(this.sprite, -p.r, -p.r, d, d);
      ctx.restore();
    }
    this.puffs = this.puffs.filter((p) => p.age < p.life);

    ctx.globalCompositeOperation = "lighter";
    for (const k of this.sparks) {
      k.age += dt;
      k.vy += 900 * s * dt;
      const px = k.x;
      const py = k.y;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      const t = Math.max(0, 1 - k.age / k.life);
      ctx.globalAlpha = Math.max(0, t);
      ctx.strokeStyle = `rgb(255,${180 + 60 * t | 0},${90 + 120 * t | 0})`;
      ctx.lineWidth = 1.6 * this.scale;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(k.x, k.y);
      ctx.stroke();
    }
    this.sparks = this.sparks.filter((k) => k.age < k.life);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    return true;
  }
}
