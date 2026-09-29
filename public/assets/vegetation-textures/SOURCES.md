# Vegetation texture sources

The default grass renderer is adapted from MIT-licensed
[WindSweptGrass.js](https://gist.github.com/kitchenbeats/7e80e53ee4cc1a3177925f48cdf61793),
revision `de189ffe172c8f69895b59a847c851a4e406241d`, by J Hanlon / I Dream
Of AI (2026). Its [full notice](../../THIRD_PARTY_LICENSES.md) is bundled.
Island changes add terrain/cliff/path masks, scene weather wind scaling, and
muted coastal colors. The older original grass remains as a debug fallback
using `?grass=original`; its blade and scattered-stone geometry is original.

Tree branches and leaf cards are generated with MIT-licensed EZ-Tree 1.1.0;
the leaf-spray artwork is drawn in code. The photographic PBR materials below
are by Poly Haven and licensed **CC0**. Files here are resized, JPEG-encoded
copies of the official 1K maps for the game's offline bundle. The leafy and
withered grass maps are used only by the original debug fallback; the default
WindSweptGrass field uses procedural colors.

Tree generator: https://github.com/dgreenheck/ez-tree (MIT); the user's
reference article is https://tympanus.net/codrops/2025/01/27/fractals-to-forests-creating-realistic-3d-trees-with-three-js/.
EZ-Tree's published bundle contains embedded demo textures, but the scene
replaces both bark and leaf materials before drawing a tree.

Both WindSweptGrass and EZ-Tree full MIT notices are in [`public/THIRD_PARTY_LICENSES.md`](../../THIRD_PARTY_LICENSES.md).

License: https://polyhaven.com/license

| Local files | Official asset page | Exact source downloads |
| --- | --- | --- |
| `leafy_diffuse.jpg` | https://polyhaven.com/a/leafy_grass | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/leafy_grass/leafy_grass_diff_1k.jpg |
| `withered_diffuse.jpg` | https://polyhaven.com/a/withered_grass | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/withered_grass/withered_grass_diff_1k.jpg |
| `bark_diffuse.jpg` | https://polyhaven.com/a/knotted_pine_bark | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/knotted_pine_bark/knotted_pine_bark_diff_1k.jpg |
| `bark_nor_gl.jpg` | https://polyhaven.com/a/knotted_pine_bark | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/knotted_pine_bark/knotted_pine_bark_nor_gl_1k.jpg |
| `bark_rough.jpg` | https://polyhaven.com/a/knotted_pine_bark | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/knotted_pine_bark/knotted_pine_bark_rough_1k.jpg |

The game loads these local files and makes no live Poly Haven API requests.
No Free3D model or texture or Grassworks proprietary code or asset is used.
