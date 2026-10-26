# Renders

The scroll sequence on the home page is rendered in Blender (Cycles) from the original
Breadboard Simulator models in `assets/breadboard.blend`.

- `scene.py` builds the scene: spotlit breadboard, red LED and resistor, lights and camera.
- `anim.py` animates and renders the sequence to 16-bit PNG.
- `post.py` adds the LED bloom, vignette and grain.
- `build_frames.py` grades and encodes everything into `public/frames/`.

## Rendering on a GPU (recommended)

With Blender 4.2 or newer installed, from this folder:

```sh
blender -b -P anim.py -- out/a --size 2560x1440 --samples 256 --gpu
blender -b -P anim.py -- out/b --size 2560x1440 --samples 256 --gpu --turn 36:50 --glow off --prefix off
blender -b -P anim.py -- out/b --size 2560x1440 --samples 256 --gpu --turn 36:50 --glow on --prefix on
```

`--gpu` picks OptiX on NVIDIA RTX cards (falling back to CUDA, HIP, oneAPI or Metal).
Frames that already exist are skipped, so a run can be stopped and resumed.

## Rendering on the CPU

`pip install bpy numpy opencv-python-headless pillow` (Python 3.13; the `bpy` wheel is Blender
itself), then `PY=python render_all.sh`. Expect about three hours on four cores.
