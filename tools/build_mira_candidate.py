"""Build Mira, the older lake watcher, from the verified CC0 MakeHuman pack.

Offline inputs live in ../../work/character_sources. The game is never changed
until the exported portrait and GLB have been reviewed.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_tamsin_candidate as builder


builder.OUTPUT = builder.WORK / "mira-candidate.glb"
builder.RENDER = builder.ROOT.parent / "mira-mpfb-candidate.png"
builder.BLEND = builder.WORK / "mira-candidate.blend"

SPEC = {
    "name": "Mira (older lake watcher)",
    "gender": 1.0,
    "age": 0.79,
    "weight": 0.47,
    "muscle": 0.36,
    "skin": "skins/old_caucasian_female/old_caucasian_female.mhmat",
    "clothes": "clothes/male_casualsuit05/male_casualsuit05.mhclo",
    "boots": "clothes/shoes02/shoes02.mhclo",
    "hair": "hair/bob02/bob02.mhclo",
    "eyes": "eyes/low-poly/low-poly.mhclo",
    "eyebrows": "eyebrows/eyebrow001/eyebrow001.mhclo",
    "eyelashes": "eyelashes/eyelashes01/eyelashes01.mhclo",
}


if __name__ == "__main__":
    builder.extract_selected_sources(SPEC)
    human, rig = builder.make_character(SPEC)
    builder.limit_accessory_maps({
        "bob02_diffuse.png": 1024,
        "male_casualsuit05_normal.png": 2048,
    })
    builder.BLEND.parent.mkdir(parents=True, exist_ok=True)
    builder.bpy.ops.wm.save_as_mainfile(filepath=str(builder.BLEND))
    builder.pose_neutral(rig)
    builder.export_candidate(rig)
    builder.render_preview(rig)
    print(f"RENDER {builder.RENDER} bytes={builder.RENDER.stat().st_size}")
