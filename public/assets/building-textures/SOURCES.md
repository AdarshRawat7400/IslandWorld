# Building material sources

These 13 local JPEG maps are offline, resized/re-encoded derivatives of the linked [Poly Haven CC0 materials](https://polyhaven.com/license). They are used by the Blender-generated buildings; the timber and rust maps also serve the ferry and rescue launch at runtime. The source material pages document the original asset and its license. `tools/build_assets.py` records how each local map family is assigned to GLB materials. The exact CDN download URLs and conversion commands used for these local derivatives were not retained; the local hashes below identify the files in this release.

| Local family and files | Poly Haven material | Application |
| --- | --- | --- |
| `wood_*` | [Wood Peeling Paint Weathered](https://polyhaven.com/a/wood_peeling_paint_weathered) | Painted exterior timber |
| `timber_*` | [Brown Planks 03](https://polyhaven.com/a/brown_planks_03) | Interior timber, ferry deck, and rescue deck |
| `concrete_*` | [Rough Concrete](https://polyhaven.com/a/rough_concrete) | Concrete and stone surfaces |
| `rust_*` | [Rusty Metal 04](https://polyhaven.com/a/rusty_metal_04) | Corroded fittings and ferry/rescue metal detail |

The diffuse/normal/rough suffixes denote color, OpenGL normal, and roughness maps. `rust_metal.jpg` is the metallic map. The timber application receives a warm material tint in the generated buildings.

| Local file | SHA-256 |
| --- | --- |
| `concrete_diffuse.jpg` | `82622ccdfd000d5d579ad8dc94bdd7eb1bff4126cbf083ffb6cfdd85494b4957` |
| `concrete_nor_gl.jpg` | `3e6393f31cdaa47d7c19bc6d77a9a2b014e93566dc6b5ef3157c045a1cf51672` |
| `concrete_rough.jpg` | `5d6f2f7ee98aa356fa95b078463363356996d5a6c7fddb76da28a4b2d7414e53` |
| `rust_diffuse.jpg` | `e66a5e4a4744fe9786647e6d4494859fa5538730b570ae33ab90465eccd124a5` |
| `rust_metal.jpg` | `293b716f3411887ccbbf325b5fdeee22169010d374a1ff705ce7b1e2b4d35159` |
| `rust_nor_gl.jpg` | `72a8b3e0bb1f845503bcae9d69e995d5b6b04235fae7b568f59c91731e2b4135` |
| `rust_rough.jpg` | `4d67eadcc0cbf2aa4c17c78102fd0e211bee3d1bd7daa412db7516407176d009` |
| `timber_diffuse.jpg` | `d7171a1a9407c05e35b66be6e06cb97457badd4935b81bf7e3785cc6430351b0` |
| `timber_nor_gl.jpg` | `26ef885e3cfbe3ea8302d30a7b5fe107436e32c5d7ab7d800dbcf73a6de8e981` |
| `timber_rough.jpg` | `dd13f77efc821df8f941428ced59c84ee1373ff42fe8f6b190d2d9937750a6a3` |
| `wood_diffuse.jpg` | `65fac38f6c8380fa52604258041a4a0b8d4ac2d485a33146350362047f8d89ec` |
| `wood_nor_gl.jpg` | `5805428ff0a5fb67199e8ee24b0406b63f3069de93a7d531284b38eb241d73b2` |
| `wood_rough.jpg` | `a41091b807774df918f2a411f4366c97f2c0dd8bb0ca381d1753c1727a98adbc` |
