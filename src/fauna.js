import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { islandCoastalRadiusAt, islandTerrainHeightAt } from './world.js';
import { isRoad } from './roads.js';
import { isLake } from './inlandLake.js';

// Original, low-poly coastal wildlife. All forms and markings are generated here;
// no external models, textures, audio, or animation data are needed.
const BIRD_FLOCKS = Object.freeze([
  { x: 48, z: 280, y: 47, radius: 23 },
  { x: -270, z: 100, y: 65, radius: 30 },
  { x: -125, z: -280, y: 63, radius: 34 },
  { x: 270, z: -130, y: 66, radius: 28 },
  { x: 205, z: 200, y: 61, radius: 28 },
  { x: -205, z: 220, y: 64, radius: 27 },
  { x: 0, z: -280, y: 61, radius: 33 },
  { x: -280, z: -100, y: 66, radius: 29 },
  { x: 145, z: 5, y: 66, radius: 25 },
  { x: -130, z: 0, y: 77, radius: 24 },
  { x: 75, z: -125, y: 71, radius: 27 },
  { x: -55, z: 290, y: 56, radius: 25 },
]);

const SHEEP_CANDIDATES = Object.freeze([
  [-214, 105], [-225, 95], [-218, 118], [-238, 112],
  [187, -118], [183, -136],
]);

const RABBIT_CANDIDATES = Object.freeze([
  [-154, 115], [-180, 93], [171, 145], [174, 155],
]);

export const WILDLIFE_POPULATION = Object.freeze({ birds: 120, sheep: 52, rabbits: 78 });
const BIRD_COUNT = WILDLIFE_POPULATION.birds;
const STORM_BIRD_COUNT = BIRD_FLOCKS.length * 3;
const LAKE_BANK_CLEARANCE = 5;
const VISUAL_RANGE = Object.freeze({ bird: 250, sheep: 170, rabbit: 135 });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export const WILDLIFE_KINDS = Object.freeze({
  bird: Object.freeze({ radius: 0.6, maxHealth: 20, respawnMs: 90000 }),
  sheep: Object.freeze({ radius: 0.92, maxHealth: 55, respawnMs: 90000 }),
  rabbit: Object.freeze({ radius: 0.48, maxHealth: 20, respawnMs: 90000 }),
});

function safeWander(home, proposedX, proposedZ, radius, options) {
  const terrainHeight = options.terrainHeight;
  if (options.multiplayer) {
    const y = typeof terrainHeight === 'function'
      ? terrainHeight(proposedX, proposedZ) : home.y;
    // Shared room paths are intentionally independent of client-only foliage,
    // props and nearby players. Every room client sees the same animal route.
    return Number.isFinite(y) && y >= 18
      ? { x: proposedX, y, z: proposedZ } : home;
  }
  if (typeof terrainHeight !== 'function') {
    return { x: proposedX, y: home.y, z: proposedZ };
  }
  const cameraX = finite(options.playerX, Infinity);
  const cameraZ = finite(options.playerZ, Infinity);
  if (Number.isFinite(cameraX) && Number.isFinite(cameraZ)
    && Math.hypot(home.x - cameraX, home.z - cameraZ) > VISUAL_RANGE.sheep + 25) {
    // Far-off animals need neither road/obstacle queries nor animated wander.
    return home;
  }
  const coastalRadius = options.coastalRadius || (() => 0);
  const isRoad = options.isRoad || (() => false);
  const isBlocked = options.isBlocked || (() => false);
  const isLake = options.isLake || (() => false);
  if (!Number.isFinite(proposedX) || !Number.isFinite(proposedZ)
    || coastalRadius(proposedX, proposedZ) >= 0.9
    || isRoad(proposedX, proposedZ, 3 + radius)
    || isLake(proposedX, proposedZ, LAKE_BANK_CLEARANCE + radius)
    || isBlocked(proposedX, proposedZ, radius)) return home;
  const y = terrainHeight(proposedX, proposedZ);
  if (!Number.isFinite(y) || y < 18) return home;
  return { x: proposedX, y, z: proposedZ };
}

