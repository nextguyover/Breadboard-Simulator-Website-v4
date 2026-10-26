"""The scroll sequence: the LED lifts out of the breadboard, flickers out as its legs
leave the holes, and floats up into a product shot while the camera cranes after it.

    python render/anim.py OUT_DIR [--size 3200x1800] [--samples 64] [--frames 0:150:1] [--glow on|off|auto]

Frames are written as 16-bit PNG (OUT_DIR/a_0000.png ...); render/post.py grades them.
`--glow on|off` forces the LED state, which is how the sticky "lit" and "dark" layers are made.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene as S  # noqa: E402

FRAMES = 150
LEG_DEPTH = 0.0075  # how far the legs sit inside the board's clips
RISE = 0.034
HERO_TARGET = Vector((0.004, -0.0005, 0.021))
CAM_START = Vector((-0.24, 0.0, 0.05))


def clamp01(x):
    return max(0.0, min(1.0, x))


def span(t, a, b):
    return clamp01((t - a) / (b - a))


def ease(u):
    return u * u * (3 - 2 * u)


def ease_io(u):
    return 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2


def lerp(a, b, u):
    return a + (b - a) * u


RES_RISE = 0.016


def res_rise(t):
    """The resistor follows the LED out of the board, much slower, and drops out of shot."""
    return RES_RISE * ease_io(span(t, 0.12, 1.0))


def rise(t):
    return RISE * ease_io(span(t, 0.05, 0.8))


def glow(t, forced=None):
    if forced is not None:
        return forced
    dz = rise(t)
    if dz < LEG_DEPTH * 0.72:
        return 1.0
    if dz >= LEG_DEPTH:
        return 0.0
    # Contacts scraping out of the clips: a short, uneven flicker before it dies.
    u = (dz - LEG_DEPTH * 0.72) / (LEG_DEPTH * 0.28)
    pattern = [1.0, 0.35, 0.95, 0.15, 0.7, 0.05, 0.4, 0.0]
    i = min(int(u * len(pattern)), len(pattern) - 1)
    return pattern[i]


def pose(t, led, cam, lights, forced_glow=None):
    dz = rise(t)
    led.location = S.LED_HOME + Vector((0, 0, dz))
    spin = ease_io(span(t, 0.36, 1.0))
    led.rotation_euler = (math.radians(-5) * spin, 0, led["base_rz"] + math.radians(115) * spin)
    led["glow"] = glow(t, forced_glow)
    bpy.data.objects["Resistor-Axial"].location = S.RES_HOME + Vector((0, 0, res_rise(t)))

    # Camera: a slow push-in on the hero shot, then a crane and orbit that follows the LED.
    led_center = led.location + Vector((0, 0, -0.0115))
    follow = ease_io(span(t, 0.04, 0.58))
    target = HERO_TARGET.lerp(led_center, follow)
    start_offset = CAM_START - HERO_TARGET
    dist0 = start_offset.length
    az0 = math.atan2(start_offset.y, start_offset.x)
    el0 = math.asin(start_offset.z / dist0)
    orbit = ease_io(span(t, 0.2, 1.0))
    push = ease(span(t, 0.0, 0.3))
    dist = lerp(dist0, dist0 * 0.93, push)
    az = az0 - math.radians(38) * orbit
    el = lerp(el0, math.radians(7.0), orbit)
    cam.location = target + Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el))) * dist
    S.aim(cam, target)
    # Focus starts on the holes at the foot of the parts, then follows the LED up as it lifts.
    focus = S.BOARD_FOCUS.lerp(led.location + Vector((0, 0, 0.002)), ease_io(span(t, 0.08, 0.45)))
    cam.data.dof.focus_distance = (cam.location - focus).length
    cam.data.dof.aperture_fstop = lerp(4.0, 5.6, ease(span(t, 0.35, 0.9)))

    strips = lerp(0.25, 1.0, ease(span(t, 0.3, 0.75)))
    bpy.data.lights["Strip L"].energy = 0.55 * strips
    bpy.data.lights["Strip R"].energy = 0.3 * strips
    key, beauty = lights
    key.energy = 1.6 * (1 - ease(span(t, 0.5, 0.86)))
    beauty.energy = 0.45 * ease(span(t, 0.34, 0.62))


def write_meta(out, scene, led, cam, lights, turn):
    """Where the LED is on screen in every frame (0-1 across, 0-1 down), for the site's
    effects: the glow follows the dome, the smoke rises from it."""
    from bpy_extras.object_utils import world_to_camera_view

    def screen(p):
        v = world_to_camera_view(scene, cam, p)
        return [round(v.x, 5), round(1 - v.y, 5)]

    frames = []
    count = int(turn.split(":")[0]) if turn else FRAMES
    for f in range(count):
        if turn:
            pose(1.0, led, cam, lights, 0.0)
            led.rotation_euler.z += math.radians(float(turn.split(":")[1])) * f / (count - 1)
        else:
            pose(f / (FRAMES - 1), led, cam, lights)
        bpy.context.view_layer.update()
        m = led.matrix_world
        frames.append({
            "dome": screen(m @ Vector((0, 0, 0.0035))),
            "top": screen(m @ Vector((0, 0, 0.0068))),
            "legs": screen(m @ Vector((0, 0, -0.027))),
            "glow": round(led["glow"], 3),
        })
    import json
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "meta.json"), "w") as fh:
        json.dump({"aspect": scene.render.resolution_x / scene.render.resolution_y, "frames": frames}, fh)


def main():
    # Works both as `python anim.py OUT ...` (bpy module) and `blender -b -P anim.py -- OUT ...`.
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    out = argv[0]
    args = argv[1:]

    def opt(name, default):
        return args[args.index(name) + 1] if name in args else default

    w, h = (int(x) for x in opt("--size", "3200x1800").split("x"))
    samples = int(opt("--samples", "512"))
    a, b, step = (int(x) for x in opt("--frames", f"0:{FRAMES}:1").split(":"))
    forced = {"on": 1.0, "off": 0.0}.get(opt("--glow", "auto"))
    prefix = opt("--prefix", "a")
    # --turn N:DEG renders the sticky pose (end of the sequence) turning a further DEG degrees.
    turn = opt("--turn", None)

    scene, led, res, cam = S.load()
    led["base_rz"] = led.rotation_euler.z
    S.render_settings(scene, w, h, samples)
    if "--gpu" in args:
        S.use_gpu(scene)
    lights = (bpy.data.lights["Key"], bpy.data.lights["Beauty"])
    os.makedirs(out, exist_ok=True)
    if turn:
        n, deg = turn.split(":")
        a, b, step = 0, int(n), 1
    if "--meta" in args:
        write_meta(out, scene, led, cam, lights, turn)
        return
    for f in range(a, b, step):
        path = os.path.join(out, f"{prefix}_{f:04d}.png")
        if os.path.exists(path) and "--force" not in args:
            continue
        if turn:
            pose(1.0, led, cam, lights, forced)
            led.rotation_euler.z += math.radians(float(deg)) * f / (b - 1)
        else:
            pose(f / (FRAMES - 1), led, cam, lights, forced)
        bpy.context.view_layer.update()
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("frame", f, flush=True)


if __name__ == "__main__":
    main()
