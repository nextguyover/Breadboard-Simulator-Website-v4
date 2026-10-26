/**
 * A little oscilloscope showing a 555 astable: the timing capacitor ramping between 1/3 and
 * 2/3 of the supply, and the square wave on the output. Drawn as a sweeping, glowing trace.
 */

const VCC = 5;
const R1 = 10e3;
const R2 = 47e3;
const C = 10e-6;
const T_HIGH = Math.LN2 * (R1 + R2) * C; // charging through R1 + R2
const T_LOW = Math.LN2 * R2 * C; // discharging through R2
const PERIOD = T_HIGH + T_LOW;
const SPAN = 2; // seconds across the screen (200 ms/div x 10)
const DIVS_X = 10;
const DIVS_Y = 8;

/** Capacitor voltage and output at time t (steady state). */
function sample(t: number): [number, number] {
  const u = ((t % PERIOD) + PERIOD) % PERIOD;
  const lo = VCC / 3;
  const hi = (2 * VCC) / 3;
  if (u < T_HIGH) {
    const tau = (R1 + R2) * C;
    return [VCC - (VCC - lo) * Math.exp(-u / tau), VCC * 0.96];
  }
  const tau = R2 * C;
  return [hi * Math.exp(-(u - T_HIGH) / tau), 0.08];
}

export function startScope(root: HTMLElement): void {
  const canvas = root.querySelector("canvas")!;
  const ctx = canvas.getContext("2d")!;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let running = false;
  let t0 = performance.now();

  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.width = Math.round(canvas.clientWidth * dpr);
    h = canvas.height = Math.round(canvas.clientHeight * dpr);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const grid = () => {
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < DIVS_X; i++) {
      const x = Math.round((i * w) / DIVS_X) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let j = 1; j < DIVS_Y; j++) {
      const y = Math.round((j * h) / DIVS_Y) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(w / 2 + 0.5, 0);
    ctx.lineTo(w / 2 + 0.5, h);
    ctx.moveTo(0, h / 2 + 0.5);
    ctx.lineTo(w, h / 2 + 0.5);
    ctx.stroke();
  };

  // Each channel's 0 V line, in divisions up from the bottom; 1 V/div.
  const yOf = (v: number, zeroDiv: number) => h - ((zeroDiv + v) / DIVS_Y) * h;

  const frame = (now: number) => {
    if (!running) return;
    const t = (now - t0) / 1000;
    // The sweep: the screen fills left to right, then starts over, like a real scope.
    const sweep = (t % SPAN) / SPAN;
    const start = Math.floor(t / SPAN) * SPAN;
    ctx.clearRect(0, 0, w, h);
    grid();
    const steps = Math.max(200, Math.round(w / 2));
    const trace = (ch: 0 | 1, colour: string, zero: number) => {
      for (const pass of [0, 1]) {
        ctx.beginPath();
        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          // The part past the sweep shows the previous pass, fading out.
          const tt = u <= sweep ? start + u * SPAN : start - SPAN + u * SPAN;
          const y = yOf(sample(tt)[ch], zero);
          const x = u * w;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineJoin = "round";
        ctx.strokeStyle = colour;
        ctx.lineWidth = (pass ? 1.6 : 5) * dpr;
        ctx.globalAlpha = pass ? 1 : 0.18;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    trace(1, "#ffd166", 2.6);
    trace(0, "#59d6ff", 0.6);
    // Fade what's ahead of the beam so the sweep reads.
    const grad = ctx.createLinearGradient(sweep * w, 0, sweep * w + w * 0.18, 0);
    grad.addColorStop(0, "rgba(6,8,7,0.85)");
    grad.addColorStop(1, "rgba(6,8,7,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(sweep * w, 0, w * 0.18, h);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(sweep * w - dpr, 0, 2 * dpr, h);
    requestAnimationFrame(frame);
  };

  new IntersectionObserver(([e]) => {
    const was = running;
    running = e.isIntersecting && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (running && !was) {
      t0 = performance.now() - 1300;
      requestAnimationFrame(frame);
    }
    if (!running && !was) {
      // Reduced motion: one still frame.
      running = true;
      frame(performance.now());
      running = false;
    }
  }).observe(root);
}

/** The AND gate card: inputs toggle, the output follows A AND B. */
export function startLogic(root: HTMLElement): void {
  const [a, b, y] = Array.from(root.querySelectorAll("span"));
  const states: [boolean, boolean][] = [
    [false, false],
    [true, false],
    [true, true],
    [false, true],
    [true, true],
  ];
  let k = 0;
  let timer = 0;
  const step = () => {
    const [sa, sb] = states[k++ % states.length];
    a.classList.toggle("on", sa);
    b.classList.toggle("on", sb);
    y.classList.toggle("on", sa && sb);
  };
  new IntersectionObserver(([e]) => {
    clearInterval(timer);
    if (e.isIntersecting) timer = window.setInterval(step, 1100);
  }).observe(root);
  step();
}
