# Island World

An explorable coastal island built with Three.js and Blender assets. This project is a reusable world foundation: the terrain, weather, buildings, roads, vehicles, wildlife, ambient residents, ambience, and exploration controls are present, while campaign progression and story objectives are absent.

The source project remains in its own folder. This folder can be developed and built independently.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```powershell
npm ci
npm run dev
```

Open the local URL shown by Vite, typically `http://localhost:5173/`. The first load may take time while the building models and textures are prepared. Audio starts after selecting **Explore the Island**, because browsers require a user gesture.

To build and inspect the static release:

```powershell
npm run build
npm run preview
```

The output is `dist/`. Vite copies `public/` into that build, including the asset source records and license notices. The development and preview scripts listen on all network interfaces; use an appropriate firewall and access policy if sharing a local server.

## Explore

| Action | Desktop control |
| --- | --- |
| Move and look | WASD and mouse |
| Run | Shift |
| Talk to a nearby resident, drive, or leave a car | E |
| Steer while driving | A / D |
| Open map | M |
| Enter or leave drone view | G |
| Flashlight | F |
| Mute or unmute audio | U |
| Open or close menu | Escape |

Desktop mouse look starts when you select **Explore the Island** or **Resume Exploring**. If the browser blocks mouse capture, hold the left mouse button and drag on the game view to look around; click the game again to retry capture.

The menu offers changing weather, mist, rain, thunderstorm, and dawn, plus separate piano and sea-volume controls. A map shows roads, landmarks, and the current position. On a landscape touch device, the project also displays a movement stick, look area, and context controls. The current visual target is desktop; lower-capability devices use a reduced render profile.

Walking off a high cliff triggers a fall and returns the player to safe ground. Cars can be driven on the road network. The drone offers a separate view and flight controls. Weather, wildlife, traffic, and offshore vessels continue to animate during exploration. The playable island has a lighthouse on West Headland, reached by a short path from the road. Two distant cliff islands sit north and southwest across a broad stretch of sea, about 3.3 km apart. All three rotating lighthouse beacons become most visible at night and during storms; looking toward a lens as it sweeps past produces a brief glare. The two offshore landmasses are atmospheric background, outside the playable area. The field map marks a roughly 120 × 96 metre lake in the island's central high ground; its waterline and north-bank viewing corridor stay clear, while fern, shrub, and mossy-stone pockets grow farther up the banks. Walking or driving into the water is blocked.

## Preserved world systems

- High coastal cliffs, textured terrain, reef, a highland lake, ocean swells, breaking surf, shoreline spray, two landing areas, and a West Headland lighthouse.
- Two distant, high-cliff island silhouettes with rock strata, coves, wind-shaped tree groves, small ridge buildings, weather-aware haze, and rotating lighthouse beacons.
- Dense generated grass, including lower wind-scoured cover around the high cliff rim, wind-shaped trees, seabirds, sheep, rabbits, ambient residents, and road traffic.
- Six CC0 phototextured coastal model sets add grass-tuft variation, ferns, low and tall shrubs, fallen branches, and mossy stones. Terrain-cell instancing and distance culling keep their rendering bounded; larger stones and branches block movement.
- Six CC0 harbor models add life rings, cargo crates, fishing buckets, utility boxes, portable searchlights, and floating channel buoys. Each 1K model loads once nearby; repeated props share geometry and maps, and solid items block walking and driving.
- Procedural clouds, moving storm fronts, spatial lightning, rain, splashes, wet windows, wind, and fire effects.
- Five detailed building models, a detention facility, smaller service structures, roads, a pier, boats, navigation lights, and interior details.
- Collision, indoor rain shelter, cliff fall and recovery, driving, drone view, map, first-person controls, audio ambience, and soft piano music.

Physical landmarks and coordinates live in [`src/worldSites.js`](src/worldSites.js). The environment entry point is [`src/main.js`](src/main.js); [`src/environmentStructures.js`](src/environmentStructures.js) places detailed buildings, lighting, boardwalks, and navigational objects. The original world systems remain in focused modules such as [`src/world.js`](src/world.js), [`src/vegetation.js`](src/vegetation.js), [`src/coastalDetails.js`](src/coastalDetails.js), [`src/harborProps.js`](src/harborProps.js), [`src/roads.js`](src/roads.js), [`src/fauna.js`](src/fauna.js), [`src/islandResidents.js`](src/islandResidents.js), and [`src/audio.js`](src/audio.js). Sparse residents use six CC0 MakeHuman based characters and two separately credited Sketchfab coastal figures; the more distant prison population stays instanced. Residents give brief ambient observations when approached, without starting campaign quests. Their model loading and draw distance are limited for browser performance.

The sea uses a shared wave field in [`src/oceanWaveField.js`](src/oceanWaveField.js) for rendered swells and boat motion. The elevated lake basin, shoreline, and smaller wind ripples are defined separately in [`src/inlandLake.js`](src/inlandLake.js). The distant landmasses, batched cliff/tree detail, shared rotating Fresnel-style lighthouse optics, and view-facing glare live in [`src/distantIslands.js`](src/distantIslands.js), [`src/offshoreIslandDetail.js`](src/offshoreIslandDetail.js), [`src/offshoreLighthouse.js`](src/offshoreLighthouse.js), and [`src/lighthouseGlare.js`](src/lighthouseGlare.js). In development, `?test=offshore_north`, `?test=offshore_southwest`, `?test=west_rim`, `?test=lighthouse`, and `?test=light_rain` start from useful sightlines; combine them with `?weather=clear&time=noon` or `?weather=storm&time=night`. Use `?test=light_rain&weather=rain&time=noon&rain=0.08` to inspect low-intensity splashes.

## Dynamic weather and daylight

**Weather** and **Time** are independent controls in the in-game menu. Their automatic settings run a repeating sequence of smooth coastal weather fronts and a 20-minute day and night cycle. Choose a fixed weather or time to inspect a scene without stopping the other cycle. For a reproducible browser view, use parameters such as `?weather=storm&time=night` or `?weather=clear&time=noon`.

[`src/dynamicWeather.js`](src/dynamicWeather.js) provides the clock, sun and moon positions, cloud cover, precipitation, wind speed, and wind direction. The same state drives the volumetric sky, moving sun and moon lighting, directional rain and spray, grass and tree sway, sea chop and slower swell energy, lake ripples, wet ground and windows, and the wind and rain audio mix. Cloud movement accumulates wind displacement so a changing direction cannot jump the pattern. Thunder and lightning remain tied to storm fronts; roofs still suppress nearby falling rain. The weather is simulated for this fictional island, not fetched from a live weather service.

The existing WebGL2 cloud renderer uses one locally generated 48³ density texture and at most eight ray steps on desktop; the mobile render profiles lower that cap to six, five, or four. Rain uses one shader-instanced field with a maximum of 16,000 drops and scales the active count with precipitation. The moonlight casts no shadow map, keeping the night scene's additional lighting cost modest.

## Assets and licenses

The original project authored its island layout, procedural geometry, effects, and interaction code. Reused materials, character models, recordings, code components, and fonts are credited in [`CREDITS.md`](CREDITS.md). The full notices are in [`public/THIRD_PARTY_LICENSES.md`](public/THIRD_PARTY_LICENSES.md), with exact media origins and checksums in the `SOURCES.md` files under `public/assets/`. The [Sketchfab NPC review](SKETCHFAB_NPC_REVIEW.md) records considered and excluded models. Preserve these notices when distributing a build. No proprietary grass package or Free3D grass model is included.
