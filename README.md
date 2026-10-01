# Island World

An explorable coastal island built with Three.js and Blender assets. This project is a reusable world foundation: the terrain, weather, buildings, roads, vehicles, wildlife, ambient residents, ambience, and exploration controls are present, while campaign progression and story objectives are absent.

**Play Island World:** [islandworld-3ccb4.web.app](https://islandworld-3ccb4.web.app/). Firebase Hosting serves the game, and the private-room server runs on [Render Free](https://islandworld-room-server.onrender.com/healthz). The public server URL is saved in `.env.production` for repeatable Firebase builds.

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

## Private multiplayer (local)

Start the room server and the game in separate terminals:

```powershell
npm ci
npm run server
```

```powershell
npm run dev
```

Open **Private Multiplayer** in the menu, enter a name, then create an **Explore** or **PvP** room. Share its six-character code with up to nine other players. Both modes start with a service revolver and hunting rifle; Explore blocks player-versus-player damage, but wildlife and human NPCs can be hurt in either mode. Survivors retaliate with firearms after a direct hit or a clear near miss. PvP also enables player damage, with server-owned ammunition, health, armor, death, and safe respawning. Island pickups include a pump shotgun, grenades, mines, field medkits, ammunition boxes, and armor plates. A player can carry three guns, three grenades, and three mines. Medkits restore up to 40 health; an ammo box adds one magazine to each carried gun's reserve, up to its normal limit. Armor plates restore up to 50 armor, capped at 100; armor absorbs eligible NPC attacks and PvP damage before health. Defeated players drop carried equipment that others can collect. The room remains open when its creator leaves as long as another member stays. A dropped connection can rejoin the same identity for two minutes; page reloads try to resume automatically, and the menu also offers **Rejoin Saved Room**.

| Combat action (solo or room) | Desktop | Landscape touch |
| --- | --- | --- |
| Fire / throw / place selected item | Left mouse button | FIRE / USE |
| Aim | Hold right mouse button | Tap AIM to toggle on/off |
| Reload | R | RELOAD |
| Quick-switch / equipment wheel | Tap Q or Tab to switch to the next available item; hold either key, move the mouse or use A/D, then release to equip | Tap WHEEL, then an item |
| Holster gun / roam unarmed | H toggles the last gun; 1–3 or the wheel also draw a gun | Choose the sixth, **HOLSTER**, wheel slot; choose a gun to draw it again |
| Direct equipment shortcut | 1–3 gun slots; 4 grenade; 5 mine | Equipment wheel |
| Sprint | Hold Shift while moving | Tap SPRINT to toggle running; tap again to walk |
| Crouch / go prone | C / Z; press the same key again to stand | Tap POSE to cycle standing, crouching, and prone |
| Collect nearby pickup | E | PICK UP |
| Respawn after defeat | Space or RESPAWN | RESPAWN |

The two clients need to reach the same room server. Localhost on a friend's computer refers to their computer; the Firebase build uses the Render HTTPS/WSS server configured in `.env.production` so friends on different networks can join the same room. See [`MULTIPLAYER_SERVER.md`](MULTIPLAYER_SERVER.md) for hosting, origin, and persistence details. Render Free sleeps after inactivity, so the first room connection may take time. A server restart ends in-memory rooms.

## Running and firearms

Running now uses acceleration, braking, uphill slowdown, and stamina. The
collectible Patrol SMG and Support LMG support held-trigger automatic fire,
animated reloads, recorded CC0 reports and foley, and wind-driven muzzle smoke.
See [`RUNNING_AND_WEAPONS.md`](RUNNING_AND_WEAPONS.md) for controls, all five gun
profiles, ammunition authority, and release checks.

## Room voice chat

Private rooms support opt-in WebRTC audio through a LiveKit SFU. Join **Room Voice**
in the menu, then explicitly enable the microphone. Desktop supports **V**
push-to-talk and open microphone; mobile voice controls stay inside **MORE**.
Individual mute, deafen, volume, speaking indicators, and privacy-safe reconnects
are included. See [`VOICE_CHAT.md`](VOICE_CHAT.md) for hosting and verification.
The published IslandWorld server is configured for LiveKit Cloud's free Build
plan. Fresh server installations need their own LiveKit credentials;
unconfigured voice never blocks gameplay. No credentials are included in Git
or Firebase assets.

## Firebase Hosting

This project targets the separate Firebase project `islandworld-3ccb4` in the `rawatadarsh2763@gmail.com` account. The Hosting configuration deploys the built `dist/` folder. Sign in to Firebase CLI with that Google account, then run:

```powershell
npm ci
npm test
npm run build
firebase login:use rawatadarsh2763@gmail.com
firebase deploy --only hosting --project islandworld-3ccb4
```

The hosted site is `https://islandworld-3ccb4.web.app/`. Production builds read the public `VITE_ISLAND_SERVER_URL` in `.env.production`; Render allows both Firebase Hosting origins through `ISLAND_ALLOWED_ORIGINS`. Keep the bundled asset source and license notices in `public/` when making future builds.

## Explore

| Action | Desktop control |
| --- | --- |
| Move and look | WASD and mouse |
| Run | Shift |
| Crouch / go prone | C / Z; press again to stand |
| Holster or draw last weapon | H |
| Switch equipment | Tap Q or Tab to advance; hold to open the six-slot wheel |
| Talk, drive, leave a car, or collect a nearby item | E |
| Steer while driving | A / D |
| Open map | M |
| Enter or leave drone view | G |
| Flashlight | F |
| Mute or unmute audio | U |
| Open or close menu | Escape |

Desktop mouse look starts when you select **Explore the Island** or **Resume Exploring**. If the browser blocks mouse capture, hold the left mouse button and drag on the game view to look around; click the game again to retry capture. The island has 250 wildlife targets across 12 bird flocks and safe grazing areas: 120 birds, 52 sheep, and 78 rabbits. Guns and explosives can hit birds in flight as well as ground animals; they fall and fade without gore, then return after 90 seconds. All named residents, prison guards, and detainees can be wounded or killed. A direct hit or a clear near miss alerts them: guards use rifles, while residents and detainees use revolvers within shorter ranges. Cover blocks their attacks. Dead NPCs stop talking and blocking paths and stay dead for the current solo session or room. NPCs can down a solo player, who may respawn after three seconds at a safe island clearing with five seconds of protection. Crouching and going prone lower the camera and movement speed; each stance also has its own room hitbox. Choose **HOLSTER** in the wheel or press H to explore without a visible weapon. The health and armor bars remain visible while on foot; ammo and weapon controls appear when a gun is selected. The gun and hand asset sources are documented in [`CREDITS.md`](CREDITS.md).

The menu offers changing weather, mist, rain, thunderstorm, and dawn, plus separate piano and sea-volume controls. A map shows roads, landmarks, and the current position. Landscape touch controls sit in compact edge clusters: movement stick, SPRINT toggle and POSE on the left, combat and equipment wheel on the right, and a context button only when an action is available. Drag the right side to look. MORE opens map, drone, flashlight, and audio controls; MENU pauses exploration. Sprint requires standing and resets when paused, downed, or switching to driving or drone view. Driving and drone view retain their own pedal and flight controls. The current visual target is desktop; lower-capability devices use a reduced render profile.

Walking off a high cliff triggers a fall and returns the player to safe ground. Cars can be driven on the road network. The drone offers a separate view and flight controls. Weather, wildlife, traffic, and offshore vessels continue to animate during exploration. The playable island has a lighthouse on West Headland, reached by a short path from the road. Two distant cliff islands sit north and southwest across a broad stretch of sea, about 3.3 km apart. All three rotating lighthouse beacons become most visible at night and during storms; looking toward a lens as it sweeps past produces a brief glare. The two offshore landmasses are atmospheric background, outside the playable area. The field map marks a roughly 120 × 96 metre lake in the island's central high ground; its waterline and north-bank viewing corridor stay clear, while fern, shrub, and mossy-stone pockets grow farther up the banks. Walking or driving into the water is blocked.

## Preserved world systems

- High coastal cliffs, textured terrain, reef, a highland lake, ocean swells, breaking surf, shoreline spray, two landing areas, and a West Headland lighthouse.
- Two distant, high-cliff island silhouettes with rock strata, coves, wind-shaped tree groves, small ridge buildings, weather-aware haze, and rotating lighthouse beacons.
- Dense generated grass, including lower wind-scoured cover around the high cliff rim, wind-shaped trees, 250 instanced birds, sheep, and rabbits with nearby distance culling, ambient residents, and road traffic.
- Six CC0 phototextured coastal model sets add grass-tuft variation, ferns, low and tall shrubs, fallen branches, and mossy stones. Terrain-cell instancing and distance culling keep their rendering bounded; larger stones and branches block movement.
- Six CC0 harbor models add life rings, cargo crates, fishing buckets, utility boxes, portable searchlights, and floating channel buoys. Each 1K model loads once nearby; repeated props share geometry and maps, and solid items block walking and driving.
- Procedural clouds, moving storm fronts, spatial lightning, rain, splashes, wet windows, wind, and fire effects.
- Five detailed building models, a detention facility, smaller service structures, roads, a pier, boats, navigation lights, and interior details.
- Collision, indoor rain shelter, cliff fall and recovery, driving, drone view, map, first-person controls, audio ambience, and soft piano music.

Physical landmarks and coordinates live in [`src/worldSites.js`](src/worldSites.js). The environment entry point is [`src/main.js`](src/main.js); [`src/environmentStructures.js`](src/environmentStructures.js) places detailed buildings, lighting, boardwalks, and navigational objects. The original world systems remain in focused modules such as [`src/world.js`](src/world.js), [`src/vegetation.js`](src/vegetation.js), [`src/coastalDetails.js`](src/coastalDetails.js), [`src/harborProps.js`](src/harborProps.js), [`src/roads.js`](src/roads.js), [`src/fauna.js`](src/fauna.js), [`src/islandResidents.js`](src/islandResidents.js), and [`src/audio.js`](src/audio.js). Sparse residents use six CC0 MakeHuman based characters and two separately credited Sketchfab coastal figures; the more distant prison population stays instanced. Residents give brief ambient observations when approached, without starting campaign quests. Their model loading and draw distance are limited for browser performance.

The sea uses a shared wave field in [`src/oceanWaveField.js`](src/oceanWaveField.js) for rendered swells and boat motion. The elevated lake basin, shoreline, and smaller wind ripples are defined separately in [`src/inlandLake.js`](src/inlandLake.js). The distant landmasses, batched cliff/tree detail, shared rotating Fresnel-style lighthouse optics, and view-facing glare live in [`src/distantIslands.js`](src/distantIslands.js), [`src/offshoreIslandDetail.js`](src/offshoreIslandDetail.js), [`src/offshoreLighthouse.js`](src/offshoreLighthouse.js), and [`src/lighthouseGlare.js`](src/lighthouseGlare.js). In development, `?test=offshore_north`, `?test=offshore_southwest`, `?test=west_rim`, `?test=lighthouse`, `?test=light_rain`, and `?test=wildlife` start from useful sightlines; combine them with `?weather=clear&time=noon` or `?weather=storm&time=night`. Use `?test=light_rain&weather=rain&time=noon&rain=0.08` to inspect low-intensity splashes. The development-only `?test=pickup` starts beside armor, health, and ammo supplies with partially depleted stats for end-to-end pickup checks.

## Dynamic weather and daylight

**Weather** and **Time** are independent controls in the in-game menu. Their automatic settings run a repeating sequence of smooth coastal weather fronts and a 20-minute day and night cycle. Choose a fixed weather or time to inspect a scene without stopping the other cycle. For a reproducible browser view, use parameters such as `?weather=storm&time=night` or `?weather=clear&time=noon`.

[`src/dynamicWeather.js`](src/dynamicWeather.js) provides the clock, sun and moon positions, cloud cover, precipitation, wind speed, and wind direction. The same state drives the volumetric sky, moving sun and moon lighting, directional rain and spray, grass and tree sway, sea chop and slower swell energy, lake ripples, wet ground and windows, and the wind and rain audio mix. Cloud movement accumulates wind displacement so a changing direction cannot jump the pattern. Thunder and lightning remain tied to storm fronts; roofs still suppress nearby falling rain. The weather is simulated for this fictional island, not fetched from a live weather service.

The existing WebGL2 cloud renderer uses one locally generated 48³ density texture and at most eight ray steps on desktop; the mobile render profiles lower that cap to six, five, or four. Rain uses one shader-instanced field with a maximum of 16,000 drops and scales the active count with precipitation. The moonlight casts no shadow map, keeping the night scene's additional lighting cost modest.

## Vintage night lamps

Greywake has 68 original cast-iron lanterns along road verges, landing paths,
entrances and lake approaches. Lamps stay off whenever the sun is above the
horizon, including bright dawn/dusk and overcast weather. Warm glass sources
fade on below the horizon after sunset; rain changes the metal and glass
roughness. Nearby lamps illuminate
the actual roads, grass and buildings with soft falloff. Lamp bases block walking
and driving, while road lanes and building entrances stay clear.

The fixtures use four instanced mesh draws and three small generated texture
maps. A fixed pool provides four nearby lights and one 512-pixel shadow map on
desktop, or two lights without additional shadows on mobile. Light pools fade
between nearby fixtures as the player moves; distant lanterns retain their
visible glow. Placement is deterministic, and multiplayer uses the
shared weather and clock without networking individual light or foliage updates.
In development, `?test=night_lamps&weather=storm&time=night` provides a ground-level
lighting check; add `&qaQuality=low` to inspect the mobile lighting budget.

## Assets and licenses

The original project authored its island layout, procedural geometry, effects, and interaction code. Reused materials, character models, recordings, code components, and fonts are credited in [`CREDITS.md`](CREDITS.md). The full notices are in [`public/THIRD_PARTY_LICENSES.md`](public/THIRD_PARTY_LICENSES.md), with exact media origins and checksums in the `SOURCES.md` files under `public/assets/`. The [Sketchfab NPC review](SKETCHFAB_NPC_REVIEW.md) records considered and excluded models. Preserve these notices when distributing a build. No proprietary grass package or Free3D grass model is included.
