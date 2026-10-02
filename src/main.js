import * as THREE from 'three';
import { createWorld } from './world.js';
import { createDynamicWeather } from './dynamicWeather.js';
import { INLAND_LAKE } from './inlandLake.js';
import { SITES } from './worldSites.js';
import { createEnvironmentStructures } from './environmentStructures.js';
import { detectRenderEnvironment, selectRenderProfile } from './renderQuality.js';
import { createRoads, isRoad, ROAD_ROUTES } from './roads.js';
import { createSetDressing } from './setDressing.js';
import { createAncillaryBuildings } from './buildingDetails.js';
import { createDriving } from './driving.js';
import { createAmbientTraffic } from './ambientTraffic.js';
import { createPrisonPopulation } from './prisonPopulation.js';
import { createIslandResidents } from './islandResidents.js';
import { createHarborProps } from './harborProps.js';
import { createIslandLamps } from './islandLamps.js';
import { createPumpInterior } from './pumpInterior.js';
import { createFauna, WILDLIFE_KINDS } from './fauna.js';
import { createLootWorld } from './lootWorld.js';
import { createInventory, createWorldPickupSpawns, collectItem, consumeItem,
  canCollectItem, canApplySupply, applySupply, ITEM_DEFINITIONS, GUN_IDS } from './combatLoot.js';
import { createScenicBoats } from './scenicBoats.js';
import { createSeaLife } from './seaLife.js';
import { createFireAtmosphere } from './fireAtmosphere.js';
import { createWindSpray } from './windSpray.js';
import { createRainEffects } from './rainEffects.js';
import { addWetWindows } from './wetWindows.js';
import { createAudio } from './audio.js';
import { createMusic, DEFAULT_MUSIC_VOLUME } from './music.js';
import { createDroneView } from './droneView.js';
import { createCinematicCapture } from './cinematicCapture.js';
import { createShowcaseRecording } from './showcaseRecording.js';
import { createTouchControls } from './touchControls.js';
import { orientFirstPersonCamera } from './firstPersonCamera.js';
import { createLighthouseGlare } from './lighthouseGlare.js';
import { useTouchControls } from './inputMode.js';
import { isNativeAndroid, createNativeLifecycleController,
  bindNativeAppLifecycle } from './nativeAppLifecycle.js';
import { createVoiceChat } from './voiceChat.js';
import { createVoiceChatUI } from './voiceChatUi.js';
import './voiceChatUi.css';
import {
  PLAYER_RADIUS, archiveFurnitureBlocks, archiveFurnitureBlocksMoveFrom,
  buildingWallBlocks, circlesBlock, radioFurnitureBlocks,
  radioFurnitureBlocksMoveFrom, roofRectangles, southPierRailBlocks,
} from './collision.js';
import {
  CLIFF_FALL, advanceCliffFall, beginCliffFall, classifyCoastalStep,
  cliffFallPresentation, createCliffFallState, rememberSafeGround,
} from './cliffFall.js';
import { createFallPresentation } from './fallPresentation.js';
import { createMultiplayerClient } from './multiplayerClient.js';
import { createMultiplayerRoomUI } from './multiplayerRoomUi.js';
import { createRemotePlayers } from './remotePlayers.js';
import { createCombatPresentation } from './combatPresentation.js';
import { createCombatMouseInput } from './combatInput.js';
import { createHitAudio } from './hitAudio.js';
import { applyHealthDamage, blastDamageForTarget, playerDownedPose } from './combatDamage.js';
import { playerStance, togglePlayerStance } from './playerStance.js';
import { createPlayerLocomotion } from './playerLocomotion.js';
import { createAmmoPrediction } from './ammoPrediction.js';
import { WEAPONS, EXPLOSIVES, SAFE_SPAWNS, RESPAWN_DELAY_MS,
  SPAWN_PROTECTION_MS, blastDamageAt, rayWildlifeHit } from './multiplayerRules.js';
import { createNpcCombatant, rayNpcHit, npcThreatenedByShot,
  alertNpc, applyNpcDamage, npcAttackDecision } from './npcCombatRules.js';
import { shotBlockedByStructures, shotBlockedByTerrain } from '../server/lineOfSight.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const captureRequest = new URLSearchParams(location.search).get('capture');
const captureEnabled = ['1', 'orbit', 'showcase'].includes(captureRequest);
if (captureEnabled) document.body.classList.add('cinematic-capture');
const siteById = Object.fromEntries(SITES.map((site) => [site.id, site]));
const keys = new Set();
const nativeAndroid = isNativeAndroid();
document.body.classList.toggle('native-android', nativeAndroid);
const settingsKey = 'island-world-settings-v1';
let settings = {};
try { settings = JSON.parse(localStorage.getItem(settingsKey) || '{}') || {}; } catch { /* storage may be disabled */ }

let assetsReady = false;
let firstFrameRendered = false;
THREE.DefaultLoadingManager.onStart = () => {
  assetsReady = false;
};
THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  $('loading-detail').textContent = `Loading island assets · ${loaded} of ${total}`;
  $('loading-progress').value = loaded;
  $('loading-progress').max = Math.max(loaded, total);
};
THREE.DefaultLoadingManager.onLoad = () => {
  assetsReady = true;
  hideLoadingIfReady();
};
THREE.DefaultLoadingManager.onError = (url) => {
  console.warn(`Could not load island asset: ${url}`);
};
function hideLoadingIfReady() {
  if (assetsReady && firstFrameRendered) $('loading').hidden = true;
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 3200);
const hitAudio = createHitAudio({ camera });
camera.rotation.order = 'YXZ';
scene.add(camera);
const cinematicCapture = captureEnabled ? createCinematicCapture(camera) : null;
const ordinaryRenderProfile = selectRenderProfile({ ...detectRenderEnvironment(), nativeAndroid });
const combatDiagnosticProfile = import.meta.env.DEV
  && ['combat', 'night_lamps'].includes(new URLSearchParams(location.search).get('test'))
  && new URLSearchParams(location.search).get('qaQuality') === 'low';
const captureQuality = new URLSearchParams(location.search).get('captureQuality');
const renderProfile = combatDiagnosticProfile
  ? selectRenderProfile({ mobile: true, deviceMemory: 2, hardwareConcurrency: 4 })
  : captureEnabled && captureQuality === 'balanced'
  ? { ...ordinaryRenderProfile, grassQuality: 28_000,
    grassDensityMultiplier: 6, shadowMapSize: 1024, cloudStepCap: 5 }
  : captureEnabled && captureQuality === 'performance'
    ? { ...ordinaryRenderProfile, tier: 'mobile-standard', grassQuality: 18_000,
      grassDensityMultiplier: 4, shadowMapSize: 512, cloudStepCap: 4 }
    : ordinaryRenderProfile;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, renderProfile.pixelRatioCap));
renderer.setSize(innerWidth, innerHeight);
if (captureEnabled) {
  // Keep delivery captures at true 1080p even if the browser window is smaller.
  // Smaller back buffers are available only as local performance diagnostics.
  const captureParams = new URLSearchParams(location.search);
  const diagnosticWidth = Number(captureParams.get('captureWidth'));
  const diagnosticHeight = Number(captureParams.get('captureHeight'));
  const captureWidth = import.meta.env.DEV && diagnosticWidth >= 640 && diagnosticWidth <= 1920
    ? Math.round(diagnosticWidth) : 1920;
  const captureHeight = import.meta.env.DEV && diagnosticHeight >= 360 && diagnosticHeight <= 1080
    ? Math.round(diagnosticHeight) : 1080;
  renderer.setPixelRatio(1);
  renderer.setSize(captureWidth, captureHeight, false);
  camera.aspect = captureWidth / captureHeight;
  camera.updateProjectionMatrix();
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);

const world = createWorld(scene, camera, { renderProfile });
const lighthouseGlare = createLighthouseGlare($('lighthouse-glare'), world.terrainHeight);
const structures = createEnvironmentStructures(scene, world);
let islandLamps = null;
const roads = createRoads(scene, world.terrainHeight);
const dressing = createSetDressing(scene, world.terrainHeight);
const ancillary = createAncillaryBuildings(scene, world.terrainHeight, SITES);
const pumpInterior = createPumpInterior(scene, world.terrainHeight, siteById.pump);
const harborProps = createHarborProps(scene, {
  groundHeight: structures.playerGroundHeight,
  pierHeight: structures.playerGroundHeight,
  northJettyHeight: world.terrainHeight(-65, -315) + 0.23,
  waterHeight: world.waterHeight,
  isGroundSafe: (x, z, radius) => world.isWalkable(x, z)
    && !world.isLake(x, z, radius + 0.5)
    && !isRoad(x, z, radius + 0.9)
    && !circlesBlock(x, z, radius, world.natureObstacles)
    && !SITES.some((site) => buildingWallBlocks(site, x, z, radius))
    && !dressing.collides(x, z, radius)
    && !ancillary.blocksMove(x, z, radius),
});
const driving = createDriving(dressing.vehicles, world.terrainHeight, { onRoad: isRoad });
const prisonPopulation = createPrisonPopulation(scene, world.terrainHeight);
const drone = createDroneView({ terrainHeight: world.terrainHeight, waterHeight: world.waterHeight });
const scenicBoats = createScenicBoats(scene, world.waterHeight);
const seaLife = createSeaLife(scene, { waterHeight: world.waterHeight });
const fireAtmosphere = createFireAtmosphere(scene, world.terrainHeight, {
  quality: renderProfile.tier === 'desktop' ? 'desktop' : 'mobile',
});
const windSpray = createWindSpray(scene, camera, world.coastalRadius,
  { quality: renderProfile.tier });
const shelterRects = [
  ...roofRectangles(SITES),
  ...ancillary.shelters,
  ...dressing.shelters.map((roof) => ({
    x: roof.x, z: roof.z, halfWidth: roof.width / 2, halfDepth: roof.depth / 2,
  })),
];
world.setShelters(shelterRects);
const isRoofed = (x, z) => shelterRects.some((roof) =>
  Math.abs(x - roof.x) < roof.halfWidth && Math.abs(z - roof.z) < roof.halfDepth);
const wetWindows = addWetWindows(scene, SITES, world.terrainHeight);
const rainEffects = createRainEffects(scene, camera, world.terrainHeight,
  world.waterHeight, isRoofed, world.lakeWaterHeight,
  { isRoadAt: isRoad, renderedTerrainHeight: world.renderedTerrainHeight });
const fauna = createFauna(scene, world.terrainHeight, {
  coastalRadius: world.coastalRadius, isRoad, isLake: world.isLake,
  isBlocked: (x, z, radius) => world.isLake(x, z, radius + 2)
    || circlesBlock(x, z, radius, world.natureObstacles)
    || dressing.collides(x, z, radius) || ancillary.blocksMove(x, z, radius)
    || harborProps.collides(x, z, radius) || islandLamps?.collides(x, z, radius),
});
const sound = createAudio();
const music = createMusic();
let ambientTraffic = null;
let residents = null;

const player = { x: 0, z: 270, yaw: 0, pitch: -0.05, walkPhase: 0,
  stance: 'stand' };
let cameraEyeHeight = playerStance('stand').eyeHeight;
const locomotion = createPlayerLocomotion();
// Development-only viewpoints for water and shoreline-detail rendering QA.
const waterQaView = import.meta.env.DEV ? new URLSearchParams(location.search).get('test') : null;
if (waterQaView === 'lake') {
  Object.assign(player, { x: INLAND_LAKE.x, z: INLAND_LAKE.z + INLAND_LAKE.radiusZ + 17,
    yaw: 0, pitch: -0.08 });
} else if (waterQaView === 'combat') {
  Object.assign(player, { x: -141, z: -75, yaw: -Math.PI / 2, pitch: -0.05 });
} else if (waterQaView === 'night_lamps') {
  Object.assign(player, { x: -105, z: 181, yaw: 0, pitch: -0.025 });
} else if (waterQaView === 'flora') {
  Object.assign(player, { x: -141, z: -75, yaw: -Math.PI / 2, pitch: -0.08 });
} else if (waterQaView === 'ocean') {
  Object.assign(player, { x: -300, z: -120, yaw: Math.PI / 2, pitch: -0.12 });
} else if (waterQaView === 'west_rim') {
  Object.assign(player, { x: -318, z: -120, yaw: Math.PI / 2, pitch: -0.11 });
} else if (waterQaView === 'lighthouse') {
  Object.assign(player, { x: -225, z: -120, yaw: 1.15, pitch: 0.20 });
} else if (waterQaView === 'light_rain') {
  Object.assign(player, { x: -225, z: -120, yaw: 1.15, pitch: -0.65 });
} else if (waterQaView === 'south_fisher') {
  Object.assign(player, { x: 8, z: 330, yaw: Math.PI, pitch: -0.06 });
} else if (waterQaView === 'north_fisher') {
  Object.assign(player, { x: -79, z: -299, yaw: 0, pitch: -0.06 });
} else if (waterQaView === 'harbor') {
  Object.assign(player, { x: 1.2, z: 348, yaw: Math.PI * 0.66, pitch: -0.12 });
} else if (waterQaView === 'service_props') {
  Object.assign(player, { x: -63, z: 190, yaw: 0.88, pitch: -0.1 });
} else if (waterQaView === 'pump_worker') {
  Object.assign(player, { x: 124, z: 152, yaw: 0, pitch: -0.06 });
} else if (waterQaView === 'west_searchlight') {
  Object.assign(player, { x: -191, z: -108.5, yaw: -0.51, pitch: -0.07 });
} else if (waterQaView === 'wildlife') {
  Object.assign(player, { x: -214, z: 122, yaw: 0, pitch: -0.04 });
} else if (waterQaView === 'offshore_north') {
  Object.assign(player, { x: -65, z: -315, yaw: -0.28, pitch: -0.03 });
} else if (waterQaView === 'offshore_southwest') {
  Object.assign(player, { x: -305, z: 135, yaw: 2.24, pitch: -0.06 });
}
let started = false;
let menuOpen = true;
let mapOpen = false;
let muted = false;
let nativeLifecycle = null;
let nativeAudioPaused = false;
let nativeVoiceWasDeafened = false;
let graphicsLost = false;
let flashlightOn = false;
let elapsed = 0;
let ambientElapsed = 0;
let footstepDistance = 0;
let respawnFadeTime = -1;
let fallExpectedSeconds = 1.8;
let pointerLockFallback = false;
let toastUntil = 0;
let lastPlaceId = '';
const cliffWorld = {
  isWalkable: world.isWalkable, terrainHeight: world.terrainHeight,
  coastalRadius: world.coastalRadius, waterHeight: world.waterHeight,
  isPier: structures.onSouthPier,
};
let cliffFall = rememberSafeGround(createCliffFallState({ x: 0, z: 270 }),
  { x: player.x, z: player.z }, cliffWorld, canStandAt);
const fallPresentation = createFallPresentation({ camera });

const flashlight = new THREE.SpotLight(0xcde6de, 11, 30, Math.PI / 9, 0.65, 1.4);
flashlight.position.set(0.12, -0.13, -0.05);
flashlight.target.position.set(0, -0.03, -7);
flashlight.visible = false;
camera.add(flashlight, flashlight.target);

