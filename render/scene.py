"""Builds the hero scene (spotlit breadboard, red LED, resistor) from the original
Breadboard Simulator models. Imported by the render scripts; needs the `bpy` module.

    python render/scene.py out.png [width height samples]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE_BLEND = os.environ.get(
    "BSIM_MODELS",
    os.path.join(HERE, "assets", "breadboard.blend"),
)

KEEP = {"Breadboard", "Adhesive", "Diode-Light-Emitting", "Legs", "Reflector", "Resistor-Axial", "Legs.016"}

# LED legs in F14/F15, resistor from G15 to G18 (shares row 15 with the LED's cathode).
LED_HOME = Vector((0.00375, 0.0025, 0.0285))
# The resistor sits one row nearer the camera than the LED, in front of it like the original hero shot.
RES_HOME = Vector((0.00125, -0.0025, 0.0215))
# Where the opening shot focuses: the holes at the foot of the parts.
BOARD_FOCUS = Vector((0.0025, 0.0, 0.0085))
LED_RED = (1.0, 0.006, 0.004, 1.0)


def _socket(node, *names):
    for n in names:
        if n in node.inputs:
            return node.inputs[n]
    raise KeyError(names)


def led_material(led):
    """Red epoxy dome that glows from inside. Brightness follows the LED object's
    `glow` property (0 = off, 1 = normal brightness)."""
    mat = bpy.data.materials.new("LED Epoxy")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.42, 0.012, 0.008, 1)
    bsdf.inputs["Roughness"].default_value = 0.06
    _socket(bsdf, "Transmission Weight", "Transmission").default_value = 0.3
    _socket(bsdf, "Coat Weight", "Clearcoat").default_value = 1.0
    _socket(bsdf, "Coat Roughness").default_value = 0.02
    _socket(bsdf, "Subsurface Weight").default_value = 0.0
    _socket(bsdf, "Subsurface Radius").default_value = (1.0, 0.05, 0.03)
    _socket(bsdf, "Subsurface Scale").default_value = 0.003
    _socket(bsdf, "Emission Color").default_value = LED_RED
    em = _socket(bsdf, "Emission Strength")
    drv = em.driver_add("default_value").driver
    var = drv.variables.new()
    var.name = "g"
    var.targets[0].id = led
    var.targets[0].data_path = '["glow"]'
    drv.expression = "g * 2.2"
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


def smooth_lens(ob, levels=3, sharp_deg=50):
    """The lens is a 16-sided low-poly mesh, so its outline shows facets at this zoom. Subdivide it,
    creasing the hard flange and base edges so only the round body and dome get smoother."""
    import math as _m
    me = ob.data
    me.calc_loop_triangles()
    crease = me.attributes.get("crease_edge") or me.attributes.new("crease_edge", "FLOAT", "EDGE")
    faces_of = {}
    for poly in me.polygons:
        for key in poly.edge_keys:
            faces_of.setdefault(key, []).append(poly.normal.copy())
    for e in me.edges:
        ns = faces_of.get(tuple(sorted(e.vertices)), [])
        sharp = len(ns) != 2 or ns[0].angle(ns[1], 0) > _m.radians(sharp_deg)
        crease.data[e.index].value = 1.0 if sharp else 0.0
    for poly in me.polygons:
        poly.use_smooth = True
    sub = ob.modifiers.new("Smooth lens", "SUBSURF")
    sub.levels = levels
    sub.render_levels = levels
    sub.use_creases = True
    # Subdivide before the existing smooth-by-angle node modifier.
    ob.modifiers.move(len(ob.modifiers) - 1, 0)


def load():
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(SOURCE_BLEND))
    for o in list(bpy.data.objects):
        if o.name not in KEEP:
            bpy.data.objects.remove(o, do_unlink=True)
    scene = bpy.context.scene
    led = bpy.data.objects["Diode-Light-Emitting"]
    led.location = LED_HOME
    led["glow"] = 1.0
    smooth_lens(led)
    led.data.materials[0] = led_material(led)
    res = bpy.data.objects["Resistor-Axial"]
    res.location = RES_HOME
    res.rotation_euler = (0, 0, 0)

    # Point light inside the dome so the LED throws red light on its legs and the board.
    glow = bpy.data.lights.new("LED Glow", "POINT")
    glow.color = LED_RED[:3]
    glow.shadow_soft_size = 0.0025
    d = glow.driver_add("energy").driver
    v = d.variables.new()
    v.name = "g"
    v.targets[0].id = led
    v.targets[0].data_path = '["glow"]'
    d.expression = "g * 0.04"
    glow_ob = bpy.data.objects.new("LED Glow", glow)
    scene.collection.objects.link(glow_ob)
    glow_ob.parent = led
    glow_ob.location = (0, 0, 0.0035)

    # Overhead spotlight: the pool of light on the board.
    spot = bpy.data.lights.new("Key", "SPOT")
    spot.energy = 1.6
    spot.spot_size = math.radians(9)
    spot.spot_blend = 0.7
    spot.shadow_soft_size = 0.02
    spot.color = (1.0, 0.97, 0.93)
    spot_ob = bpy.data.objects.new("Key", spot)
    scene.collection.objects.link(spot_ob)
    spot_ob.location = (0.02, 0.0, 0.26)
    aim(spot_ob, Vector((0.01, 0.0, 0.008)))

    # Faint cool rim from behind so the LED reads when it is off.
    rim = bpy.data.lights.new("Rim", "AREA")
    rim.energy = 0.25
    rim.size = 0.06
    rim.color = (0.75, 0.82, 1.0)
    rim_ob = bpy.data.objects.new("Rim", rim)
    scene.collection.objects.link(rim_ob)
    rim_ob.location = (0.14, 0.05, 0.09)
    aim(rim_ob, Vector((0.004, 0.0025, 0.03)))
    # ...but only on the parts, never the board, or it washes out the spotlight pool.
    receivers = bpy.data.collections.new("Rim Receivers")
    for n in ("Diode-Light-Emitting", "Legs", "Reflector", "Resistor-Axial", "Legs.016"):
        receivers.objects.link(bpy.data.objects[n])
    rim_ob.light_linking.receiver_collection = receivers

    # Product-shot key that takes over once the LED leaves the board and goes dark.
    beauty = bpy.data.lights.new("Beauty", "AREA")
    beauty.energy = 0.0
    beauty.shape = "DISK"
    beauty.size = 0.08
    beauty.color = (1.0, 0.96, 0.92)
    beauty_ob = bpy.data.objects.new("Beauty", beauty)
    scene.collection.objects.link(beauty_ob)
    beauty_ob.location = (-0.1, 0.12, 0.16)
    aim(beauty_ob, Vector((0.004, 0.0025, 0.05)))
    beauty_ob.light_linking.receiver_collection = receivers

    bpy.data.materials["Metal.004"].node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.42
    # Glossy board plastic, so the downlight catches the edges of every hole like the original shot.
    for name in ("Plastic & Texture.001", "Plastic.006"):
        bpy.data.materials[name].node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.08

    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.02, 0.02, 0.025, 1)
    bg.inputs[1].default_value = 0.002

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 100
    # Fixed vertical field of view, so a portrait crop is the same shot as the landscape frame.
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = 20.25
    cam_data.clip_start = 0.005
    cam_data.dof.use_dof = True
    cam_data.dof.aperture_fstop = 2.8
    cam = bpy.data.objects.new("Camera", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (-0.24, 0.0, 0.05)
    target = Vector((0.004, -0.0005, 0.021))
    aim(cam, target)
    cam_data.dof.focus_distance = (cam.location - BOARD_FOCUS).length

    # Tall strip softboxes either side of the camera, riding along with it. A vertical leg
    # mirrors a light at the camera's own height, so these draw a clean highlight down each
    # leg and the side of the dome. Linked to the parts only, like the rim.
    for name, side in (("Strip L", -1), ("Strip R", 1)):
        strip = bpy.data.lights.new(name, "AREA")
        strip.shape = "RECTANGLE"
        strip.size = 0.025
        strip.size_y = 0.35
        strip.energy = 0.0
        strip.color = (1.0, 0.98, 0.95) if side < 0 else (0.85, 0.9, 1.0)
        ob = bpy.data.objects.new(name, strip)
        scene.collection.objects.link(ob)
        ob.parent = cam
        a = math.radians(68) * side
        ob.location = (math.sin(a) * 0.16, 0.0, -math.cos(a) * 0.16 + 0.0)
        ob.rotation_euler = (0, a, 0)
        ob.light_linking.receiver_collection = receivers

    render_settings(scene)
    bpy.context.view_layer.update()
    return scene, led, res, cam


def aim(ob, target):
    direction = target - ob.location
    ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def use_gpu(scene):
    """Render on the GPU: OptiX (RTX cores) when available, else CUDA, HIP, oneAPI or Metal."""
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.refresh_devices()
        gpus = [d for d in prefs.devices if d.type == backend]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == backend
            scene.cycles.device = "GPU"
            # Denoise on the GPU too, and keep the scene loaded between frames instead of
            # rebuilding it, so the CPU isn't the bottleneck.
            scene.cycles.denoising_use_gpu = True
            scene.render.use_persistent_data = True
            print("Rendering on", backend, [d.name for d in gpus], flush=True)
            return backend
    print("No GPU found, rendering on the CPU", flush=True)
    return None


def render_settings(scene, width=1280, height=720, samples=96):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    # Tight noise target: the dark spotlight falloff is where a loose threshold leaves blotches
    # that the denoiser smears into banded, compressed-looking patches.
    scene.cycles.adaptive_threshold = 0.004
    scene.cycles.adaptive_min_samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    scene.cycles.denoising_prefilter = "ACCURATE"
    scene.cycles.denoising_quality = "HIGH"
    scene.render.dither_intensity = 1.0
    scene.cycles.max_bounces = 8
    scene.cycles.transmission_bounces = 8
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "16"


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/test.png"
    w, h, s = (int(x) for x in sys.argv[2:5]) if len(sys.argv) > 4 else (960, 540, 48)
    scene, *_ = load()
    render_settings(scene, w, h, s)
    scene.render.filepath = os.path.abspath(out)
    bpy.ops.render.render(write_still=True)
