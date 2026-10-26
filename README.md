# Breadboard Simulator website

The marketing site for [Breadboard Simulator](https://app.breadboardsimulator.com), served from
breadboardsimulator.com. It's a static site: Vite, TypeScript and plain CSS, no framework.

```sh
npm install
npm run dev      # local dev server
npm run build    # static site in dist/
```

The hero is a scroll-scrubbed sequence of Blender renders drawn on a canvas (`src/stage.ts`).
It plays from short video clips in `public/video/`, decoded with WebCodecs a keyframe group
at a time into a window of ready frames around the scroll position (`src/video.ts`).
Browsers without WebCodecs fall back to the WebP frames in `public/frames/`. The clips, the
frames and the part shots in `public/parts/` are generated; see
[`render/README.md`](render/README.md) to re-render them. `src/data/seq-*.json` holds where the
LED is on screen in each frame, written by `render/anim.py --meta`.
