import * as THREE from 'three';
import { createVegetation } from './vegetation.js';
import { createStormSky } from './stormClouds.js';
import { createStormActivity } from './stormActivity.js';
import { createGpuRain } from './gpuRain.js';
import { DESKTOP_RENDER_PROFILE } from './renderQuality.js';
import { PRISON_LAYOUT } from './setDressing.js';
import { CLIFF_FALL } from './cliffFall.js';
import { createInlandLake, isLake, lakeWaterHeight, sculptLakeTerrain } from './inlandLake.js';
import { createOceanWaveField, OCEAN_WAVE_GLSL } from './oceanWaveField.js';
import { createDistantIslands } from './distantIslands.js';
import { createOffshoreLighthouse } from './offshoreLighthouse.js';
import { MAIN_LIGHTHOUSE_SITE } from './worldSites.js';
import { landingBoardwalkSections, landingBoardwalkTopAt } from './landingBoardwalk.js';

// The island is a rounded, irregular square of approximately 0.45 km².
// All coordinates are metres; +z points toward the landing beach.
const SITES = [
  { x: 0, z: 270, y: 3.5 },       // landing
  { x: -90, z: 185, y: 31 },     // lodge on the south shoulder
  { x: -170, z: 60, y: 37 },     // archive on the plateau
  { x: -210, z: -120, y: 42 },   // west headland
  { x: 59, z: -228, y: 48 },     // tower control room clear of the east light pair
  { x: 150, z: -55, y: 39 },     // radio house
  { x: 125, z: 130, y: 33 },    // pump house
  { x: -186, z: -120, y: 42 },  // west survey point
  { x: 232, z: -120, y: 40 },   // east survey ridge
  { x: -65, z: -315, y: 1.5 },   // low shelf at North Inlet jetty
];

// Trails provide gentle, reliable routes between island landmarks.
const TRAILS = [
  [[0, 270, 3.5], [-18, 246, 11], [-39, 222, 20], [-69, 200, 31], [-90, 185, 31]],
  [[-90, 185, 31], [-127, 127, 34], [-170, 60, 37]],
  [[-127, 127, 34], [-97, 119, 37], [-78, 113, 40], [-58, 112, 42], [-58, 105, 43.2]],
  // The old staff apron is also a graded access spur. Keeping it in the
  // terrain trail network clears grass and tree roots from the parked car.
  [[-58, 112, 42], [-45, 112, 42.7], [-34, 117, 43]],
  [[-170, 60, 37], [-190, -28, 40], [-210, -120, 42]],
  [[-210, -120, 42], [-186, -120, 42]],
  // A narrow footpath leaves the West Headland road for the lighthouse.
  [[-210, -120, 42], [-231, -127, 40.5], [-253, -136, 37.5], [-261, -136, 37.1]],
  [[-210, -120, 42], [-120, -176, 46], [-24, -207, 49], [30, -207, 48], [59, -222, 48], [59, -228, 48]],
  [[59, -228, 48], [68, -192, 47], [112, -144, 44], [150, -55, 39]],
  [[59, -228, 48], [30, -207, 48], [-30, -212, 49], [-85, -242, 32], [-135, -260, 22], [-100, -290, 11], [-65, -315, 1.5]],
  [[59, -228, 48], [68, -192, 47], [143, -188, 45], [232, -120, 40], [197, -81, 39], [150, -55, 39]],
  [[150, -55, 39], [152, 41, 36], [125, 130, 33]],
  [[125, 130, 33], [66, 209, 21], [38, 238, 11], [0, 270, 3.5]],
];

// Terrain generation and grass placement call trailSample hundreds of
// thousands of times. The segment geometry never moves, so calculate these
// constants once while retaining the same projection and distance math.
const TRAIL_SEGMENTS = TRAILS.flatMap((trail) => trail.slice(1).map((b, index) => {
  const a = trail[index];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  return { x: a[0], z: a[1], y: a[2], endY: b[2], dx, dz,
    lengthSquared: dx * dx + dz * dz };
}));
const LEVEL_SITES = SITES.filter((site) => site.y >= 4
  && !(site.x === -90 && site.z === 185));

const WEATHER = {
  clear: {
    sky: 0x9baeb3, fog: 0x9caeaa, fogDensity: 0.0019,
    cloud: 0xc6c9be, cloudCover: 0.22,
    hemiSky: 0xe6ece6, hemiGround: 0x85998a, hemiIntensity: 2.5,
    sun: 0xffedcd, sunIntensity: 2.1, rain: 0, seaDeep: 0x294751, seaLight: 0x739499,
  },
  mist: {
    sky: 0x879797, fog: 0x899b9b, fogDensity: 0.0027,
    cloud: 0x718184, cloudCover: 0.52,
    hemiSky: 0xe6f0e9, hemiGround: 0x85998e, hemiIntensity: 2.8,
    sun: 0xe4ece2, sunIntensity: 1.8, rain: 0, seaDeep: 0x263f49, seaLight: 0x547078,
  },
  rain: {
    sky: 0x66757c, fog: 0x697a80, fogDensity: 0.0042,
    cloud: 0x45565e, cloudCover: 0.78,
    hemiSky: 0xc0cfd0, hemiGround: 0x60736d, hemiIntensity: 2.05,
    sun: 0xb7c5c8, sunIntensity: 0.85, rain: 0.55, seaDeep: 0x182f3e, seaLight: 0x3c5662,
  },
  storm: {
    sky: 0x38434e, fog: 0x46515a, fogDensity: 0.0054,
    cloud: 0x26323c, cloudCover: 0.94,
    hemiSky: 0x93a5ad, hemiGround: 0x45555a, hemiIntensity: 1.25,
    sun: 0x9eb6c1, sunIntensity: 0.34, rain: 1, seaDeep: 0x122531, seaLight: 0x30444f,
  },
  dawn: {
    sky: 0xbaa99b, fog: 0xafa99e, fogDensity: 0.0026,
    cloud: 0x918887, cloudCover: 0.42,
    hemiSky: 0xf1d1b7, hemiGround: 0x53605c, hemiIntensity: 2.15,
    sun: 0xffddb3, sunIntensity: 2.1, rain: 0, seaDeep: 0x39515b, seaLight: 0x82958e,
  },
};

const WEATHER_COLOR_KEYS = Object.freeze([
  'sky', 'fog', 'cloud', 'hemiSky', 'hemiGround', 'sun', 'seaDeep', 'seaLight',
]);
const WEATHER_SCALAR_KEYS = Object.freeze([
  'fogDensity', 'cloudCover', 'hemiIntensity', 'sunIntensity', 'rain',
]);
// Color space conversion is independent of blend progress. Keep one target
// Color per weather mode instead of allocating eight each rendered frame.
const WEATHER_COLORS = Object.fromEntries(Object.entries(WEATHER).map(([name, values]) => [
  name,
  Object.fromEntries(WEATHER_COLOR_KEYS.map((key) => [key, new THREE.Color(values[key])])),
]));
const NIGHT_COLORS = Object.freeze({
  sky: new THREE.Color(0x091725), fog: new THREE.Color(0x1a2c35),
  cloud: new THREE.Color(0x283647), hemiSky: new THREE.Color(0x667994),
  hemiGround: new THREE.Color(0x263c43), seaDeep: new THREE.Color(0x091927),
  seaLight: new THREE.Color(0x294354),
});