function canStandAt(x, z, checkPeople = true, fromX = null, fromZ = null) {
  if (world.isLake(x, z, PLAYER_RADIUS)) return false;
  if (southPierRailBlocks(x, z, PLAYER_RADIUS)) return false;
  if (SITES.some((site) => buildingWallBlocks(site, x, z, PLAYER_RADIUS))) return false;
  if (circlesBlock(x, z, PLAYER_RADIUS, world.natureObstacles)) return false;
  if (dressing.collides(x, z, PLAYER_RADIUS)) return false;
  if (harborProps.collides(x, z, PLAYER_RADIUS)) return false;
  if (islandLamps?.collides(x, z, PLAYER_RADIUS)) return false;
  if (ancillary.blocksMove(x, z, PLAYER_RADIUS)) return false;
  if (pumpInterior.blocksMove(x, z, PLAYER_RADIUS)) return false;
  if (radioFurnitureBlocks(siteById.radio, x, z, PLAYER_RADIUS)
    && (fromX === null || radioFurnitureBlocksMoveFrom(siteById.radio,
      fromX, fromZ, x, z, PLAYER_RADIUS))) return false;
  if (archiveFurnitureBlocks(siteById.archive, x, z, PLAYER_RADIUS)
    && (fromX === null || archiveFurnitureBlocksMoveFrom(siteById.archive,
      fromX, fromZ, x, z, PLAYER_RADIUS))) return false;
  if (ambientTraffic?.collides(x, z, PLAYER_RADIUS)) return false;
  if (checkPeople && prisonPopulation.collides(x, z, PLAYER_RADIUS)) return false;
  if (checkPeople && residents?.collides(x, z, PLAYER_RADIUS)) return false;
  return true;
}

function canPlaceVehicle(x, z, vehicle, radius = 0.42, ignoreAmbient = false) {
  if (world.isLake(x, z, radius)) return false;
  if (!world.isWalkable(x, z)) return false;
  if (SITES.some((site) => buildingWallBlocks(site, x, z, radius))) return false;
  if (circlesBlock(x, z, radius, world.natureObstacles)) return false;
  if (ancillary.blocksMove(x, z, radius) || pumpInterior.blocksMove(x, z, radius)) return false;
  if (dressing.collides(x, z, radius, vehicle?.id)) return false;
  if (harborProps.collides(x, z, radius)) return false;
  if (islandLamps?.collides(x, z, radius)) return false;
  if (!ignoreAmbient && ambientTraffic?.collides(x, z, radius)) return false;
  if (prisonPopulation.collides(x, z, radius)) return false;
  if (residents?.collides(x, z, radius)) return false;
  return true;
}
ambientTraffic = createAmbientTraffic(scene, world.terrainHeight, {
  parkedVehicles: dressing.vehicles,
  canPlace: (x, z, vehicle, radius) => canPlaceVehicle(x, z, vehicle, radius, true),
});
residents = createIslandResidents(scene, structures.playerGroundHeight, {
  isSafe: (x, z, definition) => {
    const radius = Math.max(0.6, definition.bodyRadius || 0);
    return world.isWalkable(x, z) && !world.isLake(x, z, radius)
      && canStandAt(x, z, false)
      && !circlesBlock(x, z, radius, world.natureObstacles)
      && !dressing.collides(x, z, radius)
      && !harborProps.collides(x, z, radius)
      && !ancillary.blocksMove(x, z, radius)
      && !pumpInterior.blocksMove(x, z, radius)
      && !prisonPopulation.collides(x, z, radius);
  },
  isRoad,
});
islandLamps = createIslandLamps(scene, {
  terrainHeight: world.terrainHeight, groundHeight: structures.playerGroundHeight,
  isWalkable: (x, z) => world.isWalkable(x, z) || structures.onSouthPier(x, z),
  isLake: world.isLake, profile: renderProfile,
  canPlace: (x, z, radius = 0.28) => !world.isLake(x, z, radius + 1.1)
    && !circlesBlock(x, z, radius + 0.5, world.natureObstacles)
    && !SITES.some(site => site.kind === 'building'
      && Math.abs(x - site.x) < site.scale[0] * 0.52 + radius
      && Math.abs(z - site.z) < site.scale[1] * 0.52 + radius)
    && !dressing.collides(x, z, radius + 0.4)
    && !harborProps.collides(x, z, radius + 0.4)
    && !ancillary.blocksMove(x, z, radius + 0.4)
    && !pumpInterior.blocksMove(x, z, radius + 0.4)
    && !prisonPopulation.collides(x, z, radius + 0.6)
    && !residents.collides(x, z, radius + 0.6),
});

function tryPlayerStep(x, z) {
  // The coast allows some ledges beyond walkable ground. An inland lake is
  // always a blocked step, never a cliff fall into the distant sea.
  if (world.isLake(x, z, PLAYER_RADIUS)) return false;
  const from = { x: player.x, z: player.z };
  const coast = classifyCoastalStep(from, { x, z }, cliffWorld);
  if (coast.kind === 'fall' && canStandAt(x, z, false)) {
    cliffFall = beginCliffFall(cliffFall, from, { x, z },
      structures.playerGroundHeight(from.x, from.z), cliffWorld);
    if (cliffFall.phase === 'falling') {
      const height = cliffFall.eyeY - world.waterHeight(x, z) - CLIFF_FALL.eyeHeight;
      fallExpectedSeconds = Math.sqrt(2 * Math.max(1, height) / CLIFF_FALL.gravity);
      keys.clear();
      touchControls.reset();
      sound.playFallStart();
      showToast('FALLING FROM THE CLIFF');
    }
    return false;
  }
  if (coast.kind !== 'ground' && coast.kind !== 'ledge') return false;
  if (!canStandAt(x, z, true, from.x, from.z)) return false;
  if (ambientTraffic.blocksMove(from.x, from.z, x, z, PLAYER_RADIUS)) return false;
  if (pumpInterior.blocksMoveFrom(from.x, from.z, x, z, PLAYER_RADIUS)) return false;
  if (prisonPopulation.blocksMove(from.x, from.z, x, z, PLAYER_RADIUS)) return false;
  player.x = x;
  player.z = z;
  return true;
}

function showToast(message, milliseconds = 2600) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastUntil = performance.now() + milliseconds;
}

function nearestSite(x, z) {
  let best = null;
  let distance = Infinity;
  for (const site of SITES) {
    const candidate = Math.hypot(x - site.x, z - site.z);
    if (candidate < distance) { best = site; distance = candidate; }
  }
  return { site: best, distance };
}

const weatherSelect = $('weather-select');
const timeSelect = $('time-select');
const rawQueryWeather = new URLSearchParams(location.search).get('weather');
const queryWeather = rawQueryWeather === 'dawn' ? 'clear' : rawQueryWeather;
const queryTime = new URLSearchParams(location.search).get('time');
const rawDebugRain = import.meta.env.DEV ? new URLSearchParams(location.search).get('rain') : null;
const debugRain = rawDebugRain !== null && Number.isFinite(Number(rawDebugRain))
  ? clamp(Number(rawDebugRain), 0, 1) : null;
const savedWeather = settings.weather === 'dawn' ? 'clear' : settings.weather;
weatherSelect.value = ['auto', 'clear', 'mist', 'rain', 'storm'].includes(queryWeather)
  ? queryWeather : ['auto', 'clear', 'mist', 'rain', 'storm'].includes(savedWeather)
    ? savedWeather : 'auto';
timeSelect.value = ['auto', 'dawn', 'noon', 'dusk', 'night'].includes(queryTime)
  ? queryTime : ['auto', 'dawn', 'noon', 'dusk', 'night'].includes(settings.time)
    ? settings.time : 'auto';
const musicSlider = $('music-volume');
const seaSlider = $('sea-volume');
musicSlider.value = Number.isFinite(Number(settings.music)) ? clamp(Number(settings.music), 0, 100)
  : DEFAULT_MUSIC_VOLUME * 100;
seaSlider.value = Number.isFinite(Number(settings.sea)) ? clamp(Number(settings.sea), 0, 100) : 100;
function storeSettings() {
  try { localStorage.setItem(settingsKey, JSON.stringify({
    weather: weatherSelect.value, time: timeSelect.value,
    music: Number(musicSlider.value), sea: Number(seaSlider.value),
  })); } catch { /* storage may be disabled */ }
}
function syncSettings() {
  $('music-value').textContent = `${musicSlider.value}%`;
  $('sea-value').textContent = `${seaSlider.value}%`;
  music.setVolume(Number(musicSlider.value) / 100);
  sound.setSeaVolume(Number(seaSlider.value) / 100);
  storeSettings();
}
musicSlider.addEventListener('input', syncSettings);
seaSlider.addEventListener('input', syncSettings);
weatherSelect.addEventListener('change', () => {
  if (multiplayer.getState().room) {
    void multiplayer.request('world:set', { weather: weatherSelect.value, time: timeSelect.value })
      .catch((error) => showToast(error.message));
  } else storeSettings();
  showToast(weatherSelect.value === 'auto' ? 'CHANGING WEATHER' : weatherSelect.selectedOptions[0].textContent.toUpperCase());
});
const lootWorld = createLootWorld(scene, world.terrainHeight);
timeSelect.addEventListener('change', () => {
  if (multiplayer.getState().room) {
    void multiplayer.request('world:set', { weather: weatherSelect.value, time: timeSelect.value })
      .catch((error) => showToast(error.message));
  } else storeSettings();
  showToast(timeSelect.value === 'auto' ? 'DAY AND NIGHT CYCLE'
    : timeSelect.selectedOptions[0].textContent.toUpperCase());
});
syncSettings();

const weatherClock = createDynamicWeather();
let climate = weatherClock.sample(0);
let climateSampleTime = -Infinity;
function currentWeather() {
  return climate.mode;
}

function requestLook() {
  // Interactive diagnostics use ordinary DOM controls without mouse capture.
  if (waterQaView === 'combat') { pointerLockFallback = true; return; }
  if (captureEnabled || !started || menuOpen || mapOpen || touchEnabled) return;
  // Browsers may reject the request if the tab loses focus during navigation.
  // Clicking the canvas again remains a valid retry after that transient case.
  const capture = renderer.domElement.requestPointerLock;
  if (!capture) {
    pointerLockFallback = true;
    showToast('HOLD LEFT CLICK AND DRAG TO LOOK');
    return;
  }
  try {
    const request = capture.call(renderer.domElement);
    request?.catch?.(() => {
      pointerLockFallback = true;
      showToast('MOUSE CAPTURE BLOCKED · DRAG TO LOOK OR CLICK GAME TO RETRY');
    });
  } catch {
    pointerLockFallback = true;
    showToast('MOUSE CAPTURE BLOCKED · DRAG TO LOOK OR CLICK GAME TO RETRY');
  }
}
function openMenu() {
  if (!started) return;
  releaseCombatInput();
  combat.closeEquipmentWheel({ commit: false });
  menuOpen = true;
  keys.clear();
  document.exitPointerLock?.();
  $('screen').hidden = false;
  $('start-button').innerHTML = 'RESUME EXPLORING <span>→</span>';
  touchControls.setVisible(false);
}
function closeMenu() {
  if (graphicsLost || (nativeLifecycle && !nativeLifecycle.resumeFromGesture())) return;
  combat.unlockAudio();
  void hitAudio.unlock();
  if (!started) {
    started = true;
    sound.start();
    void music.start();
    $('hud').hidden = false;
  }
  menuOpen = false;
  $('screen').hidden = true;
  refreshTouchUi();
  requestLook();
}
$('start-button').addEventListener('click', closeMenu);
$('menu-button').addEventListener('click', openMenu);

function mapSvg() {
  const mapX = (x) => ((x + 400) / 800 * 500).toFixed(1);
  const mapY = (z) => ((z + 400) / 800 * 500).toFixed(1);
  const lakeSvg = `<g><ellipse cx="${mapX(INLAND_LAKE.x)}" cy="${mapY(INLAND_LAKE.z)}"
    rx="${(INLAND_LAKE.radiusX / 800 * 500).toFixed(1)}"
    ry="${(INLAND_LAKE.radiusZ / 800 * 500).toFixed(1)}"
    fill="#4b7480" stroke="#a8c8cb" stroke-width="1.5"/>
    <text x="${mapX(INLAND_LAKE.x)}" y="${mapY(INLAND_LAKE.z)}"
      text-anchor="middle" fill="#e5f1eb" font-size="8">INLAND LAKE</text></g>`;
  const roadsSvg = ROAD_ROUTES.map((route) => `<polyline points="${route.points.map(([x,z]) =>
    `${mapX(x)},${mapY(z)}`).join(' ')}" fill="none" stroke="#b9a17d" stroke-width="2" opacity=".75"/>`).join('');
  const sitesSvg = SITES.filter((site) => !['headland_stake', 'tunnel'].includes(site.id))
    .map((site) => `<g><circle cx="${mapX(site.x)}" cy="${mapY(site.z)}" r="4" fill="#e7d7ac"/><text x="${Number(mapX(site.x))+7}" y="${Number(mapY(site.z))+3}" fill="#e9ece0" font-size="8">${site.name}</text></g>`).join('');
  return `<svg viewBox="0 0 500 500" role="img" aria-label="Island roads, lake, landmarks, and your position"><path d="M75 70 Q235 15 379 74 Q488 173 427 375 Q341 489 153 450 Q24 394 41 233 Q39 116 75 70Z" fill="#46614d" stroke="#b4c2aa" stroke-width="3"/>${lakeSvg}${roadsSvg}${sitesSvg}<circle cx="${mapX(player.x)}" cy="${mapY(player.z)}" r="6" fill="#fff4c5" stroke="#102128" stroke-width="2"/></svg>`;
}
function openMap() {
  if (!started || menuOpen) return;
  releaseCombatInput();
  combat.closeEquipmentWheel({ commit: false });
  mapOpen = true;
  keys.clear();
  document.exitPointerLock?.();
  $('map-content').innerHTML = mapSvg();
  $('map-panel').hidden = false;
  touchControls.setVisible(false);
}
function closeMap() {
  mapOpen = false;
  $('map-panel').hidden = true;
  refreshTouchUi();
  requestLook();
}
$('map-close').addEventListener('click', closeMap);

function toggleDrone() {
  if (!started || menuOpen || mapOpen || driving.active || cliffFall.phase !== 'grounded'
    || multiplayer.getState().self?.dead
    || (!multiplayer.getState().room && soloHealth <= 0)) return;
  combat.closeEquipmentWheel({ commit: false });
  releaseCombatInput();
  if (drone.active) { drone.exit(); showToast('ON FOOT'); }
  else {
    setPlayerStance('stand', { quiet: true });
    if (drone.enter({ x: player.x, z: player.z,
      y: structures.playerGroundHeight(player.x, player.z) + CLIFF_FALL.eyeHeight,
      yaw: player.yaw, pitch: player.pitch })) showToast('DRONE VIEW');
  }
  keys.clear();
  touchControls.reset();
  refreshTouchUi();
}
function toggleAudio() {
  muted = !muted;
  applyGameAudioMute();
  showToast(muted ? 'AUDIO OFF' : 'AUDIO ON');
}
function nearbyInteraction() {
  if (drone.active) return null;
  const vehicle = driving.nearbyVehicle(player.x, player.z, 4.4);
  const pickup = lootWorld.nearby(player.x, player.z, 2.7);
  const islander = residents.nearestPerson(player.x, player.z);
  const prison = prisonPopulation.nearestPerson(player.x, player.z);
  const closest = [pickup && { kind: 'loot', item: pickup.item, distance: pickup.distance },
    islander && { kind: 'resident', person: islander, distance: islander.distance },
    prison && { kind: 'prison', person: prison, distance: prison.distance }]
    .filter(Boolean).sort((a, b) => a.distance - b.distance)[0];
  // A closer vehicle keeps its established E action when someone stands by it.
  if (vehicle && (!closest || vehicle.distance <= closest.distance + 0.35)) {
    return { kind: 'vehicle', vehicle: vehicle.vehicle, distance: vehicle.distance };
  }
  return closest || null;
}

