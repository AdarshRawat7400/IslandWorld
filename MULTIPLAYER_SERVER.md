# IslandWorld room server

The optional online mode uses a small Socket.IO v4 server. Single-player still runs without it. Rooms exist in server memory: up to 10 players per six-character code. The creator has no special ownership, so the room remains available while other players stay. A room ends immediately when its last member chooses **Leave Room**. An unexpected disconnect reserves that identity's slot for two minutes; if nobody reconnects and no members remain after that grace period, the idle room is removed automatically. The client resumes using a private reconnect token, allowing time for a full island reload on slower devices.

## Run locally

```powershell
npm install
npm run server
```

The server listens on port 3001 by default. Start the Vite client separately with `npm run dev` and open **Private Multiplayer** in the game menu. The server has a read-only health endpoint at `http://127.0.0.1:3001/healthz`.

Set these environment variables before starting the server when needed:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ISLAND_SERVER_HOST` | `0.0.0.0` | Network interface to listen on |
| `ISLAND_SERVER_PORT` | `PORT` when set, otherwise `3001` | TCP port; Render supplies `PORT` automatically |
| `ISLAND_ALLOWED_ORIGINS` | local browser origins only | Comma-separated, exact client origins allowed to connect |

The browser client uses `VITE_ISLAND_SERVER_URL` at build time. For example, set it to `http://127.0.0.1:3001` for a local test. A public HTTPS game requires a public **HTTPS/WSS** server URL and its exact game origin in `ISLAND_ALLOWED_ORIGINS`. Firebase Hosting serves static files and does not run this persistent room process.

## Deploy the room server on Render Free

The repository includes [`render.yaml`](render.yaml) for one **Free** Node web service. In Render, connect the private IslandWorld GitHub repository and create a Blueprint from this file. It runs `npm ci --omit=dev`, starts `npm run server`, and checks `/healthz`. The server binds to `0.0.0.0` and uses Render's `PORT`; the Blueprint allows both Firebase Hosting origins. Do not add a database or change the plan to a paid tier for this setup. A manual Render Web Service can use the same settings if Blueprint access is unavailable.

After Render reports the service live, check `https://<your-service>.onrender.com/healthz`. Then build the Firebase client with `VITE_ISLAND_SERVER_URL` set to the exact Render HTTPS origin (no path or trailing slash) and deploy its `dist/` folder. The environment variable is captured **during the Vite build**, so changing it on Render alone will not update an existing Firebase release. In PowerShell:

```powershell
$env:VITE_ISLAND_SERVER_URL = 'https://<your-service>.onrender.com'
npm run build
firebase deploy --only hosting --project islandworld-3ccb4
```

Render Free may sleep after inactivity; its first connection can take time to wake. Rooms and reconnect tokens are memory-only, so a Render restart or redeploy ends every active room. Keep this service to one instance unless room state is moved to a shared store and Socket.IO routing is configured accordingly. Test two browsers from different networks before calling public multiplayer live.

Room and reconnect tokens are kept in memory. Restarting the process closes all rooms; use a shared state store and sticky routing before running multiple server instances. Room codes are access-by-code rather than account authentication; do not treat them as a place to store secrets.

## Authority and traffic

The server keeps room membership, weather/time overrides, car leases/poses, player, wildlife, and human NPC health, inventory, world and death pickups, ammunition, reload timers, explosives, and respawn timers. Clients send local movement poses, but the server bounds position, speed, the reported standing/crouching/prone eye height against authored terrain, shot origin, aim direction, weapon cadence, range, and stance-specific target hitboxes. Its coarse shot occlusion covers major buildings, the prison perimeter and solid walls while preserving authored gate and door openings, and the main lighthouse masonry. Shots and explosions also sample terrain so cliffs block damage. A client never supplies damage or target health. Terrain, trees, ocean meshes, clouds, rain particles, and other dense visuals are generated locally and are never transferred over the socket. Snapshots are sent at 10 Hz. All 250 wildlife target poses are generated from the same deterministic rules on server and client; snapshots include only injured or dead animal states, while `wildlife:state` announces each hit and revival. This keeps the larger population from adding 250 records to every periodic snapshot.