const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const TERRAIN_SIZE = 790;
const TERRAIN_DIVISIONS = 280;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

function hash(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(0, 1, x - ix);
  const fz = smooth(0, 1, z - iz);
  return mix(
    mix(hash(ix, iz), hash(ix + 1, iz), fx),
    mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx),
    fz,
  ) * 2 - 1;
}

function ridge(x, z, cx, cz, wx, wz, height) {
  const dx = (x - cx) / wx;
  const dz = (z - cz) / wz;
  return height * Math.exp(-(dx * dx + dz * dz) * 1.5);
}

function islandRadius(x, z) {
  const exponent = 3.2;
  const angle = Math.atan2(z, x);
  const inletAngle = Math.atan2(Math.sin(angle + 1.77), Math.cos(angle + 1.77));
  const shoreline = 1 + 0.024 * Math.sin(angle * 3 + 0.7)
    + 0.019 * Math.sin(angle * 7 - 0.9)
    + 0.012 * Math.sin(angle * 13 + 0.2)
    - 0.05 * Math.exp(-Math.pow(inletAngle / 0.15, 2));
  const superellipse = Math.pow(
    Math.pow(Math.abs(x) / 350, exponent) + Math.pow(Math.abs(z) / 350, exponent),
    1 / exponent,
  );
  return superellipse / shoreline;
}

function trailSample(x, z) {
  // Terrain, grass masks, and placement query this for hundreds of thousands
  // of positions. Compare squared distances for every segment, then take the
  // one square root needed by the caller. This keeps the same nearest segment
  // and projected trail height without a hypotenuse for every candidate.
  let closestSquared = Infinity;
  let closestDx = Infinity;
  let closestDz = Infinity;
  let height = 0;
  for (const segment of TRAIL_SEGMENTS) {
    const u = clamp(((x - segment.x) * segment.dx + (z - segment.z) * segment.dz)
      / segment.lengthSquared, 0, 1);
    const px = segment.x + segment.dx * u;
    const pz = segment.z + segment.dz * u;
    const dx = x - px;
    const dz = z - pz;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared < closestSquared) {
      closestSquared = distanceSquared;
      closestDx = dx;
      closestDz = dz;
      height = mix(segment.y, segment.endY, u);
    }
  }
  // A trail eases to each building's level before reaching its footprint.
  // This preserves flat foundations without a sudden grade spike at doors.
  for (const site of LEVEL_SITES) {
    const dx = x - site.x;
    const dz = z - site.z;
    // Beyond 27 m, the blend is exactly zero.
    if (dx * dx + dz * dz >= 27 * 27) continue;
    const distance = Math.hypot(dx, dz);
    height = mix(height, site.y, 1 - smooth(11, 27, distance));
  }
  return { distance: Math.hypot(closestDx, closestDz), height };
}

function surface(x, z) {
  const r = islandRadius(x, z);
  if (r >= 1.035) return { height: -8, radius: r, trailDistance: Infinity };

  // A high rolling grass cap sits above a narrow, steep rock face. The two
  // coves are sculpted into it before the cliff drop so their routes descend
  // naturally to water rather than punching holes through a vertical wall.
  const plateau = 35
    + noise(x * 0.008, z * 0.008) * 5.5
    + noise(x * 0.026, z * 0.026) * 2.2
    + noise(x * 0.085, z * 0.085) * 0.7
    + ridge(x, z, -40, -25, 175, 140, 24)
    + ridge(x, z, 45, -180, 130, 115, 12)
    + ridge(x, z, -220, -100, 100, 150, 5);
  const southCove = Math.exp(-Math.pow(x / 62, 2)) * smooth(150, 305, z);
  const northCove = Math.exp(-Math.pow((x + 65) / 59, 2)) * smooth(185, 315, -z);
  let highland = mix(plateau, 3.5, southCove);
  highland = mix(highland, 1.5, northCove);
  let height = highland * (1 - smooth(0.972, 1, r))
    - 8 * smooth(1, 1.035, r);
  const trail = trailSample(x, z);
  if (r < 0.96) {
    const trailBlend = 1 - smooth(5, 21, trail.distance);
    height = mix(height, trail.height, trailBlend);
    if (trail.distance >= 5) {
      for (const site of SITES) {
        const dx = x - site.x;
        const dz = z - site.z;
        const lowPort = site.y < 4;
        const outerRadius = lowPort ? 26 : 43;
        // The site has no influence outside its final smoothstep radius.
        if (dx * dx + dz * dz >= outerRadius * outerRadius) continue;
        const distance = Math.hypot(dx, dz);
        const levelBlend = 1 - smooth(lowPort ? 10 : 14, outerRadius, distance);
        height = mix(height, site.y, levelBlend);
      }
    }
  }
  // The old detention yard follows a deliberately graded shelf. Blend it
  // into the surrounding plateau so the gate does not face a sudden earth
  // bank and the prison approach remains a believable walkable climb.
  const prison = PRISON_LAYOUT.bounds;
  const outsideX = Math.max(prison.minX - x, 0, x - prison.maxX);
  const outsideZ = Math.max(prison.minZ - z, 0, z - prison.maxZ);
  if (outsideX * outsideX + outsideZ * outsideZ < 24 * 24) {
    const yardBlend = 1 - smooth(0, 24, Math.hypot(outsideX, outsideZ));
    height = mix(height, 45 - (z - 60) * 0.04, yardBlend);
  }
  return { height: sculptLakeTerrain(height, x, z), radius: r, trailDistance: trail.distance };
}

// Server-side movement validation uses the same analytic island and the same
// two-triangle terrain grid as the renderer, without constructing a scene.
// The player view blends toward that grid at the cliff crest and stands on the
// South Landing pier where it crosses the water.
let validationBoardwalkSections;
export function playerEyeHeightAt(x, z) {
  const analytic = surface(x, z).height;
  const cliffBlend = smooth(0.93, 0.955, islandRadius(x, z))
    * smooth(10, 18, analytic);
  let ground = analytic;
  if (cliffBlend > 0) {
    const cells = TERRAIN_DIVISIONS;
    const gx = clamp((x / TERRAIN_SIZE + 0.5) * cells, 0, cells - 1e-7);
    const gz = clamp((z / TERRAIN_SIZE + 0.5) * cells, 0, cells - 1e-7);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const vertex = (column, row) => Math.fround(surface(
      (column / cells - 0.5) * TERRAIN_SIZE,
      (row / cells - 0.5) * TERRAIN_SIZE,
    ).height);
    const a = vertex(ix, iz);
    const b = vertex(ix + 1, iz);
    const c = vertex(ix, iz + 1);
    const d = vertex(ix + 1, iz + 1);
    const rendered = fx + fz <= 1
      ? a * (1 - fx - fz) + b * fx + c * fz
      : d * (fx + fz - 1) + b * (1 - fz) + c * (1 - fx);
    ground = mix(analytic, rendered, cliffBlend);
  }
  if (Math.abs(x) <= 3.3 && z >= 268 && z <= 343) {
    validationBoardwalkSections ??= landingBoardwalkSections(
      (sampleX, sampleZ) => surface(sampleX, sampleZ).height);
    const boardwalkTop = landingBoardwalkTopAt(validationBoardwalkSections, z);
    if (boardwalkTop !== null) ground = Math.max(ground, boardwalkTop + 0.02);
  }
  if (Math.abs(x) < 3.8 && z >= 342 && z <= 357) ground = Math.max(0.49, ground);
  return ground + CLIFF_FALL.eyeHeight;
}

