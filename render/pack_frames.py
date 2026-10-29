"""Packs each frame set (render/frames/<clip>/<tier>/NNNN.<fmt>, from build_frames.py) into
one file the site streams: public/frames/<clip>/<tier>.<fmt>.bin. A page then makes one
request per sequence instead of hundreds, so the frames arrive as fast as the connection
allows. The first frames come in order, since that is where scrolling starts, then the rest
coarse to fine (every 16th frame, then every 8th, ...) so the whole run can be scrubbed
early and sharpens as the rest streams in.

Layout: a little-endian uint32 header length, the header as UTF-8 JSON
({"type": "image/avif", "frames": [[index, size], ...]} in file order), then the frames.

Also copies the first hero frame of the smallest sizes to public/frames/poster/, which
index.html shows until the canvas is ready.

    python render/pack_frames.py
"""
import json
import os
import shutil
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
SRC = os.path.join(HERE, "frames")
DEST = os.path.join(ROOT, "public", "frames")
TYPES = {"avif": "image/avif", "webp": "image/webp"}
POSTER_TIERS = ("m540", "d1280")


HEAD = 40


def order(n):
    """The first HEAD frames in order, then the last, then every 16th frame, every 8th, ..."""
    out, seen = [], set()
    for i in list(range(min(HEAD, n))) + [n - 1] + [i for step in (16, 8, 4, 2, 1) for i in range(0, n, step)]:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def pack(folder, fmt, dest):
    n = len([f for f in os.listdir(folder) if f.endswith("." + fmt)])
    frames = []
    for i in order(n):
        with open(os.path.join(folder, f"{i:04d}.{fmt}"), "rb") as fh:
            frames.append((i, fh.read()))
    header = json.dumps({"type": TYPES[fmt], "frames": [[i, len(b)] for i, b in frames]}, separators=(",", ":")).encode()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(struct.pack("<I", len(header)))
        fh.write(header)
        for _, b in frames:
            fh.write(b)
    return os.path.getsize(dest)


def main():
    for clip in ("a", "b/off", "b/on"):
        for tier in sorted(os.listdir(os.path.join(SRC, clip))):
            folder = os.path.join(SRC, clip, tier)
            for fmt in TYPES:
                size = pack(folder, fmt, os.path.join(DEST, clip, f"{tier}.{fmt}.bin"))
                print(f"{clip}/{tier}.{fmt}.bin {size / 1024:.0f} KB")
    for tier in POSTER_TIERS:
        for fmt in TYPES:
            os.makedirs(os.path.join(DEST, "poster"), exist_ok=True)
            shutil.copy(os.path.join(SRC, "a", tier, f"0000.{fmt}"), os.path.join(DEST, "poster", f"{tier}.{fmt}"))


if __name__ == "__main__":
    main()
