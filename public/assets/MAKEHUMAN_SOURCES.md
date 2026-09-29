# Mira and Dane: MakeHuman CC0 character source record

These two island residents were generated offline for Island World. They replace
reused models at the existing lake watcher and pump mechanic sites. No extra
residents were added. The other four MakeHuman characters are listed in
`../THIRD_PARTY_LICENSES.md`.

## Official input downloads

| Input | Official source | SHA-256 |
| --- | --- | --- |
| MakeHuman system assets CC0 ZIP | [MakeHuman Community asset pack](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html); [direct file](https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip) | `B542127A8E25547C7C29C19F2D1D2ADB9A664C80396ECD694095DBC8028A0107` |
| MPFB 2.0.17 Blender extension ZIP | [Official Blender Extensions page](https://extensions.blender.org/add-ons/mpfb/); [direct ZIP](https://extensions.blender.org/download/sha256:4f0a879d64a39bf646fbf5f53601ac678855da329d650617dca5737548239a87/add-on-mpfb-v2.0.17.zip?repository=%2Fapi%2Fv1%2Fextensions%2F&blender_version_min=4.2.0) | `4F0A879D64A39BF646FBF5F53601AC678855DA329D650617DCA5737548239A87` |

The selected core character assets are [CC0](https://static.makehumancommunity.org/about/license.html), including commercial redistribution. The selected `.mhclo` and `.mhmat` files in the official ZIP each say “explicitly released as CC0 in september 2020” and identify Data Collection AB, Joel Palmius, and Jonas Hauquier as copyright holders at release. The build scripts check those headers before export. MPFB's code is an offline build tool and is not shipped.

## Selected parts

| Resident | Model role | Selected CC0 source parts inside the ZIP |
| --- | --- | --- |
| Mira | Older lake watcher | `skins/old_caucasian_female/old_caucasian_female.mhmat`; `hair/bob02/bob02.mhclo`; `clothes/male_casualsuit05/male_casualsuit05.mhclo`; `clothes/shoes02/shoes02.mhclo` |
| Dane | Pump mechanic | `skins/middleage_asian_male/middleage_asian_male.mhmat`; `hair/short01/short01.mhclo`; `clothes/male_worksuit01/male_worksuit01.mhclo`; `clothes/shoes04/shoes04.mhclo` |

Both also use the pack's core human mesh, game-engine rig, `eyes/low-poly/low-poly.mhclo`, `eyebrows/eyebrow001/eyebrow001.mhclo`, `eyelashes/eyelashes01/eyelashes01.mhclo`, and `eyes/materials/brown.mhmat` and its image. The source ZIP and MPFB extension stay in the offline `work/character_sources/` folder, outside Island World's shipped files.

## Build and delivered files

| Resident | Blender build script | Untouched candidate export SHA-256 | Browser GLB SHA-256 | Browser bytes | Triangles |
| --- | --- | --- | --- | ---: | ---: |
| Mira | `tools/build_mira_candidate.py` | `08453C9A71DEA1D0817D508A68F6B73B7DF179351A399D4684AF84C330DE0E78` | `6EDAB22C22E8B90176465E4A330A2DC8C40F4012843387A3CBD84A1BC7B7A1AD` | 1,030,064 | 27,856 |
| Dane | `tools/build_dane_candidate.py` | `19F95F2758806A430214BF7AF0111E0227E1B7A4441277A3CC95B0D17BE541EA` | `C8402C1F5007798F6232C6F54F70409C819DE1DA2BF56FB09AEC9F094B7CBE30` | 1,176,264 | 31,484 |

The candidate exports are in offline `work/character_sources/` and the delivered files are `assets/mira.glb` and `assets/dane.glb`. Mira has seven skinned meshes and eight images; Dane has seven skinned meshes and nine images. The generated clothing normal maps were reduced from 4096 to 2048 pixels for both. Mira's hair diffuse map was reduced from 2048 to 1024 pixels. The original CC0 ZIP was not modified. All other PNG maps were encoded as lossless WebP, verified by comparing decoded RGBA pixels. The images were externalized and deduplicated into `assets/shared_images/`, so the browser GLB byte counts exclude referenced image bytes. `tools/glb_shared_images_manifest.json` records every image and geometry hash, and `python tools/deduplicate_glb_images.py --verify` checks them.

The characters are posed in a neutral standing rest pose and placed at the existing lake and pump sites. These are the modifications to the CC0 inputs; no third-party body, clothing, texture, or voice asset was added.
