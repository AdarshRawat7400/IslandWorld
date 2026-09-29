"""Build Dane, the pump mechanic, from the verified CC0 MakeHuman pack."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_tamsin_candidate as builder


builder.OUTPUT = builder.WORK / "dane-candidate.glb"
builder.RENDER = builder.ROOT.parent / "dane-mpfb-candidate.png"
builder.BLEND = builder.WORK / "dane-candidate.blend"

SPEC = {
    "name": "Dane (pump mechanic)",
    "gender": 0.0,
    "age": 0.48,
    "weight": 0.54,
    "muscle": 0.56,
    "skin": "skins/middleage_asian_male/middleage_asian_male.mhmat",
    "clothes": "clothes/male_worksuit01/male_worksuit01.mhclo",
    "boots": "clothes/shoes04/shoes04.mhclo",
    "hair": "hair/short01/short01.mhclo",
    "eyes": "eyes/low-poly/low-poly.mhclo",
    "eyebrows": "eyebrows/eyebrow001/eyebrow001.mhclo",
    "eyelashes": "eyelashes/eyelashes01/eyelashes01.mhclo",
}


if __name__ == "__main__":
    builder.extract_selected_sources(SPEC)
    human, rig = builder.make_character(SPEC)
    builder.limit_accessory_maps({
        "male_worksuit01_normal.png": 2048,
    })
    builder.BLEND.parent.mkdir(parents=True, exist_ok=True)
    builder.bpy.ops.wm.save_as_mainfile(filepath=str(builder.BLEND))
    builder.pose_neutral(rig)
    builder.export_candidate(rig)
    builder.render_preview(rig)
    print(f"RENDER {builder.RENDER} bytes={builder.RENDER.stat().st_size}")
