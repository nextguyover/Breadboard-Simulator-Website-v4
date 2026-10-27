/**
 * The "turn the knob" demo: a 9 V battery, a resistor and a red LED. The current comes
 * from the diode equation (solved properly, not faked), and too much of it for too long
 * cooks the LED.
 */

const SUPPLY = 9;
const N_VT = 2 * 0.02585; // emission coefficient x thermal voltage
const I_SAT = 1.1e-18; // fits a red LED: about 1.9 V at 10 mA
const R_SERIES = 5; // the LED's own bulk resistance
const RATED = 0.02; // 20 mA
const SAFE = 0.03; // above this it starts to cook
const COOK = 1.4; // stress at which it fails

/** E12 values from 47 Ω to 10 kΩ: the resistors you'd actually find in a kit. */
const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const RESISTORS = [10, 100, 1000]
  .flatMap((d) => E12.map((m) => Math.round(m * d * 10) / 10))
  .concat([10000])
  .filter((r) => r >= 47);

export function ledCurrent(r: number): number {
  // Solve SUPPLY = I·R + Vd(I) by bisection; Vd rises monotonically with I.
  let lo = 0;
  let hi = SUPPLY / r;
  for (let k = 0; k < 60; k++) {
    const i = (lo + hi) / 2;
    const v = i * r + N_VT * Math.log(i / I_SAT + 1) + i * R_SERIES;
    if (v > SUPPLY) hi = i;
    else lo = i;
  }
  return (lo + hi) / 2;
}

export const ledDrop = (i: number) => N_VT * Math.log(i / I_SAT + 1) + i * R_SERIES;

/** Perceived brightness, 1 at the 20 mA rating. */
export const brightness = (i: number) => Math.pow(i / RATED, 0.6);

const DIGITS = ["#111", "#7a3b16", "#d11f1f", "#f07c1b", "#f2c21b", "#2f9e44", "#1c6ed5", "#7b3fbf", "#8a8a8a", "#f4f4f4"];

/** Resistor colour bands: two digits and a multiplier. */
export function bands(r: number): string[] {
  const exp = Math.floor(Math.log10(r)) - 1;
  const sig = Math.round(r / 10 ** exp);
  return [DIGITS[Math.floor(sig / 10)], DIGITS[sig % 10], DIGITS[exp] ?? "#c9a24a"];
}

export function formatOhms(r: number): string {
  if (r >= 1000) return `${+(r / 1000).toFixed(1)} kΩ`;
  return `${Math.round(r)} Ω`;
}

function formatAmps(i: number): string {
  const ma = i * 1000;
  return ma >= 10 ? `${ma.toFixed(0)} mA` : `${ma.toFixed(1)} mA`;
}

function formatWatts(p: number): string {
  const mw = p * 1000;
  return mw >= 1000 ? `${(mw / 1000).toFixed(2)} W` : `${mw.toFixed(mw >= 10 ? 0 : 1)} mW`;
}

export interface RigOutput {
  brightness: number;
  burnt: number;
}

export class Rig {
  private slider: HTMLInputElement;
  private index = 0;
  private stress = 0;
  private burnt = false;
  private burntAmount = 0;
  private flash = 0;
  private touched = false;
  private demo: number | null = null;
  /** Fired once, the moment the LED fails. */
  onBurn: (() => void) | null = null;

  constructor(private root: HTMLElement) {
    this.slider = root.querySelector<HTMLInputElement>("[data-slider]")!;
    this.slider.max = String(RESISTORS.length - 1);
    this.slider.step = "1";
    // The slider runs from the biggest resistor (dimmest) to the smallest.
    this.setIndex(RESISTORS.length - 1);
    this.slider.addEventListener("input", () => {
      this.touched = true;
      this.demo = null;
      this.setIndex(RESISTORS.length - 1 - Number(this.slider.value), false);
    });
    root.querySelector("[data-replace]")!.addEventListener("click", () => this.replace());
  }

  get resistance(): number {
    return RESISTORS[this.index];
  }