/** Pure target poses shared by the rendered fauna and room hit validation. */
export function wildlifeTargetsAt(homes, elapsed, weather = 'mist', options = {}) {
  const time = Math.max(0, finite(elapsed, 0));
  const storm = weather === 'storm';
  const rain = weather === 'rain';
  const birdCount = storm ? STORM_BIRD_COUNT : BIRD_COUNT;
  const rabbitCount = storm ? 0 : rain ? Math.ceil(homes.rabbits.length / 2) : homes.rabbits.length;
  const playerX = finite(options.playerX, Infinity);
  const playerZ = finite(options.playerZ, Infinity);
  const targets = [];
  for (let i = 0; i < BIRD_COUNT; i++) {
    const rank = Math.floor(i / BIRD_FLOCKS.length);
    const flockIndex = i % BIRD_FLOCKS.length;
    const flock = BIRD_FLOCKS[flockIndex];
    const phase = rank * 2.39996323 + flockIndex * 0.37;
    const radius = flock.radius * (0.68 + rank * 0.088);
    const speed = (0.22 + rank * 0.012 + flockIndex * 0.003)
      * (storm ? 1.48 : rain ? 1.2 : 1);
    const angle = phase + time * speed;
    const aspect = 0.68 + rank * 0.025;
    targets.push({ id: `bird-${i}`, kind: 'bird',
      x: flock.x + Math.cos(angle) * radius,
      y: flock.y - (storm ? 4.5 : 0) + Math.sin(time * 0.78 + phase) * 1.5,
      z: flock.z + Math.sin(angle) * radius * aspect,
      radius: WILDLIFE_KINDS.bird.radius, maxHealth: WILDLIFE_KINDS.bird.maxHealth,
      active: i < birdCount });
  }
  for (let i = 0; i < homes.sheep.length; i++) {
    const home = homes.sheep[i];
    const phase = i * 2.17;
    const wander = storm ? 0.45 : 1;
    const next = safeWander(home,
      home.x + Math.sin(time * 0.12 + phase) * 2.2 * wander,
      home.z + Math.cos(time * 0.105 + phase * 1.23) * 1.7 * wander,
      1, options);
    targets.push({ id: `sheep-${i}`, kind: 'sheep',
      x: next.x, y: next.y + 0.70, z: next.z,
      radius: WILDLIFE_KINDS.sheep.radius, maxHealth: WILDLIFE_KINDS.sheep.maxHealth,
      active: true });
  }
  for (let i = 0; i < homes.rabbits.length; i++) {
    const home = homes.rabbits[i];
    const phase = i * 2.53;
    const playerKnown = !options.multiplayer
      && Number.isFinite(playerX) && Number.isFinite(playerZ);
    const dx = playerKnown ? home.x - playerX : 0;
    const dz = playerKnown ? home.z - playerZ : 0;
    const playerDistance = playerKnown ? Math.hypot(dx, dz) : Infinity;
    const flee = clamp((20 - playerDistance) / 16, 0, 1) * 3.6;
    const escapeX = Number.isFinite(playerDistance) && playerDistance > 0.01
      ? dx / playerDistance * flee : 0;
    const escapeZ = Number.isFinite(playerDistance) && playerDistance > 0.01
      ? dz / playerDistance * flee : 0;
    const next = safeWander(home,
      home.x + Math.sin(time * 0.37 + phase) * 1.25 + escapeX,
      home.z + Math.cos(time * 0.32 + phase) * 1.15 + escapeZ,
      0.35, options);
    const hop = Math.max(0, Math.sin(time * 6.5 + phase)) * (flee > 0 ? 0.11 : 0.04);
    targets.push({ id: `rabbit-${i}`, kind: 'rabbit',
      x: next.x, y: next.y + 0.36 + hop, z: next.z,
      radius: WILDLIFE_KINDS.rabbit.radius, maxHealth: WILDLIFE_KINDS.rabbit.maxHealth,
      active: i < rabbitCount });
  }
  return targets;
}

function findGroundHome([originX, originZ], terrainHeight, coastalRadius, isRoad,
  isBlocked, isLake, clearance) {
  for (let attempt = 0; attempt < 72; attempt++) {
    const angle = attempt * 2.39996323;
    const distance = attempt === 0 ? 0 : 1.7 * Math.sqrt(attempt);
    const x = originX + Math.cos(angle) * distance;
    const z = originZ + Math.sin(angle) * distance;
    const y = terrainHeight(x, z);
    const grade = Math.max(
      Math.abs(terrainHeight(x + 2, z) - y),
      Math.abs(terrainHeight(x - 2, z) - y),
      Math.abs(terrainHeight(x, z + 2) - y),
      Math.abs(terrainHeight(x, z - 2) - y),
    );
    if (Number.isFinite(y) && y > 18 && grade < 3.4
      && coastalRadius(x, z) < 0.9 && !isRoad(x, z, 7 + clearance)
      && !isLake(x, z, LAKE_BANK_CLEARANCE + clearance)
      && !isBlocked(x, z, clearance)) {
      return { x, y, z };
    }
  }
  return null;
}

