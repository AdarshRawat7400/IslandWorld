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
import { createPumpInterior } from './pumpInterior.js';
import { createFauna } from './fauna.js';
import { createScenicBoats } from './scenicBoats.js';
import { createSeaLife } from './seaLife.js';
import { createFireAtmosphere } from './fireAtmosphere.js';
import { createWindSpray } from './windSpray.js';
import { createRainEffects } from './rainEffects.js';
import { addWetWindows } from './wetWindows.js';
import { createAudio } from './audio.js';
import { createMusic, DEFAULT_MUSIC_VOLUME } from './music.js';
import { createDroneView } from './droneView.js';
import { createTouchControls } from './touchControls.js';
import { orientFirstPersonCamera } from './firstPersonCamera.js';
import { createLighthouseGlare } from './lighthouseGlare.js';
import { useTouchControls } from './inputMode.js';
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
import './style.css';

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const siteById = Object.fromEntries(SITES.map((site) => [site.id, site]));
const keys = new Set();
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
camera.rotation.order = 'YXZ';
scene.add(camera);
const renderProfile = selectRenderProfile(detectRenderEnvironment());
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, renderProfile.pixelRatioCap));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);

const world = createWorld(scene, camera, { renderProfile });
const lighthouseGlare = createLighthouseGlare($('lighthouse-glare'), world.terrainHeight);
const structures = createEnvironmentStructures(scene, world);
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
    || harborProps.collides(x, z, radius),
});
const sound = createAudio();
const music = createMusic();
let ambientTraffic = null;
let residents = null;

