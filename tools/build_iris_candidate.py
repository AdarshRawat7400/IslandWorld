"""Build Iris Hale from the official CC0 MakeHuman system pack.

Uses the verified offline downloads described in docs/character-candidate.md.
This script writes a review candidate to work/; the packaged game asset is
copied only after its pose, appearance, and runtime placement are checked.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_tamsin_candidate as builder


builder.OUTPUT = builder.WORK / "iris-candidate.glb"
builder.RENDER = builder.ROOT.parent / "iris-mpfb-candidate.png"
builder.BLEND = builder.WORK / "iris-candidate.blend"

SPEC = {
    "name": "Iris Hale (candidate)",
    "gender": 1.0,
    "age": 0.27,
    "weight": 0.43,
    "muscle": 0.51,
    "skin": "skins/young_caucasian_female2/young_caucasian_female2.mhmat",
    "clothes": "clothes/male_casualsuit01/male_casualsuit01.mhclo",
    "boots": "clothes/shoes01/shoes01.mhclo",
    "hair": "hair/ponytail01/ponytail01.mhclo",
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