New players arrive in a small set of verified safe clearings at South Landing so the group can find one another. Both modes permit firearm and explosive damage against wildlife and human NPCs, including birds in flight; Explore does not allow player-versus-player damage. Human NPCs can retaliate against a player in either mode after a direct hit or a clear shot passing very close to them. Every human NPC uses a firearm: guards fire rifles at range, residents use revolvers, and detainees use short-range concealed revolvers. They only attack on-foot, living, unprotected players with clear sight and never injure other NPCs or wildlife. Human NPCs do not respawn within a room; a new room begins with the full population. PvP also permits player combat. Dead wildlife reappears after 90 seconds. A player death allows a more separated safe respawn after 3 seconds, with 5 seconds of spawn protection. Protection ends if the protected player fires. The existing cliff-fall recovery remains a separate local animation; its `player:recover` event does not heal or reset ammunition.

## Loot, inventory, and explosives

New arrivals carry a revolver and rifle. The third gun, the shotgun, can be collected from room pickups. Each player can carry at most three distinct guns, three grenades, and three mines. Press H or select the sixth **HOLSTER** wheel slot to roam unarmed; this is local equipment presentation and does not discard the carried guns. Press H again to draw the last gun, or select a gun through its shortcut or the wheel. Tap Q or Tab to advance to the next available equipment slot; hold either key to choose from the wheel. Gun selection is stored in the inventory, while `combat:fire` accepts any **owned** gun to avoid a selection packet race. C toggles crouch and Z toggles prone; pressing the active stance key again returns to standing. The client sends stance with each movement pose, and the server checks eye height, maximum speed, and player hitboxes for that stance. A respawn begins with a revolver only. Death drops every other carried gun plus all grenades and mines into loot that other players can collect. Loot stacks can be collected partially when the player has fewer open slots than the stack contains.

Each room scatters a seeded set of gun, grenade, mine, medkit, ammo, and armor pickups among validated clearings. A collected world pickup returns after 90 seconds. Death loot expires after three minutes. Both are bounded by the room's pickup limit. Inventory and pickup state survive a reconnect while the room remains in memory.

Medkits, ammo boxes, and armor plates take effect when collected and do not occupy the three-item carry slots. A medkit restores up to 40 health, capped at 100, and can be collected only while alive and below full health. An ammo box adds one magazine to the reserve of each owned gun, capped at that gun's original reserve limit; it cannot refill an unowned gun. A box cannot be collected when every owned reserve is full. An armor plate restores up to 50 armor, capped at 100; full armor leaves the plate on the ground. Supply pickups do not reset firing cadence, an active reload, or spawn protection. The server calculates the result from its own health, armor, and ammunition, so client-supplied values do not alter it. Supply stacks are consumed only as far as useful, leaving any remainder on the ground.

Players start and respawn with zero armor. Armor absorbs damage from eligible gunfire, grenades, mines, and NPC retaliation before health is reduced. An attack reports `damage` as its raw amount, `armorDamage` and `healthDamage` as the actual amounts absorbed or lost, then the remaining `armor` and `health`. Explore prevents player-versus-player damage while allowing an alerted NPC to strike its attacker. Death clears armor.

Grenades land at a validated point up to 24 metres ahead and explode after 2.2 seconds, damaging targets within seven metres. Mines can be placed within three metres on dry island ground; they arm after 0.9 seconds, trigger on nearby eligible players, wildlife, or human NPCs within two metres, and expire after two minutes. Their blast reaches five metres. Damage decreases with distance. Both modes allow explosive damage to wildlife and human NPCs; only PvP allows player-thrown explosive damage to players. Spawn protection, solid structures, terrain cover, and drone mode are respected. Deployment ends the owner's spawn protection. The server derives item consumption, blast hits, damage, and death drops without accepting client damage values. Active explosives are capped at eight per owner and 64 per room.

