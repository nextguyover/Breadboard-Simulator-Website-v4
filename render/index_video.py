"""Indexes the encoded clips (public/video) for the site's WebCodecs player: per clip,
the codec string, decoder description and every packet's byte range, keyframe flag and
frame number, so the browser can decode straight from the MP4 without a demuxer.
Writes src/data/video.json. build_video.py runs it after encoding.

    python render/index_video.py
"""
import base64
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
VIDEO = os.path.join(ROOT, "public", "video")
INDEX = os.path.join(ROOT, "src", "data", "video.json")
FFPROBE = os.environ.get("FFPROBE", "ffprobe")


def box(data, name):
    """The payload of the first `name` box (avcC / av1C sit inside the sample description)."""
    i = data.find(name.encode())
    if i < 4:
        raise RuntimeError(f"no {name} box")
    size = int.from_bytes(data[i - 4 : i], "big")
    return data[i + 4 : i - 4 + size]


def codec_string(codec, mp4):
    if codec == "h264":
        c = box(mp4, "avcC")
        return f"avc1.{c[1]:02x}{c[2]:02x}{c[3]:02x}", c
    c = box(mp4, "av1C")
    profile, level = c[1] >> 5, c[1] & 31
    tier = "H" if c[2] >> 7 else "M"
    depth = 12 if (c[2] >> 5) & 1 else 10 if (c[2] >> 6) & 1 else 8
    return f"av01.{profile}.{level:02d}{tier}.{depth:02d}", c


def index(path, codec, size, fps):
    mp4 = open(path, "rb").read()
    probe = json.loads(subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_packets",
         "-show_entries", "packet=pts_time,pos,size,flags", "-of", "json", path],
        check=True, capture_output=True, text=True,
    ).stdout)
    string, desc = codec_string(codec, mp4)
    entry = {
        "url": "video/" + os.path.basename(path),
        "codec": string,
        "width": size[0],
        "height": size[1],
        "bytes": len(mp4),
        # In decode order: [byte offset, size, keyframe, frame number].
        "packets": [
            [int(p["pos"]), int(p["size"]), int("K" in p["flags"]), round(float(p["pts_time"]) * fps)]
            for p in probe["packets"]
        ],
    }
    if codec == "h264":
        # H.264 in MP4 needs its avcC record to configure the decoder; AV1 does not.
        entry["description"] = base64.b64encode(desc).decode()
    return entry


def main():
    manifest = json.load(open(os.path.join(VIDEO, "manifest.json")))
    out = {}
    for name, clip in manifest["clips"].items():
        for kind, files in clip["files"].items():
            for codec, file in files.items():
                e = index(os.path.join(VIDEO, file), codec, clip["sizes"][kind], manifest["fps"])
                frames = sorted(p[3] for p in e["packets"])
                if frames != list(range(clip["frames"])):
                    raise RuntimeError(f"{file}: frame numbers don't run 0..{clip['frames'] - 1}")
                out.setdefault(name, {}).setdefault(kind, {})[codec] = e
                print(f"{file}: {e['codec']}, {len(e['packets'])} packets")
    with open(INDEX, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", os.path.relpath(INDEX, ROOT))


if __name__ == "__main__":
    main()