const pickupPending = new Set();
function pickupLoot(item) {
  if (!item || pickupPending.has(item.id)) return;
  const supply = ['medkit', 'ammo', 'armor'].includes(item.kind);
  const inRoom = Boolean(multiplayer.getState().room);
  if (!supply && !canCollectItem(currentInventory, item.itemId)) {
    showToast('INVENTORY FULL OR ALREADY OWNED', 1900);
    return;
  }
  if (supply && !inRoom && !canApplySupply({ inventory: soloInventory,
    health: soloHealth, armor: soloArmor, ammo: soloAmmo }, item.itemId)) {
    showToast(item.kind === 'medkit' ? 'HEALTH ALREADY FULL'
      : item.kind === 'armor' ? 'ARMOR ALREADY FULL' : 'AMMO RESERVES FULL', 1900);
    return;
  }
  if (inRoom) {
    const epoch = combatEpoch;
    pickupPending.add(item.id);
    void multiplayer.request('loot:pickup', { id: item.id })
      .then((result) => {
        if (epoch !== combatEpoch) return;
        currentInventory = createInventory(result.inventory);
        ammoPrediction.ingest(result.ammo);
        localAmmo = ammoPrediction.snapshot();
        lastRoomHealth = result.health;
        lastRoomArmor = result.armor;
        combat.setInventory(currentInventory);
        combat.setState({ health: result.health, armor: result.armor,
          ammo: localAmmo?.[combat.selectedWeapon] });
        showToast(`${item.label.toUpperCase()} COLLECTED`);
      })
      .catch((error) => { if (epoch === combatEpoch) showToast(error.message, 1800); })
      .finally(() => { if (epoch === combatEpoch) pickupPending.delete(item.id); });
    return;
  }
  const index = soloPickups.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return;
  if (supply) {
    const result = applySupply({ inventory: soloInventory, health: soloHealth,
      armor: soloArmor, ammo: soloAmmo }, item.itemId);
    if (!result.applied) return;
    soloHealth = result.health;
    soloArmor = result.armor;
    soloAmmo = result.ammo;
    localAmmo = soloAmmo;
    soloPickups.splice(index, 1);
    lootWorld.sync(soloPickups);
    combat.setState({ health: soloHealth, armor: soloArmor,
      ammo: soloAmmo[combat.selectedWeapon] });
    showToast(`${item.label.toUpperCase()} COLLECTED`);
    return;
  }
  const before = soloInventory;
  const next = collectItem(before, item.itemId, soloPickups[index].count);
  if (next === before) return;
  const count = item.kind === 'gun' ? 1
    : next[item.kind === 'grenade' ? 'grenades' : 'mines']
      - before[item.kind === 'grenade' ? 'grenades' : 'mines'];
  if (count >= soloPickups[index].count) soloPickups.splice(index, 1);
  else soloPickups[index] = { ...soloPickups[index],
    count: soloPickups[index].count - count };
  soloInventory = next;
  currentInventory = next;
  combat.setInventory(currentInventory);
  lootWorld.sync(soloPickups);
  showToast(`${item.label.toUpperCase()} COLLECTED`);
}
function interact() {
  if (!started || menuOpen || mapOpen || drone.active || cliffFall.phase !== 'grounded'
    || multiplayer.getState().self?.dead
    || (!multiplayer.getState().room && soloHealth <= 0)) return;
  if (driving.active) {
    const vehicle = driving.active;
    const exited = driving.exit((x, z) => world.isWalkable(x, z) && canStandAt(x, z));
    if (!exited) { showToast('STOP THE CAR TO EXIT'); return; }
    player.x = exited.x;
    player.z = exited.z;
    player.yaw = exited.yaw;
    if (multiplayer.getState().room) {
      void (async () => {
        try {
          await multiplayer.request('vehicle:state', { id: vehicle.id, x: vehicle.x,
            z: vehicle.z, heading: vehicle.heading, speed: 0 });
        } catch { /* The exit still releases the server's car lease. */ }
        try { await multiplayer.request('vehicle:exit', { id: vehicle.id }); }
        catch (error) { showToast(error.message); }
      })();
    }
    showToast('ON FOOT');
  } else {
    const nearby = nearbyInteraction();
    if (nearby?.kind === 'vehicle') {
      const enter = () => {
        setPlayerStance('stand', { quiet: true });
        if (!driving.enter(nearby.vehicle.id)) return;
        player.x = nearby.vehicle.x;
        player.z = nearby.vehicle.z;
        showToast('DRIVING · W/S PEDALS · A/D STEER · SPACE BRAKE · E EXIT');
        refreshTouchUi();
      };
      if (multiplayer.getState().room) {
        void multiplayer.request('vehicle:enter', { id: nearby.vehicle.id })
          .then(({ vehicle }) => { Object.assign(nearby.vehicle, vehicle); enter(); })
          .catch((error) => showToast(error.message));
      } else enter();
    } else if (nearby?.kind === 'loot') {
      pickupLoot(nearby.item);
    } else if (nearby?.person) {
      const line = currentWeather() === 'storm' && nearby.person.stormLine
        ? nearby.person.stormLine : nearby.person.line;
      showToast(`${nearby.person.name.toUpperCase()} · ${line}`, 5200);
    }
  }
  refreshTouchUi();
}

let wheelPressedAt = -Infinity;
let wheelChanged = false;
function onLook(dx, dy) {
  if (cinematicCapture?.active || !started || menuOpen || mapOpen
    || driving.active || cliffFall.phase !== 'grounded'
    || multiplayer.getState().self?.dead
    || (!multiplayer.getState().room && soloHealth <= 0)) return;
  if (combat.equipmentWheelOpen) {
    const highlighted = combat.moveEquipmentWheel(dx, dy);
    if (highlighted && highlighted !== combat.selectedEquipment) wheelChanged = true;
    return;
  }
  if (drone.active) { drone.look(dx, dy); return; }
  player.yaw -= dx * 0.0021;
  player.pitch = clamp(player.pitch - dy * 0.0021, -1.45, 1.45);
}
// Exercise the real touch HUD with a desktop browser's phone-size viewport.
const touchQaEnabled = import.meta.env.DEV
  && new URLSearchParams(location.search).get('touch') === '1';
const touchEnabled = nativeAndroid || touchQaEnabled || useTouchControls({
  primaryCoarse: window.matchMedia('(pointer: coarse)').matches,
  anyFine: window.matchMedia('(any-pointer: fine)').matches,
});
document.body.classList.toggle('touch-ui', touchEnabled);
const touchControls = createTouchControls($('touch-controls'), {
  onLook,
  onAction(action) {
    if (action === 'menu') openMenu();
    else if (action === 'map') mapOpen ? closeMap() : openMap();
    else if (action === 'interact') drone.active ? toggleDrone() : interact();
    else if (action === 'drone') toggleDrone();
    else if (action === 'stance') setPlayerStance(
      { stand: 'crouch', crouch: 'prone', prone: 'stand' }[player.stance]);
    else if (action === 'sprint' && player.stance === 'stand') touchControls.toggleSprint();
    else if (action === 'light') { flashlightOn = !flashlightOn; flashlight.visible = flashlightOn; }
    else if (action === 'audio') toggleAudio();
  },
});

const multiplayer = createMultiplayerClient();
const remotePlayers = createRemotePlayers(scene,
  { groundHeight: structures.playerGroundHeight });
const freshSoloAmmo = () => Object.fromEntries(Object.entries(WEAPONS).map(([id, weapon]) =>
  [id, { magazine: weapon.magazine, reserve: weapon.reserve, reloadingUntil: 0 }]));
let soloAmmo = freshSoloAmmo();
let soloHealth = 100;
let soloArmor = 0;
let soloRespawnAt = 0;
let soloProtectedUntil = 0;
let soloInventory = createInventory();
if (waterQaView === 'combat') {
  // Local rendering/input QA only; no extra weapons in the shipped inventory.
  soloInventory = createInventory({ guns: ['revolver', 'smg', 'lmg'], selectedGun: 'revolver' });
}
let currentInventory = soloInventory;
let soloPickups = createWorldPickupSpawns(Math.floor(Math.random() * 0xffffffff));
if (waterQaView === 'pickup') {
  // Development sightline for end-to-end pickup/HUD checks; absent in builds.
  soloHealth = 60;
  soloAmmo.revolver.reserve -= 6;
  soloPickups = [
    { id: 'qa-armor', kind: 'armor', itemId: 'armor', x: player.x,
      z: player.z, count: 1, source: 'world' },
    { id: 'qa-medkit', kind: 'medkit', itemId: 'medkit', x: player.x + 0.7,
      z: player.z, count: 1, source: 'world' },
    { id: 'qa-ammo', kind: 'ammo', itemId: 'ammo', x: player.x + 1.4,
      z: player.z, count: 1, source: 'world' },
    ...soloPickups,
  ];
}
let activeRoomPickups = new Map();
let activeRoomExplosives = new Map();
let activeRoomWildlife = new Map();
let soloExplosives = [];
let nextSoloExplosiveId = 1;
let lastSoloExplosiveCheck = -Infinity;
let lastSoloUseAt = -Infinity;
lootWorld.sync(soloPickups);
const soloWildlifeHealth = new Map();
const soloNpcs = new Map([...residents.getCombatTargets(),
  ...prisonPopulation.getCombatTargets()].map((target) => [target.id,
  createNpcCombatant(target, target.kind,
    target.kind === 'resident'
      ? structures.playerGroundHeight(target.x, target.z)
      : world.terrainHeight(target.x, target.z))]));
const activeRoomNpcs = new Map();
let lastSoloNpcCheck = -Infinity;
let soloPose = null;
let soloVehicles = null;
let roomClock = null;
let lastRoomHealth = null;
let lastRoomArmor = null;
let localAmmo = soloAmmo;
let lastVehicleSend = -Infinity;
let vehicleSendPending = false;
let lastCombatVisible = false;
let lastCombatHolstered = false;
const lastLocalShot = Object.fromEntries(Object.keys(WEAPONS).map((id) => [id, -Infinity]));
const ammoPrediction = createAmmoPrediction();
let combatEpoch = 0;
let selectionGeneration = 0;
let selectionPending = false;
let triggerHeld = false;
let nextLocalShotAt = -Infinity;
let lastFireErrorAt = -Infinity;
let qaRunUntil = 0;
let qaFireUntil = 0;
let combatQa = null;
let combatMouse = null;
let downedTime = null;

function releaseCombatInput() {
  qaRunUntil = qaFireUntil = 0;
  triggerHeld = false;
  combatMouse?.reset();
  locomotion.reset();
  footstepDistance = 0;
}

function resetAmmoPrediction(ammo = {}) {
  pickupPending.clear();
  combatEpoch += 1;
  selectionGeneration += 1;
  selectionPending = false;
  ammoPrediction.reset(ammo);
  releaseCombatInput();
  nextLocalShotAt = -Infinity;
  for (const id of GUN_IDS) lastLocalShot[id] = -Infinity;
}

function refreshPredictedAmmo() {
  localAmmo = ammoPrediction.snapshot();
  combat.setState({ ammo: localAmmo[combat.selectedWeapon], serverNow: roomServerNow() });
}

function roomServerNow() {
  return roomClock ? roomClock.serverNow + performance.now() - roomClock.receivedAt : Date.now();
}

function resetRoomPlayer(spawn, { fade = true } = {}) {
  downedTime = null;
  hitAudio.clear();
  releaseCombatInput();
  locomotion.reset({ refill: true });
  driving.forceExit();
  drone.exit();
  player.stance = 'stand';
  cameraEyeHeight = playerStance('stand').eyeHeight;
  combat.setState({ stance: 'stand' });
  player.x = spawn.x;
  player.z = spawn.z;
  player.pitch = -0.05;
  cliffFall = rememberSafeGround(createCliffFallState({ x: player.x, z: player.z }),
    { x: player.x, z: player.z }, cliffWorld, canStandAt);
  respawnFadeTime = fade ? 0 : -1;
  keys.clear();
  touchControls.reset();
  refreshTouchUi();
}

function applyRoomWorld(next) {
  if (!next) return;
  if (['auto', 'clear', 'mist', 'rain', 'storm'].includes(next.weather)) {
    weatherSelect.value = next.weather;
  }
  if (['auto', 'dawn', 'noon', 'dusk', 'night'].includes(next.time)) {
    timeSelect.value = next.time;
  }
  if (Number.isFinite(next.startedAt) && Number.isFinite(next.serverNow)) {
    roomClock = { startedAt: next.startedAt, serverNow: next.serverNow,
      receivedAt: performance.now() };
  }
}

function applyRoomSnapshot(room) {
  const selfId = multiplayer.getState().selfId;
  remotePlayers.ingest(room, selfId);
  driving.syncRemoteVehicles(room.vehicles);
  applyRoomWorld({ ...room.world, serverNow: room.serverNow });
  if (Array.isArray(room.pickups)) {
    activeRoomPickups = new Map(room.pickups.map((item) => [item.id, item]));
    lootWorld.sync(room.pickups);
  }
  if (Array.isArray(room.explosives)) {
    activeRoomExplosives = new Map(room.explosives.map((item) => [item.id, item]));
    combat.syncExplosives(room.explosives, room.serverNow);
  }
  if (Array.isArray(room.wildlife)) {
    const changed = new Map(room.wildlife.map((animal) => [animal.id, animal]));
    for (const id of activeRoomWildlife.keys()) {
      if (!changed.has(id)) fauna.setAnimalAlive(id, true);
    }
    for (const animal of changed.values()) fauna.setAnimalAlive(animal.id, !animal.dead);
    activeRoomWildlife = changed;
  }
  if (Array.isArray(room.npcs)) {
    activeRoomNpcs.clear();
    for (const npc of room.npcs) activeRoomNpcs.set(npc.id, npc);
    residents.setCombatStates(room.npcs);
    prisonPopulation.setCombatStates(room.npcs);
  }
  const self = room.players?.find((member) => member.id === selfId);
  if (!self) return;
  const lostHealth = lastRoomHealth === null ? 0
    : Math.max(0, lastRoomHealth - self.health);
  const lostArmor = lastRoomArmor === null ? 0
    : Math.max(0, lastRoomArmor - (self.armor ?? 0));
  if (lostHealth || lostArmor) {
    combat.showDamage(lostHealth + lostArmor);
    hitAudio.playHit({ id: selfId, kind: 'human', local: true,
      damage: lostHealth + lostArmor, dead: self.dead });
  }
  if (self.dead && lastRoomHealth !== 0) {
    downedTime ??= 0;
    resetAmmoPrediction(self.ammo);
    combat.showDeath();
    driving.forceExit();
    drone.exit();
    keys.clear();
    touchControls.reset();
  }
  if (!self.dead && lastRoomHealth === 0) {
    resetAmmoPrediction(self.ammo);
    resetRoomPlayer(self);
    combat.showRespawn();
  }
  lastRoomHealth = self.health;
  lastRoomArmor = self.armor ?? 0;
  ammoPrediction.ingest(self.ammo);
  localAmmo = ammoPrediction.snapshot();
  if (self.inventory) {
    currentInventory = createInventory(self.inventory);
    combat.setInventory(currentInventory);
  }
  combat.setState({ mode: room.mode, ammo: localAmmo?.[combat.selectedWeapon],
    health: self.health, armor: self.armor, dead: self.dead,
    protectedUntil: self.spawnProtectedUntil,
    respawnAt: self.respawnAvailableAt, serverNow: room.serverNow });
}

