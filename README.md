# Breadboard Simulator website

The marketing site for [Breadboard Simulator](https://app.breadboardsimulator.com), served from
breadboardsimulator.com. It's a static site: Vite, TypeScript and plain CSS, no framework.

```sh
npm install
npm run dev      # local dev server
npm run build    # static site in dist/
```

The hero is a scroll-scrubbed sequence of Blender renders drawn on a canvas (`src/stage.ts`).
It plays from still frames in `public/frames/`, AVIF with a WebP fallback, in several sizes
(`src/data/frames.json`); each screen downloads only the smallest size that covers it. The
frames are kept compressed and only a window around the scroll position is decoded
(`src/frames.ts`). The frames and the part shots in `public/parts/` are generated; see
[`render/README.md`](render/README.md) to re-render them. `src/data/seq-*.json` holds where the
LED is on screen in each frame, written by `render/anim.py --meta`.

## Deploying

Pushing to the `prod` branch (normally by merging main into it) runs `.github/workflows/deploy.yml`, which
builds the site and publishes it to Cloudflare Pages. It needs the repository secret `CLOUDFLARE_API_TOKEN`
(Account > Cloudflare Pages > Edit); the account ID is in the workflow. `CF_PAGES_PROJECT` overrides the Pages project
name (default `breadboard-simulator-website`).
