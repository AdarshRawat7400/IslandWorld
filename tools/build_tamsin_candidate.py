"""Build a review-only Tamsin character from verified CC0 MakeHuman core assets.

This script deliberately uses source downloads under ../../work/character_sources,
outside the distributable game project. It does not enable the candidate in the
runtime. Run with Blender 5.1:

    blender -b --factory-startup --python tools/build_tamsin_candidate.py

Download the official MPFB 2.0.17 extension and makehuman_system_assets_cc0.zip
into that work directory, extract the MPFB zip as work/character_sources/mpfb,
and run this script. It extracts only this character's needed source assets.
See docs/character-candidate.md for exact URLs, hashes, and license evidence.
"""

from __future__ import annotations

import math
from pathlib import Path
from zipfile import ZipFile
import addon_utils
import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parent.parent / "work" / "character_sources"
SELECTED = WORK / "selected"
OUTPUT = WORK / "tamsin-candidate.glb"
RENDER = ROOT.parent / "tamsin-mpfb-candidate.png"
BLEND = WORK / "tamsin-candidate.blend"

SPEC = {
    "name": "Tamsin Reed (candidate)",
    "gender": 1.0,
    "age": 0.42,
    "weight": 0.48,
    "muscle": 0.47,
    "skin": "skins/middleage_caucasian_female/middleage_caucasian_female.mhmat",
    "clothes": "clothes/male_casualsuit05/male_casualsuit05.mhclo",
    "boots": "clothes/shoes01/shoes01.mhclo",
    "hair": "hair/short03/short03.mhclo",
    "eyes": "eyes/low-poly/low-poly.mhclo",
    "eyebrows": "eyebrows/eyebrow001/eyebrow001.mhclo",
    "eyelashes": "eyelashes/eyelashes01/eyelashes01.mhclo",
}


def source_asset(relative: str) -> str:
    path = (SELECTED / relative).resolve()
    if not path.is_relative_to(SELECTED.resolve()) or not path.is_file():
        raise FileNotFoundError(f"Missing verified CC0 core asset: {relative}")
    return str(path)


def extract_selected_sources(spec: dict):
    archive_path = WORK / "makehuman_system_assets_cc0.zip"
    if not archive_path.is_file():
        raise FileNotFoundError("Download the official CC0 system asset pack to " + str(archive_path))
    prefixes = tuple({str(Path(relative).parent).replace('\\', '/') + '/'
                      for relative in spec.values() if isinstance(relative, str)
                      and '/' in relative})
    extra = {"eyes/materials/brown.mhmat", "eyes/materials/brown_eye.png"}
    SELECTED.mkdir(parents=True, exist_ok=True)
    with ZipFile(archive_path) as archive:
        for item in archive.infolist():
            if item.is_dir() or not (item.filename.startswith(prefixes)
                                     or item.filename in extra):
                continue
            target = (SELECTED / item.filename).resolve()
            if not target.is_relative_to(SELECTED.resolve()):
                raise ValueError(f"Unsafe source archive path: {item.filename}")
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(item) as source, target.open('wb') as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
    for relative in (value for value in spec.values()
                     if isinstance(value, str) and value.endswith(('.mhclo', '.mhmat'))):
        header = Path(source_asset(relative)).read_text(errors='replace')[:900]
        if 'released as CC0' not in header:
            raise ValueError(f"CC0 header missing from selected source: {relative}")


def register_mpfb():
    if not (WORK / "mpfb" / "blender_manifest.toml").is_file():
        raise FileNotFoundError("Extract the verified official MPFB extension to work/character_sources/mpfb")
    bpy.context.preferences.extensions.repos.new(
        name="TTL character scratch", module="ttl_character",
        custom_directory=str(WORK), source="USER")
    # The extension stays enabled only inside this factory-startup Blender
    # process. No user preferences are saved or game runtime code imported.
    addon_utils.enable("bl_ext.ttl_character.mpfb", default_set=True)
    from bl_ext.ttl_character.mpfb.services.humanservice import HumanService
    from bl_ext.ttl_character.mpfb.services.targetservice import TargetService
    from bl_ext.ttl_character.mpfb.entities.objectproperties import HumanObjectProperties
    from bl_ext.ttl_character.mpfb.services.exportservice import ExportService
    return HumanService, TargetService, HumanObjectProperties, ExportService


