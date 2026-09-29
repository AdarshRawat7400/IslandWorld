"""Build Oren Pike from the official MakeHuman CC0 system asset pack.

The model remains a review candidate under work/ until its in-game scale,
materials, pose, and footing have been checked. See docs/character-candidate.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_tamsin_candidate as builder


builder.OUTPUT = builder.WORK / "oren-candidate.glb"
builder.RENDER = builder.ROOT.parent / "oren-mpfb-candidate.png"
builder.BLEND = builder.WORK / "oren-candidate.blend"

SPEC = {
    "name": "Oren Pike (candidate)",
    "gender": 0.0,
    "age": 0.78,
    "weight": 0.56,
    "muscle": 0.43,
    "skin": "skins/old_caucasian_male/old_caucasian_male.mhmat",
    "clothes": "clothes/male_casualsuit05/male_casualsuit05.mhclo",
    "boots": "clothes/shoes01/shoes01.mhclo",
    "hair": "hair/short04/short04.mhclo",
    "hat": "clothes/fedora01/fedora01.mhclo",
    "eyes": "eyes/low-poly/low-poly.mhclo",
    "eyebrows": "eyebrows/eyebrow001/eyebrow001.mhclo",
    "eyelashes": "eyelashes/eyelashes01/eyelashes01.mhclo",
}


if __name__ == "__main__":
    builder.extract_selected_sources(SPEC)
    human, rig = builder.make_character(SPEC)
    builder.limit_accessory_maps({
        "fedora_diffuse.png": 1024,
        "male_casualsuit05_normal.png": 2048,
    })
    builder.BLEND.parent.mkdir(parents=True, exist_ok=True)
    builder.bpy.ops.wm.save_as_mainfile(filepath=str(builder.BLEND))
    builder.pose_neutral(rig)
    builder.export_candidate(rig)
    builder.render_preview(rig)
    print(f"RENDER {builder.RENDER} bytes={builder.RENDER.stat().st_size}")
