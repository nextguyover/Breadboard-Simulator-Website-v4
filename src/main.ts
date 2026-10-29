import "./styles.css";
import seqA from "./data/seq-a.json";
import seqB from "./data/seq-b.json";
import { Rig } from "./circuit";
import { EXAMPLES, LEVEL_COLOURS, PART_COUNT, PART_GROUPS } from "./content";
import { startLogic, startScope } from "./scope";
import { Stage, type StageInput } from "./stage";
import { startShare } from "./share";

const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(s));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const A_LAST = seqA.frames.length - 1;
const B_LAST = seqB.frames.length - 1;

// ---------- Static content ----------

function buildDrawer(): void {
  const root = $("[data-drawer]");
  const tabs = document.createElement("div");
  tabs.className = "drawer-tabs";
  tabs.setAttribute("role", "tablist");
  const grid = document.createElement("div");
  grid.className = "drawer-grid";
  root.append(tabs, grid);

  const show = (k: number) => {
    $$(".drawer-tab", tabs).forEach((t, i) => t.setAttribute("aria-selected", String(i === k)));
    grid.replaceChildren(
      ...PART_GROUPS[k].parts.map((p, i) => {
        const el = document.createElement("figure");
        el.className = "part";
        el.style.setProperty("--i", String(i));
        el.innerHTML = `<img src="${import.meta.env.BASE_URL}parts/${p.img}.webp" alt="" loading="lazy" decoding="async" width="320" height="320" /><figcaption><b>${p.name}</b><small>${p.detail}</small></figcaption>`;
        return el;
      }),
    );
  };
  PART_GROUPS.forEach((g, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "drawer-tab";
    b.setAttribute("role", "tab");
    b.innerHTML = `${g.name}<span>${g.parts.length}</span>`;
    b.addEventListener("click", () => show(k));
    tabs.append(b);
  });
  show(0);

  const names = PART_GROUPS.flatMap((g) => g.parts.map((p) => [p.name, p.detail]));
  $$("[data-marquee]").forEach((track, row) => {
    const list = names.filter((_, i) => i % 2 === row);
    const html = list.map(([n, d]) => `<span><b>${n}</b>${d}</span>`).join("");
    track.innerHTML = html + html;
  });
  $$(".big-num").forEach((el) => (el.textContent = String(PART_COUNT)));
}

function buildExamples(): void {
  $("[data-examples]").innerHTML = EXAMPLES.map(
    (e) => `<li style="--c:${LEVEL_COLOURS[e.level]}"><span class="lvl" title="${e.level}"></span><b>${e.title}</b><span>${e.text}</span></li>`,
  ).join("");
}

// ---------- Reveal on scroll ----------

function reveals(): void {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  // Stagger siblings that come in together.
  const groups = new Map<Element, number>();
  for (const el of $$(".reveal")) {
    const parent = el.parentElement!;
    const n = groups.get(parent) ?? 0;
    groups.set(parent, n + 1);
    (el as HTMLElement).style.setProperty("--d", `${Math.min(n, 6) * 0.07}s`);
    io.observe(el);
  }
}

/** Cards light up under the pointer. */
function cardGlow(): void {
  for (const card of $$(".card")) {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  }
}

function counters(): void {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target as HTMLElement;
      const to = Number(el.dataset.count);
      if (!to || reduced) continue;
      const t0 = performance.now();
      const tick = (now: number) => {
        const u = clamp01((now - t0) / 1400);
        el.textContent = String(Math.round(to * (1 - Math.pow(1 - u, 4))));
        if (u < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  });
  $$("[data-count]").forEach((el) => io.observe(el));
}

function faq(): void {
  for (const d of $$<HTMLDetailsElement>(".faq-list details")) {
    d.addEventListener("toggle", () => {
      d.classList.toggle("opening", d.open);
    });
  }
}

function nav(): void {
  const el = $("[data-nav]");
  const links = $$<HTMLAnchorElement>(".nav-links a");
  const sections = links.map((a) => document.querySelector(a.hash));
  let lastY = scrollY;
  // Where the current scroll direction started, so a small nudge back doesn't flip the bar.
  let turnY = scrollY;
  let hidden = false;
  const rig = $(".rig");
  const end = $("[data-seq-end]");
  /**
   * The bar cuts across the LED, so it stays away for the scroll story and the live demo
   * (until the rig has left the screen) and for the bookend, which has its own button.
   * Everywhere else, in the reading sections, a scroll up brings it back.
   */
  const immersive = (y: number) => {
    const vh = innerHeight;
    const endR = end.getBoundingClientRect();
    if (y > vh * 0.15 && rig.getBoundingClientRect().bottom > 0) return true;
    return endR.top < vh * 0.5 && endR.bottom > vh;
  };
  const update = () => {
    const y = scrollY;
    el.classList.toggle("scrolled", y > 40);
    // Tuck away while scrolling down through the long sequences; come back only after a
    // deliberate scroll up (or near the top), not on every small wobble.
    if ((y > lastY) !== (lastY > turnY)) turnY = lastY;
    if (y < innerHeight * 0.6) hidden = false;
    else if (y > turnY + 12) hidden = true;
    else if (y < turnY - 72) hidden = false;
    el.classList.toggle("hidden", hidden || immersive(y));
    lastY = y;
    const mid = innerHeight * 0.4;
    let active = -1;
    sections.forEach((s, i) => {
      if (s && s.getBoundingClientRect().top < mid) active = i;
    });
    links.forEach((a, i) => a.classList.toggle("active", i === active));
  };
  addEventListener("scroll", update, { passive: true });
  update();
}

