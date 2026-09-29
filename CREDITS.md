# Credits and asset licenses

Island World retains the source project's authored island layout, Blender-built structures, procedural boats and vehicles, weather and shoreline effects, roads, interior details, wildlife, collision, camera controls, and interface. Its two distant islands, cliff strata, wind-shaped trees, ridge buildings, lighthouse towers, rotating beams, and eye-glare effect use new project-created geometry, materials, and animation, with no downloaded model or texture. Other elements use project-created geometry, shaders, animation, or code unless a source is named below. Third-party files remain under their original licenses; attribution here records provenance even where CC0 does not require it.

The complete third-party notices are bundled in [`public/THIRD_PARTY_LICENSES.md`](public/THIRD_PARTY_LICENSES.md). Material, audio, and music folders each include a `SOURCES.md` file with their exact download URLs and local checksums. Keep those records and the required MIT/OFL notices with distributed builds.

## CC0 surface materials

The following offline texture maps come from [Poly Haven](https://polyhaven.com/license) and are available under CC0. Terrain maps are in `public/assets/textures/`; building and boat maps are in `public/assets/building-textures/`; bark and optional fallback grass maps are in `public/assets/vegetation-textures/`.

| Material | Current or retained use | Source |
| --- | --- | --- |
| Coast Sand Rocks 02 | Island terrain | [Poly Haven](https://polyhaven.com/a/coast_sand_rocks_02) |
| Rock Face, photographed by Greg Zaal and processed by Dario Barresi | Coastal cliffs | [Poly Haven](https://polyhaven.com/a/rock_face) |
| Rock Ground | Exposed rock and reef | [Poly Haven](https://polyhaven.com/a/rock_ground) |
| Wood Peeling Paint Weathered | Building timber | [Poly Haven](https://polyhaven.com/a/wood_peeling_paint_weathered) |
| Brown Planks 03 | Floors, trim, boardwalk, and boat decks | [Poly Haven](https://polyhaven.com/a/brown_planks_03) |
| Rough Concrete | Buildings and stonework | [Poly Haven](https://polyhaven.com/a/rough_concrete) |
| Rusty Metal 04, by Amal Kumar | Building metal and boat surface detail | [Poly Haven](https://polyhaven.com/a/rusty_metal_04) |
| Leafy Grass | Retained alternative grass maps | [Poly Haven](https://polyhaven.com/a/leafy_grass) |
| Withered Grass | Retained alternative grass maps | [Poly Haven](https://polyhaven.com/a/withered_grass) |
| Knotted Pine Bark | Tree trunks and branches | [Poly Haven](https://polyhaven.com/a/knotted_pine_bark) |

See [`terrain sources`](public/assets/textures/SOURCES.md), [`building texture sources`](public/assets/building-textures/SOURCES.md), and [`vegetation texture sources`](public/assets/vegetation-textures/SOURCES.md) for the original URLs and checksums.

## CC0 coastal 3D models

The island uses the following 1K glTF assets from [Poly Haven](https://polyhaven.com/license). Their meshes are instanced in small, culled terrain cells; grass, ferns, and shrubs also use the separately supplied alpha maps so leaf silhouettes render correctly. Models are scattered with their source display offsets removed, varied in scale and tint, and placed outside roads, buildings, the lake, and the lake viewpoint. The precise download URLs and verified file hashes are in [`coastal model sources`](public/assets/coastal-models/SOURCES.md).

| Model | Author(s) | Island use | Source |
| --- | --- | --- | --- |
| Grass Medium 02 | Rico Cilliers | Phototextured tufts mixed into the existing wind grass | [Poly Haven](https://polyhaven.com/a/grass_medium_02) |
| Fern 02 | Rico Cilliers and Rob Tuytel | Fern clumps in sheltered ground and lake banks | [Poly Haven](https://polyhaven.com/a/fern_02) |
| Shrub Sorrel 01 | Rico Cilliers | Low flowering groundcover | [Poly Haven](https://polyhaven.com/a/shrub_sorrel_01) |
| Shrub 03 | Rico Cilliers | Taller seed-bearing shrubs in sheltered pockets | [Poly Haven](https://polyhaven.com/a/shrub_03) |
| Dry Branches Medium 01 | Rico Cilliers | Weathered branches on exposed ground | [Poly Haven](https://polyhaven.com/a/dry_branches_medium_01) |
| Rock Moss Set 02 | Kless Gyzen | Damp stone accents at the lake and coast | [Poly Haven](https://polyhaven.com/a/rock_moss_set_02) |

The [Sketchfab Arachis repens model](https://sketchfab.com/3d-models/arachis-repens-low-poly-plant-301fa20bac9f416286266be83c2039b1) was reviewed but is not shipped: it has about 421,000 triangles and would be unsuitable for dense placement.

## CC0 harbor props

The following original 1K glTF model bundles come from [Poly Haven](https://polyhaven.com/license) under CC0. They may be redistributed and used in commercial builds. The files were downloaded through Poly Haven's official files API and verified against its published MD5 hashes and byte sizes. See the [per-file source record](public/assets/harbor-props/SOURCES.md).

| Model | Author(s) | Source |
| --- | --- | --- |
| Ocean Buoy | Mateusz Sadek | [Poly Haven](https://polyhaven.com/a/ocean_buoy) |
| Lifebuoy | Hank Kaamura | [Poly Haven](https://polyhaven.com/a/lifebuoy) |
| Wooden Crate 02 | James Ray Cock (modeling), Jurita Burger (graphic design) | [Poly Haven](https://polyhaven.com/a/wooden_crate_02) |
| Wooden Bucket 02 | James Ray Cock | [Poly Haven](https://polyhaven.com/a/wooden_bucket_02) |
| Utility Box 02 | James Ray Cock | [Poly Haven](https://polyhaven.com/a/utility_box_02) |
| Portable Searchlight | Elijah Cragg | [Poly Haven](https://polyhaven.com/a/portable_searchlight) |

## Sketchfab coastal characters — CC BY 4.0

The following models were downloaded through Sketchfab's official 1K GLB option and placed on the island as sparse focal characters. Their [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/) permits redistribution and commercial use with attribution. Keep this credit and the [source, hash, and modification record](public/assets/sketchfab-npcs/SOURCES.md) with every distributed build.

| Model | Creator | Island use | Source |
| --- | --- | --- | --- |
| Gone fishing | Bree08 | Standing fisherman and rod | [Sketchfab](https://sketchfab.com/3d-models/gone-fishing-abdb06aa64e84462aa88eed6b25742f5) |
| Old Fisherman | Bente Schoone | Seated fishing elder with chair and tackle | [Sketchfab](https://sketchfab.com/3d-models/old-fisherman-1359f1408b6c4dccae835f26cc70f5f2) |

The original 1K `Gone fishing` export is in `public/assets/sketchfab-npcs/`; the untouched `Old Fisherman` export is preserved in source-only `source-assets/sketchfab-npcs/`. Its browser copy was re-exported from Blender with 96 meshes joined into six by material, with geometry and textures preserved. Runtime placement, scale, and orientation are additional changes made for Island World. The two decorative ground and water card batches on `Old Fisherman` are hidden at runtime so its chair and tackle sit on the island shore. Exact hashes and modifications are in `SOURCES.md`.

## Vegetation and weather code

| Component | Use | License/source |
| --- | --- | --- |
| [WindSweptGrass](https://gist.github.com/kitchenbeats/7e80e53ee4cc1a3177925f48cdf61793) by J Hanlon / I Dream Of AI | Adapted code-generated grass field | MIT; [bundled notice](public/THIRD_PARTY_LICENSES.md) |
| [EZ-Tree](https://github.com/dgreenheck/ez-tree) by Daniel Greenheck | Generated tree branch and leaf-card geometry | MIT; [bundled notice](public/THIRD_PARTY_LICENSES.md) |
| [webgl-noise](https://github.com/ashima/webgl-noise) by Ashima Arts and Stefan Gustavson | Simplex noise used in tree sway | Permissive notice in [bundled licenses](public/THIRD_PARTY_LICENSES.md) |
| [Procedural Weather — Three.js Skill](https://github.com/CK42BB/procedural-weather-threejs) by Kingsley | Reference for shader-driven rain animation | MIT; [bundled notice](public/THIRD_PARTY_LICENSES.md) |

The trees use project-created leaf artwork and the CC0 bark map above. Their placement, proportions, and sway integration are authored for this island. The volumetric cloud shader, celestial lighting, dynamic weather clock, lightning, shoreline surf, rain impacts, and wet-window effects use project-created geometry or shaders. The [Three.js Sky documentation](https://threejs.org/docs/pages/Sky.html) and [Three.js WebGL cloud example](https://threejs.org/examples/webgl_volume_cloud.html) were consulted as rendering references; their shader source was not copied into this project. No Grassworks proprietary code, Free3D grass model, or downloaded cloud/tree model is included.

## Ocean wave code

The shared directional wave spectrum and Gerstner displacement in `src/oceanWaveField.js` are adapted from [Open Water's wave simulation](https://github.com/bob6664569/open-water/blob/285b6ce32057c70191a7fe16c31d979fa383ac64/site/js/simulation/waves.js) by bob6664569 under the MIT License. The same field drives the rendered ocean and sampled boat height and tilt. Only source code was adapted; no Open Water models, textures, audio, or other media are bundled. The full notice is in [`public/THIRD_PARTY_LICENSES.md`](public/THIRD_PARTY_LICENSES.md).

## Recorded ambience and music

The following recordings in `public/assets/audio/` come from creator submissions on OpenGameArt. Each linked page offers CC0; the rain-on-window file is used under its CC0 option. When a recording cannot load, the project can synthesize ambience with Web Audio. Thunder, bird calls, vehicle tones, and fall/sea-impact cues are synthesized in code.

| Local files | Recording and creator | Source/license |
| --- | --- | --- |
| `ocean-wave-1.flac` through `ocean-wave-4.flac` | **Beach Ocean Waves** by jasinski, submitted by qubodup | [OpenGameArt, CC0](https://opengameart.org/content/beach-ocean-waves) |
| `wind.ogg` | **wind whoosh loop** by SketchMan3, derived from JaggedStone's **Loopable Dungeon Ambience** | [Wind loop, CC0](https://opengameart.org/content/wind-whoosh-loop); [source ambience, CC0](https://opengameart.org/content/loopable-dungeon-ambience) |
| `rain.ogg` | **AMB Rain Loop 1** by Kresiek The Furry | [OpenGameArt, CC0](https://opengameart.org/content/amb-rain-loop-1) |
| `rain-on-window.wav` | **Rain on Window Loop** by alxl | [OpenGameArt, CC0 option](https://opengameart.org/content/rain-on-window-loop) |

The subdued piano file `public/assets/music/forget-me-not-loop.ogg` is **Forget Me Not in F Major** by Kistol, provided as a loop on [OpenGameArt under CC0 1.0](https://opengameart.org/content/forget-me-not). The menu provides a separate music volume control. The precise audio filename mappings and checksums are in [`audio sources`](public/assets/audio/SOURCES.md) and [`music sources`](public/assets/music/SOURCES.md). No film score, film melody, recorded dialogue, or thunder recording is used.

## CC0 island character model assets

Six generated character GLBs and their shared images in `public/assets/` provide the other island residents. Their meshes, rigs, skin, hair, clothing, and textures come from the official [MakeHuman system assets](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html), whose selected core assets are [CC0](https://static.makehumancommunity.org/about/license.html). They were generated offline with [MPFB](https://extensions.blender.org/add-ons/mpfb/) in Blender. MPFB is a build tool; its code and the full source asset pack are not shipped. The new `mira.glb` is the older lake watcher, with the pack's old female skin, silver bob, coat, trousers, and walking shoes; `dane.glb` is the pump mechanic in work overalls. They replace two repeated rigs without adding to the resident count. The selected part and license details are in [`public/THIRD_PARTY_LICENSES.md`](public/THIRD_PARTY_LICENSES.md); the new models' exact official download URLs, input and delivered hashes, and texture changes are in [`public/assets/MAKEHUMAN_SOURCES.md`](public/assets/MAKEHUMAN_SOURCES.md). The generated GLBs reference lossless WebP images in `public/assets/shared_images/` and need browser WebP support.

## Runtime libraries and fonts

| Package | Use | License |
| --- | --- | --- |
| [Three.js](https://threejs.org/) | 3D rendering and GLB loading | MIT |
| [Vite](https://vite.dev/) | Development server and static build | MIT |
| [DM Sans](https://fontsource.org/fonts/dm-sans) via Fontsource | Interface text | SIL OFL 1.1 |
| [Libre Baskerville](https://fontsource.org/fonts/libre-baskerville) via Fontsource | Display text | SIL OFL 1.1 |

The [bundled license file](public/THIRD_PARTY_LICENSES.md) includes the required notices for Three.js, Open Water, WindSweptGrass, EZ-Tree, webgl-noise, the cited weather reference, and both font families. Installed package licenses are also available in `node_modules/`. Package versions are locked by `package-lock.json`.