function roomCombatReady() {
  const state = multiplayer.getState();
  return Boolean((!state.room || state.connected) && started && !menuOpen
    && !mapOpen && !drone.active && !driving.active && !cinematicCapture?.active
    && cliffFall.phase === 'grounded' && !state.self?.dead
    && !combat.equipmentWheelOpen && (state.room || soloHealth > 0));
}

function setPlayerStance(stance, { quiet = false } = {}) {
  if (!['stand', 'crouch', 'prone'].includes(stance) || driving.active
    || drone.active || cliffFall.phase !== 'grounded'
    || multiplayer.getState().self?.dead
    || (!multiplayer.getState().room && soloHealth <= 0)) return false;
  if (player.stance === stance) return true;
  locomotion.reset();
  player.stance = stance;
  combat.setState({ stance });
  if (!quiet) showToast(stance === 'stand' ? 'STANDING'
    : stance === 'crouch' ? 'CROUCHING' : 'PRONE');
  refreshTouchUi();
  return true;
}

function syncSoloNpcs({ restorePositions = false } = {}) {
  if (restorePositions) {
    residents.resetCombatStates();
    prisonPopulation.resetCombatStates();
  }
  // Solo detainees keep their original subtle pacing; only room snapshots
  // supply authoritative positions.
  const states = [...soloNpcs.values()].map(({ x, y, z, heading, ...state }) => state);
  residents.setCombatStates(states);
  prisonPopulation.setCombatStates(states);
}

function refreshSoloNpcPositions() {
  for (const target of [...residents.getCombatTargets(),
    ...prisonPopulation.getCombatTargets()]) {
    const npc = soloNpcs.get(target.id);
    if (!npc || npc.dead) continue;
    soloNpcs.set(target.id, { ...npc, x: target.x, z: target.z,
      y: target.kind === 'resident'
        ? structures.playerGroundHeight(target.x, target.z)
        : world.terrainHeight(target.x, target.z) });
  }
}

function nearestSoloNpc(origin, direction, range) {
  let nearest = null;
  for (const npc of soloNpcs.values()) {
    const distance = rayNpcHit(origin, direction, npc, range);
    if (distance === null) continue;
    const impact = { x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
      z: origin.z + direction.z * distance };
    if (shotBlockedByStructures(origin, impact) || shotBlockedByTerrain(origin, impact)) continue;
    if (!nearest || distance < nearest.distance) nearest = { npc, distance };
  }
  return nearest;
}

function alertSoloNpcsNearShot(origin, direction, range, hitNpcId = null) {
  let changed = false;
  for (const npc of soloNpcs.values()) {
    if (npc.dead || npc.alerted || npc.id === hitNpcId
      || !npcThreatenedByShot(origin, direction, npc, range)) continue;
    const center = { x: npc.x, y: npc.y + 1.1, z: npc.z };
    if (shotBlockedByStructures(origin, center) || shotBlockedByTerrain(origin, center)) continue;
    soloNpcs.set(npc.id, alertNpc(npc, 'solo'));
    changed = true;
  }
  if (changed) syncSoloNpcs();
}

function hurtSoloNpc(npc, damage, direction) {
  if (!npc || npc.dead || damage <= 0) return false;
  const next = applyNpcDamage(npc, damage, 'solo');
  if (next === npc) return false;
  soloNpcs.set(npc.id, next);
  syncSoloNpcs();
  const reaction = { damage: npc.health - next.health, direction };
  if (npc.kind === 'resident') residents.showCombatHit(npc.id, reaction);
  else prisonPopulation.showCombatHit(npc.id, reaction);
  hitAudio.playHit({ id: npc.id, kind: 'human', damage: reaction.damage,
    dead: next.dead, position: { x: npc.x, y: npc.y + 1.05, z: npc.z } });
  return true;
}

function damageSoloPlayer(amount, now = performance.now()) {
  if (multiplayer.getState().room || soloHealth <= 0 || soloProtectedUntil > now) return false;
  const hit = applyHealthDamage({ health: soloHealth, armor: soloArmor }, amount);
  if (!hit.damage) return false;
  soloHealth = hit.health;
  soloArmor = hit.armor;
  combat.showDamage(hit.damage);
  hitAudio.playHit({ id: 'solo', kind: 'human', local: true,
    damage: hit.damage, dead: hit.dead });
  if (hit.dead) {
    downedTime ??= 0;
    soloRespawnAt = now + RESPAWN_DELAY_MS;
    releaseCombatInput();
    combat.showDeath();
    driving.forceExit();
    drone.exit();
    keys.clear();
    touchControls.reset();
    showToast('YOU WERE DOWNED · RESPAWN WHEN READY');
  }
  combat.setState({ health: soloHealth, armor: soloArmor, dead: hit.dead,
    respawnAt: soloRespawnAt, protectedUntil: soloProtectedUntil, serverNow: now });
  return true;
}

function showNpcAttack(attack) {
  if (!attack?.origin || !attack?.target) return;
  const resident = soloNpcs.get(attack.npcId)?.kind === 'resident'
    || activeRoomNpcs.get(attack.npcId)?.kind === 'resident';
  if (attack.attackKind?.endsWith('_shot')) {
    if (resident) residents.showAttack(attack.npcId, attack.target,
      { noProjectile: true });
    else prisonPopulation.showAttack(attack.npcId, attack.target,
      { noProjectile: true });
    const shot = new THREE.Vector3(attack.target.x - attack.origin.x,
      attack.target.y - attack.origin.y, attack.target.z - attack.origin.z);
    if (shot.lengthSq() > 0.01) {
      const hitDistance = shot.length();
      combat.remoteFire({ weapon: attack.weapon || 'revolver', origin: attack.origin,
        direction: shot.normalize(), hitDistance });
    }
  }
}

function updateSoloNpcCombat(now = performance.now()) {
  if (multiplayer.getState().room || now - lastSoloNpcCheck < 100) return;
  lastSoloNpcCheck = now;
  refreshSoloNpcPositions();
  if (!started || menuOpen || mapOpen || cinematicCapture?.active || drone.active
    || driving.active || cliffFall.phase !== 'grounded' || soloHealth <= 0) return;
  const target = { id: 'solo', x: player.x,
    y: structures.playerGroundHeight(player.x, player.z)
      + playerStance(player.stance).eyeHeight,
    z: player.z, mode: 'walk', stance: player.stance, dead: false,
    spawnProtectedUntil: soloProtectedUntil };
  for (const npc of soloNpcs.values()) {
    const attack = npcAttackDecision(npc, [target], now, (origin, impact) =>
      !shotBlockedByStructures(origin, impact)
        && !shotBlockedByTerrain(origin, impact));
    if (!attack) continue;
    soloNpcs.set(npc.id, { ...npc, lastAttackAt: now });
    showNpcAttack(attack);
    damageSoloPlayer(attack.damage, now);
    if (soloHealth === 0) break;
  }
}

function nearestSoloAnimal(origin, direction, range) {
  let nearest = null;
  for (const target of fauna.getTargets()) {
    if (!target.active || !target.alive) continue;
    const distance = rayWildlifeHit(origin, direction, target, range);
    if (distance === null) continue;
    const impact = { x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
      z: origin.z + direction.z * distance };
    if (shotBlockedByStructures(origin, impact) || shotBlockedByTerrain(origin, impact)) continue;
    if (!nearest || distance < nearest.distance) nearest = { target, distance };
  }
  return nearest;
}

function hurtSoloAnimal(target, damage, now = performance.now(), direction) {
  if (!target.active || !target.alive || damage <= 0) return false;
  const previousHealth = soloWildlifeHealth.get(target.id)?.health ?? target.maxHealth;
  const health = Math.max(0, previousHealth - damage);
  soloWildlifeHealth.set(target.id, { health,
    respawnAt: health === 0 ? now + WILDLIFE_KINDS[target.kind].respawnMs : 0 });
  fauna.showCombatHit(target.id, { direction, damage: previousHealth - health });
  if (health === 0) fauna.setAnimalAlive(target.id, false, { direction });
  hitAudio.playHit({ id: target.id, kind: target.kind, position: target,
    damage: previousHealth - health, dead: health === 0 });
  return true;
}

function explodeSoloItem(explosive, now = performance.now()) {
  const config = EXPLOSIVES[explosive.kind];
  if (!config) return;
  const origin = { x: explosive.x, y: explosive.y + 1, z: explosive.z };
  const directionTo = (target) => new THREE.Vector3(target.x - origin.x,
    target.y - origin.y, target.z - origin.z).normalize();
  const stance = playerStance(player.stance);
  const selfTarget = { x: player.x, z: player.z,
    y: structures.playerGroundHeight(player.x, player.z) + stance.hitHeight * 0.5,
    dead: soloHealth <= 0, mode: drone.active ? 'drone' : 'walk',
    spawnProtectedUntil: soloProtectedUntil };
  const selfDamage = blastDamageForTarget(origin, selfTarget, config, { now,
    visible: (from, to) => !shotBlockedByStructures(from, to) && !shotBlockedByTerrain(from, to) });
  if (selfDamage) damageSoloPlayer(selfDamage, now);
  let hitAny = false;
  for (const target of fauna.getTargets()) {
    if (!target.active || !target.alive) continue;
    const distance = Math.max(0,
      Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z)
        - target.radius);
    if (distance > config.radius || shotBlockedByStructures(origin, target)
      || shotBlockedByTerrain(origin, target)) continue;
    hitAny = hurtSoloAnimal(target, blastDamageAt(distance, config), now, directionTo(target)) || hitAny;
  }
  refreshSoloNpcPositions();
  for (const npc of soloNpcs.values()) {
    if (npc.dead) continue;
    const center = { x: npc.x, y: npc.y + 1.05, z: npc.z };
    const distance = Math.max(0, Math.hypot(center.x - origin.x,
      center.y - origin.y, center.z - origin.z) - 0.65);
    if (distance > config.radius || shotBlockedByStructures(origin, center)
      || shotBlockedByTerrain(origin, center)) continue;
    hitAny = hurtSoloNpc(npc, blastDamageAt(distance, config), directionTo(center)) || hitAny;
  }
  combat.showExplosion({ id: explosive.id, kind: explosive.kind,
    position: { x: explosive.x, y: explosive.y, z: explosive.z },
    radius: config.radius });
  if (hitAny) combat.showHit();
}

function updateSoloExplosives(now = performance.now()) {
  if (multiplayer.getState().room || now - lastSoloExplosiveCheck < 90) return;
  lastSoloExplosiveCheck = now;
  for (let index = soloExplosives.length - 1; index >= 0; index--) {
    const explosive = soloExplosives[index];
    const config = EXPLOSIVES[explosive.kind];
    if (explosive.kind === 'grenade' && now < explosive.detonatesAt) continue;
    if (explosive.kind === 'mine' && now < explosive.armedAt) continue;
    if (explosive.kind === 'mine' && now < explosive.expiresAt) {
      const mineOrigin = { x: explosive.x, y: explosive.y + 0.15,
        z: explosive.z };
      const visible = (target) => !shotBlockedByStructures(mineOrigin, target)
        && !shotBlockedByTerrain(mineOrigin, target);
      const triggered = fauna.getTargets().some((target) => target.active && target.alive
        && Math.hypot(target.x - explosive.x, target.z - explosive.z)
          <= config.triggerRadius + target.radius && visible(target))
        || [...soloNpcs.values()].some((npc) => !npc.dead
          && Math.hypot(npc.x - explosive.x, npc.z - explosive.z)
            <= config.triggerRadius + 0.65
          && visible({ x: npc.x, y: npc.y + 1.05, z: npc.z }));
      if (!triggered) continue;
    }
    soloExplosives.splice(index, 1);
    if (explosive.kind === 'mine' && now >= explosive.expiresAt) {
      combat.removeExplosive(explosive.id);
    } else explodeSoloItem(explosive, now);
  }
}

function settleSoloReloads(now = performance.now()) {
  if (multiplayer.getState().room) return;
  for (const [id, ammo] of Object.entries(soloAmmo)) {
    if (!ammo.reloadingUntil || ammo.reloadingUntil > now) continue;
    const amount = Math.min(WEAPONS[id].magazine - ammo.magazine, ammo.reserve);
    ammo.magazine += amount;
    ammo.reserve -= amount;
    ammo.reloadingUntil = 0;
    if (combat.selectedWeapon === id) combat.setState({ ammo, serverNow: now });
  }
}

function settleSoloWildlife(now = performance.now()) {
  if (multiplayer.getState().room) return;
  for (const [id, state] of soloWildlifeHealth) {
    if (!state.respawnAt || state.respawnAt > now) continue;
    soloWildlifeHealth.delete(id);
    fauna.setAnimalAlive(id, true);
  }
}

