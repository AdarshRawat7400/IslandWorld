"""Build Elias Ward from the official MakeHuman CC0 system asset pack.

The model remains a review candidate under work/ until its in-game scale,
materials, pose, and footing have been checked. See docs/character-candidate.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_tamsin_candidate as builder


builder.OUTPUT = builder.WORK / "elias-candidate.glb"
builder.RENDER = builder.ROOT.parent / "elias-mpfb-candidate.png"
builder.BLEND = builder.WORK / "elias-candidate.blend"

SPEC = {
    "name": "Elias Ward (candidate)",
    "gender": 0.0,
    "age": 0.55,
    "weight": 0.48,
    "muscle": 0.38,
    "skin": "skins/middleage_caucasian_male/middleage_caucasian_male.mhmat",
    "clothes": "clothes/male_casualsuit01/male_casualsuit01.mhclo",
    "boots": "clothes/shoes04/shoes04.mhclo",
    "hair": "hair/short02/short02.mhclo",
    "eyes": "eyes/low-poly/low-poly.mhclo",
    "eyebrows": "eyebrows/eyebrow001/eyebrow001.mhclo",
    "eyelashes": "eyelashes/eyelashes01/eyelashes01.mhclo",
}


if __name__ == "__main__":
    builder.extract_selected_sources(SPEC)
    human, rig = builder.make_character(SPEC)
    builder.BLEND.parent.mkdir(parents=True, exist_ok=True)
    builder.bpy.ops.wm.save_as_mainfile(filepath=str(builder.BLEND))
    builder.pose_neutral(rig)
    builder.export_candidate(rig)
    builder.render_preview(rig)
    print(f"RENDER {builder.RENDER} bytes={builder.RENDER.stat().st_size}")
