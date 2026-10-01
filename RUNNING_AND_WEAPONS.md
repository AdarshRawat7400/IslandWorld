# Running and firearm update

## Aim, wildlife and impact update on 2026-10-02

All **325 automated tests** and the production build passed, including two-identity room tests for matching impact events, explosive damage and prone mine detection.

- Desktop uses mouse button events so holding right-click aim and pressing left-click fire works in either order. The fallback camera drag does not generate a duplicate shot on release.
- Mobile AIM is a persistent toggle. Firing and reloading preserve it; changing weapons, holstering, opening the wheel/menu, or dying clears it. A second finger releasing cannot cancel the FIRE finger.
- Birds use seeded, non-repeating waypoint paths with banking, altitude changes, glides and wingbeats. Client rendering and server hit validation share the same position calculation.
- People flinch, buckle and collapse toward the impact direction. Remote corpses stay grounded at their authoritative death location until respawn/leave. Wildlife has short flinches, side falls and gravity-driven bird tumbles; the first-person death view falls to the ground before safe respawn.
- Six CC0 human pain variants and one CC0 sheep vocal are bundled, with original bird/rabbit calls and missing-file fallbacks. Hit audio is positional for others and centered for self, with a 700 ms per-entity cooldown, distance attenuation and an eight-voice limit.
- Grenades affect a **7 m** blast radius; mines affect **5 m**, with a **2 m** trigger radius. Damage falls with distance; structures/terrain can block it, armor absorbs it first, and spawn protection prevents it. Solo explosions now also hurt their nearby owner. Explore rooms block player damage; PvP permits it. Owners do not trigger their own mines, but can be hurt if another player, NPC or animal triggers one nearby.
- Browser checks confirmed persistent mobile aim, firing/reloading in aim, a 20-round aimed SMG burst, seven decoded pain clips, recorded self pain, NPC retaliation and a grounded corpse, bird hit audio, solo grenade death, and safe respawn with protection.
- Development-only diagnostic controls and the reduced QA render profile are excluded from the production build. Physical multi-finger phone gestures and headset sound balance still need real-device checks.

## Previous running/firearm verification

- All 290 automated tests passed, including two-identity Socket.IO combat, ownership, ammunition, reloads, spawn protection, Explore mode and replay rejection.
- Production build passed; local combat diagnostic controls are excluded from the production bundle.
- Browser checks in the actual island confirmed SMG/LMG held bursts, distinct recorded reports, all 13 decoded audio samples, magazine/box reloads and reserve deductions, pooled muzzle smoke, and sprinting at 7.154 m/s with the SMG while consuming stamina.
- An 844 x 390 touch layout confirmed sprint toggle, firing, reload lockouts and compact controls, with no browser console errors.
- These feature checks used a reduced rendering profile in a development-only diagnostic view; they are not a frame-rate benchmark. Physical phone touch gestures, headset listening and adverse internet latency still need field checks.

IslandWorld keeps its existing solo exploration, private rooms, driving, drone,
weather, touch controls, and cliff recovery. These changes apply to IslandWorld.

## Controls

| Action | Desktop | Landscape touch |
| --- | --- | --- |
| Walk / look | WASD / mouse | Left stick / drag the right side |
| Sprint | Hold Shift while moving forward | Tap SPRINT; tap again to walk |
| Fire | Left click; hold for SMG or LMG | Tap FIRE; hold for SMG or LMG |
| Aim | Hold right mouse button | Tap AIM to toggle on/off |
| Reload | R | RELOAD |
| Switch weapon | 1–3; tap Q/Tab to cycle, or hold for the wheel | WHEEL, then a gun |
| Holster | H, or HOLSTER in the wheel | HOLSTER in the wheel |
| Collect equipment | E near a pickup | PICK UP |
| Crouch / prone | C / Z; repeat to stand | POSE cycles the three stances |

Browsers unlock gun audio after a user gesture. Click **Explore the Island** or
**Resume Exploring** to start. The normal desktop fire control uses mouse
capture; the existing drag-to-look fallback supports individual click shots.

## Running

Movement accelerates and brakes smoothly instead of changing speed instantly.
On level ground, standing walk and forward sprint are capped at 4.6 and 7.3
metres per second before weapon and direction modifiers. Uphill terrain slows
movement; downhill travel does not increase the cap. Reverse and sideways
movement are slower, and diagonal input is normalized.

Sprint uses stamina only while the player actually moves. A wall does not drain
it. Recovery starts after 0.9 seconds without running; exhaustion requires
recovering to 28% before sprint becomes available again. Aiming, firing,
reloading, crouching, and going prone prevent sprint. The stamina display appears
when needed. Switching to a car, drone, map, menu, fall, or inactive tab clears
held movement/fire inputs. Safe respawns refill stamina.

