"""Grades the rendered PNGs (render/out) and encodes the WebP frames the site plays
(public/frames). Each frame is written twice: 1920x1080 for wide screens ("d") and a
720x1440 centre crop for phones ("m").

    python render/build_frames.py [--only a|b]
"""
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


def encode(job):
    src, dest, glow = job
    im = post.process(src, glow_strength=0.9 * glow)
    w, h = im.size
    desk = im.resize((1920, 1080), Image.LANCZOS)
    cw = round(h / 2)
    crop = im.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h))
    phone = crop.resize((720, 1440), Image.LANCZOS)
    for kind, img in (("d", desk), ("m", phone)):
        path = os.path.join(DEST, dest.format(kind=kind))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        img.save(path, "WEBP", quality=78, method=6)
    return dest


def jobs(only):
    out = []
    if only in (None, "a"):
        meta = json.load(open(os.path.join(META, "seq-a.json")))["frames"]
        for i, m in enumerate(meta):
            out.append((os.path.join(OUT, "a", f"a_{i:04d}.png"), f"a/{{kind}}/{i:04d}.webp", m["glow"]))
    if only in (None, "b"):
        n = len(json.load(open(os.path.join(META, "seq-b.json")))["frames"])
        for state, glow in (("off", 0.0), ("on", 1.0)):
            for i in range(n):
                out.append((os.path.join(OUT, "b", f"{state}_{i:04d}.png"), f"b/{state}/{{kind}}/{i:04d}.webp", glow))
    return [j for j in out if os.path.exists(j[0])]


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    todo = jobs(only)
    with ProcessPoolExecutor() as pool:
        for done in pool.map(encode, todo):
            print(done, flush=True)
    print(len(todo), "frames")