export function islandCoastalRadiusAt(x, z) { return islandRadius(x, z); }

export function islandTerrainHeightAt(x, z) { return surface(x, z).height; }

// A small fixed number of terrain samples is enough to reject wildlife hits
// through a headland. This is independent of renderer meshes and can also be
// used by the local solo shooting path for the same result.
export function shotBlockedByTerrain(origin, target, sampleStep = 2.5) {
  if (!Number.isFinite(sampleStep) || sampleStep <= 0
    || !origin || !target || ![origin.x, origin.y, origin.z,
    target.x, target.y, target.z].every(Number.isFinite)) return true;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const length = Math.hypot(dx, dy, dz);
  const samples = Math.ceil(length / sampleStep);
  for (let index = 1; index < samples; index++) {
    const fraction = index / samples;
    const x = origin.x + dx * fraction;
    const z = origin.z + dz * fraction;
    const height = playerEyeHeightAt(x, z) - CLIFF_FALL.eyeHeight;
    if (height > origin.y + dy * fraction + 0.15) return true;
  }
  return false;
}

function loadPbrMap(filename, repeat, isColor = false) {
  // TextureLoader uses the browser image element; headless design tests still
  // create the world to validate its geometry and traversable locations.
  if (typeof document === 'undefined') return null;
  const texture = new THREE.TextureLoader().load(`/assets/textures/${filename}`);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeRockMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xb8c1c1,
    map: loadPbrMap('rock_ground_diff_1k.jpg', 1.3, true),
    normalMap: loadPbrMap('rock_ground_nor_gl_1k.jpg', 1.3),
    roughnessMap: loadPbrMap('rock_ground_rough_1k.jpg', 1.3),
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughness: 0.91,
    metalness: 0,
    flatShading: true,
  });
}