async function fireWeapon() {
  if (!roomCombatReady() || !GUN_IDS.includes(combat.selectedEquipment)
    || !currentInventory.guns.includes(combat.selectedEquipment) || selectionPending) return;
  const inRoom = Boolean(multiplayer.getState().room);
  const weapon = combat.selectedEquipment;
  const ammunition = localAmmo?.[weapon];
  const now = performance.now();
  if (!ammunition || ammunition.magazine < 1
    || ammunition.reloadingUntil > (inRoom ? roomServerNow() : now)
    || now < nextLocalShotAt
    || now - lastLocalShot[weapon] < WEAPONS[weapon].fireIntervalMs) return;
  const epoch = combatEpoch;
  const shotId = inRoom ? ammoPrediction.reserve(weapon) : null;
  if (inRoom && shotId === null) return;
  lastLocalShot[weapon] = now;
  nextLocalShotAt = now + WEAPONS[weapon].fireIntervalMs + (inRoom ? 8 : 0);
  const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  const view = camera.getWorldDirection(new THREE.Vector3()).normalize();
  // Small hip-fire cone. ADS and a supported prone stance tighten automatic fire.
  const spread = (WEAPONS[weapon].spread || 0) * (combat.aiming ? 0.28 : 1)
    * (player.stance === 'prone' ? 0.55 : 1);
  if (spread) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * spread;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    view.addScaledVector(right, Math.cos(angle) * radius)
      .addScaledVector(up, Math.sin(angle) * radius).normalize();
  }
  const direction = { x: view.x, y: view.y, z: view.z };
  localAmmo = inRoom ? ammoPrediction.snapshot()
    : { ...localAmmo, [weapon]: { ...ammunition, magazine: ammunition.magazine - 1 } };
  if (!inRoom) {
    soloAmmo[weapon] = localAmmo[weapon];
    soloProtectedUntil = Math.min(soloProtectedUntil, now);
  }
  combat.setState({ ammo: localAmmo[weapon], serverNow: inRoom ? roomServerNow() : now,
    ...(!inRoom ? { protectedUntil: soloProtectedUntil } : {}) });
  if (!inRoom) refreshSoloNpcPositions();
  const animalHit = inRoom ? null : nearestSoloAnimal(origin, direction, WEAPONS[weapon].range);
  const npcHit = inRoom ? null : nearestSoloNpc(origin, direction, WEAPONS[weapon].range);
  const firstHit = !animalHit || (npcHit && npcHit.distance < animalHit.distance)
    ? npcHit : animalHit;
  combat.fire({ weapon, origin, direction, local: true,
    hitDistance: firstHit?.distance });
  player.pitch = clamp(player.pitch + (WEAPONS[weapon].recoil || 0.6)
    * (combat.aiming ? 0.003 : 0.005), -1.45, 1.45);
  if (!inRoom) {
    if (firstHit === npcHit && npcHit) {
      if (hurtSoloNpc(npcHit.npc, WEAPONS[weapon].damage, direction)) combat.showHit();
    } else if (firstHit === animalHit && animalHit) {
      if (hurtSoloAnimal(animalHit.target, WEAPONS[weapon].damage, now, direction)) combat.showHit();
    }
    alertSoloNpcsNearShot(origin, direction, firstHit?.distance ?? WEAPONS[weapon].range,
      firstHit === npcHit ? npcHit?.npc.id : null);
    return;
  }
  try {
    const result = await multiplayer.request('combat:fire', { weapon, origin, direction, shotId });
    if (epoch !== combatEpoch) return;
    ammoPrediction.acknowledge(weapon, shotId, result.ammo);
    refreshPredictedAmmo();
    if (result.hit) {
      if (Number.isFinite(result.hit.distance)) {
        combat.confirmLocalHit(result.hit.distance, { weapon, origin });
      }
      combat.showHit();
    }
  } catch (error) {
    if (epoch !== combatEpoch) return;
    ammoPrediction.reject(weapon, shotId);
    refreshPredictedAmmo();
    if (performance.now() - lastFireErrorAt > 1700) {
      lastFireErrorAt = performance.now();
      showToast(error.message, 1700);
    }
  }
}

async function reloadWeapon() {
  if (!roomCombatReady() || !GUN_IDS.includes(combat.selectedEquipment) || selectionPending) return;
  triggerHeld = false;
  const weapon = combat.selectedEquipment;
  if (!multiplayer.getState().room) {
    settleSoloReloads();
    const ammo = soloAmmo[weapon];
    if (!ammo.reserve || ammo.magazine === WEAPONS[weapon].magazine
      || ammo.reloadingUntil) return;
    ammo.reloadingUntil = performance.now() + WEAPONS[weapon].reloadMs;
    localAmmo = soloAmmo;
    combat.setState({ ammo, serverNow: performance.now() });
    return;
  }
  const epoch = combatEpoch;
  try {
    const result = await multiplayer.request('combat:reload', { weapon });
    if (epoch !== combatEpoch) return;
    ammoPrediction.ingest({ [weapon]: result.ammo });
    refreshPredictedAmmo();
  } catch (error) { if (epoch === combatEpoch) showToast(error.message, 1700); }
}

function selectEquipment(id) {
  const owned = id === 'unarmed' ? true
    : GUN_IDS.includes(id) ? currentInventory.guns.includes(id)
    : id === 'grenade' ? currentInventory.grenades > 0
      : id === 'mine' && currentInventory.mines > 0;
  if (!owned || !combat.selectEquipment(id)) {
    showToast(`${ITEM_DEFINITIONS[id]?.label?.toUpperCase() || 'ITEM'} UNAVAILABLE`, 1400);
    return false;
  }
  triggerHeld = false;
  combatMouse?.reset();
  if (GUN_IDS.includes(id)) {
    currentInventory = { ...currentInventory, selectedGun: id };
    if (!multiplayer.getState().room) soloInventory = currentInventory;
    else {
      const generation = ++selectionGeneration;
      const epoch = combatEpoch;
      selectionPending = true;
      void multiplayer.request('inventory:select', { weapon: id })
        .then((result) => {
          if (generation !== selectionGeneration || epoch !== combatEpoch) return;
          currentInventory = createInventory(result.inventory);
          combat.setInventory(currentInventory);
        })
        .catch((error) => {
          if (generation !== selectionGeneration || epoch !== combatEpoch) return;
          const authoritative = multiplayer.getState().self?.inventory;
          if (authoritative) {
            currentInventory = createInventory(authoritative);
            combat.selectEquipment(currentInventory.selectedGun);
            combat.setInventory(currentInventory);
          }
          showToast(error.message, 1700);
        })
        .finally(() => {
          if (generation === selectionGeneration && epoch === combatEpoch) selectionPending = false;
        });
    }
    combat.setState({ ammo: localAmmo?.[id] });
  }
  return true;
}

function selectWeapon(weapon) { return selectEquipment(weapon); }

async function useEquipment(requestedKind = combat.selectedEquipment) {
  if (!roomCombatReady() || !['grenade', 'mine'].includes(requestedKind)
    || combat.selectedEquipment !== requestedKind
    || currentInventory[requestedKind === 'grenade' ? 'grenades' : 'mines'] < 1) return;
  const kind = requestedKind;
  const now = performance.now();
  if (!multiplayer.getState().room && now - lastSoloUseAt < 350) return;
  const view = camera.getWorldDirection(new THREE.Vector3());
  const horizontal = new THREE.Vector2(view.x, view.z).normalize();
  if (!Number.isFinite(horizontal.x) || !Number.isFinite(horizontal.y)) return;
  const distance = kind === 'grenade' ? clamp(12 + view.y * 11, 6, 23) : 1.8;
  const target = { x: player.x + horizontal.x * distance,
    z: player.z + horizontal.y * distance };
  if (kind === 'mine' && (!world.isWalkable(target.x, target.z)
    || world.isLake(target.x, target.z, 0.6)
    || world.coastalRadius(target.x, target.z) >= 0.955)) {
    showToast('CHOOSE SOLID GROUND FOR THE MINE', 1800);
    return;
  }
  if (multiplayer.getState().room) {
    const epoch = combatEpoch;
    try {
      const result = await multiplayer.request('combat:use', { kind, target });
      if (epoch !== combatEpoch) return;
      currentInventory = createInventory(result.inventory);
      combat.setInventory(currentInventory);
    } catch (error) { if (epoch === combatEpoch) showToast(error.message, 1800); }
    return;
  }
  if (soloExplosives.length >= 8) {
    showToast('TOO MANY ACTIVE EXPLOSIVES', 1800);
    return;
  }
  const nextInventory = consumeItem(soloInventory, kind);
  if (nextInventory === soloInventory) return;
  lastSoloUseAt = now;
  soloProtectedUntil = Math.min(soloProtectedUntil, now);
  soloInventory = nextInventory;
  currentInventory = soloInventory;
  combat.setInventory(currentInventory);
  combat.setState({ protectedUntil: soloProtectedUntil, serverNow: now });
  const config = EXPLOSIVES[kind];
  const explosive = { id: `solo-${nextSoloExplosiveId++}`, kind, ownerId: 'solo',
    x: target.x, y: world.terrainHeight(target.x, target.z) + 0.25, z: target.z,
    createdAt: now, radius: config.radius,
    ...(kind === 'grenade' ? { detonatesAt: now + config.fuseMs }
      : { armedAt: now + config.armMs, expiresAt: now + config.ttlMs }) };
  soloExplosives.push(explosive);
  if (kind === 'grenade') combat.showExplosiveThrow({ id: explosive.id, kind,
    origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: explosive.x, y: explosive.y, z: explosive.z } });
  else combat.showMinePlacement({ id: explosive.id, kind,
    position: { x: explosive.x, y: explosive.y, z: explosive.z } });
}

function activateSelectedEquipment() {
  if (combat.equipmentWheelOpen) return;
  if (GUN_IDS.includes(combat.selectedEquipment)) void fireWeapon();
  else void useEquipment(combat.selectedEquipment);
}

async function respawnRoomPlayer() {
  const original = multiplayer.getState();
  const self = original.self;
  if (!self?.dead || roomServerNow() < self.respawnAvailableAt) return;
  try {
    const result = await multiplayer.request('player:respawn');
    const current = multiplayer.getState();
    if (current.selfId !== original.selfId || current.code !== original.code) return;
    resetAmmoPrediction(result.ammo);
    resetRoomPlayer(result.spawn);
    lastRoomHealth = result.health;
    lastRoomArmor = result.armor;
    localAmmo = result.ammo;
    if (result.inventory) {
      currentInventory = createInventory(result.inventory);
      combat.setInventory(currentInventory);
      combat.selectEquipment(currentInventory.selectedGun);
    }
    combat.setState({ health: result.health, armor: result.armor, dead: false,
      protectedUntil: result.spawnProtectedUntil, ammo: result.ammo?.[combat.selectedWeapon] });
    combat.showRespawn();
    showToast('RETURNED TO SAFE GROUND');
  } catch (error) { showToast(error.message); }
}

function respawnPlayer() {
  if (multiplayer.getState().room) {
    void respawnRoomPlayer();
    return;
  }
  const now = performance.now();
  if (soloHealth > 0 || now < soloRespawnAt) return;
  const safe = SAFE_SPAWNS.filter((spawn) => world.isWalkable(spawn.x, spawn.z)
    && !world.isLake(spawn.x, spawn.z, PLAYER_RADIUS)
    && canStandAt(spawn.x, spawn.z));
  const closestThreat = (spawn) => Math.min(500,
    ...[...soloNpcs.values()].filter((npc) => !npc.dead && npc.alerted)
      .map((npc) => Math.hypot(npc.x - spawn.x, npc.z - spawn.z)));
  const spawn = safe.sort((a, b) => closestThreat(b) - closestThreat(a))[0]
    || { x: 0, z: 270 };
  resetRoomPlayer(spawn);
  soloHealth = 100;
  soloArmor = 0;
  soloRespawnAt = 0;
  soloProtectedUntil = now + SPAWN_PROTECTION_MS;
  combat.setState({ health: soloHealth, armor: soloArmor, dead: false,
    protectedUntil: soloProtectedUntil, respawnAt: 0,
    ammo: soloAmmo[combat.selectedWeapon], serverNow: now });
  combat.showRespawn();
  showToast('RETURNED TO SAFE GROUND');
}

const combat = createCombatPresentation({ camera, scene, root: document.body,
  mobile: touchEnabled, onFire: fireWeapon, onReload: reloadWeapon,
  onTriggerChange: (held) => { triggerHeld = held && roomCombatReady(); },
  onAim: (aiming) => combat.setAim(aiming), onSelectWeapon: selectWeapon,
  onSelectEquipment: selectEquipment, onUseEquipment: useEquipment,
  onRespawn: respawnPlayer });
combat.setInventory(soloInventory);
combat.setState({ mode: 'solo', ammo: localAmmo.revolver,
  health: soloHealth, armor: soloArmor, stance: player.stance,
  serverNow: performance.now() });
combatMouse = createCombatMouseInput({ onAim: (aim) => combat.setAim(aim),
  onTriggerChange: (held) => { triggerHeld = held && GUN_IDS.includes(combat.selectedEquipment); },
  onFire: () => {
    if (fallbackPointerStart) fallbackPointerStart.fired = true;
    activateSelectedEquipment();
  } });
if (waterQaView === 'combat') {
  combatQa = document.createElement('section');
  combatQa.id = 'combat-qa';
  combatQa.setAttribute('aria-label', 'Local combat diagnostics');
  const readout = document.createElement('output');
  readout.id = 'combat-qa-state';
  let qaResidentId = null;
  let qaBirdId = null;
  const lookAtTarget = (target, distance = 8, from = null) => {
    releaseCombatInput();
    player.x = from?.x ?? target.x;
    player.z = from?.z ?? target.z + distance;
    const dx = target.x - player.x, dz = target.z - player.z;
    player.yaw = Math.atan2(-dx, -dz);
    const eye = structures.playerGroundHeight(player.x, player.z) + cameraEyeHeight;
    player.pitch = Math.atan2(target.y - eye, Math.hypot(dx, dz));
  };
  for (const id of ['revolver', 'smg', 'lmg']) {
    const button = document.createElement('button');
    button.textContent = id.toUpperCase();
    button.addEventListener('click', () => selectEquipment(id));
    combatQa.append(button);
  }
  for (const [label, action] of [
    ['FIRE 2s', () => { if (roomCombatReady()) { qaFireUntil = performance.now() + 2000; triggerHeld = true; activateSelectedEquipment(); } }],
    ['RELOAD', () => void reloadWeapon()],
    ['SPRINT 4s', () => { if (roomCombatReady()) qaRunUntil = performance.now() + 4000; }],
    ['STOP', releaseCombatInput],
    ['AIM TOGGLE', () => combat.setAim(!combat.aiming)],
    ['HIT SELF', () => damageSoloPlayer(34)],
    ['SELF GRENADE', () => explodeSoloItem({ id: 'qa-self-grenade', kind: 'grenade',
      x: player.x, z: player.z, y: structures.playerGroundHeight(player.x, player.z) })],
    ['RESPAWN', respawnPlayer],
    ['VIEW RESIDENT', () => {
      refreshSoloNpcPositions();
      const target = [...soloNpcs.values()].find(npc => npc.kind === 'resident' && !npc.dead);
      if (target) { qaResidentId = target.id; lookAtTarget({ ...target, y: target.y + 1 }); }
    }],
    ['HIT RESIDENT', () => hurtSoloNpc(soloNpcs.get(qaResidentId), 60, { x: 0, z: -1 })],
    ['VIEW BIRD', () => {
      const birds = fauna.getTargets().filter(animal => animal.kind === 'bird' && animal.active);
      const views = SAFE_SPAWNS.flatMap(from => birds.map(target => ({ from, target,
        distance: Math.hypot(target.x - from.x, target.z - from.z) })));
      const view = views.sort((a, b) => a.distance - b.distance).find(({ from, target, distance }) => {
        const eye = { ...from, y: structures.playerGroundHeight(from.x, from.z) + cameraEyeHeight };
        return distance > 8 && Math.hypot(distance, target.y - eye.y) < 70
          && !shotBlockedByStructures(eye, target) && !shotBlockedByTerrain(eye, target);
      });
      if (view) { qaBirdId = view.target.id; lookAtTarget(view.target, 12, view.from); }
    }],
    ['HIT BIRD', () => {
      const target = fauna.getTargets().find(animal => animal.id === qaBirdId);
      if (target) hurtSoloAnimal(target, 60, performance.now(), { x: 0, z: -1 });
    }],
  ]) {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', action);
    combatQa.append(button);
  }
  combatQa.append(readout);
  document.body.append(combatQa);
}
syncSoloNpcs();
createMultiplayerRoomUI({ client: multiplayer });
const voiceChat = createVoiceChat({ client: multiplayer });
const voiceChatUI = createVoiceChatUI({ voice: voiceChat, client: multiplayer,
  mobile: touchEnabled });