### Socket event contract

| Event | Client request | Success acknowledgment / room broadcast |
| --- | --- | --- |
| `loot:pickup` | `{id}` | `{ok:true,pickupId,count,inventory,health,armor,ammo}`; room `loot:state` with `{action:'update'\|'remove',pickup,at}` |
| `inventory:select` | `{weapon}` | `{ok:true,inventory}` |
| `inventory:cycle` | `{direction:1\|-1}` | `{ok:true,inventory}` |
| `combat:use` | `{kind:'grenade'\|'mine',target:{x,z}}` | `{ok:true,inventory,explosive}`; room `explosive:state` and `combat:event` |

`room:snapshot` includes every player's `stance`, `inventory:{guns,grenades,mines,selectedGun}`, `health`, `armor`, and `ammo`, plus top-level `pickups` and `explosives` arrays. Its top-level `wildlife` array contains only injured or dead animal states, sufficient to rebuild them on reconnect; healthy animal poses are generated locally. A pickup contains `{id,kind,itemId,x,y,z,count,source}`, where source is `world` or `player`. An explosive contains `{id,kind,ownerId,x,y,z,createdAt,radius}` with `detonatesAt` for a grenade or `armedAt` and `expiresAt` for a mine. `loot:state` and `explosive:state` announce `{action:'spawn'\|'update'\|'remove',pickup|explosive,at}` as applicable. `combat:event` sends `throw` or `place` with `id,itemKind,playerId,origin,position,radius,at` (and `detonatesAt` for a grenade), then `explosion` with `id,itemKind,ownerId,origin,position,radius,hits,at`. Player entries in `hits`, and the existing `hit` events for both shots and blasts, include `damage,armorDamage,healthDamage,armor,health,dead`; a `death` event includes `health:0,armor:0`. The acknowledgment's final explosive position is authoritative; client supplied `y`, damage, or targets are ignored.

`room:snapshot` also includes `npcs:[{id,name,kind,x,y,z,heading,health,maxHealth,dead,alerted,targetId}]`, where Y is terrain height. Direct hits, clear near-miss alerts, and death emit `npc:state` with the changed public NPC state. `combat:event` emits `npc_hit` with `npcId,shooterId,weapon,damage,health,dead,position,at` and `npc_death` with `npcId,killerId,weapon,position,at`. Retaliation emits `npc_attack` with `npcId,targetId,attackKind,weapon,origin,target,damage,armorDamage,healthDamage,armor,health,dead,at`, where `attackKind` is `guard_shot`, `resident_shot`, or `detainee_shot`. The server decides targets, visibility, damage, and cooldowns; clients cannot assign NPC damage or health.

Rejected requests have `{ok:false,error,message}`. Common errors include `gun_not_owned`, `pickup_unavailable`, `pickup_out_of_reach`, `inventory_full`, `health_full`, `armor_full`, `ammo_full`, `invalid_target`, `invalid_facing`, `blocked_throw`, `unsafe_ground`, `item_unavailable`, `use_rate_limited`, and `explosive_limit`. Room snapshots let a reconnect rebuild inventory, health, armor, ammunition, nearby loot, active grenades or mines, and NPC health and alert state.

The exact Socket.IO event contract and error codes are defined in [`server/index.js`](server/index.js) and covered by [`tests/serverRooms.test.js`](tests/serverRooms.test.js), [`tests/serverCombat.test.js`](tests/serverCombat.test.js), [`tests/serverWildlife.test.js`](tests/serverWildlife.test.js), [`tests/serverExplosives.test.js`](tests/serverExplosives.test.js), [`tests/serverNpcCombat.test.js`](tests/serverNpcCombat.test.js), and the two-client socket flow in [`tests/serverIntegration.test.js`](tests/serverIntegration.test.js). `wildlife:state` announces each animal hit and revival.
