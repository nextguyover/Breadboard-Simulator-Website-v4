"""Builds the hero scene (spotlit breadboard, red LED, resistor) from hero.blend.
Imported by the render scripts; needs the `bpy` module.

    python render/scene.py out.png [width height samples]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
# The original hero render: camera, focus point, downlight, backdrop and glossy board.
SOURCE_BLEND = os.environ.get("BSIM_HERO", os.path.join(HERE, "assets", "hero.blend"))

# Filled in by load() from the hero scene, so the animation starts on the original shot.
LED_HOME = Vector()
RES_HOME = Vector()
FOCUS_HOME = Vector()
KEY_ENERGY = 0.0
FSTOP_HOME = 9.0
LED_RED = (1.0, 0.006, 0.004, 1.0)


def _socket(node, *names):
    for n in names:
        if n in node.inputs:
            return node.inputs[n]
    raise KeyError(names)


def drive_glow(led):
    """The original epoxy material, with its glow following the LED object's `glow`
    property (0 = off, 1 = normal brightness)."""
    bsdf = led.material_slots[0].material.node_tree.nodes["Principled BSDF"]
    drv = _socket(bsdf, "Emission Strength").driver_add("default_value").driver
    var = drv.variables.new()
    var.name = "g"
    var.targets[0].id = led
    var.targets[0].data_path = '["glow"]'
    drv.expression = "g"


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
    global LED_HOME, RES_HOME, FOCUS_HOME, KEY_ENERGY, FSTOP_HOME
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(SOURCE_BLEND))
    # A stray part hidden under the board.
    if "Transition" in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects["Transition"], do_unlink=True)
    scene = bpy.context.scene
    led = bpy.data.objects["Diode-Light-Emitting"]
    res = bpy.data.objects["Resistor-Axial"]
    cam = scene.camera
    LED_HOME = led.location.copy()
    RES_HOME = res.location.copy()
    focus = bpy.data.objects["Focus Point"]
    FOCUS_HOME = focus.matrix_world.translation.copy()
    led["glow"] = 1.0
    smooth_lens(led)
    drive_glow(led)

    # The downlight, renamed so the animation can fade it.
    key_ob = bpy.data.objects["Spot"]
    key_ob.data.name = "Key"
    KEY_ENERGY = key_ob.data.energy

    # Point light inside the dome so the LED throws red light on its legs and the board.
    glow = bpy.data.lights.new("LED Glow", "POINT")
    glow.color = LED_RED[:3]
    glow.shadow_soft_size = 0.0025
    d = glow.driver_add("energy").driver
    v = d.variables.new()
    v.name = "g"
    v.targets[0].id = led
    v.targets[0].data_path = '["glow"]'
    d.expression = "g * 0.006"
    glow_ob = bpy.data.objects.new("LED Glow", glow)
    scene.collection.objects.link(glow_ob)
    glow_ob.parent = led
    glow_ob.location = (0, 0, 0.0035)

    # Lights for the parts only (light-linked), so the board keeps the original's look.
    receivers = bpy.data.collections.new("Part Receivers")
    for n in ("Diode-Light-Emitting", "Legs", "Reflector", "Resistor-Axial", "Legs.016"):
        receivers.objects.link(bpy.data.objects[n])
    # The strips are there for the LED; on the resistor they'd make it outshine the LED.
    led_receivers = bpy.data.collections.new("LED Receivers")
    for n in ("Diode-Light-Emitting", "Legs", "Reflector"):
        led_receivers.objects.link(bpy.data.objects[n])

    # Faint cool rim from behind so the LED reads when it is off.
    rim = bpy.data.lights.new("Rim", "AREA")
    rim.energy = 0.25
    rim.size = 0.06
    rim.color = (0.75, 0.82, 1.0)
    rim_ob = bpy.data.objects.new("Rim", rim)
    scene.collection.objects.link(rim_ob)
    rim_ob.location = (-0.14, -0.05, 0.09)
    aim(rim_ob, LED_HOME + Vector((0, 0, 0.002)))
    rim_ob.light_linking.receiver_collection = receivers

    # Product-shot key that takes over once the LED leaves the board and goes dark.
    beauty = bpy.data.lights.new("Beauty", "AREA")
    beauty.energy = 0.0
    beauty.shape = "DISK"
    beauty.size = 0.08
    beauty.color = (1.0, 0.96, 0.92)
    beauty_ob = bpy.data.objects.new("Beauty", beauty)
    scene.collection.objects.link(beauty_ob)
    beauty_ob.location = (0.1, -0.12, 0.16)
    aim(beauty_ob, LED_HOME + Vector((0, 0, 0.025)))
    beauty_ob.light_linking.receiver_collection = receivers

    # Same framing on any aspect: a fixed vertical field of view (the original's 36 mm wide
    # sensor at 16:9), so a portrait crop is the same shot as the landscape frame.
    cam.data.sensor_fit = "VERTICAL"
    cam.data.sensor_height = 20.25
    FSTOP_HOME = cam.data.dof.aperture_fstop
    cam.data.dof.focus_object = None
    # The original's 10 cm near clip cuts into the front of the board once the camera moves.
    cam.data.clip_start = 0.002
    cam.data.dof.focus_distance = (cam.location - FOCUS_HOME).length

    # Tall strip softboxes either side of the camera, riding along with it, for clean
    # highlights down the legs and dome once the LED is up. Off at the start.
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
        ob.light_linking.receiver_collection = led_receivers

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
    # The original's look.
    scene.view_settings.view_transform = "Filmic"
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