voiceChat.setMode(touchEnabled ? 'open' : 'push-to-talk');
multiplayer.on('joined', (state) => {
  hitAudio.clear();
  resetAmmoPrediction(state.self?.ammo);
  climateSampleTime = -Infinity;
  fauna.resetAnimals();
  soloExplosives = [];
  if (!soloPose) {
    soloPose = { x: player.x, z: player.z, yaw: player.yaw,
      pitch: player.pitch, stance: player.stance,
      weather: weatherSelect.value, time: timeSelect.value };
    soloVehicles = driving.snapshot();
  }
  const self = state.self;
  if (self) resetRoomPlayer(self, { fade: false });
  applyRoomSnapshot(state.room);
  if (self?.inventory?.selectedGun) {
    combat.selectEquipment(self.inventory.selectedGun);
    combat.setState({ ammo: localAmmo[self.inventory.selectedGun] });
  }
  showToast(`JOINED ${state.mode === 'pvp' ? 'PVP' : 'EXPLORE'} ROOM ${state.code}`);
});
multiplayer.on('snapshot', applyRoomSnapshot);
multiplayer.on('loot', (event) => {
  if (!multiplayer.getState().room || !event?.pickup?.id) return;
  if (event.action === 'remove') activeRoomPickups.delete(event.pickup.id);
  else if (event.action === 'spawn' || event.action === 'update') {
    activeRoomPickups.set(event.pickup.id, event.pickup);
  }
  lootWorld.sync([...activeRoomPickups.values()]);
});
multiplayer.on('explosive', (event) => {
  if (!multiplayer.getState().room || !event?.explosive?.id) return;
  if (event.action === 'remove') activeRoomExplosives.delete(event.explosive.id);
  else if (event.action === 'spawn') {
    activeRoomExplosives.set(event.explosive.id, event.explosive);
  }
  combat.syncExplosives([...activeRoomExplosives.values()], roomServerNow());
});
multiplayer.on('wildlife', (animal) => {
  if (!animal?.id) return;
  fauna.setAnimalAlive(animal.id, !animal.dead);
  if (animal.dead) activeRoomWildlife.set(animal.id, animal);
  else activeRoomWildlife.delete(animal.id);
});
multiplayer.on('npc', (npc) => {
  if (!multiplayer.getState().room || !npc?.id) return;
  activeRoomNpcs.set(npc.id, npc);
  const states = [...activeRoomNpcs.values()];
  residents.setCombatStates(states);
  prisonPopulation.setCombatStates(states);
});
multiplayer.on('world', applyRoomWorld);
multiplayer.on('combat', (event) => {
  const selfId = multiplayer.getState().selfId;
  if (event.kind === 'shot' && event.shooterId !== selfId) combat.remoteFire({
    weapon: event.weapon, origin: event.origin, direction: event.direction, hit: event.hit,
  });
  if (event.kind === 'throw') combat.showExplosiveThrow({ id: event.id,
    kind: event.itemKind, origin: event.origin, target: event.position });
  if (event.kind === 'place') combat.showMinePlacement({ id: event.id,
    kind: event.itemKind, position: event.position });
  if (event.kind === 'explosion') combat.showExplosion({ id: event.id,
    kind: event.itemKind, position: event.position, radius: event.radius });
  if (event.kind === 'npc_hit') {
    const npc = activeRoomNpcs.get(event.npcId);
    if (npc?.kind === 'resident') residents.showCombatHit(event.npcId, event);
    else prisonPopulation.showCombatHit(event.npcId, event);
    hitAudio.playHit({ ...event, id: event.npcId, kind: 'human',
      eventId: `npc:${event.npcId}:${event.at}` });
  }
  if (event.kind === 'wildlife_hit') {
    fauna.showCombatHit(event.id, event);
    if (event.dead) fauna.setAnimalAlive(event.id, false, event);
    hitAudio.playHit({ ...event, kind: event.animalKind,
      eventId: `animal:${event.id}:${event.at}` });
  }
  if (event.kind === 'npc_attack') {
    showNpcAttack(event);
    const direction = event.origin && event.target ? new THREE.Vector3(
      event.target.x - event.origin.x, event.target.y - event.origin.y,
      event.target.z - event.origin.z).normalize() : undefined;
    if (event.targetId !== selfId) remotePlayers.showCombatHit(event.targetId,
      { direction, damage: event.damage });
    hitAudio.playHit({ id: event.targetId, kind: 'human',
      local: event.targetId === selfId, position: event.target,
      damage: (event.armorDamage || 0) + (event.healthDamage || 0), dead: event.dead,
      eventId: `attack:${event.npcId}:${event.targetId}:${event.at}` });
    if (event.targetId === selfId) {
      combat.showDamage((event.armorDamage || 0) + (event.healthDamage || 0));
      lastRoomHealth = event.health;
      lastRoomArmor = event.armor;
      combat.setState({ health: event.health, armor: event.armor, dead: event.dead });
    }
  }
  if (event.kind === 'hit') {
    if (event.targetId !== selfId) remotePlayers.showCombatHit(event.targetId, event);
    hitAudio.playHit({ ...event, id: event.targetId, kind: 'human',
      local: event.targetId === selfId,
      position: event.position || remotePlayers.getCombatPosition(event.targetId),
      eventId: `player:${event.targetId}:${event.at}` });
  }
  if (event.kind === 'hit' && event.targetId === selfId) {
    combat.showDamage(event.damage);
    lastRoomHealth = event.health;
    lastRoomArmor = event.armor;
    combat.setState({ health: event.health, armor: event.armor, dead: event.dead });
  }
  if (event.kind === 'death' && event.playerId === selfId) {
    downedTime ??= 0;
    resetAmmoPrediction(multiplayer.getState().self?.ammo);
    combat.showDeath();
    combat.setState({ health: 0, armor: 0, dead: true,
      respawnAt: event.respawnAvailableAt });
    lastRoomHealth = 0;
    lastRoomArmor = 0;
    driving.forceExit();
    drone.exit();
    keys.clear();
    touchControls.reset();
    showToast('YOU WERE DOWNED · RESPAWN WHEN READY');
  }
  if (event.kind === 'respawn' && event.playerId === selfId) {
    resetRoomPlayer(event.spawn);
    combat.showRespawn();
  }
});
multiplayer.on('left', () => {
  downedTime = null;
  hitAudio.clear();
  resetAmmoPrediction();
  remotePlayers.clear();
  driving.forceExit();
  driving.clearRemoteVehicles();
  if (soloVehicles) driving.restore(soloVehicles, () => true);
  soloVehicles = null;
  roomClock = null;
  climateSampleTime = -Infinity;
  lastRoomHealth = null;
  lastRoomArmor = null;
  localAmmo = soloAmmo;
  currentInventory = soloInventory;
  combat.setInventory(soloInventory);
  activeRoomPickups.clear();
  activeRoomExplosives.clear();
  activeRoomWildlife.clear();
  activeRoomNpcs.clear();
  lootWorld.sync(soloPickups);
  combat.syncExplosives(soloExplosives, performance.now());
  fauna.resetAnimals();
  for (const [id, state] of soloWildlifeHealth) {
    if (state.health === 0) fauna.setAnimalAlive(id, false);
  }
  syncSoloNpcs({ restorePositions: true });
  combat.setState({ active: false, mode: 'solo', ammo: localAmmo[combat.selectedWeapon],
    health: soloHealth, armor: soloArmor, dead: soloHealth === 0,
    protectedUntil: soloProtectedUntil, respawnAt: soloRespawnAt,
    serverNow: performance.now() });
  if (soloPose) {
    Object.assign(player, { x: soloPose.x, z: soloPose.z, yaw: soloPose.yaw,
      pitch: soloPose.pitch, stance: soloPose.stance });
    cameraEyeHeight = playerStance(player.stance).eyeHeight;
    combat.setState({ stance: player.stance });
    weatherSelect.value = soloPose.weather;
    timeSelect.value = soloPose.time;
    soloPose = null;
    storeSettings();
  }
  cliffFall = rememberSafeGround(createCliffFallState({ x: player.x, z: player.z }),
    { x: player.x, z: player.z }, cliffWorld, canStandAt);
  showToast('LEFT PRIVATE ROOM · SOLO EXPLORATION');
});
if (multiplayer.getState().savedSession) {
  // Reconnect while assets are still loading, before a slow world load can
  // consume the server's grace period.
  void multiplayer.resumeRoom().catch((error) => {
    console.info('Saved room could not be resumed:', error.message);
  });
}
function refreshTouchUi() {
  const landscape = innerWidth >= innerHeight;
  $('touch-rotate').hidden = !touchEnabled || landscape || !started;
  touchControls.setVisible(!captureEnabled && touchEnabled && landscape
    && started && !menuOpen && !mapOpen && !multiplayer.getState().self?.dead
    && (multiplayer.getState().room || soloHealth > 0));
  if (!touchEnabled) return;
  const mode = drone.active ? 'drone' : driving.active ? 'driving' : 'walking';
  touchControls.setMode(mode);
  touchControls.setSprintAvailable(mode === 'walking' && player.stance === 'stand'
    && cliffFall.phase === 'grounded');
  const stanceLabel = player.stance === 'stand' ? 'STAND' : player.stance.toUpperCase();
  if ($('touch-stance-label').textContent !== stanceLabel) {
    $('touch-stance-label').textContent = stanceLabel;
    const posture = { stand: 'standing', crouch: 'crouching', prone: 'prone' }[player.stance];
    $('touch-stance').setAttribute('aria-label', `Change posture, currently ${posture}`);
    $('touch-stance').classList.toggle('pressed', player.stance !== 'stand');
  }
  const nearby = !drone.active && !driving.active ? nearbyInteraction() : null;
  touchControls.setAction(drone.active ? 'EXIT DRONE' : driving.active ? 'EXIT CAR'
    : nearby?.kind === 'vehicle' ? 'DRIVE' : nearby?.kind === 'loot' ? 'PICK UP'
      : nearby?.person ? 'TALK' : 'USE',
  drone.active || driving.active || Boolean(nearby));
  $('touch-drone-toggle').textContent = drone.active ? 'EXIT DRONE' : 'DRONE';
}

window.addEventListener('keydown', (event) => {
  if (cinematicCapture?.active) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code)
    && started && !menuOpen) event.preventDefault();
  if (event.code === 'Escape') {
    if (combat.equipmentWheelOpen) combat.closeEquipmentWheel({ commit: false });
    else if (mapOpen) closeMap();
    else if (menuOpen && started) closeMenu();
    else openMenu();
    return;
  }
  if (menuOpen || !started || mapOpen) return;
  if (multiplayer.getState().self?.dead
    || (!multiplayer.getState().room && soloHealth <= 0)) {
    if (event.code === 'Space') respawnPlayer();
    return;
  }
  if (combat.equipmentWheelOpen
    && ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code)) {
    combat.rotateEquipmentWheel(['ArrowLeft', 'KeyA'].includes(event.code) ? -1 : 1);
    wheelChanged = true;
    return;
  }
  if (event.repeat) return;
  if (event.code === 'KeyM') { openMap(); return; }
  if (event.code === 'KeyG') { toggleDrone(); return; }
  if (event.code === 'KeyE') { interact(); return; }
  if (['Tab', 'KeyQ'].includes(event.code) && roomCombatReady()) {
    if (combat.openEquipmentWheel()) {
      triggerHeld = false;
      wheelPressedAt = performance.now();
      wheelChanged = false;
    }
    return;
  }
  if (event.code === 'KeyH' && roomCombatReady()) {
    combat.closeEquipmentWheel({ commit: false });
    selectEquipment(combat.selectedEquipment === 'unarmed'
      ? (currentInventory.guns.includes(combat.selectedWeapon)
        ? combat.selectedWeapon : currentInventory.guns[0]) : 'unarmed');
    return;
  }
  if (event.code === 'KeyC') {
    setPlayerStance(togglePlayerStance(player.stance, 'crouch'));
    return;
  }
  if (event.code === 'KeyZ') {
    setPlayerStance(togglePlayerStance(player.stance, 'prone'));
    return;
  }
  if (event.code === 'KeyR' && roomCombatReady()) { void reloadWeapon(); return; }
  if (['Digit1', 'Digit2', 'Digit3'].includes(event.code) && roomCombatReady()) {
    selectEquipment(currentInventory.guns[Number(event.code.at(-1)) - 1]); return;
  }
  if (event.code === 'Digit4' && roomCombatReady()) { selectEquipment('grenade'); return; }
  if (event.code === 'Digit5' && roomCombatReady()) { selectEquipment('mine'); return; }
  if (event.code === 'KeyF') { flashlightOn = !flashlightOn; flashlight.visible = flashlightOn; return; }
  if (event.code === 'KeyU') { toggleAudio(); return; }
  keys.add(event.code);
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
  if (['Tab', 'KeyQ'].includes(event.code)) {
    if (started && !menuOpen && !mapOpen && !event.repeat) event.preventDefault();
    if (combat.equipmentWheelOpen && !wheelChanged
      && performance.now() - wheelPressedAt < 200) combat.rotateEquipmentWheel(1);
    combat.closeEquipmentWheel({ commit: true });
    wheelPressedAt = -Infinity;
    wheelChanged = false;
  }
});
let mouseDragging = false;
let fallbackPointerStart = null;
window.addEventListener('blur', () => {
  releaseCombatInput();
  keys.clear(); touchControls.reset(); mouseDragging = false;
  voiceChat.setPushToTalk(false);
  void voiceChat.setMuted(true);
  fallbackPointerStart = null;
  combat.setAim(false);
  combat.closeEquipmentWheel({ commit: false });
});
const mouseCombatPolicy = (event) => ({
  canAim: roomCombatReady() && GUN_IDS.includes(combat.selectedEquipment),
  canFire: roomCombatReady() && (document.pointerLockElement === renderer.domElement
    || (pointerLockFallback && Boolean(event.buttons & 2))),
});
renderer.domElement.addEventListener('mousedown', (event) => {
  const policy = mouseCombatPolicy(event);
  if (event.button === 2 && policy.canAim) event.preventDefault();
  combatMouse.handleMouseDown(event, policy);
  if (!touchEnabled && event.button === 0) {
    mouseDragging = true;
    fallbackPointerStart = { x: event.clientX, y: event.clientY,
      moved: false, fired: policy.canFire };
  }
});
window.addEventListener('mouseup', (event) => {
  combatMouse.handleMouseUp(event, mouseCombatPolicy(event));
  if (event.button === 0
    && pointerLockFallback && fallbackPointerStart && !fallbackPointerStart.moved
    && !fallbackPointerStart.fired
    && Math.hypot(event.clientX - fallbackPointerStart.x,
      event.clientY - fallbackPointerStart.y) < 8 && roomCombatReady()) {
    activateSelectedEquipment();
  }
  if (event.button === 0) {
    mouseDragging = false;
    fallbackPointerStart = null;
  }
});
renderer.domElement.addEventListener('contextmenu', (event) => {
  if (roomCombatReady()) event.preventDefault();
});
let lastEquipmentWheelAt = -Infinity;
renderer.domElement.addEventListener('wheel', (event) => {
  if (!roomCombatReady()) return;
  event.preventDefault();
  const now = performance.now();
  if (now - lastEquipmentWheelAt < 100) return;
  lastEquipmentWheelAt = now;
  if (combat.equipmentWheelOpen) {
    combat.rotateEquipmentWheel(Math.sign(event.deltaY) || 1);
    wheelChanged = true;
  } else combat.cycleEquipment(Math.sign(event.deltaY) || 1);
}, { passive: false });
document.addEventListener('pointerlockerror', () => {
  if (started && !menuOpen && !mapOpen && !touchEnabled) {
    pointerLockFallback = true;
    showToast('MOUSE CAPTURE BLOCKED · DRAG TO LOOK OR CLICK GAME TO RETRY');
  }
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) pointerLockFallback = false;
  else combatMouse.reset();
});
window.addEventListener('pointercancel', (event) => {
  if (event.pointerType === 'mouse') combatMouse.reset();
});
document.addEventListener('visibilitychange', () => {
  nativeLifecycle?.setAppActive(!document.hidden);
  if (!document.hidden) return;
  releaseCombatInput();
  keys.clear();
  touchControls.reset();
  combat.setAim(false);
});
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement === renderer.domElement) onLook(event.movementX, event.movementY);
  else if (mouseDragging && (event.buttons & 1) && event.target === renderer.domElement) {
    if (fallbackPointerStart && Math.hypot(event.clientX - fallbackPointerStart.x,
      event.clientY - fallbackPointerStart.y) >= 8) fallbackPointerStart.moved = true;
    onLook(event.movementX, event.movementY);
  }
});
renderer.domElement.addEventListener('click', requestLook);
window.addEventListener('resize', () => {
  if (captureEnabled) { refreshTouchUi(); return; }
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, renderProfile.pixelRatioCap));
  renderer.setSize(innerWidth, innerHeight);
  refreshTouchUi();
});

