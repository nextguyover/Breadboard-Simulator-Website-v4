# Renders

The scroll sequence on the home page is rendered in Blender (Cycles) from the original hero
render scene, `assets/hero.blend` (camera, focus point, downlight, backdrop and glossy board).
`assets/breadboard.blend` and `assets/models/` hold the parts used for the parts drawer shots.

- `scene.py` loads the hero scene and adds the LED glow and the lights for the later shots.
- `anim.py` animates and renders the sequence to 16-bit PNG.
- `post.py` adds the LED bloom, vignette and grain.
- `build_frames.py` grades the renders and encodes the AVIF and WebP frames, in every size, into
  `public/frames/`, and writes `src/data/frames.json`.
- `parts.py` and `build_parts.py` make the studio shots in `public/parts/`.

## Rendering on a GPU (recommended)

With Blender 4.2 or newer installed, from this folder:

```sh
blender -b -P anim.py -- out/a --size 2560x1440 --samples 512 --gpu
blender -b -P anim.py -- out/b --size 2560x1440 --samples 512 --gpu --turn 36:50 --glow off --prefix off
blender -b -P anim.py -- out/b --size 2560x1440 --samples 512 --gpu --turn 36:50 --glow on --prefix on
```

`--gpu` picks OptiX on NVIDIA RTX cards (falling back to CUDA, HIP, oneAPI or Metal).
Frames that already exist are skipped, so a run can be stopped and resumed.

## Rendering on the CPU

`pip install bpy numpy opencv-python-headless pillow` (Python 3.13; the `bpy` wheel is Blender
itself), then `PY=python render_all.sh`. Expect many hours; the GPU takes about 20 s a frame on an RTX 4070 Ti.