// ---------- The stage and the scroll story ----------

const phone = matchMedia("(max-width: 860px), (max-aspect-ratio: 4/5)");

interface Geometry {
  heroTop: number;
  heroRun: number;
  liveTop: number;
  liveRun: number;
  coverTop: number;
  endTop: number;
  endRun: number;
}

function measure(): Geometry {
  const top = (el: Element) => el.getBoundingClientRect().top + scrollY;
  const hero = $("[data-seq]");
  const live = $("[data-live]");
  const end = $("[data-seq-end]");
  const vh = innerHeight;
  return {
    heroTop: top(hero),
    heroRun: Math.max(1, hero.offsetHeight - vh),
    liveTop: top(live),
    liveRun: Math.max(1, live.offsetHeight),
    coverTop: top($("#engine")),
    endTop: top(end),
    endRun: Math.max(1, end.offsetHeight - vh),
  };
}

function story(): void {
  const stageEl = $(".stage");
  const heroCopy = $("[data-hero]");
  const cue = $("[data-cue]");
  const pin = $("[data-seq] .seq-pin");
  const beats = $$("[data-beat]").map((el) => {
    const [a, b] = el.dataset.beat!.split(",").map(Number);
    return { el, a, b };
  });
  const endCopy = $("[data-end]");
  const rig = new Rig($("[data-live]"));

  let geo = measure();
  let frame = 0;
  let dock = 0;
  let last = performance.now();
  let demoDone = false;

  const stage = new Stage(stageEl, () => stageEl.classList.add("ready"));
  const fxEl = $(".stage-fx", stageEl);
  stage.load(0);

  const input: StageInput = { seq: "a", frame: 0, target: 0, dock: 0, shift: [0, 0], zoom: 1, led: { brightness: 0, burnt: 0 }, visible: true };
  rig.onBurn = () => {
    stage.smokeAt(input, 3.5);
  };
  rig.onReplace = () => stage.stopSmoke();

  // Phones: pin the rig to the bottom of the screen, whatever its height (the burnt message
  // makes it taller), and tell the stage so the LED fills the space above it.
  const rigEl = $(".rig");
  const pinRig = () => {
    if (!phone.matches) return;
    const top = Math.round(innerHeight - rigEl.offsetHeight - 14);
    document.documentElement.style.setProperty("--rig-top", `${top}px`);
    stage.setRigTop(top);
  };
  new ResizeObserver(pinRig).observe(rigEl);
  addEventListener("resize", pinRig);
  pinRig();

  const onResize = () => {
    geo = measure();
    stage.resize();
  };
  addEventListener("resize", onResize);
  new ResizeObserver(() => (geo = measure())).observe(document.body);

  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const y = scrollY;
    const vh = innerHeight;

    // Hero sequence progress, 0-1 across the pinned run.
    const heroP = clamp01((y - geo.heroTop) / geo.heroRun);
    // Docking: as the live section scrolls up, the LED glides into its sticky spot.
    const dockP = smooth(clamp01((y - (geo.liveTop - vh)) / (vh * 0.85)));
    const liveP = clamp01((y - (geo.liveTop - vh)) / (geo.liveRun + vh * 0.2));
    const endP = clamp01((y - geo.endTop) / geo.endRun);
    const inEnd = y > geo.endTop - vh;

    let seq: "a" | "b";
    let target: number;
    let targetDock: number;
    if (inEnd) {
      // The bookend: back down into the board, lighting as the legs go in.
      seq = "a";
      target = A_LAST * (1 - smooth(clamp01(endP * 1.15)));
      targetDock = 0;
    } else if (dockP > 0) {
      seq = "b";
      target = B_LAST * liveP;
      targetDock = dockP;
    } else {
      seq = "a";
      target = A_LAST * heroP;
      targetDock = 0;
    }

    // Ease towards the scroll position so scrubbing feels weighty rather than steppy.
    if (seq !== input.seq) frame = target;
    const k = reduced ? 1 : 1 - Math.pow(0.0008, dt);
    frame += (target - frame) * k;
    if (Math.abs(target - frame) < 0.002) frame = target;
    dock += (targetDock - dock) * k;
    if (Math.abs(targetDock - dock) < 0.0005) dock = targetDock;

    // On wide screens the LED sits right of the copy; on phones the bookend drops it below the title.
    const wide = innerWidth / innerHeight >= 0.8 && innerWidth > 860;
    input.shift = wide ? [0.16, 0] : [0, inEnd ? 0.17 : -0.1];
    input.zoom = wide ? 1 : inEnd ? 0.72 : 0.8;

    const led = rig.tick(dt);
    input.seq = seq;
    input.frame = Math.round(frame * 1000) / 1000;
    input.target = Math.round(target);
    input.dock = Math.round(dock * 1000) / 1000;
    input.led = seq === "b" ? { brightness: Math.round(led.brightness * 1000) / 1000, burnt: led.burnt } : { brightness: 0, burnt: 0 };
    // Once an opaque section covers the screen there's nothing to draw until the bookend.
    input.visible = y < geo.coverTop || inEnd;
    stage.trackSmoke(input);
    stage.update(input, dt);
    // The smoke belongs to the live demo: fade it with the LED's docking, gone elsewhere.
    const smokeO = seq === "b" ? String(Math.round(Math.min(1, dock * 2) * 100) / 100) : "0";
    if (fxEl.style.opacity !== smokeO) fxEl.style.opacity = smokeO;

    // Hero copy leaves first, then the story beats come and go.
    const out = clamp01(heroP / 0.1);
    heroCopy.style.opacity = String(1 - out);
    heroCopy.style.transform = `translateY(${-out * 60}px)`;
    heroCopy.style.pointerEvents = out > 0.5 ? "none" : "";
    cue.style.opacity = String(1 - clamp01(heroP / 0.03));
    pin.style.setProperty("--shade", String(1 - 0.6 * clamp01(heroP / 0.15)));
    for (const b of beats) {
      const fade = 0.045;
      const o = Math.min(clamp01((heroP - b.a) / fade), clamp01((b.b - heroP) / fade));
      const travel = (heroP - (b.a + b.b) / 2) / (b.b - b.a);
      b.el.style.opacity = String(o);
      b.el.style.transform = `translateY(${-travel * 50}px)`;
    }

    // Light the LED for the visitor the first time the live circuit comes into view.
    if (!demoDone && dockP > 0.9) {
      demoDone = true;
      rig.demoTo(470);
    }

    const e = clamp01((endP - 0.55) / 0.3);
    endCopy.style.opacity = String(e);
    endCopy.style.transform = `translateY(${(1 - e) * 40}px)`;
    endCopy.style.pointerEvents = e > 0.5 ? "" : "none";

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** Phones: once the rig pins under the LED, fade the copy above it as it scrolls over the LED. */
function liveCopyFade(): void {
  const rig = $("[data-rig]");
  const copy = $$(".live-copy > :not([data-rig])");
  const last = copy.filter((el) => el.matches(".lede")).pop() ?? copy[copy.length - 1];
  const gap0 = parseFloat(getComputedStyle(rig).marginTop) || 0;
  const update = () => {
    let f = 1;
    if (phone.matches) {
      // How far the copy has pulled away from the pinned rig: 0 until it pins.
      const pulled = rig.getBoundingClientRect().top - last.getBoundingClientRect().bottom - gap0;
      f = 1 - smooth(clamp01(pulled / 140));
    }
    for (const el of copy) el.style.opacity = f < 1 ? String(f) : "";
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
}

// ---------- Boot ----------

/**
 * Wide screens: the live section pins to the top of the screen. When it is taller than the
 * screen (short windows, or once the burnt message shows), pin it with its bottom on screen
 * instead, so the rig is never cut off.
 */
function fitLivePin(): void {
  const inner = $(".live-inner");
  const fit = () => {
    // Phones lay it out in flow (position: relative), where a top offset would shift it up
    // over the hero.
    inner.style.top = phone.matches ? "" : `${Math.min(0, innerHeight - inner.offsetHeight)}px`;
  };
  new ResizeObserver(fit).observe(inner);
  addEventListener("resize", fit);
  fit();
}

buildDrawer();
buildExamples();
reveals();
cardGlow();
counters();
faq();
nav();
story();
liveCopyFade();
fitLivePin();
startScope($("[data-scope]"));
startLogic($("[data-logic]"));
startShare($("[data-linkbox]"));
$("[data-year]").textContent = String(new Date().getFullYear());