function applyGameAudioMute() {
  const silent = muted || nativeAudioPaused || graphicsLost;
  sound.setMuted(silent);
  music.setMuted(silent);
  combat.setMuted(silent);
  hitAudio.setMuted(silent);
}

function releaseAllGameInput() {
  releaseCombatInput();
  keys.clear();
  touchControls.reset();
  mouseDragging = false;
  fallbackPointerStart = null;
  combat.setAim(false);
  combat.closeEquipmentWheel({ commit: false });
  combat.setState({ active: false });
  lastCombatVisible = false;
  document.exitPointerLock?.();
}

if (nativeAndroid) {
  nativeLifecycle = createNativeLifecycleController({
    getUiState: () => ({ started, menuOpen, mapOpen, wheelOpen: combat.equipmentWheelOpen }),
    onPause() {
      releaseAllGameInput();
      openMenu();
      if (mapOpen) closeMap();
      touchControls.setVisible(false);
      voiceChatUI.setGameplayActive(false);
      if (!nativeAudioPaused) nativeVoiceWasDeafened = voiceChat.getState().deafened;
      nativeAudioPaused = true;
      applyGameAudioMute();
      voiceChat.setPushToTalk(false);
      void voiceChat.setMuted(true);
      voiceChat.setDeafened(true);
      document.body.dataset.nativeAppState = 'background';
    },
    onForeground() {
      // Multiplayer may reconnect in the background. The Resume gesture still
      // controls local input/audio, and never turns the microphone back on.
      document.body.dataset.nativeAppState = 'paused';
      refreshTouchUi();
    },
    onResume() {
      nativeAudioPaused = false;
      applyGameAudioMute();
      voiceChat.setDeafened(nativeVoiceWasDeafened);
      void voiceChat.unlockAudio();
      if (started) { void sound.start(); void music.start(); }
      document.body.dataset.nativeAppState = 'active';
    },
    onBack(action) {
      document.body.dataset.nativeBackAction = action;
      if (action === 'wheel') combat.closeEquipmentWheel({ commit: false });
      else if (action === 'map') closeMap();
      else if (action === 'resume') closeMenu();
      else if (action === 'menu') openMenu();
    },
  });
  document.body.dataset.nativeAppState = 'active';
  document.body.dataset.nativeHost = 'connecting';
  void bindNativeAppLifecycle({ controller: nativeLifecycle }).then(() => {
    document.body.dataset.nativeHost = 'ready';
  }).catch((error) => {
    document.body.dataset.nativeHost = 'unavailable';
    document.body.dataset.nativeHostError = String(error?.message || 'Android host unavailable')
      .replace(/[\r\n]/g, ' ').slice(0, 240);
    console.warn('Android host controls could not be initialized:', error.message);
  });
}

// Android can reclaim the GPU when switching apps. Three restores its WebGL
// resources; keep controls paused until the player resumes, with a reload path
// if a driver cannot restore the context.
let graphicsRecovery = null;
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  graphicsLost = true;
  applyGameAudioMute();
  voiceChat.setPushToTalk(false);
  void voiceChat.setMuted(true);
  releaseAllGameInput();
  openMenu();
  if (mapOpen) closeMap();
  if (!graphicsRecovery) {
    graphicsRecovery = document.createElement('section');
    graphicsRecovery.className = 'graphics-recovery';
    graphicsRecovery.setAttribute('role', 'alert');
    const message = document.createElement('p');
    message.textContent = 'Graphics were interrupted. Waiting for the display to recover…';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'RELOAD ISLAND';
    reload.addEventListener('click', () => location.reload());
    graphicsRecovery.append(message, reload);
    document.body.append(graphicsRecovery);
  }
  graphicsRecovery.hidden = false;
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  graphicsLost = false;
  applyGameAudioMute();
  if (graphicsRecovery) graphicsRecovery.hidden = true;
  showToast('DISPLAY RESTORED · RESUME WHEN READY');
});

