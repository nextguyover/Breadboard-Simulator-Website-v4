"""Grades the rendered PNGs (render/out) and encodes the frames the site plays
(public/frames), in AVIF and WebP and at several sizes, so each screen downloads only the
smallest set that's sharp on it. Wide screens get the full 16:9 render ("d" tiers); phones
get its 1:2 centre crop ("m" tiers).

AVIF is the main format: quality 72 with full-resolution (4:4:4) chroma, which keeps the
red LED's edges clean where 4:2:0 smears them. WebP at q88 is the fallback.
src/data/frames.json lists the tiers, formats, frame counts and bytes per set.

    python render/build_frames.py [--only a|b-off|b-on]
"""
import io
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(HERE, "out")
DEST = os.path.join(ROOT, "public", "frames")
META = os.path.join(ROOT, "src", "data")

# name: (width, height, framing)
TIERS = {
    "d1280": (1280, 720, "d"),
    "d1920": (1920, 1080, "d"),
    "d2560": (2560, 1440, "d"),
    "m540": (540, 1080, "m"),
    "m720": (720, 1440, "m"),
}
FORMATS = {
    "avif": dict(quality=72, subsampling="4:4:4", speed=4),
    "webp": dict(quality=88, method=6),
}
CLIP_DIRS = {"a": "a", "b-off": "b/off", "b-on": "b/on"}


def encode(job):
    clip, i, src, glow = job
    im = post.process(src, glow_strength=0.9 * glow)
    w, h = im.size
    cw = h // 2
    crop = im.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h))
    sizes = {}
    for tier, (tw, th, framing) in TIERS.items():
        base = im if framing == "d" else crop
        img = base if base.size == (tw, th) else base.resize((tw, th), Image.LANCZOS)
        for fmt, opts in FORMATS.items():
            buf = io.BytesIO()
            img.save(buf, fmt.upper(), **opts)
            path = os.path.join(DEST, CLIP_DIRS[clip], tier, f"{i:04d}.{fmt}")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fh:
                fh.write(buf.getvalue())
            sizes[(tier, fmt)] = len(buf.getvalue())
    return clip, i, sizes


def jobs(only):
    seq_a = json.load(open(os.path.join(META, "seq-a.json")))["frames"]
    n_b = len(json.load(open(os.path.join(META, "seq-b.json")))["frames"])
    clips = {
        "a": [(os.path.join(OUT, "a", f"a_{i:04d}.png"), m["glow"]) for i, m in enumerate(seq_a)],
        "b-off": [(os.path.join(OUT, "b", f"off_{i:04d}.png"), 0.0) for i in range(n_b)],
        "b-on": [(os.path.join(OUT, "b", f"on_{i:04d}.png"), 1.0) for i in range(n_b)],
    }
    out = []
    for clip, frames in clips.items():
        if only not in (None, clip):
            continue
        missing = [s for s, _ in frames if not os.path.exists(s)]
        if missing:
            sys.exit(f"{clip}: {len(missing)} rendered frames missing, e.g. {missing[0]}")
        out += [(clip, i, src, glow) for i, (src, glow) in enumerate(frames)]
    return out, {clip: len(frames) for clip, frames in clips.items()}


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    todo, counts = jobs(only)
    index_path = os.path.join(META, "frames.json")
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    index.update({
        "tiers": {t: [w, h] for t, (w, h, _) in TIERS.items()},
        "formats": list(FORMATS),
        "clips": counts,
    })
    totals = {}
    with ProcessPoolExecutor() as pool:
        for clip, i, sizes in pool.map(encode, todo, chunksize=2):
            for (tier, fmt), n in sizes.items():
                totals.setdefault(clip, {}).setdefault(tier, {}).setdefault(fmt, 0)
                totals[clip][tier][fmt] += n
            print(clip, i, flush=True)
    index.setdefault("bytes", {}).update(totals)
    with open(index_path, "w") as fh:
        json.dump(index, fh, indent=1)
    for clip, tiers in totals.items():
        for tier, fmts in tiers.items():
            print(clip, tier, {f: f"{n / 1024:.0f} KB" for f, n in fmts.items()})