def make_character(spec: dict):
    # Factory-startup still includes Blender's default cube, which obscures
    # the model in a studio render if it is left at the origin.
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    HumanService, TargetService, HumanObjectProperties, ExportService = register_mpfb()
    human = HumanService.create_human()
    human.name = spec["name"]
    for key in ("gender", "age", "weight", "muscle"):
        HumanObjectProperties.set_value(key, spec[key], entity_reference=human)
    TargetService.reapply_macro_details(human)
    HumanService.set_character_skin(source_asset(spec["skin"]), human,
                                    skin_type="GAMEENGINE")
    HumanService.add_builtin_rig(human, "game_engine")
    for category in ("eyes", "eyebrows", "eyelashes", "hair", "clothes"):
        HumanService.add_mhclo_asset(source_asset(spec[category]), human,
                                    asset_type=category.capitalize(),
                                    material_type="GAMEENGINE", subdiv_levels=0)
    HumanService.add_mhclo_asset(source_asset(spec["boots"]), human,
                                asset_type="Clothes", material_type="GAMEENGINE",
                                subdiv_levels=0)
    if spec.get("hat"):
        HumanService.add_mhclo_asset(source_asset(spec["hat"]), human,
                                    asset_type="Clothes", material_type="GAMEENGINE",
                                    subdiv_levels=0)
    # The MPFB basemesh contains large helper faces for asset fitting. Its
    # official export staging removes those faces and applies mask modifiers;
    # leaving them in a glTF produces a white box around most of the person.
    ExportService.bake_modifiers_remove_helpers(
        human, bake_masks=True, bake_subdiv=False,
        remove_helpers=True, also_proxy=True)
    fix_gltf_alpha(human.parent)
    return human, human.parent


def fix_gltf_alpha(rig):
    """Replace MPFB's universal alpha blending with correct glTF modes.

    Its GAMEENGINE material graphs connect an alpha texture even when the
    image is fully opaque. Blender exports every such material as BLEND,
    causing sorting artifacts on layered face, hair and clothing meshes in
    Three.js. Only brows, lashes and hair need alpha cutouts.
    """
    cutout_names = (".eyebrow001", ".eyelashes01", ".short01", ".short02",
                    ".short03", ".short04", ".ponytail01", ".bob01",
                    ".bob02")
    for obj in rig.children_recursive:
        if obj.type != 'MESH':
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            nodes = mat.node_tree.nodes
            links = mat.node_tree.links
            shader = next((node for node in nodes if node.type == 'BSDF_PRINCIPLED'), None)
            if shader is None:
                continue
            alpha = shader.inputs['Alpha']
            source = alpha.links[0].from_socket if alpha.is_linked else None
            if source is not None:
                for link in tuple(alpha.links):
                    links.remove(link)
            if source is not None and mat.name.endswith(cutout_names):
                clip = nodes.new('ShaderNodeMath')
                clip.name = 'glTF alpha cutout'
                clip.operation = 'GREATER_THAN'
                clip.inputs[1].default_value = 0.45
                links.new(source, clip.inputs[0])
                links.new(clip.outputs[0], alpha)
            else:
                alpha.default_value = 1.0