let showcaseRecording = null;
let lastFrame = performance.now();
let capturePerfSince = lastFrame;
let capturePerfFrames = 0;
let capturePerfUpdateMs = 0;
let capturePerfRenderMs = 0;
function frame(now) {
  const offlineFrame = showcaseRecording?.offlineActive === true;
  if (!offlineFrame) requestAnimationFrame(frame);
  const frameWorkStart = captureEnabled ? performance.now() : 0;
  const wallDt = Math.max((now - lastFrame) / 1000, 0);
  lastFrame = now;
  if (graphicsLost || (firstFrameRendered && nativeLifecycle?.getState().paused)) return;
  if (showcaseRecording?.offlineBusy) return;
  const dt = showcaseRecording?.offlineActive ? 1 / 30 : Math.min(wallDt, 0.05);
  cinematicCapture?.update(assetsReady && firstFrameRendered ? wallDt : 0);
  const showcaseShot = showcaseRecording?.tick(now);
  if (showcaseShot) {
    elapsed = showcaseShot.simulationSeconds;
    cinematicCapture.setView(showcaseShot.camera);
    climate = weatherClock.sample(showcaseShot.weatherSeconds, {
      weatherOverride: showcaseShot.weatherOverride,
      timeOverride: showcaseShot.timeOverride,
    });
  } else if (roomClock && multiplayer.getState().room) {
    elapsed = Math.max(0, (roomServerNow() - roomClock.startedAt) / 1000);
  } else elapsed += dt;
  const active = started && !menuOpen && !mapOpen;
  const roomState = multiplayer.getState();
  if (!roomState.room) {
    settleSoloReloads(now);
    settleSoloWildlife(now);
  }
  const playerControlsActive = active && !cinematicCapture?.active
    && (!roomState.room || roomState.connected) && !roomState.self?.dead
    && (roomState.room || soloHealth > 0);
  const inputDt = active ? dt : 0;
  ambientElapsed += inputDt;
  if (!showcaseShot && elapsed - climateSampleTime >= 0.05) {
    climate = weatherClock.sample(elapsed, {
      weatherOverride: weatherSelect.value, timeOverride: timeSelect.value,
    });
    if (debugRain !== null) climate.rain = debugRain;
    climateSampleTime = elapsed;
  }
  const weather = currentWeather();
  const controls = touchControls.input.snapshot();
  const qaRunning = Boolean(combatQa && now < qaRunUntil && !roomState.room);
  if (qaFireUntil && now >= qaFireUntil) { qaFireUntil = 0; triggerHeld = false; }
  const previousX = player.x;
  const previousZ = player.z;
  let movedOnFoot = 0;
  let movementState = locomotion.readState();
  const walkingActive = playerControlsActive && !driving.active && !drone.active
    && cliffFall.phase === 'grounded' && respawnFadeTime < 0 && !combat.equipmentWheelOpen;
  if (!walkingActive) {
    movementState = locomotion.step(dt, { active: false });
    triggerHeld = false;
  }

  if (active && cliffFall.phase !== 'grounded') {
    if (player.stance !== 'stand') {
      player.stance = 'stand';
      cameraEyeHeight = playerStance('stand').eyeHeight;
      combat.setState({ stance: 'stand' });
    }
    const tick = advanceCliffFall(cliffFall, dt, cliffWorld, canStandAt);
    cliffFall = tick.state;
    if (tick.event === 'impact') sound.playFallImpact();
    if (tick.event === 'respawn') {
      player.x = tick.respawn.x;
      player.z = tick.respawn.z;
      player.pitch = -0.05;
      respawnFadeTime = 0;
      keys.clear();
      touchControls.reset();
      releaseCombatInput();
      locomotion.reset({ refill: true });
      showToast('RETURNED TO SAFE GROUND');
      if (roomState.connected) {
        const recovered = { x: player.x, z: player.z,
          y: structures.playerGroundHeight(player.x, player.z) + CLIFF_FALL.eyeHeight };
        void multiplayer.request('player:recover', recovered)
          .catch((error) => console.warn('Room cliff recovery rejected:', error.message));
      }
    }
  }
  if (respawnFadeTime >= 0 && active) {
    respawnFadeTime += dt;
    if (respawnFadeTime > 0.9) respawnFadeTime = -1;
  }
  ambientTraffic.update(inputDt, {
    playerX: player.x, playerZ: player.z, playerVehicle: driving.active,
    weather, started,
  });
  if (playerControlsActive && cliffFall.phase === 'grounded' && respawnFadeTime < 0) {
    if (driving.active) {
      driving.update(dt, {
        throttle: clamp(Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + controls.throttle, -1, 1),
        steer: clamp(Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + controls.steer, -1, 1),
        brake: keys.has('Space') || controls.brake,
      }, canPlaceVehicle);
      player.x = driving.active.x;
      player.z = driving.active.z;
    } else if (drone.active) {
      drone.update(dt, {
        forward: clamp(Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + controls.forward, -1, 1),
        sideways: clamp(Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + controls.sideways, -1, 1),
        ascend: Number(keys.has('Space')) + controls.ascend,
        descend: Number(keys.has('ControlLeft') || keys.has('ControlRight')) + controls.descend,
        boost: keys.has('ShiftLeft') || keys.has('ShiftRight') || controls.boost,
      });
    } else if (walkingActive) {
      const forward = clamp(Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + controls.forward + Number(qaRunning), -1, 1);
      const side = clamp(Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + controls.sideways, -1, 1);
      const reloadTime = localAmmo?.[combat.selectedWeapon]?.reloadingUntil || 0;
      movementState = locomotion.step(dt, {
        active: walkingActive, forward, side, yaw: player.yaw, stance: player.stance,
        sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || controls.sprint || qaRunning,
        aiming: combat.aiming, reloading: reloadTime > (roomState.room ? roomServerNow() : now),
        firing: triggerHeld || now < nextLocalShotAt,
        weaponMultiplier: combat.selectedEquipment === 'unarmed' ? 1
          : WEAPONS[combat.selectedWeapon]?.movementMultiplier ?? 1,
        groundHeight: structures.playerGroundHeight, x: player.x, z: player.z,
      }, (dx, dz) => {
        const fromX = player.x, fromZ = player.z;
        tryPlayerStep(player.x + dx, player.z);
        if (cliffFall.phase === 'grounded') tryPlayerStep(player.x, player.z + dz);
        return { dx: player.x - fromX, dz: player.z - fromZ };
      });
      movedOnFoot = Math.hypot(player.x - previousX, player.z - previousZ);
      if (movedOnFoot) player.walkPhase += movedOnFoot
        * (player.stance === 'stand' ? 2.9 : player.stance === 'crouch' ? 3.5 : 4);
    }
  }
  if (roomState.room) {
    driving.updateRemoteVehicles(dt);
    if (roomState.connected && driving.active && !vehicleSendPending
      && now - lastVehicleSend >= 100) {
      lastVehicleSend = now;
      vehicleSendPending = true;
      const vehicle = driving.active;
      void multiplayer.request('vehicle:state', { id: vehicle.id, x: vehicle.x,
        z: vehicle.z, heading: vehicle.heading, speed: vehicle.speed })
        .catch((error) => console.warn('Vehicle sync rejected:', error.message))
        .finally(() => { vehicleSendPending = false; });
    }
  }
  if (active && !driving.active && !drone.active && cliffFall.phase === 'grounded'
    && (!cliffFall.lastSafe || Math.hypot(player.x - cliffFall.lastSafe.x,
      player.z - cliffFall.lastSafe.z) > 2)) {
    cliffFall = rememberSafeGround(cliffFall, { x: player.x, z: player.z },
      cliffWorld, canStandAt);
  }

  const sheltered = !cinematicCapture?.active && !drone.active && isRoofed(player.x, player.z);
  footstepDistance += movedOnFoot;
  const stride = player.stance === 'prone' ? 0.8 : player.stance === 'crouch' ? 1.2
    : movementState.sprinting ? 2.1 : 1.65;
  if (footstepDistance >= stride && cliffFall.phase === 'grounded') {
    footstepDistance %= stride;
    sound.playFootstep(sheltered || structures.onSouthPier(player.x, player.z) ? 'floor' : 'wet ground');
  }
  if (cinematicCapture?.active) {
    cinematicCapture.applyToCamera();
  } else if (!started) {
    camera.position.set(180 + Math.sin(elapsed * 0.08) * 3, 58, 470);
    camera.lookAt(50, 30, 240);
  } else if (cliffFall.phase !== 'grounded') {
    const pose = cliffFallPresentation(cliffFall);
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.set(clamp(player.pitch + pose.pitchOffset, -1.45, 1.45), player.yaw, 0);
  } else if (driving.active) {
    const pose = driving.cameraPose();
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  } else if (drone.active) {
    drone.applyToCamera(camera);
  } else {
    const desiredEyeHeight = playerStance(player.stance).eyeHeight;
    cameraEyeHeight += (desiredEyeHeight - cameraEyeHeight)
      * Math.min(1, dt * 10);
    const walking = movedOnFoot > 0.001;
    const bob = walking ? Math.sin(player.walkPhase) * (player.stance === 'stand'
      ? 0.025 + movementState.sprintFactor * 0.013 : player.stance === 'crouch' ? 0.014 : 0.006)
      * (combat.aiming ? 0.25 : 1) : 0;
    camera.position.set(player.x,
      structures.playerGroundHeight(player.x, player.z) + cameraEyeHeight + bob,
      player.z);
    orientFirstPersonCamera(camera, player.yaw, player.pitch);
  }
  if (!cinematicCapture?.active) {
    const desiredFov = 72 + (walkingActive ? movementState.sprintFactor * 3 : 0)
      - (walkingActive && combat.aiming ? 8 : 0);
    const nextFov = camera.fov + (desiredFov - camera.fov) * (1 - Math.exp(-dt * 8));
    if (Math.abs(nextFov - camera.fov) > 0.001) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
  }
  $('stamina-hud').hidden = !walkingActive || (movementState.stamina >= 99.5 && !movementState.sprinting);
  $('stamina-fill').style.width = `${movementState.stamina}%`;
  $('stamina-hud').classList.toggle('exhausted', movementState.exhausted);
  $('stamina-label').textContent = movementState.exhausted ? 'RECOVERING' : 'STAMINA';
  $('stamina-meter').setAttribute('aria-valuenow', String(Math.round(movementState.stamina)));

  if (roomState.room && started) {
    const pose = drone.active ? drone.pose() : null;
    multiplayer.sendPlayerState({ x: pose?.x ?? player.x,
      y: pose?.y ?? (driving.active ? camera.position.y
        : structures.playerGroundHeight(player.x, player.z)
          + playerStance(player.stance).eyeHeight), z: pose?.z ?? player.z,
      yaw: pose?.yaw ?? (driving.active?.heading ?? player.yaw),
      pitch: pose?.pitch ?? player.pitch,
      mode: drone.active ? 'drone' : driving.active ? 'drive' : 'walk',
      stance: player.stance,
      vehicleId: driving.active?.id || null });
  }
  if (roomState.room) remotePlayers.update(now, dt, camera);
  const combatVisible = Boolean(started && !menuOpen && !mapOpen
    && !cinematicCapture?.active && (!roomState.room || roomState.connected));
  voiceChatUI.setGameplayActive(Boolean(started && !menuOpen && !mapOpen
    && !cinematicCapture?.active));
  const combatHolstered = Boolean(driving.active || drone.active
    || cliffFall.phase !== 'grounded');
  if (combatVisible !== lastCombatVisible || combatHolstered !== lastCombatHolstered) {
    combat.setState({ active: combatVisible, holstered: combatHolstered });
    lastCombatVisible = combatVisible;
    lastCombatHolstered = combatHolstered;
  }
  if (triggerHeld && roomCombatReady() && WEAPONS[combat.selectedEquipment]?.automatic) void fireWeapon();
  combat.update(dt, { moving: movedOnFoot > 0.001, speed: movementState.speed,
    sprintFactor: movementState.sprintFactor,
    wind: { x: Math.sin(climate.windDirection) * climate.windSpeed,
      z: Math.cos(climate.windDirection) * climate.windSpeed } });

  if (cliffFall.phase !== 'grounded') {
    fallPresentation.update(dt, { phase: cliffFall.phase === 'impact' ? 'impact' : 'falling',
      progress: cliffFall.phase === 'impact' ? cliffFall.phaseTime / CLIFF_FALL.impactSeconds
        : cliffFall.phaseTime / fallExpectedSeconds });
  } else if (respawnFadeTime >= 0) {
    fallPresentation.update(dt, { phase: 'respawn', progress: respawnFadeTime / 0.9 });
  } else fallPresentation.reset();

  const selfDead = roomState.room ? roomState.self?.dead : soloHealth <= 0;
  if (selfDead && !cinematicCapture?.active && cliffFall.phase === 'grounded') {
    downedTime = (downedTime ?? 0) + (active ? dt : 0);
    const pose = playerDownedPose(downedTime, cameraEyeHeight);
    camera.position.y = Math.max(structures.playerGroundHeight(player.x, player.z) + 0.26,
      camera.position.y - pose.drop);
    camera.rotation.x += pose.pitch;
    camera.rotation.z = pose.roll;
  } else if (!selfDead) downedTime = null;
  if (combatQa) {
    $('combat-qa-state').textContent = JSON.stringify({ weapon: combat.selectedEquipment,
      ammo: localAmmo[combat.selectedWeapon], ...movementState,
      smoke: combat.activeSmokeCount, reload: combat.reloadProgress,
      pending: ammoPrediction.pendingCount, aiming: combat.aiming,
      health: soloHealth, armor: soloArmor, downedTime,
      cameraY: camera.position.y, x: player.x, z: player.z });
    combatQa.dataset.audio = JSON.stringify(combat.audioState);
    combatQa.dataset.hitAudio = JSON.stringify(hitAudio.getState());
  }

  structures.update(elapsed);
  world.setIndoor(sheltered);
  const thunder = world.update(dt, elapsed, weather, climate,
    cinematicCapture?.active ? cinematicCapture.state() : null);
  islandLamps.update(dt, elapsed, { ...climate, wetness: world.groundWetness }, camera);
  if (waterQaView === 'night_lamps') {
    renderer.domElement.dataset.lamps = JSON.stringify(islandLamps.getState());
  }
  lighthouseGlare.update(camera, world.lighthouseBeacons,
    started && !menuOpen && !mapOpen);
  windSpray.update(dt, elapsed, weather, { indoors: sheltered,
    wind: { direction: climate.windDirection,
      strength: clamp(climate.windSpeed / 18, 0, 1.5) } });
  seaLife.update(elapsed, weather);
  scenicBoats.update(elapsed, weather);
  harborProps.update(camera, elapsed, climate.rain);
  fireAtmosphere.update(elapsed, { weather, cameraPosition: camera.position });
  prisonPopulation.update(ambientElapsed, { weather, camera,
    shadowLight: world.shadowLight, playerX: player.x, playerZ: player.z,
    dt: inputDt });
  residents.update(ambientElapsed, { dt: inputDt, cameraX: camera.position.x,
    cameraZ: camera.position.z, playerX: player.x, playerZ: player.z,
    windDirection: climate.windDirection, windSpeed: climate.windSpeed });
  const faunaCue = fauna.update(inputDt, roomState.room ? elapsed : ambientElapsed, weather,
    { playerX: camera.position.x, playerZ: camera.position.z,
      indoors: sheltered, multiplayer: Boolean(roomState.room) });
  updateSoloNpcCombat(now);
  updateSoloExplosives(now);
  lootWorld.update(dt, elapsed, camera);
  rainEffects.update(dt, elapsed, climate, { indoors: sheltered });
  wetWindows.update(dt, climate);
  pumpInterior.update(dt, { generatorOn: true, pumpOn: true }, 0.2);
  if (thunder) sound.playThunder(world.thunderPan);
  const near = nearestSite(player.x, player.z);
  const passingCar = ambientTraffic.nearbyVehicle(camera.position.x, camera.position.z, 72);
  sound.setVehicleEngine(Boolean(driving.active || passingCar),
    driving.active ? Math.min(1, Math.abs(driving.active.speed) / 14)
      : passingCar ? Math.min(1, Math.abs(passingCar.speed) / 10) : 0,
    driving.active ? 1 : passingCar ? Math.max(0, 1 - passingCar.distance / 72) * 0.55 : 0);
  sound.update(dt, { wind: clamp(climate.windSpeed / 20, 0, 1),
    rain: climate.rain, storm: weather === 'storm' ? 1 : 0.2 * climate.rain },
  { id: world.isLake(camera.position.x, camera.position.z, 32)
    ? 'lake' : near.site?.id || 'shore', indoors: sheltered });
  if (faunaCue.birdCalls) sound.playBirdCall(faunaCue.nearestBirdDistance);
  music.update(dt, { weather, indoors: sheltered, dialogue: menuOpen || mapOpen });

  $('weather-label').textContent = `${weather.toUpperCase()} · ${climate.timeLabel} · ${Math.round(climate.windSpeed)} M/S`;
  const placeName = near.distance < 55 ? near.site.name.toUpperCase() : 'ISLAND WILDS';
  $('place-label').textContent = placeName;
  if (started && !menuOpen && near.distance < 24 && near.site.id !== lastPlaceId) {
    lastPlaceId = near.site.id;
    showToast(placeName);
  }
  $('vehicle-hud').hidden = !driving.active;
  if (driving.active) $('vehicle-hud').textContent = `${driving.active.type.toUpperCase()} · ${Math.round(Math.abs(driving.active.speed) * 3.6)} KM/H`;
  $('drone-hud').hidden = !drone.active;
  if (drone.active) $('drone-altitude').textContent = `${Math.round(camera.position.y - world.waterHeight(camera.position.x, camera.position.z))} M ABOVE SEA`;
  const stanceHud = $('stance-hud');
  stanceHud.hidden = !started || menuOpen || mapOpen || driving.active || drone.active
    || player.stance === 'stand';
  const stanceText = player.stance === 'crouch' ? 'CROUCHING · C TO STAND'
    : 'PRONE · Z TO STAND';
  if (!stanceHud.hidden && stanceHud.textContent !== stanceText) {
    stanceHud.textContent = stanceText;
  }
  const nearby = !driving.active && !drone.active ? nearbyInteraction() : null;
  $('interaction').hidden = !started || menuOpen || mapOpen || drone.active
    || roomState.self?.dead || (!roomState.room && soloHealth <= 0)
    || (!driving.active && !nearby);
  if (driving.active) $('interaction').textContent = 'E · EXIT VEHICLE';
  else if (nearby?.kind === 'vehicle') $('interaction').textContent = `E · DRIVE ${nearby.vehicle.type.toUpperCase()}`;
  else if (nearby?.kind === 'loot') $('interaction').textContent = `E · PICK UP ${nearby.item.label.toUpperCase()}`;
  else if (nearby?.person) $('interaction').textContent = `E · TALK TO ${nearby.person.name.toUpperCase()} · ${nearby.person.role.toUpperCase()}`;
  if (touchEnabled && started && !menuOpen && !mapOpen) refreshTouchUi();
  if (!$('toast').hidden && now >= toastUntil) $('toast').hidden = true;
  const renderStart = captureEnabled ? performance.now() : 0;
  renderer.render(scene, camera);
  if (offlineFrame) {
    // rAF can be compositor-throttled to ~1 Hz in a capture tab despite a
    // visible WebGL canvas. Frame stepping waits for the exact encoded frame,
    // then schedules the next render without advancing during encoder work.
    void showcaseRecording.afterRender().finally(() => {
      if (showcaseRecording?.offlineActive) {
        setTimeout(() => frame(performance.now()), 0);
      } else requestAnimationFrame(frame);
    });
  } else void showcaseRecording?.afterRender();
  if (captureEnabled) {
    capturePerfFrames += 1;
    capturePerfUpdateMs += renderStart - frameWorkStart;
    capturePerfRenderMs += performance.now() - renderStart;
    if (now - capturePerfSince >= 5000) {
      window.__ISLAND_WORLD_PERF__ = Object.freeze({
        fps: capturePerfFrames * 1000 / (now - capturePerfSince),
        updateMs: capturePerfUpdateMs / capturePerfFrames,
        renderMs: capturePerfRenderMs / capturePerfFrames,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        canvasWidth: renderer.domElement.width,
        canvasHeight: renderer.domElement.height,
        visibility: document.visibilityState,
        focus: document.hasFocus(),
      });
      document.body.dataset.capturePerf = JSON.stringify(window.__ISLAND_WORLD_PERF__);
      capturePerfSince = now;
      capturePerfFrames = 0;
      capturePerfUpdateMs = 0;
      capturePerfRenderMs = 0;
    }
  }
  if (!firstFrameRendered) { firstFrameRendered = true; hideLoadingIfReady(); }
  if (captureRequest === 'showcase' && assetsReady && !showcaseRecording) {
    showcaseRecording = createShowcaseRecording({
      canvas: renderer.domElement,
      prepare(shot) {
        cinematicCapture.setView(shot.camera);
        climate = weatherClock.sample(shot.weatherSeconds, {
          weatherOverride: shot.weatherOverride, timeOverride: shot.timeOverride,
        });
      },
      start: closeMenu,
      interact,
    });
  }
  if (captureRequest === 'orbit' && assetsReady && !cinematicCapture.active && !started) {
    window.__ISLAND_WORLD_CAPTURE__.startOrbit();
  }
}
requestAnimationFrame(frame);

// Read-only diagnostics for local browser checks.
window.__ISLAND_WORLD__ = Object.freeze({
  get state() { return { started, menuOpen, mapOpen, weather: currentWeather(),
    time: climate.timeLabel, windSpeed: climate.windSpeed, rain: climate.rain,
    x: player.x, z: player.z, driving: Boolean(driving.active), drone: drone.active,
    falling: cliffFall.phase !== 'grounded',
    residentCount: residents.people.length,
    residentLoaded: residents.people.filter((person) => person.root).length }; },
  get scene() { return scene; },
  get world() { return world; },
  get residents() { return residents.people.map(({ id, x, z, root }) => ({
    id, x, z, loaded: Boolean(root), visible: Boolean(root?.visible),
  })); },
});

if (cinematicCapture) {
  function prepareCapture() {
    if (mapOpen) closeMap();
    if (menuOpen) closeMenu();
    keys.clear();
    touchControls.reset();
    document.exitPointerLock?.();
  }

  function setCaptureResolution(width = 1920, height = 1080) {
    const pixelWidth = Math.round(Number(width));
    const pixelHeight = Math.round(Number(height));
    if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight)
      || pixelWidth < 640 || pixelHeight < 360
      || pixelWidth > 3840 || pixelHeight > 2160) {
      throw new RangeError('Capture resolution must be between 640×360 and 3840×2160.');
    }
    renderer.setPixelRatio(1);
    renderer.setSize(pixelWidth, pixelHeight, false);
    camera.aspect = pixelWidth / pixelHeight;
    camera.updateProjectionMatrix();
    return { width: renderer.domElement.width, height: renderer.domElement.height };
  }

  // Available only with ?capture=1 (or ?capture=orbit / ?capture=showcase).
  // Screen recorders can capture this canvas at its actual 1920×1080 buffer size.
  window.__ISLAND_WORLD_CAPTURE__ = Object.freeze({
    get canvas() { return renderer.domElement; },
    get ready() { return assetsReady && firstFrameRendered; },
    get state() { return { ...cinematicCapture.state(),
      canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height }; },
    setResolution: setCaptureResolution,
    startOrbit(options) {
      prepareCapture();
      return cinematicCapture.startOrbit(options);
    },
    seekOrbit(seconds) { return cinematicCapture.seekOrbit(seconds); },
    setView(view) {
      prepareCapture();
      return cinematicCapture.setView(view);
    },
    stop() { return cinematicCapture.stop(); },
    setWeather(mode) {
      if (!['auto', 'clear', 'mist', 'rain', 'storm'].includes(mode)) return false;
      weatherSelect.value = mode;
      return true;
    },
    setTime(mode) {
      if (!['auto', 'dawn', 'noon', 'dusk', 'night'].includes(mode)) return false;
      timeSelect.value = mode;
      return true;
    },
  });
}