  private setIndex(i: number, moveSlider = true): void {
    this.index = Math.max(0, Math.min(RESISTORS.length - 1, i));
    if (moveSlider) this.slider.value = String(RESISTORS.length - 1 - this.index);
    const fill = (Number(this.slider.value) / Number(this.slider.max)) * 100;
    this.slider.style.setProperty("--fill", `${fill}%`);
    this.render();
  }

  /** Glides the knob to a value, as if someone turned it, unless the visitor already has. */
  demoTo(r: number, ms = 1600): void {
    if (this.touched || this.burnt) return;
    const target = RESISTORS.reduce((best, v, k) => (Math.abs(Math.log(v / r)) < Math.abs(Math.log(RESISTORS[best] / r)) ? k : best), 0);
    const from = this.index;
    const t0 = performance.now();
    const token = Math.random();
    this.demo = token;
    const step = (now: number) => {
      if (this.demo !== token) return;
      const u = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - u, 3);
      this.setIndex(Math.round(from + (target - from) * e));
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private replace(): void {
    this.burnt = false;
    this.stress = 0;
    this.root.querySelector<HTMLElement>("[data-burnt]")!.hidden = true;
    this.touched = false;
    this.setIndex(RESISTORS.indexOf(1000));
    this.demoTo(470, 1200);
  }

  private current(): number {
    return this.burnt ? 0 : ledCurrent(this.resistance);
  }

  /** Advances the heating model; returns what the stage should show. */
  tick(dt: number): RigOutput {
    const i = this.current();
    if (!this.burnt) {
      if (i > SAFE) this.stress += dt * Math.pow((i - SAFE) / SAFE, 1.2);
      else this.stress = Math.max(0, this.stress - dt * 0.5);
      if (this.stress > COOK) this.burn();
    }
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.burntAmount = this.burnt ? Math.min(1, this.burntAmount + dt * 1.5) : Math.max(0, this.burntAmount - dt * 4);
    let b = brightness(i);
    // Under stress the die flickers as it heats.
    if (this.stress > COOK * 0.45) b *= 1 + (Math.random() - 0.5) * 0.5 * (this.stress / COOK);
    this.root.querySelector<HTMLElement>("[data-rig]")?.style.setProperty("--heat", String(Math.min(1, this.stress / COOK)));
    return { brightness: b + this.flash * 4, burnt: this.burntAmount };
  }

  private burn(): void {
    this.burnt = true;
    this.flash = 1;
    this.demo = null;
    this.root.querySelector<HTMLElement>("[data-burnt]")!.hidden = false;
    navigator.vibrate?.(40);
    this.render();
    this.onBurn?.();
  }

  private render(): void {
    const r = this.resistance;
    const i = this.current();
    const q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    q<HTMLOutputElement>("[data-r]").textContent = formatOhms(r);
    q("[data-i]").textContent = formatAmps(i);
    q("[data-vf]").textContent = `${(this.burnt ? 0 : ledDrop(i)).toFixed(2)} V`;
    q("[data-p]").textContent = formatWatts(i * i * r);

    const colours = bands(r);
    this.root.querySelectorAll<SVGRectElement>("[data-band]").forEach((el) => {
      el.setAttribute("fill", colours[Number(el.dataset.band)]);
    });

    const state = q<HTMLElement>("[data-state]");
    const ma = i * 1000;
    const [label, level] = this.burnt
      ? ["Burnt out", "dead"]
      : ma > 40
        ? ["Overheating", "danger"]
        : ma > 25
          ? ["Too bright", "warn"]
          : ma > 4
            ? ["Bright", "ok"]
            : ["Dim", "dim"];
    state.textContent = label;
    state.dataset.level = level;

    const meter = Math.min(1, i / 0.05);
    const m = q<HTMLElement>("[data-meter]");
    m.style.setProperty("--m", `${meter * 100}%`);
    m.style.setProperty("--mf", String(meter));

    const svg = q<SVGElement>(".rig-schematic");
    svg.style.setProperty("--flow", String(Math.min(1, ma / 6)));
    svg.style.setProperty("--flow-speed", `${Math.max(0.12, Math.min(2.5, 12 / Math.max(ma, 0.5)))}s`);
    svg.style.setProperty("--rays", String(Math.min(1, brightness(i))));
  }
}