function makeTerrain() {
  const size = TERRAIN_SIZE;
  const divisions = TERRAIN_DIVISIONS;
  const count = (divisions + 1) ** 2;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const indices = [];
  // These are light multipliers for the photographic albedo map below.
  const peat = new THREE.Color(0xd9d5c9);
  const moss = new THREE.Color(0xd4e8bf);
  const lichen = new THREE.Color(0xe9ecd5);
  const rock = new THREE.Color(0xd9dfdc);
  const wetRock = new THREE.Color(0xb8c8ca);
  const trailColor = new THREE.Color(0xd1c6b5);
  const scratch = new THREE.Color();

  for (let z = 0; z <= divisions; z++) {
    for (let x = 0; x <= divisions; x++) {
      const px = (x / divisions - 0.5) * size;
      const pz = (z / divisions - 0.5) * size;
      const sample = surface(px, pz);
      const i = z * (divisions + 1) + x;
      positions.set([px, sample.height, pz], i * 3);
      uvs.set([x / divisions, z / divisions], i * 2);

      // Large peat/moss patches stay visible from a distance. Height bands
      // reveal horizontal stone strata on cliffs instead of uniform green.
      const broadPatch = noise(px * 0.009, pz * 0.009);
      const smallPatch = noise(px * 0.045, pz * 0.045);
      const mossAmount = smooth(-0.35, 0.55, broadPatch + smallPatch * 0.4);
      const bands = 0.5 + 0.5 * Math.sin(sample.height * 1.25
        + noise(px * 0.022, pz * 0.022) * 1.7);
      scratch.copy(peat).lerp(moss, mossAmount * 0.83);
      scratch.lerp(lichen, smooth(17, 32, sample.height) * smooth(0.1, 0.85, broadPatch) * 0.55);
      const coastalStone = smooth(0.9, 0.995, sample.radius);
      scratch.lerp(rock, Math.max(coastalStone * 0.74, smooth(24, 38, sample.height) * 0.36));
      scratch.lerp(wetRock, coastalStone * (0.13 + bands * 0.36));
      scratch.lerp(trailColor, 0.65 * (1 - smooth(4, 13, sample.trailDistance)));
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }
  }

  for (let z = 0; z < divisions; z++) {
    for (let x = 0; x < divisions; x++) {
      const a = z * (divisions + 1) + x;
      const b = a + 1;
      const c = a + divisions + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < count; i++) {
    const steepness = 1 - normals.getY(i);
    const stone = smooth(0.045, 0.33, steepness) * 0.79;
    colors[i * 3] = mix(colors[i * 3], rock.r, stone);
    colors[i * 3 + 1] = mix(colors[i * 3 + 1], rock.g, stone);
    colors[i * 3 + 2] = mix(colors[i * 3 + 2], rock.b, stone);
  }
  geometry.getAttribute('color').needsUpdate = true;

  // Poly Haven's 15 m coastal surface is tiled at approximately its measured
  // real scale. Vertex colors still supply broad site-specific wetness/paths.
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: loadPbrMap('coast_sand_rocks_02_diff_1k.jpg', 52, true),
    normalMap: loadPbrMap('coast_sand_rocks_02_nor_gl_1k.jpg', 52),
    roughnessMap: loadPbrMap('coast_sand_rocks_02_rough_1k.jpg', 52),
    normalScale: new THREE.Vector2(0.66, 0.66),
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.name = 'Island terrain';
  terrain.receiveShadow = true;
  return terrain;
}

// The base terrain uses two planar triangles per grid cell. Sample those
// triangles directly so the player and the separate cliff shell agree with
// the surface the GPU actually draws, even on the steep coastal band.
function terrainMeshHeight(terrain, x, z) {
  const cells = TERRAIN_DIVISIONS;
  const gx = clamp((x / TERRAIN_SIZE + 0.5) * cells, 0, cells - 1e-7);
  const gz = clamp((z / TERRAIN_SIZE + 0.5) * cells, 0, cells - 1e-7);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const stride = cells + 1;
  const heights = terrain.geometry.getAttribute('position').array;
  const a = (iz * stride + ix) * 3 + 1;
  const b = a + 3;
  const c = a + stride * 3;
  const d = c + 3;
  if (fx + fz <= 1) return heights[a] * (1 - fx - fz)
    + heights[b] * fx + heights[c] * fz;
  return heights[d] * (fx + fz - 1)
    + heights[b] * (1 - fz) + heights[c] * (1 - fx);
}

function makeSeaCliffs(renderedTerrainHeight) {
  // The face is denser than the grass cap so shelf breaks and cracks read at
  // sea level without changing the walkable high-ground silhouette above it.
  const segments = 1536;
  const rows = 28;
  const stride = rows + 1;
  const positions = new Float32Array((segments + 1) * stride * 3);
  const colors = new Float32Array((segments + 1) * stride * 3);
  const uvs = new Float32Array((segments + 1) * stride * 2);
  const indices = [];
  const color = new THREE.Color();
  const slate = new THREE.Color(0xe5e6df);
  const paleLayer = new THREE.Color(0xf5eee2);
  const darkLayer = new THREE.Color(0xa1adb0);
  const wetLayer = new THREE.Color(0x81949a);
  const mossEdge = new THREE.Color(0xb6c8aa);
  let perimeter = 0;
  let previousX = 0;
  let previousZ = 0;

  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let low = 0;
    let high = 540;
    for (let step = 0; step < 13; step++) {
      const mid = (low + high) * 0.5;
      if (islandRadius(dx * mid, dz * mid) < 1) low = mid;
      else high = mid;
    }
    const edge = (low + high) * 0.5;
    const shoreX = dx * edge;
    const shoreZ = dz * edge;
    if (i > 0) perimeter += Math.hypot(shoreX - previousX, shoreZ - previousZ);
    previousX = shoreX;
    previousZ = shoreZ;
    const rimHeight = surface(dx * edge * 0.968, dz * edge * 0.968).height;
    const cliffness = smooth(8, 23, rimHeight);

    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const normalizedRadius = mix(CLIFF_FALL.lipRadius, 1.01, t);
      const radius = edge * normalizedRadius;
      const x = dx * radius;
      const z = dz * radius;
      const rawHeight = renderedTerrainHeight(x, z);
      const ledge = Math.sin(Math.PI * t) * cliffness;
      // Continuous world-space noise keeps the closing seam identical. A
      // broad fold, fine chips, and rare protruding bedding ledges break the
      // former evenly spaced triangular grid without rounding off the crest.
      const fold = noise(shoreX * 0.025, shoreZ * 0.025);
      const chip = noise(shoreX * 0.078 + rawHeight * 0.045,
        shoreZ * 0.078 - rawHeight * 0.037);
      const bedding = Math.max(0, Math.sin(rawHeight * 0.59 + fold * 2.3)) ** 7;
      // Start the separate rock shell exactly at the fall lip, where its top
      // seam matches the terrain. Protrusions develop only farther seaward;
      // otherwise the mesh can visually bury a player walking to the edge.
      const faceDetail = smooth(CLIFF_FALL.lipRadius + 0.004, 0.999, normalizedRadius);
      const outset = faceDetail * (0.055 + ledge
        * (1.05 + fold * 0.62 + chip * 0.29 + bedding * 0.85));
      const y = rawHeight + faceDetail * ledge * (chip * 0.24 + bedding * 0.16);
      const index = i * stride + j;
      positions.set([x + dx * outset, y, z + dz * outset], index * 3);
      // A photographed vertical rock face replaces the old top-down pebble
      // albedo. Larger, gently warped UV islands reduce the obvious repeat
      // across a 2.5 km circumference; matching normal/roughness maps share
      // this exact projection.
      const uWarp = noise(shoreX * 0.012 + y * 0.005, shoreZ * 0.012) * 0.19;
      const vWarp = noise(shoreX * 0.017, shoreZ * 0.017) * 0.13;
      uvs.set([perimeter / 5.8 + uWarp, y / 5.8 + vWarp], index * 2);

      const strata = Math.sin(y * 0.71 + fold * 2.1
        + noise(shoreX * 0.014, shoreZ * 0.014) * 1.1);
      const seam = 1 - smooth(0.02, 0.24, Math.abs(strata));
      const nearSea = 1 - smooth(2, 17, y);
      color.copy(slate).lerp(paleLayer, smooth(-0.5, 0.8, strata) * 0.26);
      color.lerp(darkLayer, seam * 0.42 + Math.max(0, -chip) * 0.12);
      color.lerp(wetLayer, nearSea * 0.5);
      color.lerp(mossEdge, (1 - smooth(CLIFF_FALL.lipRadius,
        CLIFF_FALL.lipRadius + 0.01, normalizedRadius)) * cliffness * 0.4);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
  }
  // The perimeter is not an exact multiple of one texture tile. Scale U to
  // an integer repeat count so the closing vertex has no visible UV seam.
  const repeatScale = Math.round(perimeter / 5.8) / (perimeter / 5.8);
  for (let i = 0; i < uvs.length; i += 2) uvs[i] *= repeatScale;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = a + 1;
      const d = b + 1;
      if ((i + j) & 1) indices.push(a, c, d, a, d, b);
      else indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: loadPbrMap('rock_face_diff_2k.jpg', 1, true),
    normalMap: loadPbrMap('rock_face_nor_gl_2k.jpg', 1),
    roughnessMap: loadPbrMap('rock_face_rough_2k.jpg', 1),
    normalScale: new THREE.Vector2(0.92, 0.92),
    roughness: 0.91,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  // The photograph has strong vertical fissures. A second, rotated sample in
  // broad irregular patches interrupts their cadence without losing the
  // underlying photographed albedo or the PBR normal/roughness response.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCliffWorld;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvCliffWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCliffWorld;
        float cliffHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float cliffNoise(vec2 p) {
          vec2 cell = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(cliffHash(cell), cliffHash(cell + vec2(1.0, 0.0)), f.x),
            mix(cliffHash(cell + vec2(0.0, 1.0)), cliffHash(cell + vec2(1.0, 1.0)), f.x), f.y);
        }`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        vec4 cliffBase = texture2D(map, vMapUv);
        // World coordinates also make the alternate sample seamless at the
        // closing vertex, where the main perimeter UV wraps to an integer.
        vec2 crossUv = vec2(vCliffWorld.y / 5.8 + vCliffWorld.x * 0.022 + 13.37,
          (vCliffWorld.x * 0.71 - vCliffWorld.z * 0.70) / 5.8 + 37.71);
        vec4 cliffCross = texture2D(map, crossUv);
        float regionNoise = cliffNoise(vCliffWorld.xz * 0.021
          + vec2(vCliffWorld.y * 0.004, -vCliffWorld.y * 0.003));
        float crossAmount = smoothstep(0.26, 0.73, regionNoise) * 0.53;
        diffuseColor *= mix(cliffBase, cliffCross, crossAmount);
        #endif`);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Stratified coastal rock face';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function makeSea(waveField, renderProfile) {
  const nearHalfSize = 360;
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: 0.3 },
    uWindDirection: { value: new THREE.Vector2(1, 0.18).normalize() },
    uLightDirection: { value: new THREE.Vector3(-0.32, 0.84, -0.43).normalize() },
    uCenter: { value: new THREE.Vector2() },
    uFogDensity: { value: 0.0034 },
    uFog: { value: new THREE.Color(WEATHER.mist.fog) },
    uDeep: { value: new THREE.Color(WEATHER.mist.seaDeep) },
    uLight: { value: new THREE.Color(WEATHER.mist.seaLight) },
    ...waveField.uniforms,
  };
  const vertexShader = `
      varying vec3 vWorld;
      varying float vCrest;
      varying vec3 vWaveNormal;
      uniform float uTime;
      uniform float uWind;
      uniform float uNear;
      ${OCEAN_WAVE_GLSL}
      float islandR(vec2 p) {
        float angle = atan(p.y, p.x);
        float inletAngle = atan(sin(angle + 1.77), cos(angle + 1.77));
        float shoreline = 1.0 + 0.024 * sin(angle * 3.0 + 0.7)
          + 0.019 * sin(angle * 7.0 - 0.9)
          + 0.012 * sin(angle * 13.0 + 0.2)
          - 0.05 * exp(-pow(inletAngle / 0.15, 2.0));
        return pow(pow(abs(p.x) / 350.0, 3.2) + pow(abs(p.y) / 350.0, 3.2), 1.0 / 3.2) / shoreline;
      }
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vCrest = 0.0;
        vWaveNormal = vec3(0.0, 1.0, 0.0);
        if (uNear > 0.5) {
          vec2 p = world.xz;
          float r = islandR(p);
          float south = exp(-pow(p.x / 62.0, 2.0)) * smoothstep(265.0, 345.0, p.y);
          float north = exp(-pow((p.x + 65.0) / 58.0, 2.0)) * smoothstep(265.0, 345.0, -p.y);
          float harbor = max(south, north) * (1.0 - smoothstep(1.035, 1.15, r));
          float shore = smoothstep(0.975, 1.105, r);
          float patchFade = 1.0 - smoothstep(325.0, 358.0, max(abs(position.x), abs(position.y)));
          float attenuation = shore * mix(1.0, 0.18, harbor) * patchFade;
          vec3 wave = oceanWaveDisplacement(p);
          world.y += wave.y * attenuation;
          world.xz += wave.xz * attenuation;
          vCrest = wave.y * attenuation;
          vec2 slope = vec2(0.0);
          for (int i = 0; i < 16; i++) {
            vec4 direction = uOceanWaveDirs[i];
            vec4 component = uOceanWaveParams[i];
            float phase = direction.z * dot(direction.xy, p)
              - direction.w * uOceanWaveTime + component.z;
            slope += direction.xy * (component.x * direction.z * cos(phase));
          }
          vWaveNormal = normalize(vec3(-slope.x * attenuation, 1.0,
            -slope.y * attenuation));
        }
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `;
  const fragmentShader = `
      varying vec3 vWorld;
      varying float vCrest;
      varying vec3 vWaveNormal;
      uniform float uTime;
      uniform float uWind;
      uniform float uNear;
      uniform vec2 uCenter;
      uniform vec2 uWindDirection;
      uniform vec3 uLightDirection;
      uniform float uFogDensity;
      uniform vec3 uFog;
      uniform vec3 uDeep;
      uniform vec3 uLight;
      void main() {
        // The distant, cheap plane has a square opening for the moving, finely
        // tessellated swell patch. Both surfaces meet at flat water level.
        if (uNear < 0.5 && max(abs(vWorld.x - uCenter.x), abs(vWorld.z - uCenter.y)) < 355.0) discard;
        vec2 acrossWind = vec2(-uWindDirection.y, uWindDirection.x);
        float a = sin(dot(vWorld.xz, uWindDirection) * 0.065
          + uTime * (0.5 + uWind * 0.45));
        float b = sin(dot(vWorld.xz, acrossWind) * 0.095
          - uTime * (0.35 + uWind * 0.5));
        float c = sin(dot(vWorld.xz, uWindDirection + acrossWind * 0.42) * 0.18
          + uTime * 0.72);
        vec3 normal = normalize(vWaveNormal);
        vec3 viewDirection = normalize(cameraPosition - vWorld);
        float skyReflection = pow(1.0 - clamp(dot(normal, viewDirection), 0.0, 1.0), 2.8);
        float softLight = max(dot(normal, normalize(uLightDirection)), 0.0);
        float wave = 0.31 + 0.24 * softLight + 0.12 * a * b
          + 0.045 * c + vCrest * 0.08 + skyReflection * 0.2;
        vec3 color = mix(uDeep, uLight, clamp(wave, 0.0, 1.0));
        float glimmer = pow(max(0.0, a * b * softLight), 13.0)
          * (0.04 + 0.04 * uWind);
        color += vec3(glimmer);
        float whitecap = smoothstep(1.05, 1.75, uWind)
          * pow(max(0.0, a * b * 0.72 + c * 0.28), 7.0) * 0.17;
        whitecap += smoothstep(0.42, 1.25, vCrest)
          * smoothstep(0.75, 1.8, uWind) * 0.36;
        color += vec3(0.62, 0.72, 0.73) * whitecap;
        float distanceFromCamera = distance(cameraPosition, vWorld);
        // Match Three.js FogExp2 so the sea fades into the same horizon as land.
        float visibility = exp(-pow(distanceFromCamera * uFogDensity, 2.0));
        gl_FragColor = vec4(mix(uFog, color, visibility), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;
  const makeMaterial = (near) => new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uNear: { value: near ? 1 : 0 } },
    vertexShader, fragmentShader,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const farMesh = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000, 70, 70), makeMaterial(false));
  farMesh.rotation.x = -Math.PI / 2;
  farMesh.position.y = 0.045;
  farMesh.name = 'Distant open sea';
  const segments = renderProfile.tier === 'desktop' ? 200 : 120;
  const nearMesh = new THREE.Mesh(new THREE.PlaneGeometry(nearHalfSize * 2, nearHalfSize * 2, segments, segments), makeMaterial(true));
  nearMesh.rotation.x = -Math.PI / 2;
  nearMesh.position.y = 0.055;
  nearMesh.name = 'Moving nearshore swells';
  nearMesh.frustumCulled = false;
  return { mesh: farMesh, nearMesh, uniforms, nearHalfSize };
}

// This mirrors the near-water shader so boats can follow the same moving
// surface. The swell patch follows the camera; distant water stays level.
function seaWaveAttenuation(x, z, cameraX, cameraZ) {
  const patch = 1 - smooth(325, 358, Math.max(Math.abs(x - cameraX), Math.abs(z - cameraZ)));
  if (patch <= 0) return 0;
  const radius = islandRadius(x, z);
  const south = Math.exp(-Math.pow(x / 62, 2)) * smooth(265, 345, z);
  const north = Math.exp(-Math.pow((x + 65) / 58, 2)) * smooth(265, 345, -z);
  const harbor = Math.max(south, north) * (1 - smooth(1.035, 1.15, radius));
  const shore = smooth(0.975, 1.105, radius);
  return shore * mix(1, 0.18, harbor) * patch;
}

function sampleSeaHeight(x, z, time, cameraX, cameraZ, waveField) {
  const attenuation = seaWaveAttenuation(x, z, cameraX, cameraZ);
  return attenuation <= 0 ? 0.045 : waveField.heightAt(x, z, time, attenuation);
}

function sampleSeaNormal(x, z, time, cameraX, cameraZ, waveField) {
  const attenuation = seaWaveAttenuation(x, z, cameraX, cameraZ);
  return waveField.normalAt(x, z, time, attenuation);
}

function makeShorelineFoam() {
  const segments = 512;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const cliffness = new Float32Array((segments + 1) * 2);
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let low = 0;
    let high = 540;
    for (let step = 0; step < 13; step++) {
      const mid = (low + high) * 0.5;
      if (islandRadius(dx * mid, dz * mid) < 1) low = mid;
      else high = mid;
    }
    const edge = (low + high) * 0.5;
    const cliff = smooth(7, 27, surface(dx * edge * 0.965, dz * edge * 0.965).height);
    for (let side = 0; side < 2; side++) {
      const radius = edge + (side === 0 ? 0.45 : 15);
      const index = i * 2 + side;
      positions.set([dx * radius, 0.14, dz * radius], index * 3);
      uvs.set([i / segments, side], index * 2);
      cliffness[index] = cliff;
    }
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aCliff', new THREE.BufferAttribute(cliffness, 1));
  geometry.setIndex(indices);
  const uniforms = {
    uTime: { value: 0 }, uWind: { value: 0.3 },
    uFog: { value: new THREE.Color(WEATHER.mist.fog) },
    uFogDensity: { value: WEATHER.mist.fogDensity },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vCliff;
      attribute float aCliff;
      void main() {
        vUv = uv;
        vCliff = aCliff;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vCliff;
      uniform float uTime;
      uniform float uWind;
      uniform vec3 uFog;
      uniform float uFogDensity;
      void main() {
        float breakup = 0.55 + 0.45 * sin(vUv.x * 537.0 + uTime * 0.41)
          * sin(vUv.x * 211.0 - uTime * 0.27);
        // Crest bands travel from open water toward the rock face. At a high
        // cliff the last band bursts into a short, brighter impact wash.
        float breaker = pow(max(0.0, sin(vUv.y * 16.0 + uTime * (0.95 + uWind * 0.29)
          + vUv.x * 31.0)), 8.0);
        float impact = pow(max(0.0, sin(uTime * (1.15 + uWind * 0.25)
          + vUv.x * 76.0)), 7.0) * pow(1.0 - vUv.y, 4.0) * vCliff;
        float spentFoam = pow(1.0 - vUv.y, 2.1) * (0.1 + 0.16 * breakup);
        float alpha = (spentFoam + breaker * (0.24 + 0.19 * uWind)
          + impact * (0.12 + 0.25 * uWind)) * breakup;
        alpha *= 1.0 - smoothstep(0.82, 1.0, vUv.y);
        float distanceFromCamera = distance(cameraPosition, vWorld);
        alpha *= exp(-pow(distanceFromCamera * uFogDensity, 2.0));
        gl_FragColor = vec4(mix(vec3(0.83, 0.91, 0.89), uFog, 0.14), clamp(alpha, 0.0, 0.78));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Broken shoreline surf';
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}

function makeReef(scene, rockMaterial) {
  // The false leading-light line ends in these exposed rocks. The true north
  // channel around x=-56 stays free of navigation obstacles.
  const count = 54;
  const reef = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), rockMaterial, count);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  let seed = 0x713cb401;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < count; i++) {
    const radius = Math.sqrt(random());
    const angle = random() * Math.PI * 2;
    const x = -268 + Math.cos(angle) * radius * 27;
    const z = -370 + Math.sin(angle) * radius * 19;
    const size = 0.75 + random() * 2.2;
    position.set(x, -0.3 + random() * 0.55, z);
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
    scale.set(size * (0.72 + random() * 0.55), size * (0.43 + random() * 0.45), size);
    matrix.compose(position, quaternion, scale);
    reef.setMatrixAt(i, matrix);
    tint.setHSL(0.52, 0.045, 0.5 + random() * 0.14);
    reef.setColorAt(i, tint);
  }
  reef.instanceMatrix.needsUpdate = true;
  reef.frustumCulled = false;
  reef.name = 'False-channel reef';
  scene.add(reef);
}

/** Create the atmospheric island; the caller owns the renderer and player controls. */
export function createWorld(scene, camera, { renderProfile = DESKTOP_RENDER_PROFILE } = {}) {
  const terrain = makeTerrain();
  const renderedTerrainHeight = (x, z) => terrainMeshHeight(terrain, x, z);
  const cliffs = makeSeaCliffs(renderedTerrainHeight);
  const oceanWaves = createOceanWaveField();
  const sea = makeSea(oceanWaves, renderProfile);
  const surf = makeShorelineFoam();
  const inlandLake = createInlandLake();
  const distantIslands = createDistantIslands(scene);
  const lighthouseSite = MAIN_LIGHTHOUSE_SITE;
  let lighthouseGround = renderedTerrainHeight(lighthouseSite.x, lighthouseSite.z);
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    lighthouseGround = Math.min(lighthouseGround, renderedTerrainHeight(
      lighthouseSite.x + Math.sin(angle) * lighthouseSite.radius,
      lighthouseSite.z + Math.cos(angle) * lighthouseSite.radius));
  }
  const mainLighthouse = createOffshoreLighthouse({
    name: 'Greywake Island', x: 0, z: 0, lighthouse: lighthouseSite,
  }, { groundY: lighthouseGround - 0.12 });
  mainLighthouse.group.name = 'West Headland Lighthouse';
  mainLighthouse.tower.castShadow = true;
  scene.add(mainLighthouse.group);
  const lighthouseBeacons = [mainLighthouse, ...distantIslands.beacons];
  const sky = createStormSky(scene);
  scene.add(sea.mesh, sea.nearMesh, terrain, cliffs, surf.mesh, inlandLake.mesh);
  const rockMaterial = makeRockMaterial();
  const vegetation = createVegetation(scene, surface, {
    grassQuality: renderProfile.grassQuality,
    grassDensityMultiplier: renderProfile.grassDensityMultiplier,
    isLake,
    renderedHeight: renderedTerrainHeight,
    coastalRadius: islandRadius,
    tier: renderProfile.tier,
  });
  makeReef(scene, rockMaterial);

  const fog = new THREE.FogExp2(WEATHER.mist.fog, WEATHER.mist.fogDensity);
  scene.fog = fog;
  scene.background = new THREE.Color(WEATHER.mist.sky);
  const hemi = new THREE.HemisphereLight(WEATHER.mist.hemiSky, WEATHER.mist.hemiGround, WEATHER.mist.hemiIntensity);
  const sun = new THREE.DirectionalLight(WEATHER.mist.sun, WEATHER.mist.sunIntensity);
  sun.position.set(-170, 280, -210);
  sun.castShadow = true;
  sun.shadow.mapSize.set(renderProfile.shadowMapSize, renderProfile.shadowMapSize);
  sun.shadow.camera.left = -145;
  sun.shadow.camera.right = 145;
  sun.shadow.camera.top = 145;
  sun.shadow.camera.bottom = -145;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 650;
  sun.shadow.bias = -0.00035;
  const moon = new THREE.DirectionalLight(0xa9c3e6, 0);
  moon.name = 'Moonlight';
  moon.castShadow = false;
  const nightCloud = new THREE.Color();
  const windDirection = new THREE.Vector2(1, 0.18).normalize();
  const cloudDrift = new THREE.Vector2();
  scene.add(hemi, sun, sun.target, moon, moon.target);

  const rainData = createGpuRain();
  scene.add(rainData.mesh);
  let indoors = false;
  let mode = 'mist';
  let blend = 1;
  let base;
  const stormActivity = createStormActivity();
  let flashAge = Infinity;
  let flashPower = 0;
  let thunderPan = 0;
  let groundWetness = 0;
  const current = {
    sky: new THREE.Color(WEATHER.mist.sky),
    fog: new THREE.Color(WEATHER.mist.fog),
    cloud: new THREE.Color(WEATHER.mist.cloud),
    hemiSky: new THREE.Color(WEATHER.mist.hemiSky),
    hemiGround: new THREE.Color(WEATHER.mist.hemiGround),
    sun: new THREE.Color(WEATHER.mist.sun),
    seaDeep: new THREE.Color(WEATHER.mist.seaDeep),
    seaLight: new THREE.Color(WEATHER.mist.seaLight),
    fogDensity: WEATHER.mist.fogDensity,
    cloudCover: WEATHER.mist.cloudCover,
    hemiIntensity: WEATHER.mist.hemiIntensity,
    sunIntensity: WEATHER.mist.sunIntensity,
    rain: WEATHER.mist.rain,
  };
  base = {
    sky: current.sky.clone(), fog: current.fog.clone(), cloud: current.cloud.clone(),
    hemiSky: current.hemiSky.clone(), hemiGround: current.hemiGround.clone(),
    sun: current.sun.clone(), seaDeep: current.seaDeep.clone(), seaLight: current.seaLight.clone(),
    fogDensity: current.fogDensity, cloudCover: current.cloudCover, hemiIntensity: current.hemiIntensity,
    sunIntensity: current.sunIntensity, rain: current.rain,
  };

  function setWeather(requested) {
    if (!WEATHER[requested] || requested === mode) return;
    base = {
      sky: current.sky.clone(), fog: current.fog.clone(), cloud: current.cloud.clone(),
      hemiSky: current.hemiSky.clone(), hemiGround: current.hemiGround.clone(),
      sun: current.sun.clone(), seaDeep: current.seaDeep.clone(), seaLight: current.seaLight.clone(),
      fogDensity: current.fogDensity, cloudCover: current.cloudCover, hemiIntensity: current.hemiIntensity,
      sunIntensity: current.sunIntensity, rain: current.rain,
    };
    mode = requested;
    blend = 0;
  }

  function setIndoor(isIndoor) {
    indoors = Boolean(isIndoor);
  }

  function setShelters(rectangles) {
    rainData.setShelters(rectangles);
  }

  function update(dt, elapsed, requestedWeather, atmosphere, captureOptions = null) {
    if (typeof requestedWeather === 'string') setWeather(requestedWeather);
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    if (blend < 1) {
      const target = WEATHER[mode];
      const targetColors = WEATHER_COLORS[mode];
      blend = Math.min(1, blend + dt / (mode === 'storm' ? 2.8 : 5));
      const t = smooth(0, 1, blend);
      for (const key of WEATHER_COLOR_KEYS) {
        current[key].copy(base[key]).lerp(targetColors[key], t);
      }
      for (const key of WEATHER_SCALAR_KEYS) {
        current[key] = mix(base[key], target[key], t);
      }
    }
    const celestial = Number.isFinite(atmosphere?.daylight) ? atmosphere : null;
    const daylight = celestial ? clamp(celestial.daylight, 0, 1) : 1;
    const night = celestial ? clamp(celestial.night, 0, 1) : 0;
    const twilight = celestial ? clamp(celestial.twilight, 0, 1) : 0;
    const precipitation = celestial && Number.isFinite(celestial.rain)
      ? clamp(celestial.rain, 0, 1) : current.rain;
    const cloudCover = celestial && Number.isFinite(celestial.cloudCover)
      ? clamp(celestial.cloudCover, 0, 1) : current.cloudCover;
    const windSpeed = celestial && Number.isFinite(celestial.windSpeed)
      ? clamp(celestial.windSpeed, 0, 30) : null;
    if (celestial?.windDirection) {
      const x = Number(celestial.windDirection.x);
      const z = Number(celestial.windDirection.z);
      if (Number.isFinite(x) && Number.isFinite(z) && x * x + z * z > 0.01) {
        windDirection.set(x, z).normalize();
      }
    }
    const windForce = windSpeed == null ? mix(0.35, 1.5, precipitation)
      : clamp(0.20 + windSpeed * 0.069, 0.2, 1.7);
    const wetTarget = precipitation > 0.03 ? clamp(precipitation * 1.2, 0, 1) : 0;
    groundWetness += (wetTarget - groundWetness)
      * (1 - Math.exp(-dt * (wetTarget > groundWetness ? 0.09 : 0.008)));
    terrain.material.roughness = 0.9 - groundWetness * 0.34;
    terrain.material.color.setRGB(1 - groundWetness * 0.14,
      1 - groundWetness * 0.115, 1 - groundWetness * 0.09);
    rockMaterial.roughness = 0.91 - groundWetness * 0.29;
    scene.background.copy(current.sky);
    fog.color.copy(current.fog);
    if (celestial) {
      scene.background.lerp(NIGHT_COLORS.sky, night * 0.96);
      fog.color.lerp(NIGHT_COLORS.fog, night * 0.86);
    }
    // Offshore fog banks alter the view without changing the underlying
    // weather preset. The same density reaches terrain, sea and surf shaders.
    const fogMultiplier = Number.isFinite(atmosphere?.multiplier)
      ? clamp(atmosphere.multiplier, 0.6, 1.5) : 1;
    const naturalFogDensity = current.fogDensity * fogMultiplier
      * (celestial ? mix(0.9, 1.13, cloudCover) : 1);
    const fogCap = Number.isFinite(captureOptions?.fogDensityCap)
      ? clamp(captureOptions.fogDensityCap, 0.0001, 0.01) : Infinity;
    const visibleFogDensity = Math.min(naturalFogDensity, fogCap);
    fog.density = visibleFogDensity;
    hemi.color.copy(current.hemiSky);
    hemi.groundColor.copy(current.hemiGround);
    if (celestial) {
      hemi.color.lerp(NIGHT_COLORS.hemiSky, night * 0.73);
      hemi.groundColor.lerp(NIGHT_COLORS.hemiGround, night * 0.86);
    }
    hemi.intensity = current.hemiIntensity * (celestial ? mix(1, 0.33, night) : 1);
    // A filming-only cool sky bounce keeps the real island's cliff and roof
    // geometry legible against a storm-night sea. Normal gameplay has no fill.
    const cinematicNightFill = clamp(Number(captureOptions?.nightFill) || 0, 0, 1) * night;
    hemi.intensity += cinematicNightFill * 1.25;
    sun.color.copy(current.sun);
    sun.intensity = current.sunIntensity * (celestial
      ? daylight * (1 - cloudCover * 0.38) + twilight * 0.12 : 1);
    // Keep a modest shadow map centered on the player instead of rasterizing
    // the whole island into one low-resolution shadow texture.
    if (celestial?.sunDirection) {
      const direction = celestial.sunDirection;
      sun.position.set(camera.position.x + direction.x * 370,
        direction.y * 370,
        camera.position.z + direction.z * 370);
      sun.castShadow = daylight > 0.12;
      moon.position.set(camera.position.x + celestial.moonDirection.x * 370,
        celestial.moonDirection.y * 370,
        camera.position.z + celestial.moonDirection.z * 370);
      moon.target.position.set(camera.position.x, 0, camera.position.z);
      moon.target.updateMatrixWorld();
      moon.intensity = night * clamp(celestial.moonDirection.y * 2.5, 0, 1)
        * (0.12 + celestial.moonPhase * 0.2) * (1 - cloudCover * 0.5);
      moon.intensity += cinematicNightFill * 0.36;
    } else {
      sun.position.set(camera.position.x - 170, 280, camera.position.z - 210);
      sun.castShadow = true;
      moon.intensity = 0;
    }
    sun.target.position.set(camera.position.x, 0, camera.position.z);
    sun.target.updateMatrixWorld();
    oceanWaves.update(elapsed || 0, mode, windSpeed);
    sea.uniforms.uTime.value = elapsed || 0;
    sea.uniforms.uWind.value = windSpeed == null
      ? mix(0.3, 1.8, current.rain) : clamp(0.22 + windSpeed * 0.078, 0.22, 2.1);
    sea.uniforms.uWindDirection.value.copy(windDirection);
    sea.uniforms.uLightDirection.value.copy(celestial && night > 0.65
      ? celestial.moonDirection : celestial?.sunDirection ?? { x: -0.32, y: 0.84, z: -0.43 });
    sea.uniforms.uCenter.value.set(camera.position.x, camera.position.z);
    sea.nearMesh.position.x = camera.position.x;
    sea.nearMesh.position.z = camera.position.z;
    sea.uniforms.uFogDensity.value = visibleFogDensity;
    sea.uniforms.uFog.value.copy(fog.color);
    sea.uniforms.uDeep.value.copy(current.seaDeep);
    sea.uniforms.uLight.value.copy(current.seaLight);
    if (celestial) {
      sea.uniforms.uDeep.value.lerp(NIGHT_COLORS.seaDeep, night * 0.95);
      sea.uniforms.uLight.value.lerp(NIGHT_COLORS.seaLight, night * 0.84);
    }
    inlandLake.uniforms.uTime.value = elapsed || 0;
    inlandLake.uniforms.uWind.value = windSpeed == null ? current.rain
      : clamp(windSpeed / 22, 0, 1);
    inlandLake.uniforms.uFog.value.copy(fog.color);
    inlandLake.uniforms.uFogDensity.value = visibleFogDensity;
    vegetation.windTime.value = elapsed || 0;
    vegetation.windStrength.value = windForce;
    vegetation.windDirection.value.copy(windDirection);
    vegetation.updateVisibility(camera, { aerialCapture: captureOptions?.aerialTrees === true });
    surf.uniforms.uTime.value = elapsed || 0;
    surf.uniforms.uWind.value = sea.uniforms.uWind.value;
    surf.uniforms.uFog.value.copy(fog.color);
    surf.uniforms.uFogDensity.value = visibleFogDensity;
    sky.mesh.position.copy(camera.position);
    sky.uniforms.uTime.value = elapsed || 0;
    sky.uniforms.uCameraHeight.value = camera.position.y;
    sky.uniforms.uCameraXZ.value.set(camera.position.x, camera.position.z);
    // The volume fills many more pixels on large desktop displays. Fewer ray
    // samples there preserve frame rate while the baked 3D noise retains shape.
    if (typeof window !== 'undefined') {
      const pixelsAcross = window.innerWidth * Math.min(window.devicePixelRatio || 1, 1.5);
      const displaySteps = pixelsAcross >= 2400 ? 5 : pixelsAcross >= 1800 ? 6 : 8;
      sky.uniforms.uSteps.value = Math.min(displaySteps, renderProfile.cloudStepCap);
    }
    sky.uniforms.uHorizon.value.copy(fog.color);
    sky.uniforms.uZenith.value.copy(scene.background);
    nightCloud.copy(current.cloud);
    if (celestial) nightCloud.lerp(NIGHT_COLORS.cloud, night * 0.78);
    sky.uniforms.uCloud.value.copy(nightCloud);
    sky.uniforms.uCover.value = cloudCover;
    sky.uniforms.uStorm.value = smooth(0.55, 1, precipitation);
    if (celestial) {
      sky.uniforms.uSunDirection.value.copy(celestial.sunDirection);
      sky.uniforms.uMoonDirection.value.copy(celestial.moonDirection);
      sky.uniforms.uDaylight.value = daylight;
      sky.uniforms.uTwilight.value = twilight;
      sky.uniforms.uNight.value = night;
      sky.uniforms.uMoonPhase.value = celestial.moonPhase;
    }
    const cloudWindSpeed = windSpeed == null ? 3.2 : windSpeed * 0.58;
    sky.uniforms.uWindVector.value.copy(windDirection).multiplyScalar(cloudWindSpeed);
    cloudDrift.addScaledVector(sky.uniforms.uWindVector.value, dt);
    sky.uniforms.uWindOffset.value.copy(cloudDrift);

    const lightning = stormActivity.update(elapsed, mode);
    if (lightning.strike) {
      flashAge = 0;
      flashPower = lightning.flashPower;
      const strikePan = sky.strike(camera, elapsed || 0, lightning.bolts);
      if (lightning.thunder) thunderPan = strikePan;
    } else if (mode !== 'storm') {
      flashAge = Infinity;
    }
    if (mode === 'storm') flashAge += dt;
    // Two quick pulses give a distant strike its telltale stutter.
    const pulse = Number.isFinite(flashAge)
      ? Math.exp(-Math.max(0, flashAge - 0.018) * 39) * (flashAge < 0.09 ? 1 : 0)
        + Math.exp(-Math.max(0, flashAge - 0.12) * 26) * (flashAge >= 0.12 ? 0.66 : 0)
      : 0;
    const flash = clamp(pulse * flashPower, 0, 1);
    sky.updateLightning(flash);
    if (night > 0.5) moon.intensity += flash * 1.7;
    else sun.intensity += flash * 2.5;
    hemi.intensity += flash * 0.6;

    const beaconWeather = {
      night, weather: mode, fogColor: fog.color, fogDensity: visibleFogDensity,
      lightning: flash, cameraPosition: camera.position,
    };
    distantIslands.update(elapsed || 0, beaconWeather);
    mainLighthouse.update(elapsed || 0, beaconWeather);

    rainData.update(camera, elapsed || 0, precipitation, indoors, flash,
      windSpeed == null ? undefined : {
        direction: { x: windDirection.x, z: windDirection.y },
        strength: clamp(windSpeed / 18, 0, 1.5),
      });
    return lightning.thunder;
  }

  const waterHeight = (x, z, time = sea.uniforms.uTime.value) => sampleSeaHeight(
    x, z, time, camera.position.x, camera.position.z, oceanWaves,
  );
  waterHeight.normalAt = (x, z, time = sea.uniforms.uTime.value) => sampleSeaNormal(
    x, z, time, camera.position.x, camera.position.z, oceanWaves,
  );

  return {
    update,
    setWeather,
    setIndoor,
    setShelters,
    shadowLight: sun,
    distantIslands,
    mainLighthouse,
    lighthouseBeacons,
    get groundWetness() { return groundWetness; },
    get thunderPan() { return thunderPan; },
    natureObstacles: vegetation.natureObstacles,
    terrainHeight: (x, z) => surface(x, z).height,
    renderedTerrainHeight,
    coastalRadius: (x, z) => islandRadius(x, z),
    isLake,
    lakeWaterHeight: (x, z, time = inlandLake.uniforms.uTime.value) =>
      lakeWaterHeight(x, z, time, inlandLake.uniforms.uWind.value),
    waterHeight,
    isWalkable: (x, z) => {
      if (isLake(x, z)) return false;
      const radius = islandRadius(x, z);
      if (radius < 0.955) return true;
      // Only the two carved coves can be approached down to the surf. This
      // keeps the sheer cliff faces inaccessible while allowing dock access.
      const south = Math.exp(-Math.pow(x / 62, 2)) * smooth(150, 305, z);
      const north = Math.exp(-Math.pow((x + 65) / 59, 2)) * smooth(185, 315, -z);
      return radius < 0.999 && Math.max(south, north) > 0.57
        && surface(x, z).height > 0.15;
    },
  };
}
