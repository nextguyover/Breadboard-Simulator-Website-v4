"""Grades the rendered PNGs (render/out) and encodes the videos the site scrubs
(public/video). Each sequence is encoded twice per framing: AV1 10-bit for browsers that
decode it, and H.264 8-bit as the fallback everything plays. Framings: the full
2560x1440 render for wide screens ("d") and its 720x1440 centre crop for phones ("m").

The grade is post.py's bloom and vignette, kept at 16 bits all the way into the encoder,
without post.py's grain: grain is noise the encoder has to spend bits on in every frame
(the hero clip's H.264 grew 5x with it), and the 16-bit source plus x264's aq-mode 3 keep
the dark gradients from banding. --grain puts it back on the H.264 files.

    python render/build_video.py [--only a|b-off|b-on] [--codec av1|h264] [--grain]
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(HERE, "out")
DEST = os.path.join(ROOT, "public", "video")
META = os.path.join(ROOT, "src", "data")

FPS = 30
GOP = 15  # a keyframe every half second of scroll: cheap seeks, still mostly P/B frames
GRAIN_H264 = "--grain" in sys.argv

CODECS = {
    "av1": [
        "-c:v", "libsvtav1", "-preset", "3", "-crf", "24", "-pix_fmt", "yuv420p10le",
        "-svtav1-params", "tune=0",
    ],
    "h264": [
        "-c:v", "libx264", "-preset", "veryslow", "-crf", "23", "-tune", "film",
        "-profile:v", "high", "-pix_fmt", "yuv420p", "-x264-params", "aq-mode=3",
    ],
}


def grade(job):
    """One frame, graded, as 16-bit sRGB for both framings: (clean, grained) per framing."""
    src, glow = job
    lin = post.load_linear(src)
    lin = post.bloom(lin, 0.9 * glow)
    lin = post.vignette(lin)
    rgb = post.to_srgb(lin).astype(np.float32)
    grained = rgb + np.random.default_rng(7).standard_normal(rgb.shape[:2], dtype=np.float32)[..., None] * (1.2 / 255)
    h, w, _ = rgb.shape
    cw = h // 2
    x0 = (w - cw) // 2
    out = {}
    for kind, crop in (("d", slice(0, w)), ("m", slice(x0, x0 + cw))):
        out[kind] = {
            "av1": to16(rgb[:, crop]),
            "h264": to16((grained if GRAIN_H264 else rgb)[:, crop]),
        }
    return out


def to16(a):
    return np.ascontiguousarray(np.clip(a * 65535 + 0.5, 0, 65535).astype("<u2"))


def ffmpeg(path, w, h, codec):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int",
        *CODECS[codec],
        "-g", str(GOP), "-keyint_min", str(GOP),
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        "-movflags", "+faststart", "-an", path,
    ]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def clips(only):
    n_a = len(json.load(open(os.path.join(META, "seq-a.json")))["frames"])
    n_b = len(json.load(open(os.path.join(META, "seq-b.json")))["frames"])
    seq_a = json.load(open(os.path.join(META, "seq-a.json")))["frames"]
    all_clips = {
        "a": [(os.path.join(OUT, "a", f"a_{i:04d}.png"), seq_a[i]["glow"]) for i in range(n_a)],
        "b-off": [(os.path.join(OUT, "b", f"off_{i:04d}.png"), 0.0) for i in range(n_b)],
        "b-on": [(os.path.join(OUT, "b", f"on_{i:04d}.png"), 1.0) for i in range(n_b)],
    }
    return {k: v for k, v in all_clips.items() if only in (None, k)}


def batched(pool, frames, size=8):
    """Grades in parallel but in order, a few frames at a time: a graded 1440p frame is
    tens of MB, so the whole sequence can't sit in memory at once."""
    for i in range(0, len(frames), size):
        yield from pool.map(grade, frames[i : i + size])


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    codecs = [sys.argv[sys.argv.index("--codec") + 1]] if "--codec" in sys.argv else list(CODECS)
    manifest_path = os.path.join(DEST, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    manifest.update({"fps": FPS, "gop": GOP})
    manifest.setdefault("clips", {})

    with ProcessPoolExecutor() as pool:
        for name, frames in clips(only).items():
            missing = [s for s, _ in frames if not os.path.exists(s)]
            if missing:
                sys.exit(f"{name}: {len(missing)} rendered frames missing, e.g. {missing[0]}")
            h, w = cv2.imread(frames[0][0], cv2.IMREAD_UNCHANGED).shape[:2]
            sizes = {"d": (w, h), "m": (h // 2, h)}
            encoders = {
                (kind, codec): ffmpeg(os.path.join(DEST, f"{name}.{kind}.{codec}.mp4"), *sizes[kind], codec)
                for kind in sizes for codec in codecs
            }
            for i, graded in enumerate(batched(pool, frames)):
                for (kind, codec), proc in encoders.items():
                    proc.stdin.write(graded[kind][codec].tobytes())
                if i == 0 and name == "a":
                    for kind in sizes:
                        poster = (graded[kind]["h264"] >> 8).astype(np.uint8)[..., ::-1]
                        cv2.imwrite(os.path.join(DEST, f"poster.{kind}.webp"), poster, [cv2.IMWRITE_WEBP_QUALITY, 88])
                print(name, i, flush=True)
            for (kind, codec), proc in encoders.items():
                proc.stdin.close()
                if proc.wait():
                    sys.exit(f"ffmpeg failed for {name}.{kind}.{codec}")
            manifest["clips"][name] = {
                "frames": len(frames),
                "sizes": {k: list(v) for k, v in sizes.items()},
                "files": {
                    kind: {c: f"{name}.{kind}.{c}.mp4" for c in CODECS if os.path.exists(os.path.join(DEST, f"{name}.{kind}.{c}.mp4"))}
                    for kind in sizes
                },
            }
            for (kind, codec) in encoders:
                p = os.path.join(DEST, f"{name}.{kind}.{codec}.mp4")
                print(f"{name}.{kind}.{codec}.mp4 {os.path.getsize(p) / 1024:.0f} KB", flush=True)

    with open(manifest_path, "w") as fh:
        json.dump(manifest, fh, indent=2)


if __name__ == "__main__":
    main()
