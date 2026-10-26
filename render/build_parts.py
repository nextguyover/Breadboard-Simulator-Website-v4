"""Encodes the part studio shots (render/out/parts) as WebP for public/parts."""
import glob
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(HERE, "..", "public", "parts")

if __name__ == "__main__":
    os.makedirs(DEST, exist_ok=True)
    for src in sorted(glob.glob(os.path.join(HERE, "out", "parts", "*.png"))):
        name = os.path.splitext(os.path.basename(src))[0]
        im = Image.open(src).convert("RGBA").resize((480, 480), Image.LANCZOS)
        im.save(os.path.join(DEST, f"{name}.webp"), "WEBP", quality=84, method=6)
        print(name)