function generatedCandidate(index, phase) {
  // Two incommensurate rotations distribute each species across the entire
  // high island instead of making a visible grid or a dense central cluster.
  const area = (index * 0.618033988749895 + phase) % 1;
  const bearing = (index * 0.754877666246693 + phase * 0.618) % 1;
  const radius = 290 * Math.sqrt(0.055 + area * 0.945);
  const angle = bearing * Math.PI * 2;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

function planGroundSpecies(anchors, desired, separation, clearance,
  terrainHeight, coastalRadius, isRoad, isBlocked, isLake, phase) {
  const result = [];
  for (let index = 0; index < 1400 && result.length < desired; index++) {
    const seed = index < anchors.length ? anchors[index]
      : generatedCandidate(index - anchors.length, phase);
    const home = findGroundHome(seed, terrainHeight, coastalRadius, isRoad,
      isBlocked, isLake, clearance);
    if (!home || result.some((prior) =>
      Math.hypot(prior.x - home.x, prior.z - home.z) < separation)) continue;
    result.push(home);
  }
  return result;
}

/** Deterministic safe homes; animals never start in roads or on a cliff lip. */
export function planCoastalFauna(terrainHeight, {
  coastalRadius = () => 0,
  isRoad = () => false,
  isBlocked = () => false,
  isLake = () => false,
} = {}) {
  if (typeof terrainHeight !== 'function') throw new TypeError('terrainHeight must be a function');
  return {
    sheep: planGroundSpecies(SHEEP_CANDIDATES, WILDLIFE_POPULATION.sheep,
      20, 4, terrainHeight, coastalRadius, isRoad, isBlocked, isLake, 0.113),
    rabbits: planGroundSpecies(RABBIT_CANDIDATES, WILDLIFE_POPULATION.rabbits,
      13, 2.5, terrainHeight, coastalRadius, isRoad, isBlocked, isLake, 0.487),
  };
}

// The room authority and clients use exactly the same safe island homes.
// Only terrain/road/lake functions are evaluated here: no scene is constructed.
const roomHomes = planCoastalFauna(islandTerrainHeightAt, {
  coastalRadius: islandCoastalRadiusAt, isRoad, isLake,
});
export const SERVER_WILDLIFE_HOMES = Object.freeze({
  sheep: Object.freeze(roomHomes.sheep.map((home) => Object.freeze(home))),
  rabbits: Object.freeze(roomHomes.rabbits.map((home) => Object.freeze(home))),
});

function makeWingGeometry(side) {
  const geometry = new THREE.BufferGeometry();
  // The uneven trailing edge reads as separate primaries when a gull banks.
  // A shallow fold gives the wing a visible upper surface in side views.
  const outline = [
    [0, 0, 0.18], [0.45, 0.025, 0.31], [0.96, 0.065, 0.30],
    [1.44, 0.105, 0.16], [2.12, 0.17, -0.25],
    [1.80, 0.09, -0.22], [1.60, 0.07, -0.35],
    [1.37, 0.045, -0.29], [1.17, 0.025, -0.41],
    [0.91, 0.015, -0.30], [0.64, 0.005, -0.37],
    [0.42, 0, -0.21], [0, 0, -0.16],
  ];
  const positions = [];
  const colors = [];
  const rootColor = new THREE.Color(0xffffff);
  const tipColor = new THREE.Color(0x66737a);
  const color = new THREE.Color();
  for (let index = 1; index < outline.length - 1; index++) {
    const triangle = side < 0
      ? [outline[0], outline[index + 1], outline[index]]
      : [outline[0], outline[index], outline[index + 1]];
    for (const vertex of triangle) {
      positions.push(vertex[0] * side, vertex[1], vertex[2]);
      color.copy(rootColor).lerp(tipColor, clamp((vertex[0] - 0.72) / 1.35, 0, 1));
      colors.push(color.r, color.g, color.b);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function makeTailGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.28, -0.33, 0.01, -0.82, -0.04, 0, -0.67,
    0, 0, -0.28, -0.04, 0, -0.67, 0.04, 0, -0.67,
    0, 0, -0.28, 0.04, 0, -0.67, 0.33, 0.01, -0.82,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}

function mergeParts(parts) {
  const pieces = parts.map(({ geometry, position, scale, rotationX = 0 }) => {
    if (rotationX) geometry.rotateX(rotationX);
    geometry.scale(...scale);
    geometry.translate(...position);
    return geometry;
  });
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('Could not assemble procedural animal geometry');
  return merged;
}

function instanced(geometry, material, count, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  // The same mesh contains birds across the whole island and moves every
  // frame. A stale aggregate bounding sphere would cull nearby instances.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function makeBirds(scene, resources) {
  const bodyGeometry = new THREE.SphereGeometry(1, 8, 6);
  const headGeometry = new THREE.SphereGeometry(1, 7, 5);
  const beakGeometry = new THREE.ConeGeometry(0.065, 0.25, 4);
  beakGeometry.rotateX(Math.PI / 2);
  const rightWingGeometry = makeWingGeometry(1);
  const leftWingGeometry = makeWingGeometry(-1);
  const tailGeometry = makeTailGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.9, metalness: 0,
  });
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.9, metalness: 0,
    side: THREE.DoubleSide, vertexColors: true,
  });
  const tailMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
  });
  const beakMaterial = new THREE.MeshStandardMaterial({
    color: 0xc6a475, roughness: 0.9, metalness: 0,
  });
  resources.push(bodyGeometry, headGeometry, beakGeometry, rightWingGeometry,
    leftWingGeometry, tailGeometry, material, wingMaterial, tailMaterial,
    beakMaterial);
  const body = instanced(bodyGeometry, material, BIRD_COUNT, 'Coastal bird bodies');
  const head = instanced(headGeometry, material, BIRD_COUNT, 'Coastal bird heads');
  const wings = instanced(rightWingGeometry, wingMaterial, BIRD_COUNT,
    'Coastal bird wings');
  const leftWings = instanced(leftWingGeometry, wingMaterial, BIRD_COUNT,
    'Coastal bird left wings');
  const beaks = instanced(beakGeometry, beakMaterial, BIRD_COUNT, 'Coastal bird beaks');
  const tails = instanced(tailGeometry, tailMaterial, BIRD_COUNT, 'Coastal bird tails');
  const birds = [];
  for (let rank = 0; rank < BIRD_COUNT / BIRD_FLOCKS.length; rank++) {
    for (let flock = 0; flock < BIRD_FLOCKS.length; flock++) {
    const index = birds.length;
    const dark = (flock + rank * 3) % 7 === 0;
    const bodyColor = dark ? 0x303b3e : rank % 3 === 1 ? 0xc1c7c2 : 0xe0e2d8;
    const wingColor = dark ? 0x202c30 : 0x88979b;
    body.setColorAt(index, new THREE.Color(bodyColor));
    head.setColorAt(index, new THREE.Color(bodyColor));
    wings.setColorAt(index, new THREE.Color(wingColor));
    leftWings.setColorAt(index, new THREE.Color(wingColor));
    beaks.setColorAt(index, new THREE.Color(dark ? 0x4a4a44 : 0xe1bd78));
    tails.setColorAt(index, new THREE.Color(dark ? 0x263137 : 0xabb4b1));
    birds.push({ flock, rank, phase: rank * 2.39996323 + flock * 0.37,
      radius: BIRD_FLOCKS[flock].radius * (0.68 + rank * 0.088),
      speed: 0.22 + rank * 0.012 + flock * 0.003,
      size: dark ? 0.91 : 0.9 + (rank % 4) * 0.045 });
    }
  }
  scene.add(body, head, wings, leftWings, beaks, tails);
  return { birds, body, head, wings, leftWings, beaks, tails,
    meshes: [body, head, wings, leftWings, beaks, tails] };
}