const player = { x: 0, z: 270, yaw: 0, pitch: -0.05, walkPhase: 0 };
// Development-only viewpoints for water and shoreline-detail rendering QA.
const waterQaView = import.meta.env.DEV ? new URLSearchParams(location.search).get('test') : null;
if (waterQaView === 'lake') {
  Object.assign(player, { x: INLAND_LAKE.x, z: INLAND_LAKE.z + INLAND_LAKE.radiusZ + 17,
    yaw: 0, pitch: -0.08 });
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
} else if (waterQaView === 'offshore_north') {
  Object.assign(player, { x: -65, z: -315, yaw: -0.28, pitch: -0.03 });
} else if (waterQaView === 'offshore_southwest') {
  Object.assign(player, { x: -305, z: 135, yaw: 2.24, pitch: -0.06 });
}
let started = false;
let menuOpen = true;
let mapOpen = false;
let muted = false;
let flashlightOn = false;
let elapsed = 0;
let ambientElapsed = 0;
let footstepDistance = 0;
let respawnFadeTime = -1;
let fallExpectedSeconds = 1.8;
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
  storeSettings();
  showToast(weatherSelect.value === 'auto' ? 'CHANGING WEATHER' : weatherSelect.selectedOptions[0].textContent.toUpperCase());
});
timeSelect.addEventListener('change', () => {
  storeSettings();
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
  if (!started || menuOpen || mapOpen || touchEnabled) return;
  // Browsers may reject the request if the tab loses focus during navigation.
  // Clicking the canvas again remains a valid retry after that transient case.
  const capture = renderer.domElement.requestPointerLock;
  if (!capture) {
    showToast('HOLD LEFT CLICK AND DRAG TO LOOK');
    return;
  }
  try {
    const request = capture.call(renderer.domElement);
    request?.catch?.(() => showToast('MOUSE CAPTURE BLOCKED · DRAG TO LOOK OR CLICK GAME TO RETRY'));
  } catch {
    showToast('MOUSE CAPTURE BLOCKED · DRAG TO LOOK OR CLICK GAME TO RETRY');
  }
}
function openMenu() {
  if (!started) return;
  menuOpen = true;
  keys.clear();
  document.exitPointerLock?.();
  $('screen').hidden = false;
  $('start-button').innerHTML = 'RESUME EXPLORING <span>→</span>';
  touchControls.setVisible(false);
}
function closeMenu() {
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
  if (!started || menuOpen || mapOpen || driving.active || cliffFall.phase !== 'grounded') return;
  if (drone.active) { drone.exit(); showToast('ON FOOT'); }
  else if (drone.enter({ x: player.x, z: player.z,
    y: structures.playerGroundHeight(player.x, player.z) + CLIFF_FALL.eyeHeight,
    yaw: player.yaw, pitch: player.pitch })) showToast('DRONE VIEW');
  keys.clear();
  touchControls.reset();
  refreshTouchUi();
}
function toggleAudio() {
  muted = !muted;
  sound.setMuted(muted);
  music.setMuted(muted);
  showToast(muted ? 'AUDIO OFF' : 'AUDIO ON');
}
function nearbyInteraction() {
  if (drone.active) return null;
  const vehicle = driving.nearbyVehicle(player.x, player.z, 4.4);
  const islander = residents.nearestPerson(player.x, player.z);
  const prison = prisonPopulation.nearestPerson(player.x, player.z);
  const person = [islander && { kind: 'resident', person: islander, distance: islander.distance },
    prison && { kind: 'prison', person: prison, distance: prison.distance }]
    .filter(Boolean).sort((a, b) => a.distance - b.distance)[0];
  // A closer vehicle keeps its established E action when someone stands by it.
  if (vehicle && (!person || vehicle.distance <= person.distance + 0.35)) {
    return { kind: 'vehicle', vehicle: vehicle.vehicle, distance: vehicle.distance };
  }
  return person || null;
}
function interact() {
  if (!started || menuOpen || mapOpen || drone.active || cliffFall.phase !== 'grounded') return;
  if (driving.active) {
    const exited = driving.exit((x, z) => world.isWalkable(x, z) && canStandAt(x, z));
    if (!exited) { showToast('STOP THE CAR TO EXIT'); return; }
    player.x = exited.x;
    player.z = exited.z;
    player.yaw = exited.yaw;
    showToast('ON FOOT');
  } else {
    const nearby = nearbyInteraction();
    if (nearby?.kind === 'vehicle') {
      if (driving.enter(nearby.vehicle.id)) {
        player.x = nearby.vehicle.x;
        player.z = nearby.vehicle.z;
        showToast('DRIVING · W/S PEDALS · A/D STEER · SPACE BRAKE · E EXIT');
      }
    } else if (nearby?.person) {
      const line = currentWeather() === 'storm' && nearby.person.stormLine
        ? nearby.person.stormLine : nearby.person.line;
      showToast(`${nearby.person.name.toUpperCase()} · ${line}`, 5200);
    }
  }
  refreshTouchUi();
}

function onLook(dx, dy) {
  if (!started || menuOpen || mapOpen || driving.active || cliffFall.phase !== 'grounded') return;
  if (drone.active) { drone.look(dx, dy); return; }
  player.yaw -= dx * 0.0021;
  player.pitch = clamp(player.pitch - dy * 0.0021, -1.45, 1.45);
}
const touchEnabled = useTouchControls({
  primaryCoarse: window.matchMedia('(pointer: coarse)').matches,
  anyFine: window.matchMedia('(any-pointer: fine)').matches,
});
const touchControls = createTouchControls($('touch-controls'), {
  onLook,
  onAction(action) {
    if (action === 'menu') openMenu();
    else if (action === 'map') mapOpen ? closeMap() : openMap();
    else if (action === 'interact') drone.active ? toggleDrone() : interact();
    else if (action === 'drone') toggleDrone();
    else if (action === 'light') { flashlightOn = !flashlightOn; flashlight.visible = flashlightOn; }
    else if (action === 'audio') toggleAudio();
  },
});
function refreshTouchUi() {
  const landscape = innerWidth >= innerHeight;
  $('touch-rotate').hidden = !touchEnabled || landscape || !started;
  touchControls.setVisible(touchEnabled && landscape && started && !menuOpen && !mapOpen);
  if (!touchEnabled) return;
  const mode = drone.active ? 'drone' : driving.active ? 'driving' : 'walking';
  touchControls.setMode(mode);
  const nearby = !drone.active && !driving.active ? nearbyInteraction() : null;
  touchControls.setAction(drone.active ? 'EXIT DRONE' : driving.active ? 'EXIT CAR'
    : nearby?.kind === 'vehicle' ? 'DRIVE' : nearby?.person ? 'TALK' : 'USE',
  drone.active || driving.active || Boolean(nearby));
  $('touch-drone-toggle').textContent = drone.active ? 'EXIT DRONE' : 'DRONE';
}

window.addEventListener('keydown', (event) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)
    && started && !menuOpen) event.preventDefault();
  if (event.code === 'Escape') {
    if (mapOpen) closeMap();
    else if (menuOpen && started) closeMenu();
    else openMenu();
    return;
  }
  if (menuOpen || !started || mapOpen || event.repeat) return;
  if (event.code === 'KeyM') { openMap(); return; }
  if (event.code === 'KeyG') { toggleDrone(); return; }
  if (event.code === 'KeyE') { interact(); return; }
  if (event.code === 'KeyF') { flashlightOn = !flashlightOn; flashlight.visible = flashlightOn; return; }
  if (event.code === 'KeyU') { toggleAudio(); return; }
  keys.add(event.code);
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
let mouseDragging = false;
window.addEventListener('blur', () => {
  keys.clear(); touchControls.reset(); mouseDragging = false;
});
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (!touchEnabled && event.pointerType === 'mouse' && event.button === 0) {
    mouseDragging = true;
  }
});
window.addEventListener('pointerup', () => { mouseDragging = false; });
document.addEventListener('pointerlockerror', () => {
  if (started && !menuOpen && !mapOpen && !touchEnabled) {
    showToast('MOUSE CAPTURE BLOCKED · DRAG TO LOOK OR CLICK GAME TO RETRY');
  }
});
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement === renderer.domElement) onLook(event.movementX, event.movementY);
  else if (mouseDragging && (event.buttons & 1) && event.target === renderer.domElement) {
    onLook(event.movementX, event.movementY);
  }
});
renderer.domElement.addEventListener('click', requestLook);
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, renderProfile.pixelRatioCap));
  renderer.setSize(innerWidth, innerHeight);
  refreshTouchUi();
});