## Firearms

Values are shared by the client and room server in
[`src/multiplayerRules.js`](src/multiplayerRules.js).

| Weapon | Magazine / starting reserve | Fire mode | Minimum shot interval | Reload | Damage / range |
| --- | --- | --- | --- | --- | --- |
| Service Revolver | 6 / 36 | Single shot | 320 ms | 1.8 s | 34 / 65 m |
| Hunting Rifle | 5 / 25 | Single shot | 850 ms | 2.4 s | 60 / 130 m |
| Pump Shotgun | 5 / 25 | Single shot | 900 ms | 2.6 s | 78 / 32 m |
| Patrol SMG | 30 / 150 | Automatic | 100 ms | 2.25 s | 18 / 70 m |
| Support LMG | 60 / 180 | Automatic | 125 ms | 3.6 s | 24 / 110 m |

The SMG and LMG are original textured models. The heavier LMG reduces movement
to 84% of normal while equipped; the SMG uses 98%, and the shotgun uses 96%.
Hip fire has a small spread cone; aiming and prone stance tighten it. The shotgun
retains the existing single hitscan damage model rather than simulating pellets.

Players start with the revolver and rifle. Seeded world loot includes three SMG
and two LMG pickups, alongside the existing shotgun and supplies. The carrying
limit remains **three guns, three grenades, and three mines**. A fourth gun
cannot be collected; respawn or choose a loadout with a free slot to take another.
Defeated room players drop carried equipment except the starter revolver.

Reload presentation follows the actual remaining timer, with supporting-hand,
cylinder/bolt, magazine, and pump movement appropriate to the weapon. Switching
guns hides that animation and cancels its sound; the underlying reload still
finishes. Returning to the gun resumes its remaining presentation.

Gunshots and reload foley use small, local **CC0 recordings**, with two reports
per gun and subtle playback variation. Automatic weapons have lower report gain;
the audio mix limits simultaneous sounds and bounds stacked peaks. Distant shots
are panned and softened, with a short propagation delay. Original generated
reports remain available if recordings cannot load. Provenance and license
records are in [`public/assets/combat-audio/SOURCES.md`](public/assets/combat-audio/SOURCES.md)
and [`CREDITS.md`](CREDITS.md).

Muzzle smoke comes from a bounded reusable pool, starts at the barrel, disperses
with wind, and fades automatically. Muzzle flashes, traces, and hit feedback
remain separate from damage authority. Gun and hand materials retain their
foreground rendering so dense grass cannot cover the viewmodel.

## Private-room authority

The server validates the carried and selected weapon, firing cadence,
ammunition, reload duration, plausible origin/facing, line of sight, and damage.
Switching weapons cannot bypass a shot's recovery time. Explore blocks damage
between players; PvP permits it. Existing armor, spawn protection, wildlife and
NPC combat, death, respawn, and cliff recovery rules remain in effect.

The client predicts magazine debits for responsive automatic fire, with at most
eight shots awaiting confirmation across all guns. Server ammo revisions and
accepted shot IDs reconcile delayed acknowledgements and snapshots. Older
updates cannot undo newer ammo state, rejected shots return their pending debit,
and repeated accepted IDs cannot damage a target twice. Client prediction cannot
assign health or refill server ammunition.

Stamina, spread selection, and movement feel are client systems. The server's
existing stance-specific travel checks still reject implausible movement and
forged eye heights; it does not separately audit stamina or weapon weight.

## Local checks

Start the server and Vite in separate terminals, using the normal setup in
[`README.md`](README.md):

```powershell
npm ci
npm run server
```

```powershell
npm run dev
```

Then check a production build:

```powershell
npm test
npm run build
```

Focused automated coverage includes acceleration/braking, slope and collision
response, stamina and exhaustion, held-trigger cancellation, reload mechanism
restoration, smoke/tracer bounds, recorded audio fallback/cleanup, inventory
capacity, automatic ammo/rate/reload enforcement, Explore/PvP protection, stale
shot replay rejection, and delayed ammo reconciliation.

The development-only `?test=combat&weather=clear&time=noon` view provides three
guns and explicit local firing/running diagnostic buttons. Add `&touch=1` to
inspect the touch HUD in a desktop-sized browser viewport. These diagnostic
controls and the test loadout are excluded from production builds.

Before a release, check sustained firing/reloading on actual Android and iOS
devices, comfortable headphone/speaker levels, and two players on different
networks under real latency. A desktop touch-layout check does not substitute
for those device checks. Keep the browser client and room server on the same
update when publishing the new weapon IDs and ammo protocol.
