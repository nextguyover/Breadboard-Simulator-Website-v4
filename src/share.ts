/**
 * The share-link demo: the link "types" itself out while the parts it carries pop in,
 * then the button copies a real link to the Simple LED example.
 */
import { SAMPLE_LINK } from "./data/sample-link";

const PARTS = [
  ["battery", "9 V battery"],
  ["resistor", "Resistor, 470 Ω"],
  ["led", "Red LED"],
  ["jumper", "2 jumper wires"],
  ["breadboard", "Breadboard"],
];

export function startShare(root: HTMLElement): void {
  const hashEl = root.querySelector<HTMLElement>("[data-hash]")!;
  const partsEl = root.querySelector<HTMLElement>("[data-linkparts]")!;
  const copy = root.querySelector<HTMLButtonElement>("[data-copy]")!;
  const hash = SAMPLE_LINK.slice(SAMPLE_LINK.indexOf("/#"));
  let started = false;

  const run = () => {
    started = true;
    const shown = Math.min(hash.length, 96);
    const t0 = performance.now();
    const dur = 1800;
    let popped = 0;
    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / dur);
      const n = Math.round(shown * u);
      hashEl.textContent = hash.slice(0, n) + (u === 1 && hash.length > shown ? "…" : "");
      const want = Math.floor(u * PARTS.length + 0.001);
      while (popped < want) {
        const [img, label] = PARTS[popped++];
        const chip = document.createElement("span");
        chip.innerHTML = `<img src="${import.meta.env.BASE_URL}parts/${img}.webp" alt="" />${label}`;
        partsEl.append(chip);
      }
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    hashEl.textContent = hash.slice(0, 96) + "…";
    PARTS.forEach(([img, label]) => {
      const chip = document.createElement("span");
      chip.innerHTML = `<img src="${import.meta.env.BASE_URL}parts/${img}.webp" alt="" />${label}`;
      partsEl.append(chip);
    });
    started = true;
  }

  new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting && !started) run();
    },
    { threshold: 0.5 },
  ).observe(root);

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(SAMPLE_LINK);
      copy.textContent = "Copied. Paste it anywhere";
    } catch {
      copy.textContent = "Couldn't copy, sorry";
    }
    setTimeout(() => (copy.textContent = "Copy a sample link"), 2400);
  });
}