let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(Math.max((now - lastFrame) / 1000, 0), 0.05);
  lastFrame = now;
  elapsed += dt;
  const active = started && !menuOpen && !mapOpen;
  const inputDt = active ? dt : 0;
  ambientElapsed += inputDt;
  if (elapsed - climateSampleTime >= 0.05) {
    climate = weatherClock.sample(elapsed, {
      weatherOverride: weatherSelect.value, timeOverride: timeSelect.value,
    });
    if (debugRain !== null) climate.rain = debugRain;
    climateSampleTime = elapsed;
  }
  const weather = currentWeather();
  const controls = touchControls.input.snapshot();
  const previousX = player.x;
  const previousZ = player.z;

  if (active && cliffFall.phase !== 'grounded') {
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
      showToast('RETURNED TO SAFE GROUND');
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
  if (active && cliffFall.phase === 'grounded' && respawnFadeTime < 0) {
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
    } else {
      const forward = clamp(Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + controls.forward, -1, 1);
      const side = clamp(Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + controls.sideways, -1, 1);
      const magnitude = Math.hypot(forward, side);
      if (magnitude > 0) {
        const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 7.3 : 4.6;
        const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
        const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
        const vx = (fx * forward + rx * side) / magnitude;
        const vz = (fz * forward + rz * side) / magnitude;
        tryPlayerStep(player.x + vx * speed * dt, player.z);
        if (cliffFall.phase === 'grounded') tryPlayerStep(player.x, player.z + vz * speed * dt);
        player.walkPhase += dt * (speed > 5 ? 11 : 8);
      }
    }
  }
  if (active && !driving.active && !drone.active && cliffFall.phase === 'grounded'
    && (!cliffFall.lastSafe || Math.hypot(player.x - cliffFall.lastSafe.x,
      player.z - cliffFall.lastSafe.z) > 2)) {
    cliffFall = rememberSafeGround(cliffFall, { x: player.x, z: player.z },
      cliffWorld, canStandAt);
  }

  const sheltered = !drone.active && isRoofed(player.x, player.z);
  footstepDistance += driving.active || drone.active ? 0 : Math.hypot(player.x - previousX, player.z - previousZ);
  if (footstepDistance > 2.25) {
    footstepDistance -= 2.25;
    sound.playFootstep(sheltered || structures.onSouthPier(player.x, player.z) ? 'floor' : 'wet ground');
  }
  if (!started) {
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
    const walking = inputDt > 0 && Math.hypot(player.x - previousX, player.z - previousZ) > 0.001;
    const bob = walking ? Math.sin(player.walkPhase) * 0.035 : 0;
    camera.position.set(player.x,
      structures.playerGroundHeight(player.x, player.z) + CLIFF_FALL.eyeHeight + bob,
      player.z);
    orientFirstPersonCamera(camera, player.yaw, player.pitch);
  }

  if (cliffFall.phase !== 'grounded') {
    fallPresentation.update(dt, { phase: cliffFall.phase === 'impact' ? 'impact' : 'falling',
      progress: cliffFall.phase === 'impact' ? cliffFall.phaseTime / CLIFF_FALL.impactSeconds
        : cliffFall.phaseTime / fallExpectedSeconds });
  } else if (respawnFadeTime >= 0) {
    fallPresentation.update(dt, { phase: 'respawn', progress: respawnFadeTime / 0.9 });
  } else fallPresentation.reset();

  structures.update(elapsed);
  world.setIndoor(sheltered);
  const thunder = world.update(dt, elapsed, weather, climate);
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
    shadowLight: world.shadowLight });
  residents.update(ambientElapsed, { dt: inputDt, cameraX: camera.position.x,
    cameraZ: camera.position.z, playerX: player.x, playerZ: player.z,
    windDirection: climate.windDirection, windSpeed: climate.windSpeed });
  const faunaCue = fauna.update(inputDt, ambientElapsed, weather,
    { playerX: camera.position.x, playerZ: camera.position.z, indoors: sheltered });
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
  const nearby = !driving.active && !drone.active ? nearbyInteraction() : null;
  $('interaction').hidden = !started || menuOpen || mapOpen || drone.active
    || (!driving.active && !nearby);
  if (driving.active) $('interaction').textContent = 'E · EXIT VEHICLE';
  else if (nearby?.kind === 'vehicle') $('interaction').textContent = `E · DRIVE ${nearby.vehicle.type.toUpperCase()}`;
  else if (nearby?.person) $('interaction').textContent = `E · TALK TO ${nearby.person.name.toUpperCase()} · ${nearby.person.role.toUpperCase()}`;
  if (touchEnabled && started && !menuOpen && !mapOpen) refreshTouchUi();
  if (!$('toast').hidden && now >= toastUntil) $('toast').hidden = true;
  renderer.render(scene, camera);
  if (!firstFrameRendered) { firstFrameRendered = true; hideLoadingIfReady(); }
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
