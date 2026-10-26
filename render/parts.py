"""Studio shots of every part for the parts drawer, from the app's own glTF models.

    python render/parts.py OUT_DIR [--size 640] [--samples 128] [--gpu] [--only led,resistor]
    blender -b -P render/parts.py -- OUT_DIR --gpu

Writes transparent PNGs; build_parts.py turns them into WebP for public/parts.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene as S  # noqa: E402

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
MODELS = os.path.join(ASSETS, "models")
HDRI = os.path.join(ASSETS, "studio_small_09_1k.hdr")
# Most models are in metres; these two were exported at other scales.
SCALE = {"battery": 0.018, "jumper_connector": 0.00493}
SHOTS = [
    "resistor", "led", "capacitor_polarised", "capacitor_non_polarised", "inductor", "diode", "diode_zener",
    "pushbutton", "toggleswitch", "potentiometer", "seven_segment", "buzzer", "rgb_led",
    "to92", "to220", "dip8", "dip14", "dip16", "battery", "jumper", "breadboard",
]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    world = bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(HDRI)
    bg = nt.nodes["Background"]
    bg.inputs[1].default_value = 0.35
    nt.links.new(env.outputs[0], bg.inputs[0])
    return scene


def import_model(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, f"{name}.glb"))
    objs = [o for o in bpy.data.objects if o not in before]
    for o in objs:
        if o.parent is None:
            o.scale = o.scale * SCALE.get(name, 1.0)
    # The DIP packages were exported without colours, like in the app: black epoxy, tinned pins.
    if name.startswith("dip"):
        for o in objs:
            for slot in getattr(o, "material_slots", []):
                m = slot.material
                if not m or not m.use_nodes:
                    continue
                p = m.node_tree.nodes.get("Principled BSDF")
                if not p:
                    continue
                if m.name.startswith("Plastic"):
                    p.inputs["Base Color"].default_value = (0.011, 0.011, 0.012, 1)
                    p.inputs["Roughness"].default_value = 0.55
                    p.inputs["Metallic"].default_value = 0
                elif m.name.startswith("Metal"):
                    p.inputs["Base Color"].default_value = (0.58, 0.58, 0.58, 1)
                    p.inputs["Roughness"].default_value = 0.35
                    p.inputs["Metallic"].default_value = 0.9
    return objs


def jumper():
    """A red jumper wire looping between two connector ends."""
    objs = []
    curve = bpy.data.curves.new("Wire", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.0006
    curve.bevel_resolution = 6
    sp = curve.splines.new("BEZIER")
    sp.bezier_points.add(2)
    pts = [(-0.012, 0, 0.004), (0, 0, 0.022), (0.012, 0, 0.004)]
    for bp, co in zip(sp.bezier_points, pts):
        bp.co = co
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    wire = bpy.data.objects.new("Wire", curve)
    bpy.context.scene.collection.objects.link(wire)
    mat = bpy.data.materials.new("Red insulation")
    mat.use_nodes = True
    p = mat.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0.7, 0.02, 0.02, 1)
    p.inputs["Roughness"].default_value = 0.35
    curve.materials.append(mat)
    objs.append(wire)
    for x in (-0.012, 0.012):
        ends = import_model("jumper_connector")
        for o in ends:
            if o.parent is None:
                o.location = (x, 0, -0.0002)
        objs += ends
    return objs


def bounds(objs):
    bpy.context.view_layer.update()
    pts = []
    for o in objs:
        if o.type in {"MESH", "CURVE"}:
            pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def light(scene, name, kind, loc, target, energy, size, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = color
    if kind == "AREA":
        data.size = size
    ob = bpy.data.objects.new(name, data)
    scene.collection.objects.link(ob)
    ob.location = loc
    S.aim(ob, target)
    return ob


def shoot(name, out, size, samples, gpu):
    scene = reset()
    objs = jumper() if name == "jumper" else import_model(name)
    lo, hi = bounds(objs)
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 1e-4)

    # Three-quarter view from above, like picking the part up off the desk.
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 85
    cam_data.sensor_fit = "HORIZONTAL"
    cam = bpy.data.objects.new("Camera", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    az, el = math.radians(-35), math.radians(32)
    dist = radius / math.tan(math.atan(18 / 85)) * 1.25
    cam.location = center + Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el))) * dist
    S.aim(cam, center)
    cam_data.clip_start = dist / 100
    cam_data.clip_end = dist * 10

    r = radius * 6
    light(scene, "Key", "AREA", center + Vector((r * 0.4, -r * 0.9, r * 1.1)), center, 60 * r * r, r * 0.8, (1, 0.97, 0.93))
    light(scene, "Fill", "AREA", center + Vector((-r, -r * 0.2, r * 0.4)), center, 14 * r * r, r, (0.85, 0.9, 1))
    light(scene, "Rim", "AREA", center + Vector((-r * 0.3, r, r * 0.6)), center, 50 * r * r, r * 0.5, (1, 0.45, 0.4))

    S.render_settings(scene, size, size, samples)
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    if gpu:
        S.use_gpu(scene)
    scene.render.filepath = os.path.join(out, f"{name}.png")
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    out = os.path.abspath(argv[0])
    args = argv[1:]

    def opt(name, default):
        return args[args.index(name) + 1] if name in args else default

    size = int(opt("--size", "640"))
    samples = int(opt("--samples", "128"))
    only = opt("--only", None)
    os.makedirs(out, exist_ok=True)
    for name in only.split(",") if only else SHOTS:
        shoot(name, out, size, samples, "--gpu" in args)
        print("shot", name, flush=True)