function makeSheep(scene, count, resources) {
  const woolParts = [
    { geometry: new THREE.SphereGeometry(1, 16, 12),
      position: [0, 0, 0], scale: [0.43, 0.40, 0.70] },
  ];
  for (const [index, z] of [-0.51, -0.23, 0.05, 0.33, 0.54].entries()) {
    for (const side of [-1, 1]) {
      woolParts.push({ geometry: new THREE.SphereGeometry(1, 9, 7),
        position: [side * 0.29, 0.12 + (index % 2) * 0.055,
          z + side * 0.035],
        scale: [0.15, 0.15 + (index % 3) * 0.01, 0.16] });
    }
  }
  for (const [index, z] of [-0.50, -0.20, 0.10, 0.39].entries()) {
    woolParts.push({ geometry: new THREE.SphereGeometry(1, 9, 7),
      position: [index % 2 ? 0.075 : -0.075, 0.32, z],
      scale: [0.17, 0.14, 0.17] });
  }
  const woolGeometry = mergeParts(woolParts);
  const headGeometry = new THREE.SphereGeometry(1, 11, 8);
  const legGeometry = mergeParts([
    { geometry: new THREE.CylinderGeometry(0.11, 0.08, 0.32, 7),
      position: [0, 0.42, -0.045], scale: [1, 1, 1], rotationX: -0.18 },
    { geometry: new THREE.SphereGeometry(1, 7, 5),
      position: [0, 0.26, 0.01], scale: [0.08, 0.08, 0.09] },
    { geometry: new THREE.CylinderGeometry(0.075, 0.09, 0.24, 7),
      position: [0, 0.14, 0.035], scale: [1, 1, 1], rotationX: 0.14 },
  ]);
  const earGeometry = new THREE.SphereGeometry(1, 7, 5);
  const muzzleGeometry = new THREE.SphereGeometry(1, 10, 7);
  const eyeGeometry = new THREE.SphereGeometry(1, 8, 6);
  const hoofGeometry = mergeParts([-1, 1].map((side) => ({
    geometry: new THREE.SphereGeometry(1, 7, 5),
    position: [side * 0.052, 0, 0.025], scale: [0.064, 0.07, 0.11],
  })));
  const tuftGeometry = new THREE.SphereGeometry(1, 8, 6);
  const noseGeometry = new THREE.SphereGeometry(1, 6, 4);
  const woolMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x605a51, roughness: 1 });
  const muzzleMaterial = new THREE.MeshStandardMaterial({ color: 0xa39986, roughness: 1 });
  const nearBlackMaterial = new THREE.MeshStandardMaterial({ color: 0x292c29, roughness: 0.84 });
  resources.push(woolGeometry, headGeometry, legGeometry, earGeometry,
    muzzleGeometry, eyeGeometry, hoofGeometry, tuftGeometry, noseGeometry,
    woolMaterial, darkMaterial, muzzleMaterial, nearBlackMaterial);
  const wool = instanced(woolGeometry, woolMaterial, count, 'Feral sheep wool');
  const heads = instanced(headGeometry, darkMaterial, count, 'Feral sheep heads');
  const legs = instanced(legGeometry, darkMaterial, count * 4, 'Feral sheep legs');
  const ears = instanced(earGeometry, darkMaterial, count * 2, 'Feral sheep ears');
  const muzzles = instanced(muzzleGeometry, muzzleMaterial, count, 'Feral sheep muzzles');
  const eyes = instanced(eyeGeometry, nearBlackMaterial, count * 2, 'Feral sheep eyes');
  const hooves = instanced(hoofGeometry, nearBlackMaterial, count * 4, 'Feral sheep hooves');
  const tails = instanced(tuftGeometry, woolMaterial, count, 'Feral sheep tails');
  const forelocks = instanced(tuftGeometry, woolMaterial, count, 'Feral sheep forelocks');
  const noses = instanced(noseGeometry, nearBlackMaterial, count, 'Feral sheep noses');
  for (let i = 0; i < count; i++) {
    const coat = new THREE.Color([0xb7b4a9, 0xd1ccbb, 0x949991, 0xbcb8ac][i % 4]);
    wool.setColorAt(i, coat);
    tails.setColorAt(i, coat);
    forelocks.setColorAt(i, coat);
  }
  scene.add(wool, heads, legs, ears, muzzles, eyes, hooves, tails,
    forelocks, noses);
  return { wool, heads, legs, ears, muzzles, eyes, hooves, tails,
    forelocks, noses,
    meshes: [wool, heads, legs, ears, muzzles, eyes, hooves, tails,
      forelocks, noses] };
}

