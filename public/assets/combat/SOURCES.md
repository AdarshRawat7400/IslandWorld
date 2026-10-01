# IslandWorld combat model sources

## Textured revolver

- **Asset:** [Revolver Game Asset](https://opengameart.org/content/revolver-game-asset)
- **Creator:** loafbrr_1 (asset file copyright field: `loafbrr`)
- **License:** [Creative Commons Zero 1.0](https://creativecommons.org/publicdomain/zero/1.0/), as shown on the OpenGameArt page and the archive's `README.txt`.
- **Official source archive:** `https://opengameart.org/sites/default/files/revolver_fbx_gltf_blend_textures.zip`
- **Source archive SHA-256:** `D404E247C2503937D7BA8FC965E9872A8E3636AEF0DE6100C2AE30650112EB4D`
- **Included game asset:** `revolver-loafbrr-cc0.glb`
- **Included asset SHA-256:** `39E612E38FB2BA79E77AF9C28A8E377F22C5DAB4FA906548DD0345C40931CA50`

The game asset is a self-contained 243,760-byte GLB. It retains the gun mesh, three 1024×1024 embedded WebP textures, and the source PBR material. It excludes the source's ammunition props, visible cartridge meshes, and unused animations. The barrel points along the model's local **+X** axis, **+Y** is up, and the complete gun extends roughly 0.345 m along X. The glTF scene bounds are approximately `(-0.043,-0.061,-0.025)` to `(0.302,0.116,0.025)` meters.

Conversion: take `GLTF/RevolverExport.gltf` from the official archive, set the glTF scene's root `nodes` to `[36]` (the `RevolverRig`), remove nodes 17–28 from that rig's `children` (the cartridge meshes), remove `animations`, then run glTF-Transform CLI 4.5.1 `optimize` with `--compress false --texture-compress webp --texture-size 1024 --flatten true --join true --simplify false --palette false`. No compressed mesh decoder is required; WebP texture support is required. The glTF validator reports no errors and warns that source normal maps rely on runtime-generated tangent space.

## Anatomical revolver trigger arm

- **Asset:** [fps arms (rigged only)](https://opengameart.org/content/fps-arms-rigged-only)
- **Creator:** para, using a MakeHuman mesh and texture with custom rig cleanup and UV bake
- **License:** [Creative Commons Zero 1.0](https://creativecommons.org/publicdomain/zero/1.0/), as shown on the OpenGameArt source page
- **Official source archive:** `https://opengameart.org/sites/default/files/fps%20arms.7z`
- **Source archive SHA-256:** `31F6C7BD5CAEA8856C4AAFCA8461F38A3C8BFDD3D8F05C898E403B9475E54562`
- **Included game asset:** `fps-hands-para-cc0.glb`
- **Included asset SHA-256:** `0B4880273B223066D69F756605B65BD20388023190655A8321BCBCD9217B9BA9`

Conversion: opened `FPS ARMS RIG 1 test anim.blend` in Blender 5.1, baked the source armature deformation at animation frame 30, separated the two arm meshes, kept the right arm, scaled its camera-relative coordinates to meters, and retained the source 1024×1024 anatomical skin texture. Forearm polygons were assigned an `Island coat sleeve` material; at runtime that material uses the project's original sleeve weave texture. The right wrist is aligned to the revolver grip. The resulting 788,436-byte GLB contains no armature, animation, camera, lights, or unused left arm. Original procedural hand and sleeve geometry in `src/combatPresentation.js` remains available for the rifle and shotgun, and as a revolver fallback if the model cannot load.
