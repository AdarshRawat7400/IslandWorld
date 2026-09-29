"""Generate compact island buildings for Island World.

Run with Blender 5.1:
    blender -b --python tools/build_assets.py

All dimensions are metres. Models are centred on the ground. The front of each
building points toward Blender -Y, which exports as glTF +Z.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets"
OUT.mkdir(parents=True, exist_ok=True)
TEXTURES = OUT / "building-textures"

# Offline, resized copies of Poly Haven CC0 PBR material maps:
# https://polyhaven.com/a/wood_peeling_paint_weathered
# https://polyhaven.com/a/brown_planks_03 (warm-tinted for interior timber)
# https://polyhaven.com/a/rough_concrete
# https://polyhaven.com/a/rusty_metal_04
# License: https://polyhaven.com/license
# No live asset requests are made by the game or by this generation script.


def material(name, rgb, roughness=0.85, metallic=0.0, alpha=1.0, glow=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, alpha)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, alpha)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if glow:
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Emission Strength"].default_value = glow
    if alpha < 1.0:
        m.surface_render_method = 'BLENDED'
    return m


M = {
    "stone": material("salt stained stone", (0.27, 0.31, 0.31)),
    "stone_dark": material("wet dark stone", (0.14, 0.18, 0.19)),
    "wood": material("aged grey blue timber", (0.21, 0.27, 0.29)),
    "wood_light": material("warm weathered cut timber", (0.31, 0.25, 0.19)),
    "floorboards": material("lodge interior worn boards", (0.32, 0.25, 0.18)),
    "roof": material("slate roof", (0.11, 0.16, 0.18)),
    "slate_mid": material("weathered slate blue", (0.17, 0.22, 0.23), 0.68),
    "slate_dark": material("rain darkened slate", (0.075, 0.115, 0.13), 0.55),
    "lichen": material("salt and lichen stains", (0.25, 0.30, 0.25), 0.91),
    "rust": material("corroded iron", (0.34, 0.18, 0.10), 0.82, 0.35),
    "iron": material("painted iron", (0.11, 0.17, 0.19), 0.55, 0.72),
    "concrete": material("weathered concrete", (0.32, 0.35, 0.34)),
    "glass": material("cold translucent glass", (0.32, 0.48, 0.53), 0.18, 0.06, 0.55),
    "glass_dark": material("dark storm glass", (0.13, 0.23, 0.27), 0.16, 0.08, 0.7),
    "warm": material("warm interior light", (0.98, 0.72, 0.31), 0.35, 0.0, 1.0, 2.1),
    "beacon": material("hazard amber beacon", (1.0, 0.65, 0.19), 0.2, 0.0, 1.0, 4.0),
    "paint": material("faded off white paint", (0.61, 0.64, 0.59)),
    "red": material("dull warning red", (0.44, 0.12, 0.10), 0.68, 0.2),
    "paper": material("yellowed paper", (0.67, 0.61, 0.43)),
    "book_cover": material("oilcloth ledger cover", (0.20, 0.26, 0.23), 0.84),
    "ink": material("aged black stencil paint", (0.055, 0.075, 0.075), 0.9),
    "brass": material("tarnished fittings", (0.40, 0.32, 0.17), 0.55, 0.7),
}


def add_pbr_maps(mat, stem, include_metal=False):
    """Use a glTF-compatible Principled texture/normal/roughness node chain."""
    base = TEXTURES / f"{stem}_diffuse.jpg"
    if not base.exists():
        print(f"PBR texture missing for {stem}; using simple material")
        return
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")

    def image_node(suffix, colorspace):
        path = TEXTURES / f"{stem}_{suffix}.jpg"
        tex = nodes.new("ShaderNodeTexImage")
        tex.label = f"Poly Haven {stem} {suffix} CC0"
        tex.image = bpy.data.images.load(str(path), check_existing=True)
        tex.image.colorspace_settings.name = colorspace
        tex.extension = 'REPEAT'
        return tex

    diffuse = image_node('diffuse', 'sRGB')
    links.new(diffuse.outputs['Color'], bsdf.inputs['Base Color'])
    rough = image_node('rough', 'Non-Color')
    links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])
    normal_image = image_node('nor_gl', 'Non-Color')
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = 0.72
    links.new(normal_image.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    if include_metal:
        metal = image_node('metal', 'Non-Color')
        links.new(metal.outputs['Color'], bsdf.inputs['Metallic'])


for _key in ('wood',):
    add_pbr_maps(M[_key], 'wood')
for _key in ('wood_light', 'floorboards'):
    add_pbr_maps(M[_key], 'timber')
for _key in ('concrete', 'stone', 'stone_dark'):
    add_pbr_maps(M[_key], 'concrete')
add_pbr_maps(M['rust'], 'rust', include_metal=True)


class Model:
    """Collect geometry by material: a few GLB nodes even with many details."""

    def __init__(self, name):
        self.name = name
        self.geo = {key: [[], []] for key in M}

    def _poly(self, verts, faces, mat):
        dst_verts, dst_faces = self.geo[mat]
        offset = len(dst_verts)
        dst_verts.extend(verts)
        dst_faces.extend(tuple(offset + k for k in face) for face in faces)

    def box(self, x, y, z, w, d, h, mat, rz=0):
        verts = []
        cr, sr = math.cos(rz), math.sin(rz)
        for dx, dy, dz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                           (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
            xx, yy = dx*w/2, dy*d/2
            verts.append((x + xx*cr - yy*sr, y + xx*sr + yy*cr, z + dz*h/2))
        self._poly(verts, [(0,3,2,1),(4,5,6,7),(0,1,5,4),
                           (1,2,6,5),(2,3,7,6),(3,0,4,7)], mat)

    def cyl(self, x, y, z, radius, height, mat, n=12, r2=None):
        if r2 is None:
            r2 = radius
        verts = []
        for zz, rr in ((z-height/2, radius), (z+height/2, r2)):
            verts.extend((x+rr*math.cos(i*math.tau/n),
                          y+rr*math.sin(i*math.tau/n), zz) for i in range(n))
        faces = [tuple(reversed(range(n))), tuple(range(n, n*2))]
        faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
        self._poly(verts, faces, mat)

    def gable_roof(self, w, d, eave, ridge, mat, x=0, y=0, gable_mat='wood'):
        v = [(x-w/2,y-d/2,eave),(x,y-d/2,ridge),(x+w/2,y-d/2,eave),
             (x-w/2,y+d/2,eave),(x,y+d/2,ridge),(x+w/2,y+d/2,eave)]
        self._poly(v, [(0,1,4,3),(1,2,5,4),(0,3,5,2)], mat)
        self._poly(v, [(0,2,1),(3,4,5)], gable_mat)

    def slate_courses(self, w, d, eave, ridge, seed=0):
        """Low-cost staggered slate courses fused into three material meshes.

        A thin face sits above the original roof plane. The lower edge of each
        course overlaps the next, so the silhouette reads as individual slates
        in oblique rain light without hundreds of draw calls.
        """
        half_w = w / 2
        course_count = max(7, round(half_w / .54))
        tile_count = max(7, round(d / .82))
        for side in (-1, 1):
            for row in range(course_count):
                inner = half_w * row / course_count
                outer = half_w * (row + 1) / course_count + .055
                outer = min(half_w + .03, outer)
                phase = .5 if row % 2 else 0.0
                for col in range(tile_count + 1):
                    y0 = -d / 2 + (col - phase) * d / tile_count
                    y1 = y0 + d / tile_count + .03
                    y0, y1 = max(-d/2, y0), min(d/2, y1)
                    if y1 - y0 < .13:
                        continue
                    # Stable tonal variation, no random state or generated texture.
                    shade = (row * 19 + col * 31 + seed * 13 + (1 if side > 0 else 0)) % 11
                    mat = 'slate_dark' if shade in (0, 7) else 'slate_mid' if shade in (2, 5, 9) else 'roof'
                    edge = .032 + .008 * (shade % 3)
                    x0, x1 = side * inner, side * outer
                    z0 = ridge - inner / half_w * (ridge - eave) + edge
                    z1 = ridge - outer / half_w * (ridge - eave) + edge
                    winding = (0,1,2,3) if side > 0 else (3,2,1,0)
                    self._poly([(x0,y0,z0),(x1,y0,z1),(x1,y1,z1),(x0,y1,z0)], [winding], mat)
        # Ridge cap and drip edge prevent the rows from looking like loose cards.
        self.box(0,0,ridge+.06,.27,d+.12,.14,'slate_dark')
        for x in (-half_w, half_w):
            self.box(x,0,eave-.035,.13,d+.13,.13,'iron')

    def front_label(self, caption, x, y, z, size=.34, mat='ink'):
        """Bake original lettering into the same per-material GLB mesh."""
        curve = bpy.data.curves.new('sign lettering', 'FONT')
        curve.body = caption
        curve.size = size
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'
        curve.extrude = .002
        label = bpy.data.objects.new('sign lettering', curve)
        bpy.context.collection.objects.link(label)
        label.location = (x, y, z)
        label.rotation_euler = (math.pi/2, 0, 0)
        bpy.ops.object.select_all(action='DESELECT')
        label.select_set(True)
        bpy.context.view_layer.objects.active = label
        bpy.ops.object.convert(target='MESH')
        bpy.context.view_layer.update()
        mesh = bpy.context.view_layer.objects.active
        verts = [tuple(mesh.matrix_world @ vertex.co) for vertex in mesh.data.vertices]
        faces = [tuple(face.vertices) for face in mesh.data.polygons]
        self._poly(verts, faces, mat)
        bpy.data.objects.remove(mesh, do_unlink=True)

    def beam_xz(self, x0, z0, x1, z1, y, breadth, depth, mat):
        """A slim sloped stringer/rail along XZ, with its cross section square."""
        dx, dz = x1-x0, z1-z0
        length = math.hypot(dx,dz)
        nx,nz = -dz/length*breadth/2,dx/length*breadth/2
        v=[(x0+nx,y-depth/2,z0+nz),(x1+nx,y-depth/2,z1+nz),
           (x1-nx,y-depth/2,z1-nz),(x0-nx,y-depth/2,z0-nz),
           (x0+nx,y+depth/2,z0+nz),(x1+nx,y+depth/2,z1+nz),
           (x1-nx,y+depth/2,z1-nz),(x0-nx,y+depth/2,z0-nz)]
        self._poly(v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),
                      (1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)

    def wall_x(self, y, w, h, thickness, mat, openings=()):
        xs = sorted({-w/2,w/2} | {a for a,b,c,d in openings} | {b for a,b,c,d in openings})
        zs = sorted({0,h} | {c for a,b,c,d in openings} | {d for a,b,c,d in openings})
        for xa,xb in zip(xs,xs[1:]):
            for za,zb in zip(zs,zs[1:]):
                mx,mz=(xa+xb)/2,(za+zb)/2
                if any(a < mx < b and c < mz < d for a,b,c,d in openings):
                    continue
                self.box(mx,y,mz,xb-xa,thickness,zb-za,mat)

    def wall_y(self, x, d, h, thickness, mat, openings=()):
        ys = sorted({-d/2,d/2} | {a for a,b,c,e in openings} | {b for a,b,c,e in openings})
        zs = sorted({0,h} | {c for a,b,c,e in openings} | {e for a,b,c,e in openings})
        for ya,yb in zip(ys,ys[1:]):
            for za,zb in zip(zs,zs[1:]):
                my,mz=(ya+yb)/2,(za+zb)/2
                if any(a < my < b and c < mz < e for a,b,c,e in openings):
                    continue
                self.box(x,my,mz,thickness,yb-ya,zb-za,mat)

    def window_x(self,x,y,z,w,h,lit=False):
        self.box(x,y,z,w,0.055,h,"glass_dark")
        for xx in (x-w/2,x+w/2):
            self.box(xx,y,z,0.105,0.12,h+0.10,"wood_light")
        for zz in (z-h/2,z+h/2):
            self.box(x,y,zz,w+0.15,0.12,0.10,"wood_light")
        self.box(x,y-0.075,z,0.06,0.04,h,"wood_light")
        self.box(x,y-0.080,z,w+.06,.045,.052,"wood_light")
        self.box(x,y-.17,z-h/2-.12,w+.24,.24,.12,"stone_dark")
        if lit:
            self.box(x,y+0.12,z,w*0.64,0.025,h*0.65,"warm")

    def window_y(self,x,y,z,w,h):
        self.box(x,y,z,0.055,w,h,"glass_dark")
        for yy in (y-w/2,y+w/2):
            self.box(x,yy,z,0.12,0.105,h+0.1,"wood_light")
        for zz in (z-h/2,z+h/2):
            self.box(x,y,zz,0.12,w+0.12,0.1,"wood_light")
        self.box(x,y,z,.045,.07,h,"wood_light")
        self.box(x,y,z,.045,w+.06,.052,"wood_light")

    def export(self):
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        count=0
        for key,(verts,faces) in self.geo.items():
            if not verts:
                continue
            mesh = bpy.data.meshes.new(f"{self.name}_{key}_mesh")
            mesh.from_pydata(verts, [], faces)
            mesh.materials.append(M[key])
            mesh.update()
            if key in ('wood', 'wood_light', 'floorboards', 'concrete', 'stone', 'stone_dark', 'rust'):
                repeat_size = {'wood': 2.0, 'wood_light': 1.6, 'floorboards': 2.5,
                               'concrete': 2.2, 'stone': 2.2,
                               'stone_dark': 2.2, 'rust': 1.8}[key]
                uvmap = mesh.uv_layers.new(name='UVMap')
                for poly in mesh.polygons:
                    normal = poly.normal
                    for loop_index in poly.loop_indices:
                        vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                        if abs(normal.z) >= max(abs(normal.x), abs(normal.y)):
                            uv = (vertex.x / repeat_size, vertex.y / repeat_size)
                        elif abs(normal.y) >= abs(normal.x):
                            uv = (vertex.x / repeat_size, vertex.z / repeat_size)
                        else:
                            uv = (vertex.y / repeat_size, vertex.z / repeat_size)
                        uvmap.data[loop_index].uv = uv
            obj=bpy.data.objects.new(f"{self.name}_{key}",mesh)
            bpy.context.collection.objects.link(obj)
            count += 1
        path=OUT/f"{self.name}.glb"
        bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB',
                                  export_yup=True, export_extras=True)
        print(f"ASSET {self.name}: {path.stat().st_size} bytes, {count} material meshes")


def lodge():
    m=Model("lodge")
    w,d,h=16,11,7.8
    m.box(0,0,0.24,16.8,11.8,0.48,"stone")
    m.box(0,0,.52,15.55,10.55,.085,"floorboards")
    m.box(0,0,3.8,15.7,10.7,0.15,"wood_light")  # upper floor
    front=[(-1.2,1.2,0,2.7),(-6.4,-4.5,1.2,3.1),(4.5,6.4,1.2,3.1),
           (-6.25,-4.65,4.8,6.8),(-3.7,-2.3,5.0,6.6),
           (-0.8,0.8,4.8,6.8),(2.3,3.7,5.0,6.6),(4.65,6.25,4.8,6.8)]
    back=[(-5.9,-4.3,1.4,3.2),(-.9,.9,1.4,3.2),(4.3,5.9,1.4,3.2),
          (-5.9,-4.3,4.9,6.8),(-.8,.8,4.9,6.8),(4.3,5.9,4.9,6.8)]
    m.wall_x(-d/2,w,h,.28,"wood",front)
    m.wall_x(d/2,w,h,.28,"wood",back)
    for xx in (-w/2,w/2):
        m.wall_y(xx,d,h,.28,"wood",[
            (-3.75,-2.25,1.5,3.0),(-1.2,1.2,1.5,3.0),(2.25,3.75,1.5,3.0),
            (-3.75,-2.25,5.0,6.6),(-1.2,1.2,5.0,6.6),(2.25,3.75,5.0,6.6)])
    m.gable_roof(17.4,12.2,h,10.8,"roof")
    m.slate_courses(17.4,12.2,h,10.8,seed=2)
    m.box(0,-6.14,8.83,1.68,.07,.61,"iron")
    for zz in (8.66,8.83,9.0):
        m.box(0,-6.19,zz,1.56,.07,.055,"wood_light")
    # Corner battens, storey bands and stained plinth break up the long flat
    # elevations while remaining clear of every glazed opening.
    for xx in (-7.78,7.78):
        for yy in (-5.48,5.48):
            m.box(xx,yy,4.0,.21,.24,7.65,"wood_light")
        m.box(xx,0,3.84,.22,11.25,.16,"wood_light")
        m.box(xx,0,.68,.09,10.95,.15,"lichen")
    for yy in (-5.52,5.52):
        m.box(0,yy,3.87,15.72,.16,.18,"wood_light")
        m.box(0,yy,.72,15.72,.065,.13,"lichen")
    for xx in (-7.9,7.9):
        m.box(xx,-5.57,7.7,.16,.38,.24,"iron")
        m.cyl(xx,-5.63,3.94,.095,7.45,"rust",8)
        m.box(xx,-5.92,.32,.42,.47,.22,"iron")
    # Roof-edge trim and shingles read from a distance.
    for yy in [i*0.8-5.6 for i in range(15)]:
        for sign in (-1,1):
            xx=sign*4
            zz=10.8-(abs(xx)/8.7)*3.0+0.035
            m.box(xx,yy,zz,0.035,0.025,0.035,"wood_light")
    for x,z,ww,hh in [(-5.45,2.15,1.9,1.9),(5.45,2.15,1.9,1.9),
                      (-5.45,5.8,1.6,2),(-3.0,5.8,1.4,1.6),(0,5.8,1.6,2),
                      (3.0,5.8,1.4,1.6),(5.45,5.8,1.6,2)]:
        m.window_x(x,-5.53,z,ww,hh,lit=(x==5.45 and z==2.15))
    for x,z,ww,hh in [(-5.1,2.3,1.6,1.8),(0,2.3,1.8,1.8),(5.1,2.3,1.6,1.8),
                      (-5.1,5.85,1.6,1.9),(0,5.85,1.6,1.9),(5.1,5.85,1.6,1.9)]:
        m.window_x(x,5.53,z,ww,hh)
    for x in (-8.03,8.03):
        for y in (-3.0,0,3.0):
            for z in (2.25,5.8):
                m.window_y(x,y,z,1.5 if y else 2.4,1.5 if z==2.25 else 1.6)
    # Open front door: slab is swung 75 degrees into the porch.
    m.box(-1.0,-6.25,1.3,1.55,.12,2.55,"wood_light",math.radians(75))
    m.box(0,-5.72,2.78,2.65,.42,.17,"stone_dark")
    for xx in (-1.35,1.35):
        m.box(xx,-5.72,1.35,.15,.24,2.7,"stone_dark")
    m.box(0,-7.2,0.17,5.4,3.2,.34,"stone_dark")
    for xx in (-2.35,2.35):
        m.box(xx,-8.5,1.75,.24,.24,3.5,"wood_light")
    m.box(0,-8.5,3.45,5.1,.55,.17,"wood_light")
    m.box(0,-5.80,3.30,3.68,.16,.47,"paint")
    m.front_label("KEEPER'S LODGE",0,-5.905,3.30,.34)
    for xx in (-2.38,2.38):
        m.box(xx,-8.29,1.54,.12,.15,2.40,"wood")
        m.box(xx,-8.28,2.59,.15,2.72,.13,"wood_light")
    for xx in (-1.95,1.95):
        m.box(xx,-8.10,.52,.45,.52,.50,"stone")
    # Interior staircase, desk, cabinets, stove, hanging practical lights.
    for i in range(12):
        x=-6.55+i*.42
        top=.67+i*.27
        m.box(x,3.0,top-.055,.47,1.16,.11,"wood_light")
        m.box(x-.20,3.0,top-.18,.07,1.13,.27,"wood")
    for y in (2.36,3.64):
        m.beam_xz(-6.78,.54,-1.62,3.76,y,.17,.11,"wood_light")
    for i in (0,3,6,9,11):
        x=-6.55+i*.42
        top=.67+i*.27
        m.box(x,2.34,top+.41,.065,.07,.90,"iron")
    m.beam_xz(-6.60,1.12,-1.81,4.09,2.34,.085,.075,"iron")
    m.box(3.5,2.7,1.08,2.2,1.2,.14,"wood_light")
    for xx in (2.7,4.3):
        for yy in (2.25,3.15):
            m.box(xx,yy,.55,.13,.13,1.1,"wood")
    m.box(5.4,3.2,.95,1.4,.9,1.9,"iron")
    m.cyl(5.4,3.2,2.0,.24,2.2,"iron")
    m.box(0,2.5,1.05,3.65,.84,.12,"wood_light")
    for xx in (-1.66,1.66):
        for yy in (2.16,2.83):
            m.box(xx,yy,.58,.11,.11,.95,"wood_light")
    m.box(0,2.96,1.43,3.58,.10,.68,"wood_light")
    for xx in (-7.67,7.67):
        m.box(xx,0,.83,.11,10.3,.12,"wood_light")
        m.box(xx,0,3.53,.13,10.3,.14,"wood_light")
    for yy in (-5.18,5.18):
        m.box(0,yy,.83,15.25,.10,.12,"wood_light")
        m.box(0,yy,3.53,15.25,.10,.14,"wood_light")
    # Small domestic props sit on existing furniture and walls while the
    # central walking route remains unobstructed.
    m.box(1.03,2.37,1.22,.46,.31,.055,"brass")
    m.box(1.03,2.37,1.28,.36,.22,.045,"paper")
    m.cyl(-1.06,2.40,1.21,.14,.16,"paper",12)
    m.cyl(-1.06,2.40,1.32,.105,.03,"stone_dark",12)
    for xx in (-2.1,2.1):
        m.box(xx,5.12,2.69,1.28,.29,.10,"wood_light")
        for i in range(4):
            m.box(xx-.43+i*.27,4.96,2.88,.10,.18,.28+.07*(i%2),
                  "paper" if i%2 else "wood_light")
    for xx in (-5.9,5.9):
        m.box(xx,-4.98,2.57,.45,.11,.13,"brass")
        m.cyl(xx,-4.95,2.73,.09,.27,"warm",8)
    # Maps, small books and a hanging raincoat make the lodge feel recently used.
    m.box(-4.8,5.24,2.05,2.25,.12,1.65,"wood_light")
    m.box(-4.8,5.15,2.05,1.92,.04,1.35,"paper")
    for xx, zz, length in ((-5.36,1.78,.58),(-4.80,2.24,.81),(-4.34,1.75,.51)):
        m.box(xx,5.12,zz,length,.025,.035,"ink",math.radians(12))
    for xx,zz in ((-5.08,1.61),(-4.40,2.41),(-4.73,1.90)):
        m.box(xx,5.105,zz,.16,.025,.10,"red")
    for i in range(7):
        xx=-1.27+i*.37
        tall=.35+(.04 if i%3==0 else 0)
        m.box(xx,2.4,1.30,.19,.26,tall,"book_cover" if i%2 else "wood")
        m.box(xx,2.26,1.30,.16,.025,tall-.045,"paper")
        m.box(xx,2.22,1.31,.035,.015,.18,"brass")
    m.box(.9,2.48,1.13,.42,.31,.025,"paper")
    m.box(5.2,1.63,2.03,.86,.32,1.67,"roof")
    m.box(5.2,1.63,2.91,.43,.30,.37,"roof")
    m.box(5.2,1.59,3.22,.83,.13,.08,"wood_light")
    for xx in (4.55,5.85):
        m.box(xx,1.63,2.31,.48,.25,.76,"roof")
    for x,y in ((0,-2.5),(4,1.0),(-3,2)):
        m.cyl(x,y,3.43,.13,.2,"warm",8)
    m.box(5.6,3.0,9.45,1.3,1.3,2.4,"stone_dark")
    for z in (8.9,9.55,10.20):
        m.box(5.6,3.0,z,1.45,1.45,.12,"stone")
    m.box(5.6,3.0,10.81,1.72,1.72,.18,"stone_dark")
    m.cyl(5.6,3.0,10.78,.19,.25,"iron")
    m.export()


def archive():
    m=Model("archive")
    w,d,h=14,9,4.7
    m.box(0,0,.18,w+.8,d+.8,.36,"stone_dark")
    m.wall_x(-d/2,w,h,.34,"concrete",[(-1.2,1.2,0,2.75),(-5.5,-3.8,1.65,3.15),(3.8,5.5,1.65,3.15)])
    m.wall_x(d/2,w,h,.34,"concrete",[
        (-5.3,-4.1,1.7,3.0),(-1,1,1.7,3.0),(4.1,5.3,1.7,3.0)])
    for x in (-w/2,w/2):
        m.wall_y(x,d,h,.34,"concrete",[
            (-3,-1.4,1.65,3.1),(1.4,3,1.65,3.1)])
    m.box(0,0,h+.2,w+1.0,d+1.0,.42,"stone_dark")
    # Raised parapet, rain-stained columns, and scuppers make the archive's
    # roof and administrative frontage read clearly from the grassy approach.
    for yy in (-4.67,4.67):
        m.box(0,yy,5.03,14.85,.22,.68,"concrete")
        m.box(0,yy,5.31,14.92,.34,.12,"stone_dark")
        for xx in (-6.75,-2.7,2.7,6.75):
            m.box(xx,yy,2.34,.32,.42,4.67,"concrete")
            m.box(xx,yy-.035,.76,.15,.03,.84,"lichen")
    for xx in (-7.17,7.17):
        m.box(xx,0,5.03,.22,9.55,.68,"concrete")
        m.box(xx,0,5.31,.36,9.66,.12,"stone_dark")
        m.cyl(xx,3.82,2.23,.11,4.45,"rust",8)
    for xx in (-5.15,5.15):
        m.box(xx,-4.72,5.07,.86,.47,.10,"rust")
        m.box(xx,-4.72,4.89,.11,.47,.29,"rust")
    m.box(0,-4.75,3.75,3.25,.11,.43,"paint")
    m.front_label("SURVEY ARCHIVE",0,-4.82,3.75,.34)
    m.box(0,-4.7,3.35,2.8,.38,.28,"iron")
    m.box(-1.15,-5.0,1.35,.1,.1,2.7,"rust")
    m.box(1.15,-5.0,1.35,.1,.1,2.7,"rust")
    m.box(-1.22,-5.15,1.35,2.2,.12,2.55,"iron",math.radians(-66))
    for x in (-4.65,4.65):
        m.window_x(x,-4.55,2.4,1.7,1.5)
        for zz in (2.03,2.78):
            m.box(x,-4.70,zz,1.52,.08,.06,"rust")
    m.window_x(0,4.55,2.35,2,1.3)
    for x in (-4.7,4.7):
        m.window_x(x,4.55,2.35,1.2,1.3)
    for x in (-7.02,7.02):
        for y in (-2.2,2.2):
            m.window_y(x,y,2.4,1.6,1.45)
    for xx in (-5.86,-2.86,.14,3.14,5.84):
        m.box(xx,4.27,.43,.17,.14,.85,"rust")
    # Six banks of labeled shelving visible through the open entrance.
    for x in (-5.8,-2.8,.2,3.2,5.9):
        m.box(x,2.5,1.6,.2,3.4,3.2,"iron")
        for zz in (.55,1.35,2.15,2.95):
            m.box(x,2.5,zz,1.8,3.5,.13,"wood_light")
            for yy in (1.2,2.2,3.2):
                m.box(x,yy,zz+.22,1.4,.5,.3,"paper")
    m.box(0,-1.0,1,2.4,1.2,.12,"wood_light")
    m.box(0,-1,1.15,1.3,.9,.025,"paper")
    for xx in (-.72,-.28,.32):
        m.box(xx,-1.01,1.19,.22,.48,.035,"paint")
    m.box(0,-.61,1.24,1.47,.055,.055,"ink")
    m.box(1.05,-.92,1.25,.26,.29,.2,"rust")
    m.cyl(-.45,-.8,1.16,.22,.025,"paper",12)
    for x,y in [(-4,-2.0),(4.15,-.85),(2.65,2.7)]:
        m.box(x,y,.45,.9,.75,.8,"wood_light")
        m.box(x,y,.88,.78,.6,.025,"paper")
        m.box(x,y-.39,.45,.60,.02,.49,"ink")
    m.box(-5.9,-3.45,1.55,1.35,.12,.96,"wood_light")
    m.box(-5.9,-3.37,1.55,1.12,.03,.74,"paper")
    m.cyl(0,-1,3.9,.18,.22,"warm",8)
    # Low roof vents and rain drains.
    for x in (-4.7,4.7):
        m.box(x,2.3,5.08,1.2,1.8,.6,"iron")
        m.box(x,2.3,5.48,1.5,2.1,.1,"stone_dark")
    for x in (-6.55,6.55):
        m.cyl(x,4.15,2.1,.12,4.2,"rust",8)
    m.export()


def signal_tower():
    m=Model("signal_tower")
    # Accessible tower-base room. The front opening faces glTF +Z, matching
    # the other buildings.
    m.box(0,0,.15,9,9,.3,"stone_dark")
    m.wall_x(-3.75,7.5,3.7,.32,"concrete",[(-1.25,1.25,0,2.85)])
    m.wall_x(3.75,7.5,3.7,.32,"concrete",[(-1.1,1.1,1.55,2.7)])
    for x in (-3.75,3.75):
        m.wall_y(x,7.5,3.7,.32,"concrete",[(.8,2.2,1.55,2.7)])
    m.box(0,0,3.75,7.8,7.8,.24,"stone_dark")
    # A raised lintel and a door folded against the left wall make the opening
    # legible even from the landing path without blocking first-person entry.
    m.box(0,-4.0,2.92,2.9,.38,.24,"rust")
    for x in (-1.32,1.32):
        m.box(x,-3.96,1.42,.13,.23,2.84,"iron")
    m.box(-3.42,-2.65,1.40,.11,2.15,2.64,"iron")
    # Salt-corroded lower cladding and exposed cable runs keep the room from
    # becoming a uniform concrete box at first-person viewing distance.
    m.box(0,3.55,0.98,7.05,.055,1.25,"rust")
    for x in (-3.56,3.56):
        m.box(x,-.54,.98,.055,6.15,1.25,"rust")
        m.box(x,-.54,1.65,.085,6.15,.08,"iron")
    for y in (-3.0,1.72,3.1):
        m.box(-3.43,y,1.98,.10,.13,2.25,"iron")
    m.box(-3.40,2.8,2.92,.10,1.2,.11,"rust")
    m.box(-.55,-1.65,.32,.12,3.65,.025,"paint")
    m.box(.55,-1.65,.32,.12,3.65,.025,"paint")
    m.cyl(0,-2.75,3.26,.22,.24,"warm",8)
    m.box(0,-2.75,3.48,.58,.55,.12,"iron")
    # Island light circuit controls, on the west/left interior wall. A dark
    # panel face and tactile switches remain readable in dim weather.
    m.box(-3.36,1.72,1.44,.2,1.95,1.72,"iron")
    m.box(-3.23,1.72,1.62,.025,1.52,.95,"glass_dark")
    for yy in (1.10,1.56,2.02):
        m.box(-3.17,yy,.88,.12,.16,.12,"beacon")
        m.box(-3.11,yy,.70,.12,.07,.24,"rust")
    m.box(-3.32,1.72,2.41,.16,2.05,.13,"red")
    # Two-route alignment board, on the east/right interior wall. The three
    # raised markers suggest one lower front lamp and two alternative rears.
    m.box(3.37,-1.75,1.72,.2,2.65,1.88,"wood_light")
    m.box(3.22,-1.75,1.72,.025,2.36,1.58,"paper")
    m.box(3.15,-1.75,2.75,.13,2.8,.16,"iron")
    for yy,zz in ((-2.45,1.22),(-1.77,2.15),(-1.03,2.15)):
        m.box(3.18,yy,zz,.06,.16,.16,"beacon")
    for yy in (-2.42,-1.72,-1.02):
        m.box(3.17,yy,1.62,.04,.025,.6,"red")
    m.box(2.60,-1.73,.55,1.35,2.35,.14,"iron")
    # Maintenance bench and log sheets stay against the back wall, leaving
    # a broad clear path from the entrance to both equipment stations.
    m.box(0,3.03,.78,3.9,.76,.12,"iron")
    for x in (-1.72,1.72):
        m.box(x,3.03,.42,.10,.58,.72,"rust")
    m.box(-.62,2.91,.87,1.18,.65,.025,"paper")
    m.box(.62,2.94,.98,.75,.45,.25,"rust")
    m.box(.62,2.70,1.12,.79,.07,.12,"iron")
    m.cyl(-2.38,.03,.47,.46,.40,"iron",12)
    m.cyl(-2.38,.03,.47,.17,.45,"rust",12)
    m.box(2.24,.35,.48,.86,.78,.7,"wood_light")
    m.box(2.24,.35,.87,.78,.65,.025,"paper")
    for x in (-2.65,2.65):
        m.box(x,3.52,2.52,1.30,.08,.05,"iron")
        m.box(x,3.40,2.27,.67,.03,.38,"paper")
    m.window_x(0,3.94,2.12,2.2,1.15)
    for x in (-3.94,3.94):
        m.window_y(x,1.5,2.12,1.4,1.15)
    for z in (5.8,9.0,13.0,17.0):
        r=2.45-(z-5)*.04
        m.cyl(0,0,z,r,4.1,"paint",12,r2=r-.15)
        m.cyl(0,0,z+2.0,r+.12,.15,"stone_dark",12)
        for az in (0,math.pi/2,math.pi,3*math.pi/2):
            xx,yy=math.cos(az)*(r+.03),math.sin(az)*(r+.03)
            m.box(xx,yy,z+.45,.22,.22,.9,"glass_dark",az)
    m.cyl(0,0,19.05,3.3,.25,"iron",12)
    # Lantern room: clear-ish glass facets between slim structural ribs.
    for i in range(12):
        a=i*math.tau/12
        x,y=math.cos(a)*2.42,math.sin(a)*2.42
        m.box(x,y,20.4,.11,.12,2.55,"iron",a)
        a2=(i+.5)*math.tau/12
        x2,y2=math.cos(a2)*2.42,math.sin(a2)*2.42
        m.box(x2,y2,20.4,1.16,.035,2.28,"glass",a2+math.pi/2)
    m.cyl(0,0,20.5,.56,1.2,"beacon",12)
    m.cyl(0,0,21.75,3.0,.38,"iron",12,r2=2.55)
    m.cyl(0,0,22.22,.18,.7,"iron",8)
    m.cyl(0,0,22.63,.36,.18,"beacon",8)
    # External safety rail and ladder.
    for i in range(16):
        a=i*math.tau/16
        m.box(math.cos(a)*3.1,math.sin(a)*3.1,19.75,.07,.07,1.25,"iron")
    m.cyl(0,0,20.3,3.13,.05,"iron",16)
    for xx in (-2.7,-2.2):
        m.box(xx,-2.8,10.0,.06,.06,15.2,"iron")
    for z in [2.7+i*.48 for i in range(30)]:
        m.box(-2.45,-2.8,z,.58,.07,.06,"iron")
    m.export()


def radio_house():
    m=Model("radio_house")
    w,d,h=11,8,4.4
    m.box(0,0,.18,w+.5,d+.5,.36,"stone_dark")
    m.wall_x(-d/2,w,h,.23,"wood",[(-1.0,1.0,0,2.5),(-4.5,-2.9,1.5,3.05),(2.9,4.5,1.5,3.05)])
    m.wall_x(d/2,w,h,.23,"wood",[
        (-4.2,-2.8,1.5,2.9),(-1.25,1.25,1.5,2.9),(2.8,4.2,1.5,2.9)])
    for x in (-w/2,w/2):
        m.wall_y(x,d,h,.23,"wood",[(-3.1,-1.7,1.6,3),(1.7,3.1,1.6,3)])
    m.gable_roof(11.8,8.7,h,6.35,"roof")
    m.slate_courses(11.8,8.7,h,6.35,seed=7)
    m.box(0,-4.39,5.18,1.18,.07,.46,"iron")
    for zz in (5.05,5.18,5.31):
        m.box(0,-4.43,zz,1.07,.06,.045,"rust")
    # Salt-faded fascia and storm shutters frame the lit receiver windows.
    for xx in (-5.43,5.43):
        for yy in (-3.96,3.96):
            m.box(xx,yy,2.2,.19,.24,4.27,"wood_light")
    for yy in (-4.0,4.0):
        m.box(0,yy,3.28,10.9,.12,.13,"wood_light")
        m.box(0,yy,.60,10.9,.07,.11,"lichen")
    m.box(0,-4.17,3.65,3.03,.14,.42,"paint")
    m.front_label("GREYWAKE RADIO",0,-4.26,3.65,.32)
    for xx in (-4.66,-2.74,2.74,4.66):
        m.box(xx,-4.18,2.27,.38,.12,1.53,"wood_light")
        for zz in (1.78,2.08,2.38,2.68):
            m.box(xx,-4.26,zz,.33,.045,.07,"wood")
        m.box(xx,-4.29,2.24,.06,.045,1.43,"rust")
    for xx in (-5.42,5.42):
        m.cyl(xx,-3.80,2.19,.07,4.12,"rust",8)
        m.box(xx,-3.79,.23,.43,.33,.18,"iron")
    m.box(-.9,-4.2,1.2,1.6,.12,2.4,"iron",math.radians(50))
    for x in (-3.7,3.7):
        m.window_x(x,-4.08,2.25,1.6,1.55)
    m.window_x(0,4.08,2.25,2.5,1.4)
    for x in (-3.5,3.5):
        m.window_x(x,4.08,2.25,1.4,1.4)
    for x in (-5.55,5.55):
        for y in (-2.4,2.4):
            m.window_y(x,y,2.3,1.4,1.4)
    # Inside: console, radio banks, cable reels and a generator.
    m.box(0,1.5,.82,5.6,1.15,.15,"iron")
    for x in (-2,-.7,.7,2):
        m.box(x,1.85,1.35,1.1,.35,1.05,"iron")
        m.box(x,1.65,1.5,.65,.03,.35,"glass_dark")
        m.box(x+.32,1.61,1.08,.10,.08,.08,"beacon")
        for offset in (-.27,-.03,.21):
            m.cyl(x+offset,1.49,1.06,.055,.045,"brass",8)
        m.box(x,1.48,1.79,.82,.04,.055,"paint")
    m.box(3.9,2.2,.85,1.5,2,1.7,"rust")
    for z in (.4,.9,1.4):
        m.box(3.9,1.15,z,1.35,.08,.05,"iron")
    m.box(-2.7,2.54,.85,2.1,.64,.12,"wood_light")
    m.box(-2.7,2.50,.95,1.2,.50,.025,"paper")
    m.cyl(-3.5,1.3,.45,.37,.48,"iron",12)
    m.cyl(-3.5,1.3,.45,.12,.51,"rust",12)
    m.box(2.0,-2.85,1.21,1.15,.23,1.48,"iron")
    for z in (.75,1.15,1.55):
        m.box(2.0,-2.71,z,.77,.04,.08,"beacon")
    # Cable trays run high along the walls rather than through the playable
    # space. The wall map and amber meters support the routing mystery.
    m.box(0,3.72,3.22,9.25,.13,.12,"rust")
    m.box(-5.21,0,3.22,.13,6.95,.12,"rust")
    for xx in (-4.1,-2.2,-.3,1.6,3.5):
        m.box(xx,3.64,3.07,.12,.13,.23,"iron")
    m.box(-4.89,1.20,1.90,.12,1.63,1.02,"wood_light")
    m.box(-4.81,1.20,1.90,.025,1.36,.78,"paper")
    for yy,zz in ((.82,1.62),(1.2,2.14),(1.58,1.62)):
        m.box(-4.78,yy,zz,.03,.18,.055,"red")
    # Mast is attached, so this model creates a memorable silhouette.
    m.cyl(4.55,2.4,9.6,.12,16,"iron",8)
    for z in (7.5,11.0,15.4):
        m.box(4.55,2.4,z,3.1,.11,.11,"iron")
        for xx in (3.24,5.86):
            m.box(xx,2.4,z-.34,.08,.08,.72,"rust")
    for x in (3.1,6.0):
        m.cyl(x,2.4,15.45,.05,.55,"iron",8)
    m.box(4.55,2.4,17.7,.6,.6,.18,"beacon")
    m.export()


def pump_house():
    m=Model("pump_house")
    w,d,h=10,8,4.3
    m.box(0,0,.3,w+.8,d+.8,.6,"stone_dark")
    m.wall_x(-d/2,w,h,.36,"stone",[(-1.05,1.05,0,2.75),(-4,-2.5,1.5,3.0),(2.5,4,1.5,3.0)])
    m.wall_x(d/2,w,h,.36,"stone",[
        (-3.25,-1.95,1.5,2.9),(1.95,3.25,1.5,2.9)])
    for x in (-w/2,w/2):
        m.wall_y(x,d,h,.36,"stone",[
            (-2.9,-1.5,1.4,2.8),(1.5,2.9,1.4,2.8)])
    m.box(0,0,h+.22,w+1,d+1,.44,"stone_dark")
    m.box(-1.2,-4.55,1.37,2.1,.10,2.65,"red",math.radians(-70))
    for x in (-3.25,3.25):
        m.window_x(x,-4.2,2.25,1.5,1.5)
    for x in (-2.6,2.6):
        m.window_x(x,4.2,2.2,1.3,1.4)
    for x in (-5.05,5.05):
        for y in (-2.2,2.2):
            m.window_y(x,y,2.1,1.4,1.4)
    # Visible water machinery inside the open entrance.
    for x in (-2.3,2.3):
        m.box(x,1.6,.6,2.2,1.45,1.2,"iron")
        m.cyl(x,1.6,1.45,.54,.48,"rust",12)
        m.cyl(x,1.6,1.8,.19,.45,"iron",12)
        m.box(x,2.75,1.6,.3,2.5,.32,"rust")
    for z in (.85,1.45,2.05,2.65):
        m.box(-4.2,3.3,z,1.3,.17,.08,"paint")
    m.box(-4.2,3.3,2.85,1.5,.18,.1,"red")
    # Physical equipment: emergency power at the rear left, relay fittings
    # at the rear right and a radio by the front right window.
    m.box(-4.15,2.1,1.30,.38,.82,1.12,"iron")
    m.box(-3.88,2.1,1.82,.18,.16,.68,"red")
    m.box(3.35,2.25,.92,1.05,.68,.14,"wood_light")
    m.box(3.35,2.25,1.06,.62,.39,.18,"rust")
    m.box(3.12,-2.10,.86,1.28,.86,.22,"iron")
    m.box(3.12,-2.10,1.22,.91,.48,.49,"iron")
    m.box(3.12,-2.33,1.31,.54,.03,.24,"glass_dark")
    m.cyl(-1.28,2.64,.65,.48,.65,"rust",12)
    m.box(-1.28,2.64,1.01,.60,.55,.13,"iron")
    # External pipe, valve and overflow gauge.
    m.cyl(5.6,1.8,1.2,.48,2.4,"rust",12)
    m.box(5.6,-.6,1.2,.65,4.9,.65,"rust")
    m.cyl(5.6,-2.9,1.2,.85,.13,"iron",12)
    m.box(5.6,-2.9,1.2,1.8,.12,.12,"red")
    m.box(-5.3,-2.9,1.9,.18,.15,2.8,"paint")
    for z in (.7,1.2,1.7,2.2,2.7,3.2):
        m.box(-5.45,-2.9,z,.22,.18,.04,"red")
    m.export()


BUILDERS = (lodge, archive, signal_tower, radio_house, pump_house)
requested = set(sys.argv[sys.argv.index('--') + 1:]) if '--' in sys.argv else None
for build in BUILDERS:
    if requested is None or build.__name__ in requested:
        build()

print("Generated GLBs:", [p.name for p in sorted(OUT.glob("*.glb"))])
