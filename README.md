# Breadboard Simulator website

The marketing site for [Breadboard Simulator](https://app.breadboardsimulator.com), served from
breadboardsimulator.com. It's a static site: Vite, TypeScript and plain CSS, no framework.

```sh
npm install
npm run dev      # local dev server
npm run build    # static site in dist/
```

The hero is a scroll-scrubbed sequence of Blender renders drawn on a canvas (`src/stage.ts`).
The frames in `public/frames/` and the part shots in `public/parts/` are generated; see
[`render/README.md`](render/README.md) to re-render them. `src/data/seq-*.json` holds where the
LED is on screen in each frame, written by `render/anim.py --meta`.