function makeRabbits(scene, count, resources) {
  const bodyGeometry = mergeParts([
    { geometry: new THREE.SphereGeometry(1, 14, 10),
      position: [0, 0, 0], scale: [0.29, 0.21, 0.38] },
    { geometry: new THREE.SphereGeometry(1, 10, 8),
      position: [-0.18, -0.06, -0.20], scale: [0.17, 0.18, 0.20] },
    { geometry: new THREE.SphereGeometry(1, 10, 8),
      position: [0.18, -0.06, -0.20], scale: [0.17, 0.18, 0.20] },
    { geometry: new THREE.SphereGeometry(1, 10, 8),
      position: [0, 0.035, 0.21], scale: [0.24, 0.21, 0.23] },
  ]);
  const headGeometry = new THREE.SphereGeometry(1, 12, 9);
  const earGeometry = new THREE.SphereGeometry(1, 10, 8);
  const eyeGeometry = new THREE.SphereGeometry(1, 10, 8);
  const tailGeometry = new THREE.SphereGeometry(1, 9, 7);
  const noseGeometry = new THREE.SphereGeometry(1, 8, 6);
  const pawGeometry = new THREE.SphereGeometry(1, 9, 7);
  const muzzleGeometry = mergeParts([-1, 1].map((side) => ({
    geometry: new THREE.SphereGeometry(1, 9, 7),
    position: [side * 0.047, 0, 0], scale: [0.057, 0.049, 0.066],
  })));
  const glintGeometry = new THREE.SphereGeometry(1, 6, 4);
  const material = new THREE.MeshStandardMaterial({ color: 0x8d8170, roughness: 1 });
  const innerEarMaterial = new THREE.MeshStandardMaterial({ color: 0xa57f79, roughness: 1 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x201d1b, roughness: 0.24 });
  const noseMaterial = new THREE.MeshStandardMaterial({ color: 0x5c4b49, roughness: 0.9 });
  const tailMaterial = new THREE.MeshStandardMaterial({ color: 0xc5c1ae, roughness: 1 });
  const muzzleMaterial = new THREE.MeshStandardMaterial({ color: 0x948b7b, roughness: 1 });
  const glintMaterial = new THREE.MeshBasicMaterial({ color: 0xa39a8d });
  resources.push(bodyGeometry, headGeometry, earGeometry, eyeGeometry,
    tailGeometry, noseGeometry, pawGeometry, muzzleGeometry, glintGeometry,
    material, innerEarMaterial, eyeMaterial, noseMaterial, tailMaterial,
    muzzleMaterial, glintMaterial);
  const body = instanced(bodyGeometry, material, count, 'Coastal rabbit bodies');
  const head = instanced(headGeometry, material, count, 'Coastal rabbit heads');
  const ears = instanced(earGeometry, material, count * 2, 'Coastal rabbit ears');
  const innerEars = instanced(earGeometry, innerEarMaterial, count * 2,
    'Coastal rabbit inner ears');
  const eyes = instanced(eyeGeometry, eyeMaterial, count * 2, 'Coastal rabbit eyes');
  const tails = instanced(tailGeometry, tailMaterial, count, 'Coastal rabbit tails');
  const noses = instanced(noseGeometry, noseMaterial, count, 'Coastal rabbit noses');
  const paws = instanced(pawGeometry, material, count * 4, 'Coastal rabbit paws');
  const muzzles = instanced(muzzleGeometry, muzzleMaterial, count, 'Coastal rabbit muzzles');
  const glints = instanced(glintGeometry, glintMaterial, count * 2, 'Coastal rabbit eye glints');
  for (let i = 0; i < count; i++) {
    const color = new THREE.Color([0x827f72, 0xa59b85, 0x6e7068, 0x918576][i % 4]);
    body.setColorAt(i, color);
    head.setColorAt(i, color);
    ears.setColorAt(i * 2, color);
    ears.setColorAt(i * 2 + 1, color);
    for (let paw = 0; paw < 4; paw++) paws.setColorAt(i * 4 + paw, color);
  }
  scene.add(body, head, ears, innerEars, eyes, tails, noses, paws,
    muzzles, glints);
  return { body, head, ears, innerEars, eyes, tails, noses, paws,
    muzzles, glints,
    meshes: [body, head, ears, innerEars, eyes, tails, noses, paws,
      muzzles, glints] };
}

/**
 * Add small ambient wildlife. Call update every frame after world weather.
 * update(dt, elapsed, weather, { playerX, playerZ, indoors }) returns a sparse
 * `birdCalls` cue (0 or 1), plus distances/counts for ambient audio and QA.
 */
