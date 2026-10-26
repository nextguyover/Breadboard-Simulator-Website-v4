"""Post-processing for rendered frames: soft bloom around the LED, a gentle vignette
and film grain, then export as WebP/AVIF-ready 8-bit images.

    python render/post.py in.png out.webp [--width 1920]
"""
import sys

import cv2
import numpy as np
from PIL import Image


def load_linear(path):
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED)[..., 2::-1].astype(np.float32)
    a /= 65535.0 if a.max() > 255 else 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def blur(lin, radius):
    return cv2.GaussianBlur(lin, (0, 0), radius)


def bloom(lin, strength=0.9):
    h, w, _ = lin.shape
    scale = w / 1920
    # Only the red glow blooms: the spotlit board stays crisp.
    redness = np.clip(lin[..., 0] - 1.6 * np.maximum(lin[..., 1], lin[..., 2]), 0, None)
    src = lin * (redness / (lin[..., 0] + 1e-4))[..., None]
    glow = 0.5 * blur(src, 6 * scale) + 0.35 * blur(src, 22 * scale) + 0.3 * blur(src, 70 * scale)
    return lin + strength * glow


def vignette(lin, amount=0.35):
    h, w, _ = lin.shape
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
    return lin * (1 - amount * d ** 2.2)[..., None]


def process(src, glow_strength=0.9):
    lin = load_linear(src)
    lin = bloom(lin, glow_strength)
    lin = vignette(lin)
    rgb = to_srgb(lin)
    rng = np.random.default_rng(7)
    rgb = rgb + (rng.standard_normal(rgb.shape[:2])[..., None] * (1.2 / 255))
    return Image.fromarray(np.clip(rgb * 255 + 0.5, 0, 255).astype(np.uint8), "RGB")


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    im = process(src)
    if "--width" in sys.argv:
        w = int(sys.argv[sys.argv.index("--width") + 1])
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(dst, quality=82)
