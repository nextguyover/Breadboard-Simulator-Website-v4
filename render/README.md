# Renders

The scroll sequence on the home page is rendered in Blender (Cycles) from the original
Breadboard Simulator models in `assets/breadboard.blend`.

Requires Python 3.13 with `pip install bpy numpy opencv-python-headless pillow`
(the `bpy` wheel is Blender itself, so no Blender install is needed).

- `scene.py` builds the scene: spotlit breadboard, red LED and resistor, lights and camera.
- `anim.py` animates and renders the sequence to 16-bit PNG.
- `post.py` adds the LED bloom, vignette and grain.
- `build_frames.py` grades and encodes everything into `public/frames/`.