def pose_neutral(rig):
    """Relax the generated game rig's arms toward a standing idle pose."""
    for name, world_degrees in (("upperarm_l", 25), ("upperarm_r", -25)):
        pose_bone = rig.pose.bones[name]
        rest_frame = pose_bone.bone.matrix_local.to_3x3()
        world_turn = Matrix.Rotation(math.radians(world_degrees), 3, 'Y')
        pose_bone.rotation_mode = 'QUATERNION'
        pose_bone.rotation_quaternion = (
            rest_frame.inverted() @ world_turn @ rest_frame).to_quaternion()
    bpy.context.view_layer.update()
    # glTF exports the armature's rest pose as its default still pose. Make
    # the relaxed arms the actual rest pose. First bake the currently posed
    # geometry, otherwise applying the pose to the bones alone puts the
    # original A-pose mesh around a neutral skeleton.
    skinned = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in rig.children_recursive:
        if obj.type != 'MESH':
            continue
        modifiers = [mod for mod in obj.modifiers if mod.type == 'ARMATURE']
        if not modifiers:
            continue
        # MPFB's macro morphs remain as shape keys. An evaluated copy bakes
        # those and the armature into the current vertices while preserving
        # their UVs and vertex indices for the existing skinning weights.
        posed_mesh = bpy.data.meshes.new_from_object(
            obj.evaluated_get(depsgraph), preserve_all_data_layers=True,
            depsgraph=depsgraph)
        if len(posed_mesh.vertices) != len(obj.data.vertices):
            raise RuntimeError(f"Pose bake changed vertex order for {obj.name}")
        obj.modifiers.clear()
        old_mesh = obj.data
        obj.data = posed_mesh
        if old_mesh.users == 0:
            bpy.data.meshes.remove(old_mesh)
        skinned.append(obj)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in skinned:
        modifier = obj.modifiers.new('neutral game rig', 'ARMATURE')
        modifier.object = rig
    bpy.context.view_layer.update()


def limit_accessory_maps(texture_limits: dict[str, int]):
    """Match tiny on-screen accessories to their useful texel resolution.

    This changes only generated candidate image datablocks, never the verified
    CC0 source files. A 1K hat is already above its largest gameplay footprint.
    """
    for name, max_side in texture_limits.items():
        image = bpy.data.images.get(name)
        if image is None:
            raise RuntimeError(f"Missing generated accessory map: {name}")
        width, height = image.size
        if max(width, height) > max_side:
            factor = max_side / max(width, height)
            image.scale(round(width * factor), round(height * factor))
            image.update()
            print(f"TEXTURE_BUDGET {name} {width}x{height} -> {image.size[0]}x{image.size[1]}")


def render_preview(rig):
    # Studio lighting checks the skin, eyes, hair and garment before any
    # replacement is considered in a rainy outdoor gameplay scene.
    def aim(obj, target):
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()

    for name, location, energy, size in (
        ("large soft key", (2.2, -3.0, 3.6), 390, 3.0),
        ("cold fill", (-2.7, -0.7, 2.2), 150, 3.5),
        ("edge light", (0.0, 2.1, 2.8), 200, 2.1),
    ):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.shape = 'DISK'
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        aim(obj, (0, 0, 0.9))

    camera_data = bpy.data.cameras.new("candidate portrait camera")
    camera = bpy.data.objects.new("candidate portrait camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (2.25, -3.2, 1.79)
    aim(camera, (0, -0.01, 0.87))
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 2.65
    bpy.context.scene.camera = camera

    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.012))
    floor = bpy.context.object
    floor.name = "review floor (not exported)"
    floor_mat = bpy.data.materials.new("muted review slate")
    floor_mat.diffuse_color = (0.105, 0.14, 0.15, 1)
    floor_mat.use_nodes = True
    floor_mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.105, 0.14, 0.15, 1)
    floor.data.materials.append(floor_mat)

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x = 800
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(RENDER)
    scene.world.color = (0.17, 0.20, 0.22)
    scene.view_settings.view_transform = 'AgX'
    bpy.ops.render.render(write_still=True)


def export_candidate(rig):
    bpy.ops.object.select_all(action='DESELECT')
    selected = [rig] + list(rig.children_recursive)
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB',
                              use_selection=True, export_apply=False,
                              export_animations=False, export_materials='EXPORT')
    meshes = [obj for obj in selected if obj.type == 'MESH']
    triangles = sum(sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
                    for obj in meshes)
    print(f"CANDIDATE {OUTPUT} bytes={OUTPUT.stat().st_size} meshes={len(meshes)} triangles={triangles}")


if __name__ == '__main__':
    extract_selected_sources(SPEC)
    human, rig = make_character(SPEC)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    pose_neutral(rig)
    export_candidate(rig)
    render_preview(rig)
    print(f"RENDER {RENDER} bytes={RENDER.stat().st_size}")