export function createFauna(scene, terrainHeight, options = {}) {
  const homes = planCoastalFauna(terrainHeight, options);
  const resources = [];
  const birds = makeBirds(scene, resources);
  const sheep = makeSheep(scene,
    Math.max(homes.sheep.length, SERVER_WILDLIFE_HOMES.sheep.length), resources);
  const rabbits = makeRabbits(scene,
    Math.max(homes.rabbits.length, SERVER_WILDLIFE_HOMES.rabbits.length), resources);
  const meshes = [...birds.meshes, ...sheep.meshes, ...rabbits.meshes];
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const yaw = new THREE.Quaternion();
  const bank = new THREE.Quaternion();
  const flap = new THREE.Quaternion();
  const pose = new THREE.Quaternion();
  const wingPose = new THREE.Quaternion();
  const vertical = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const life = new Map(wildlifeTargetsAt(SERVER_WILDLIFE_HOMES, 0).map((target) =>
    [target.id, { alive: true, deathAge: 0, deathTarget: null }]));
  let targets = [];
  let activeVisual = null;
  let callClock = 0;
  let nextCall = 19;
  let callSerial = 0;
  let disposed = false;

  function setInstance(mesh, index, x, y, z, quaternion, sx, sy, sz) {
    if (activeVisual && !activeVisual.state.alive) {
      const collapse = clamp(activeVisual.state.deathAge / 1.3, 0, 1);
      if (activeVisual.kind === 'bird') {
        y += (activeVisual.groundY + 0.15 - y) * collapse * collapse;
      }
      else y = activeVisual.groundY + (y - activeVisual.groundY) * (1 - collapse * 0.78);
      const vanish = Math.max(0.001, 1 - collapse * collapse * collapse);
      sx *= vanish;
      sy *= vanish * (1 - collapse * 0.55);
      sz *= vanish;
    }
    position.set(x, y, z);
    scale.set(sx, sy, sz);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  }

  function inVisualRange(target, kind, cameraX, cameraZ) {
    if (!Number.isFinite(cameraX) || !Number.isFinite(cameraZ)) return true;
    const limit = VISUAL_RANGE[kind];
    return (target.x - cameraX) ** 2 + (target.z - cameraZ) ** 2 < limit * limit;
  }

  function update(dt, elapsed, weather = 'mist', context = {}) {
    if (disposed) return { birdCalls: 0, birdsActive: 0, rabbitsActive: 0, nearestBirdDistance: Infinity };
    const time = Math.max(0, finite(elapsed, 0));
    const step = clamp(finite(dt, 0), 0, 0.1);
    const storm = weather === 'storm';
    const rain = weather === 'rain';
    const birdCount = storm ? STORM_BIRD_COUNT : BIRD_COUNT;
    const playerX = finite(context.playerX, Infinity);
    const playerZ = finite(context.playerZ, Infinity);
    const targetHomes = context.multiplayer ? SERVER_WILDLIFE_HOMES : homes;
    const rabbitCount = storm ? 0 : rain
      ? Math.ceil(targetHomes.rabbits.length / 2) : targetHomes.rabbits.length;
    targets = wildlifeTargetsAt(targetHomes, time, weather,
      context.multiplayer
        ? { multiplayer: true, terrainHeight }
        : { ...options, terrainHeight, playerX, playerZ });
    // A killed bird falls where it was hit rather than continuing its orbit.
    for (let i = 0; i < targets.length; i++) {
      const deathTarget = life.get(targets[i].id)?.deathTarget;
      if (deathTarget) targets[i] = { ...targets[i], ...deathTarget };
    }
    for (const state of life.values()) if (!state.alive) state.deathAge += step;
    let nearestBirdDistance = Infinity;
    let visibleBirds = 0;
    for (let i = 0; i < birdCount; i++) {
      const bird = birds.birds[i];
      const target = targets[i];
      const state = life.get(target.id);
      const distance = Math.hypot(target.x - playerX, target.z - playerZ);
      if (state.alive) nearestBirdDistance = Math.min(nearestBirdDistance, distance);
      if (!inVisualRange(target, 'bird', playerX, playerZ)
        || (!state.alive && state.deathAge > 1.3)) continue;
      const slot = visibleBirds++;
      activeVisual = { kind: 'bird', state,
        groundY: state.alive ? 0
          : Math.max(0, finite(terrainHeight(target.x, target.z), 0)) };
      const speed = bird.speed * (storm ? 1.48 : rain ? 1.2 : 1);
      const angle = bird.phase + time * speed;
      const aspect = 0.68 + bird.rank * 0.025;
      const { x, y, z } = target;
      const heading = Math.atan2(-Math.sin(angle) * bird.radius,
        Math.cos(angle) * bird.radius * aspect);
      const forwardX = Math.sin(heading);
      const forwardZ = Math.cos(heading);
      yaw.setFromAxisAngle(vertical, heading);
      bank.setFromAxisAngle(forward, Math.sin(angle * 1.2 + bird.phase) * (storm ? 0.23 : 0.12));
      pose.copy(yaw).multiply(bank);
      const size = bird.size;
      setInstance(birds.body, slot, x, y, z, pose, 0.45 * size, 0.23 * size, 0.59 * size);
      setInstance(birds.head, slot, x + forwardX * 0.48 * size,
        y + 0.1 * size, z + forwardZ * 0.48 * size,
        pose, 0.19 * size, 0.18 * size, 0.19 * size);
      setInstance(birds.beaks, slot, x + forwardX * 0.71 * size,
        y + 0.075 * size, z + forwardZ * 0.71 * size,
        pose, size, size, size);
      setInstance(birds.tails, slot, x, y, z, pose, size, size, size);
      const wingBeat = (storm ? 0.32 : 0.16)
        + Math.sin(time * (storm ? 7.4 : 4.3) + bird.phase * 2) * (storm ? 0.37 : 0.22);
      flap.setFromAxisAngle(forward, wingBeat);
      wingPose.copy(pose).multiply(flap);
      setInstance(birds.wings, slot, x, y + 0.035, z,
        wingPose, size, size, size);
      flap.setFromAxisAngle(forward, -wingBeat);
      wingPose.copy(pose).multiply(flap);
      setInstance(birds.leftWings, slot, x, y + 0.035, z,
        wingPose, size, size, size);
    }
    for (const mesh of birds.meshes) {
      mesh.count = visibleBirds;
      mesh.instanceMatrix.needsUpdate = true;
    }

    let visibleSheep = 0;
    for (let i = 0; i < targetHomes.sheep.length; i++) {
      const target = targets[BIRD_COUNT + i];
      const state = life.get(target.id);
      if (!inVisualRange(target, 'sheep', playerX, playerZ)
        || (!state.alive && state.deathAge > 1.3)) continue;
      const slot = visibleSheep++;
      activeVisual = { kind: 'sheep', state: life.get(target.id),
        groundY: target.y - 0.7 };
      const phase = i * 2.17;
      const { x, z } = target;
      const y = target.y - 0.7;
      const heading = phase + Math.sin(time * 0.09 + phase) * 0.28;
      const forwardX = Math.sin(heading);
      const forwardZ = Math.cos(heading);
      yaw.setFromAxisAngle(vertical, heading);
      setInstance(sheep.wool, slot, x, y + 0.70, z, yaw, 1, 1, 1);
      const grazing = storm ? 0.05 : (Math.sin(time * 0.62 + phase) + 1) * 0.13;
      const headY = y + 0.91 - grazing;
      const hx = x + forwardX * 0.63;
      const hz = z + forwardZ * 0.63;
      setInstance(sheep.heads, slot, hx, headY, hz, yaw, 0.22, 0.25, 0.34);
      setInstance(sheep.muzzles, slot, hx + forwardX * 0.24,
        headY - 0.08, hz + forwardZ * 0.24, yaw, 0.17, 0.13, 0.19);
      setInstance(sheep.noses, slot, hx + forwardX * 0.42,
        headY - 0.095, hz + forwardZ * 0.42, yaw, 0.09, 0.05, 0.04);
      setInstance(sheep.forelocks, slot, hx - forwardX * 0.07,
        headY + 0.24, hz - forwardZ * 0.07, yaw, 0.17, 0.13, 0.17);
      setInstance(sheep.tails, slot, x - forwardX * 0.70,
        y + 0.83, z - forwardZ * 0.70, yaw, 0.13, 0.14, 0.16);
      for (let leg = 0; leg < 4; leg++) {
        const lateral = leg % 2 ? 0.30 : -0.30;
        const longitudinal = leg < 2 ? -0.39 : 0.39;
        const lx = x + forwardZ * lateral + forwardX * longitudinal;
        const lz = z - forwardX * lateral + forwardZ * longitudinal;
        setInstance(sheep.legs, slot * 4 + leg, lx, y, lz, yaw, 1, 1, 1);
        setInstance(sheep.hooves, slot * 4 + leg,
          lx + forwardX * 0.04, y + 0.07, lz + forwardZ * 0.04,
          yaw, 1, 1, 1);
      }
      for (let ear = 0; ear < 2; ear++) {
        const side = ear ? 1 : -1;
        const ex = hx + forwardZ * side * 0.30 - forwardX * 0.08;
        const ez = hz - forwardX * side * 0.30 - forwardZ * 0.08;
        setInstance(sheep.ears, slot * 2 + ear, ex, headY + 0.13, ez,
          yaw, 0.18, 0.075, 0.12);
        setInstance(sheep.eyes, slot * 2 + ear,
          hx + forwardZ * side * 0.20 + forwardX * 0.12,
          headY + 0.09,
          hz - forwardX * side * 0.20 + forwardZ * 0.12,
          yaw, 0.042, 0.042, 0.037);
      }
    }
    for (const mesh of sheep.meshes) {
      mesh.count = mesh === sheep.legs || mesh === sheep.hooves
        ? visibleSheep * 4 : mesh === sheep.ears || mesh === sheep.eyes
          ? visibleSheep * 2 : visibleSheep;
      mesh.instanceMatrix.needsUpdate = true;
    }

    let visibleRabbits = 0;
    for (let i = 0; i < rabbitCount; i++) {
      const home = targetHomes.rabbits[i];
      const target = targets[BIRD_COUNT + targetHomes.sheep.length + i];
      const state = life.get(target.id);
      if (!inVisualRange(target, 'rabbit', playerX, playerZ)
        || (!state.alive && state.deathAge > 1.3)) continue;
      const slot = visibleRabbits++;
      activeVisual = { kind: 'rabbit', state: life.get(target.id),
        groundY: target.y - 0.36 };
      const phase = i * 2.53;
      const playerKnown = !context.multiplayer
        && Number.isFinite(playerX) && Number.isFinite(playerZ);
      const dx = playerKnown ? home.x - playerX : 0;
      const dz = playerKnown ? home.z - playerZ : 0;
      const playerDistance = playerKnown ? Math.hypot(dx, dz) : Infinity;
      const flee = clamp((20 - playerDistance) / 16, 0, 1) * 3.6;
      const escapeX = Number.isFinite(playerDistance) && playerDistance > 0.01
        ? dx / playerDistance * flee : 0;
      const escapeZ = Number.isFinite(playerDistance) && playerDistance > 0.01
        ? dz / playerDistance * flee : 0;
      const { x, z } = target;
      const heading = Math.atan2(escapeX + Math.cos(time * 0.37 + phase),
        escapeZ - Math.sin(time * 0.32 + phase));
      const forwardX = Math.sin(heading);
      const forwardZ = Math.cos(heading);
      yaw.setFromAxisAngle(vertical, heading);
      const hop = Math.max(0, Math.sin(time * 6.5 + phase)) * (flee > 0 ? 0.11 : 0.04);
      const y = target.y - 0.36 - hop;
      setInstance(rabbits.body, slot, x, y + 0.28 + hop, z, yaw, 1, 1, 1);
      const hx = x + forwardX * 0.32;
      const hz = z + forwardZ * 0.32;
      setInstance(rabbits.head, slot, hx, y + 0.40 + hop, hz,
        yaw, 0.19, 0.18, 0.19);
      setInstance(rabbits.noses, slot, hx + forwardX * 0.18,
        y + 0.35 + hop, hz + forwardZ * 0.18,
        yaw, 0.045, 0.035, 0.038);
      setInstance(rabbits.muzzles, slot, hx + forwardX * 0.145,
        y + 0.335 + hop, hz + forwardZ * 0.145,
        yaw, 1, 1, 1);
      setInstance(rabbits.tails, slot, x - forwardX * 0.43,
        y + 0.36 + hop, z - forwardZ * 0.43,
        yaw, 0.13, 0.13, 0.13);
      for (let ear = 0; ear < 2; ear++) {
        const side = ear ? 1 : -1;
        const ex = hx + forwardZ * side * 0.095 - forwardX * 0.035;
        const ez = hz - forwardX * side * 0.095 - forwardZ * 0.035;
        flap.setFromAxisAngle(forward, side * 0.17
          + Math.sin(time * 1.7 + phase) * 0.035);
        wingPose.copy(yaw).multiply(flap);
        setInstance(rabbits.ears, slot * 2 + ear, ex, y + 0.68 + hop, ez,
          wingPose, 0.073, 0.24, 0.048);
        setInstance(rabbits.innerEars, slot * 2 + ear,
          ex + forwardX * 0.042, y + 0.69 + hop, ez + forwardZ * 0.042,
          wingPose, 0.043, 0.17, 0.018);
        setInstance(rabbits.eyes, slot * 2 + ear,
          hx + forwardZ * side * 0.174 + forwardX * 0.055,
          y + 0.455 + hop,
          hz - forwardX * side * 0.174 + forwardZ * 0.055,
          yaw, 0.031, 0.032, 0.030);
        setInstance(rabbits.glints, slot * 2 + ear,
          hx + forwardZ * side * 0.185 + forwardX * 0.075,
          y + 0.47 + hop,
          hz - forwardX * side * 0.185 + forwardZ * 0.075,
          yaw, 0.006, 0.006, 0.006);
        setInstance(rabbits.paws, slot * 4 + ear,
          x + forwardZ * side * 0.14 + forwardX * 0.28,
          y + 0.08 + hop,
          z - forwardX * side * 0.14 + forwardZ * 0.28,
          yaw, 0.075, 0.09, 0.16);
        setInstance(rabbits.paws, slot * 4 + 2 + ear,
          x + forwardZ * side * 0.18 - forwardX * 0.22,
          y + 0.10 + hop,
          z - forwardX * side * 0.18 - forwardZ * 0.22,
          yaw, 0.12, 0.10, 0.22);
      }
    }
    for (const mesh of rabbits.meshes) {
      const paired = mesh === rabbits.ears || mesh === rabbits.innerEars
        || mesh === rabbits.eyes || mesh === rabbits.glints;
      mesh.count = mesh === rabbits.paws ? visibleRabbits * 4
        : paired ? visibleRabbits * 2 : visibleRabbits;
      mesh.instanceMatrix.needsUpdate = true;
    }
    activeVisual = null;

    // Calls are visual-system cues for the game's own synthesizer. They are
    // intentionally infrequent and never occur in the thunderstorm.
    callClock += step;
    let birdCalls = 0;
    if (callClock >= nextCall) {
      callClock -= nextCall;
      nextCall = 19 + (callSerial++ % 4) * 5;
      if (!storm && !context.indoors && nearestBirdDistance < 145) birdCalls = 1;
    }
    return { birdCalls, birdsActive: birdCount, rabbitsActive: rabbitCount,
      nearestBirdDistance };
  }

  update(0, 0, 'mist');
  return {
    update,
    homes,
    getTargets() {
      return targets.map((target) => {
        const alive = life.get(target.id)?.alive ?? false;
        return { ...target, alive, active: target.active && alive };
      });
    },
    setAnimalAlive(id, alive) {
      const state = life.get(id);
      if (!state || typeof alive !== 'boolean') return false;
      if (state.alive !== alive) {
        state.deathTarget = alive ? null
          : (() => {
            const target = targets.find((candidate) => candidate.id === id);
            return target ? { x: target.x, y: target.y, z: target.z } : null;
          })();
        state.alive = alive;
        state.deathAge = 0;
      }
      return true;
    },
    resetAnimals() {
      for (const state of life.values()) {
        state.alive = true;
        state.deathAge = 0;
        state.deathTarget = null;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) scene.remove(mesh);
      for (const resource of resources) resource.dispose();
    },
  };
}
