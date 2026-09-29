import * as THREE from 'three';
import { createStaticCircleObstacles } from './collision.js';
import { SITES, MAIN_LIGHTHOUSE_SITE } from './worldSites.js';
import { PRISON_LAYOUT } from './setDressing.js';
import { isRoad } from './roads.js';
import { WindSweptGrass } from './grass/WindSweptGrass.js';
import { createCoastalDetails } from './coastalDetails.js';
import { HARBOR_PROP_SITES } from './harborProps.js';

const TEX = '/assets/vegetation-textures/';
const ROCK_TEX = '/assets/textures/';
const CHUNK_SIZE = 64;
const CHUNK_EDGE = 384;
const GRASS_FIELD_SIZE = 752;
const COASTAL_GRASS_LIMIT = 0.970;
const GRASS_ATTEMPTS_PER_CHUNK = 1280;
const GRASS_CULL_DISTANCE = 170;
const TREE_COUNT = 240;
const TREE_VARIANTS = 12;
const TREE_LOD_DISTANCE = 98;
const TREE_CULL_DISTANCE = 315;
// Preserve the small vegetation breaks in the authored terrain layout.
const SMALL_CLEARINGS = Object.freeze([
  [9, 280], [136, 141], [-83, -300], [159, -43], [176, 157],
]);
// The far prototype has no shadow pass. A generous sphere contains every
// crown silhouette, even on the 1.56x landmark, as the camera turns.
// Near trees keep their original distance-only rule: a trunk outside the view
// can still cast a shadow onto a visible slope or cliff below it.
const TREE_FAR_VIEW_RADIUS_PER_SCALE = 14.5;
const TREE_VIEW_TURN_DOT = Math.cos(0.025 / 2);
// Past this range, the low-cost soft meadow cards and terrain coloration
// carry the coverage. Full 40-blade clusters are reserved for the walkable
// middle distance, where individual silhouettes can actually be perceived.
const MEADOW_CULL_DISTANCE = 145;
// Leave a visible shore around the inland lake. Trees need a wider opening
// so their crowns and trunk colliders do not project over the water.
const LAKE_BANK_CLEARANCE = 5;
const noLake = () => false;
// Match the authored six-metre South Landing boardwalk in main.js. The inland
// foot trail starts at z=270, so its terrain distance alone cannot clear the
// deck and cove approach from procedural vegetation.
const SOUTH_BOARDWALK = Object.freeze({ halfWidth: 3.3, startZ: 268, endZ: 343 });

export function southBoardwalkCenterlineDistance(x, z) {
  const dz = Math.max(SOUTH_BOARDWALK.startZ - z, 0, z - SOUTH_BOARDWALK.endZ);
  return Math.hypot(x, dz);
}

export function grassPathDistance(surface, x, z) {
  return isRoad(x, z, 4) ? 0 : Math.min(surface(x, z).trailDistance,
    southBoardwalkCenterlineDistance(x, z));
}

function southBoardwalkDeckDistance(x, z) {
  const dx = Math.max(0, Math.abs(x) - SOUTH_BOARDWALK.halfWidth);
  const dz = Math.max(SOUTH_BOARDWALK.startZ - z, 0, z - SOUTH_BOARDWALK.endZ);
  return Math.hypot(dx, dz);
}

// A small, rounded opening on the north bank gives an unobstructed view of
// the water from foot level. It only affects grass; trees retain their
// existing placement and the surrounding meadow keeps its full density.
function inLakeViewCorridor(x, z) {
  const beyondEnd = Math.max(-27 - z, 0, z + 10);
  return Math.hypot(x + 70, beyondEnd) < 7;
}

function randomGenerator(initialSeed) {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (lo, hi, v) => {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

function texture(name, isColor = true, repeatX = 1, repeatY = 1, directory = TEX) {
  if (typeof document === 'undefined') return null;
  const map = new THREE.TextureLoader().load(directory + name);
  if (isColor) map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.anisotropy = 4;
  return map;
}

// Eight original tapered blade triangles give a fuller silhouette than a
// crossed card, while remaining cheaper than the former 27-triangle tufts.
function grassGeometry() {
  const positions = [];
  const colors = [];
  const uvs = [];
  for (let i = 0; i < 8; i++) {
    const angle = i * 2.399963229728653;
    const directionX = Math.cos(angle);
    const directionZ = Math.sin(angle);
    const acrossX = -directionZ;
    const acrossZ = directionX;
    const spread = 0.07 + (i % 3) * 0.058;
    const width = 0.075 + (i % 3) * 0.022;
    const lean = 0.13 + (i % 4) * 0.04;
    const height = 0.54 + (i % 4) * 0.085;
    const low = [0.54, 0.65, 0.43];
    const high = [0.90, 0.96, 0.77];
    positions.push(
      directionX * spread - acrossX * width, 0, directionZ * spread - acrossZ * width,
      directionX * spread + acrossX * width, 0, directionZ * spread + acrossZ * width,
      directionX * (spread + lean), height, directionZ * (spread + lean),
    );
    colors.push(...low, ...low, ...high);
    const u = (i * 0.127) % 0.82;
    uvs.push(u, 0.05, u + 0.18, 0.05, u + 0.09, 0.94);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function windMaterial(map, windTime, windStrength, windDirection) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.uniforms.uWindStrength = windStrength;
    shader.uniforms.uWindDirection = windDirection;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uWindTime;\nuniform float uWindStrength;\nuniform vec2 uWindDirection;',
    );
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        float phase = (instanceMatrix[3].x + modelMatrix[3].x) * 0.117
                    + (instanceMatrix[3].z + modelMatrix[3].z) * 0.079;
        float gustFront = 0.5 + 0.5 * sin(uWindTime * 0.72
          + (instanceMatrix[3].x + modelMatrix[3].x) * 0.038
          + (instanceMatrix[3].z + modelMatrix[3].z) * 0.024);
        float bend = transformed.y * transformed.y * uWindStrength
          * (0.55 + gustFront * 0.75);
        float flutter = sin(uWindTime * 1.32 + phase) * 0.23
          + cos(uWindTime * 1.07 + phase * 0.82) * 0.15;
        transformed.x += uWindDirection.x * bend * flutter;
        transformed.z += uWindDirection.y * bend * flutter;
      #endif
    `);
  };
  material.customProgramCacheKey = () => 'island-world-grass-wind-v3';
  return material;
}

function awayFromStructures(x, z, padding = 0, isLake = noLake) {
  if (isLake(x, z, LAKE_BANK_CLEARANCE + Math.max(0, padding))) return false;
  // Keep the new drivable corridors clear while retaining natural grass and
  // branches along their verges. Road lookup uses a spatial grid.
  if (isRoad(x, z, Math.max(2.5, padding + 2.5))) return false;
  if (padding >= 0 && southBoardwalkDeckDistance(x, z) < 1.5 + padding) return false;
  const prison = PRISON_LAYOUT.bounds;
  if (x > prison.minX - 2 - padding && x < prison.maxX + 2 + padding
    && z > prison.minZ - 2 - padding && z < prison.maxZ + 2 + padding) return false;
  for (const site of SITES) {
    if (!['building', 'landing', 'hatch', 'vantage', 'lighthouse'].includes(site.kind)) continue;
    const footprint = site.scale ? Math.max(...site.scale) * 0.55 : 5;
    const safeRadius = footprint + (site.kind === 'building' ? 8 : 5) + padding;
    if (Math.hypot(x - site.x, z - site.z) < safeRadius) return false;
  }
  for (const prop of HARBOR_PROP_SITES) {
    if (prop.surface === 'sea') continue;
    const radius = 1.4 + (prop.radius ?? 0.3) + padding;
    if ((x - prop.x) ** 2 + (z - prop.z) ** 2 < radius * radius) return false;
  }
  return true;
}

function addGrassChunks(scene, surface, geometry, lushMaterial, dryMaterial, random, isLake) {
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const chunks = [];
  const up = new THREE.Vector3(0, 1, 0);
  let count = 0;

  for (let ix = -CHUNK_EDGE; ix < CHUNK_EDGE; ix += CHUNK_SIZE) {
    for (let iz = -CHUNK_EDGE; iz < CHUNK_EDGE; iz += CHUNK_SIZE) {
      const cx = ix + CHUNK_SIZE / 2;
      const cz = iz + CHUNK_SIZE / 2;
      const lush = [];
      const dry = [];

      for (let attempt = 0; attempt < GRASS_ATTEMPTS_PER_CHUNK; attempt++) {
        const x = ix + random() * CHUNK_SIZE;
        const z = iz + random() * CHUNK_SIZE;
        if (inLakeViewCorridor(x, z) || !awayFromStructures(x, z, 0, isLake)) continue;
        const sample = surface(x, z);
        if (sample.radius >= COASTAL_GRASS_LIMIT || sample.height < 0.7
          || sample.trailDistance < 8.5) continue;
        // Only the sheltered upper island grows thick grass. Near the rocky
        // perimeter, or on a steep rise, leave the ground texture exposed.
        if (sample.radius > 0.75 || sample.height > 29) {
          const dx = surface(x + 1.4, z).height - sample.height;
          const dz = surface(x, z + 1.4).height - sample.height;
          if (Math.hypot(dx, dz) > 1.0) continue;
        }
        const meadow = 0.55 + 0.25 * Math.sin(x * 0.027 + z * 0.014)
          + 0.20 * Math.sin(z * 0.043 - x * 0.017);
        const nearTrail = 1 - smooth(11, 42, sample.trailDistance);
        const chance = clamp(0.73 + meadow * 0.18 + nearTrail * 0.12, 0, 0.98);
        if (random() > chance) continue;
        const exposed = smooth(0.58, 0.9, sample.radius);
        const dryness = clamp(exposed * 0.63 + (1 - meadow) * 0.30, 0, 0.92);
        const spec = { x, z, height: sample.height, yaw: random() * Math.PI * 2,
          width: 0.85 + random() * 0.57,
          tall: 0.78 + random() * 0.73,
          shade: random() };
        (random() < dryness ? dry : lush).push(spec);
      }

      for (const [specs, material, dryBlades] of [[lush, lushMaterial, false], [dry, dryMaterial, true]]) {
        if (specs.length === 0) continue;
        const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
        mesh.name = `${dryBlades ? 'Withered' : 'Coastal'} grass ${ix},${iz}`;
        mesh.position.set(cx, 0, cz);
        mesh.frustumCulled = true;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        for (let i = 0; i < specs.length; i++) {
          const p = specs[i];
          dummy.position.set(p.x - cx, p.height - 0.035, p.z - cz);
          dummy.quaternion.setFromAxisAngle(up, p.yaw);
          dummy.scale.set(p.width, p.tall, p.width);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          if (dryBlades) color.setRGB(0.90 + p.shade * 0.08, 0.87 + p.shade * 0.07, 0.77 + p.shade * 0.08);
          else color.setRGB(0.81 + p.shade * 0.16, 0.87 + p.shade * 0.10, 0.77 + p.shade * 0.14);
          mesh.setColorAt(i, color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        scene.add(mesh);
        chunks.push({ mesh, x: cx, z: cz });
        count += specs.length;
      }
    }
  }

  return { chunks, count };
}

function addWindSweptGrass(scene, surface, grassQuality, grassDensityMultiplier, isLake,
  windDirection, coastalRadius) {
  const terrain = {
    // The irregular coastline extends beyond +/-352 m at a few headlands.
    size: GRASS_FIELD_SIZE,
    heightAt: (x, z) => surface(x, z).height,
    densityAt(x, z) {
      // Wind and salt leave a broken, lower meadow on the exposed upper rim.
      // Preserve the terrain normal so slope rejection still excludes cliffs.
      const exposure = smooth(0.88, COASTAL_GRASS_LIMIT, coastalRadius(x, z));
      const patch = 0.5 + 0.25 * Math.sin(x * 0.047 + z * 0.019)
        + 0.25 * Math.sin(z * 0.063 - x * 0.017);
      return 1 - exposure * (0.55 + 0.35 * patch);
    },
    normalAt(x, z, target) {
      const sample = surface(x, z);
      // The upstream mask uses terrain normals for coverage. Use a downward
      // normal beyond the flat upper rim, including coves and cliff faces.
      if (sample.radius >= COASTAL_GRASS_LIMIT || sample.height < 0.7
        || inLakeViewCorridor(x, z)
        || !awayFromStructures(x, z, 0, isLake)) return target.set(0, -1, 0);
      const step = 0.8;
      const dx = surface(x + step, z).height - surface(x - step, z).height;
      const dz = surface(x, z + step).height - surface(x, z - step).height;
      return target.set(-dx, step * 2, -dz).normalize();
    },
    isPath: (x, z) => grassPathDistance(surface, x, z) < 7.5,
    path: {
      width: 7.5,
      shoulderWidth: 12.5,
      nearest: (x, z) => ({ distance: grassPathDistance(surface, x, z) }),
    },
  };
  const clearings = SITES.filter((site) => ['building', 'landing', 'hatch', 'vantage', 'lighthouse'].includes(site.kind))
    .map((site) => ({
      x: site.x, z: site.z,
      radius: (site.scale ? Math.max(...site.scale) * 0.55 : 5)
        + (site.kind === 'building' ? 9 : 6),
      hardness: 0.78,
    }));
  // Small authored gaps keep existing footpaths and lookout spots readable.
  for (const [x, z] of SMALL_CLEARINGS) {
    clearings.push({ x, z, radius: 3.2, hardness: 0.76 });
  }
  for (const prop of HARBOR_PROP_SITES) {
    if (prop.surface !== 'ground') continue;
    clearings.push({ x: prop.x, z: prop.z,
      radius: 1.9 + (prop.radius ?? 0.3), hardness: 0.78 });
  }
  const grass = new WindSweptGrass({
    terrain, quality: grassQuality, seed: 0x6d2b79f5,
    densityMultiplier: grassDensityMultiplier,
    windDirection,
    clearings,
  });
  grass.object3d.name = 'WindSweptGrass island field';
  scene.add(grass.object3d);
  return grass;
}

function addRocks(scene, surface, random, isLake) {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const positions = geometry.getAttribute('position');
  // Deform the source polyhedron once; all instances share the same low-cost
  // original stone geometry but vary scale, turn and muted coastal tint.
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    positions.setXYZ(i, x * 1.08, y * 0.72 + Math.sin(x * 6 + z * 9) * 0.08, z * 0.92);
  }
  geometry.computeVertexNormals();
  // These stones formerly had only a flat tint, so the many pale silhouettes
  // read as untextured props. Use the same bundled CC0 rock maps as the reef,
  // with one shared material across all instances and short-scale UV detail.
  const material = new THREE.MeshStandardMaterial({
    color: 0xc9ceca,
    map: texture('rock_ground_diff_1k.jpg', true, 2.4, 2.4, ROCK_TEX),
    normalMap: texture('rock_ground_nor_gl_1k.jpg', false, 2.4, 2.4, ROCK_TEX),
    roughnessMap: texture('rock_ground_rough_1k.jpg', false, 2.4, 2.4, ROCK_TEX),
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.97, metalness: 0, flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, 850);
  mesh.name = 'Scattered dark coastal stones';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let count = 0;
  let visibleCount = 0;
  const obstacles = [];
  for (let attempts = 0; attempts < 11000 && count < 850; attempts++) {
    const x = (random() - 0.5) * 700;
    const z = (random() - 0.5) * 700;
    if (!awayFromStructures(x, z, -3, isLake)) continue;
    const sample = surface(x, z);
    if (sample.radius > 0.975 || sample.height < 0.4 || sample.trailDistance < 4.2) continue;
    const coastal = smooth(0.62, 0.98, sample.radius);
    if (random() > 0.18 + 0.59 * coastal) continue;
    const size = 0.38 + random() * 1.3;
    // Consume the same seeded draws and reserve the same instance slot as the
    // original field. This removes deck rocks without rerolling the island's
    // remaining rocks and tree roots. The full stone radius plus player body
    // is clear of the boardwalk, including the seeded rock at (-0.6, 303).
    const clearDeck = southBoardwalkDeckDistance(x, z) < 2.4;
    dummy.position.set(x, sample.height + 0.11, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    const width = size * (0.75 + random() * 0.65);
    const height = size * (0.26 + random() * 0.28);
    dummy.scale.set(clearDeck ? 0 : width, clearDeck ? 0 : height,
      clearDeck ? 0 : size);
    dummy.updateMatrix();
    mesh.setMatrixAt(count, dummy.matrix);
    const tint = 0.63 + random() * 0.24;
    color.setRGB(tint * 0.93, tint * 0.97, tint);
    mesh.setColorAt(count, color);
    if (!clearDeck) {
      visibleCount++;
      if (size > 1.05) obstacles.push({ x, z, radius: size * 0.56 });
    }
    count++;
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return { count: visibleCount, obstacles };
}

function treePositions(surface, random, isLake) {
  const roots = [];
  // This lone, wind-shaped tree breaks the skyline above the tunnel approach.
  // Its trunk is well clear of the trail and hatch, so it also serves as a
  // landmark when the player looks north from the south service path.
  const landmark = { x: 188, z: 105 };
  const landmarkSample = surface(landmark.x, landmark.z);
  if (landmarkSample.radius < 0.79 && landmarkSample.trailDistance > 17
    && awayFromStructures(landmark.x, landmark.z, 9, isLake)) {
    roots.push({ ...landmark, y: landmarkSample.height, size: 1.56, landmark: true });
  }
  const spacing = 11.7;
  const cellSize = 12;
  const grid = new Map();
  const cell = (x, z) => `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
  for (const root of roots) grid.set(cell(root.x, root.z), [root]);
  for (let tries = 0; tries < 36000 && roots.length < TREE_COUNT; tries++) {
    const x = -274 + random() * 548;
    const z = -270 + random() * 540;
    if (!awayFromStructures(x, z, 7, isLake)) continue;
    const sample = surface(x, z);
    if (sample.radius > 0.84 || sample.height < 13 || sample.height > 57
      || sample.trailDistance < 15.5) continue;
    // Wind-scoured outer cap remains open: the extra trees collect in broad,
    // sheltered pockets instead of hiding the high coastal silhouette.
    const exposure = smooth(0.52, 0.84, sample.radius);
    const pocket = 0.5 + 0.25 * Math.sin(x * 0.022 + z * 0.009)
      + 0.25 * Math.sin(z * 0.025 - x * 0.011);
    if (random() > 0.96 - exposure * 0.33 + pocket * 0.16) continue;
    const cx = Math.floor(x / cellSize);
    const cz = Math.floor(z / cellSize);
    let separated = true;
    for (let dx = -2; dx <= 2 && separated; dx++) {
      for (let dz = -2; dz <= 2 && separated; dz++) {
        for (const other of grid.get(`${cx + dx},${cz + dz}`) || []) {
          if (Math.hypot(x - other.x, z - other.z) < (other.landmark ? 19 : spacing)) {
            separated = false;
            break;
          }
        }
      }
    }
    if (!separated) continue;
    const slope = Math.hypot(surface(x + 2, z).height - sample.height,
      surface(x, z + 2).height - sample.height);
    if (slope > 1.18) continue;
    const root = { x, z, y: sample.height,
      size: 0.76 + random() * 0.55 - exposure * 0.11 };
    roots.push(root);
    const key = cell(x, z);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(root);
  }
  return roots;
}

function leafSprayTexture() {
  // Original cutout artwork. EZ-Tree supplies the branching and leaf cards;
  // none of its bundled demonstration textures are used in the game.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(30, 20, 180, 235);
  gradient.addColorStop(0, '#667d5e');
  gradient.addColorStop(0.52, '#77946a');
  gradient.addColorStop(1, '#405b48');
  const leaf = (x, y, tipX, tipY, width) => {
    const dx = tipX - x;
    const dy = tipY - y;
    const sideX = -dy / Math.hypot(dx, dy) * width;
    const sideY = dx / Math.hypot(dx, dy) * width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + dx * 0.32 + sideX, y + dy * 0.32 + sideY,
      tipX, tipY);
    ctx.quadraticCurveTo(x + dx * 0.56 - sideX, y + dy * 0.56 - sideY,
      x, y);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = 'rgba(185,204,158,0.36)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  ctx.strokeStyle = '#536344';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(128, 252);
  ctx.bezierCurveTo(115, 171, 150, 97, 132, 18);
  ctx.stroke();
  leaf(127, 209, 46, 153, 20);
  leaf(132, 179, 218, 139, 23);
  leaf(133, 149, 53, 91, 19);
  leaf(137, 119, 213, 71, 19);
  leaf(135, 83, 85, 28, 17);
  leaf(134, 67, 176, 13, 15);
  leaf(132, 46, 128, 4, 12);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

// The same displacement is applied to woody branches and leaf cards. Keeping
// both in phase makes the canopy bend as one object instead of letting leaves
// visibly slide off a stationary tree during a squall.
function addTreeWind(shader, windTime, windStrength, windDirection, leaves) {
  shader.uniforms.uWindTime = windTime;
  shader.uniforms.uWindStrength = windStrength;
  shader.uniforms.uWindDirection = windDirection;
  shader.vertexShader = shader.vertexShader.replace('#include <common>',
    '#include <common>\nuniform float uWindTime;\nuniform float uWindStrength;\nuniform vec2 uWindDirection;');
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
    #include <begin_vertex>
    float treePhase = 0.0;
    #ifdef USE_INSTANCING
      treePhase = instanceMatrix[3].x * 0.037 + instanceMatrix[3].z * 0.053;
    #endif
    float crownWeight = smoothstep(0.65, 6.8, transformed.y);
    crownWeight *= crownWeight;
    float windWave = 0.50 * sin(uWindTime * 0.94 + treePhase)
      + 0.30 * sin(uWindTime * 1.83 + treePhase * 1.63)
      + 0.20 * sin(uWindTime * 0.37 + treePhase * 0.47);
    float crownBend = uWindStrength * crownWeight * (0.19 + windWave * 0.30);
    transformed.x += uWindDirection.x * crownBend;
    transformed.z += uWindDirection.y * crownBend;
    ${leaves ? `float leafFlutter = uWindStrength * crownWeight
      * (0.055 + uv.y * 0.085)
      * sin(uWindTime * 3.8 + treePhase * 2.1 + transformed.z * 0.53);
    transformed.x += uWindDirection.x * leafFlutter;
    transformed.z += uWindDirection.y * leafFlutter;` : ''}
  `);
}

function treeLeafMaterial(map, windTime, windStrength, windDirection, tint) {
  const material = new THREE.MeshStandardMaterial({
    map, color: tint, side: THREE.DoubleSide, alphaTest: 0.33,
    roughness: 1, metalness: 0, depthWrite: true,
  });
  material.onBeforeCompile = (shader) => addTreeWind(shader, windTime, windStrength,
    windDirection, true);
  material.customProgramCacheKey = () => 'island-world-ez-tree-leaf-wind-v3';
  return material;
}

export function makeTreePrototype(Tree, variant, near) {
  const tree = new Tree();
  tree.options.seed = 2019 + variant * 1723;
  tree.options.bark.textured = false;
  // EZ-Tree's deciduous length formula divides by (levels - 1), so even the
  // reduced distance geometry must retain two branch levels.
  tree.options.branch.levels = 2;
  tree.options.branch.children = near
    ? { 0: variant === 0 ? 8 : 7, 1: 3, 2: 0 }
    : { 0: 4, 1: 1, 2: 0 };
  tree.options.branch.length = { 0: 5.8, 1: 4.0, 2: 2.35 };
  tree.options.branch.radius = { 0: 0.35, 1: 0.55, 2: 0.34 };
  tree.options.branch.sections = near
    ? { 0: 7, 1: 5, 2: 4 }
    : { 0: 5, 1: 3, 2: 3 };
  tree.options.branch.segments = near
    ? { 0: 8, 1: 6, 2: 4 }
    : { 0: 6, 1: 4, 2: 3 };
  tree.options.branch.angle = { 1: 56, 2: 48 };
  tree.options.branch.start = { 1: 0.23, 2: 0.22 };
  tree.options.branch.taper = { 0: 0.72, 1: 0.75, 2: 0.92 };
  tree.options.branch.gnarliness = { 0: 0.055, 1: 0.17, 2: 0.31 };
  tree.options.branch.twist = { 0: 0, 1: 0.14, 2: 0.20 };
  tree.options.branch.force = {
    direction: { x: 1, y: 0.12, z: -0.22 },
    strength: variant === 0 ? 0.033 : 0.025,
  };
  tree.options.leaves.count = near ? (variant === 0 ? 19 : 16) : 10;
  tree.options.leaves.start = 0.30;
  tree.options.leaves.size = near ? (variant === 0 ? 0.84 : 0.74) : 0.91;
  tree.options.leaves.sizeVariance = 0.31;
  tree.options.leaves.angle = 22;
  tree.generate();
  const result = {
    branches: tree.branchesMesh.geometry,
    leaves: tree.leavesMesh.geometry,
  };
  tree.branchesMesh.material.dispose();
  tree.leavesMesh.material.dispose();
  return result;
}

/** Reuse one camera frustum and one test sphere across all tree roots. */
export function createTreeVisibilityFilter() {
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const previousPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  const previousQuaternion = new THREE.Quaternion();

  function refresh(camera) {
    if (camera.position.distanceToSquared(previousPosition) < 2.5 ** 2
      && Math.abs(camera.quaternion.dot(previousQuaternion)) >= TREE_VIEW_TURN_DOT) {
      return false;
    }
    previousPosition.copy(camera.position);
    previousQuaternion.copy(camera.quaternion);
    // World.update runs before renderer.render, so Three has not necessarily
    // refreshed the camera matrix after this frame's pointer movement yet.
    camera.updateMatrixWorld();
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    return true;
  }

  function includes(root) {
    sphere.center.set(root.x, root.y + root.size * 6, root.z);
    sphere.radius = root.size * TREE_FAR_VIEW_RADIUS_PER_SCALE;
    return frustum.intersectsSphere(sphere);
  }

  return { refresh, includes };
}

export function treeDetailForRoot(root, cameraX, cameraZ, viewFilter,
  farDistance = TREE_CULL_DISTANCE) {
  const distanceSquared = (root.x - cameraX) ** 2 + (root.z - cameraZ) ** 2;
  if (distanceSquared < TREE_LOD_DISTANCE ** 2) return 'near';
  if (distanceSquared < farDistance ** 2 && viewFilter.includes(root)) return 'far';
  return null;
}

/** Keep stable tree batches on the GPU when a camera refresh selects the same roots. */
export function syncTreeLodMeshes(meshes, selectedRoots, previousRoots) {
  if (selectedRoots.length === previousRoots.length
    && selectedRoots.every((root, index) => root === previousRoots[index])) return false;

  previousRoots.length = selectedRoots.length;
  for (let index = 0; index < selectedRoots.length; index++) {
    const root = selectedRoots[index];
    previousRoots[index] = root;
    meshes[0].setMatrixAt(index, root.matrix);
    meshes[1].setMatrixAt(index, root.matrix);
    meshes[1].setColorAt(index, root.tint);
  }
  for (const mesh of meshes) {
    mesh.count = selectedRoots.length;
    if (mesh.count > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
  return true;
}

function addTrees(scene, roots, barkMaps, windTime, windStrength, windDirection, random, Tree) {
  // Twelve silhouettes repeat with varied scale, turn and tint. The source
  // tree geometry is generated only 24 times (12 forms × two detail levels),
  // then shared by all 240 roots through instancing. At long range, the lean
  // and canopy remain, with fewer branch sections and leaf cards.
  const leafMap = leafSprayTexture();
  const barkMaterial = new THREE.MeshStandardMaterial({
    color: 0xc4c9b8, map: barkMaps.diffuse,
    normalMap: barkMaps.normal, roughnessMap: barkMaps.rough,
    normalScale: new THREE.Vector2(0.48, 0.48),
    roughness: 1, metalness: 0,
  });
  barkMaterial.onBeforeCompile = (shader) => addTreeWind(shader, windTime, windStrength,
    windDirection, false);
  barkMaterial.customProgramCacheKey = () => 'island-world-ez-tree-bark-wind-v2';
  const leafMaterial = treeLeafMaterial(leafMap, windTime, windStrength, windDirection,
    new THREE.Color(0xffffff));
  const groups = Array.from({ length: TREE_VARIANTS }, () => ({
    roots: [], near: [], far: [],
    nearRoots: [], farRoots: [], previousNear: [], previousFar: [],
  }));
  const orientation = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const position = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  roots.forEach((root, index) => {
    const yaw = (random() - 0.5) * 0.68;
    orientation.setFromAxisAngle(yAxis, yaw);
    size.setScalar(root.size);
    position.set(root.x, root.y - 0.15, root.z);
    root.matrix = new THREE.Matrix4().compose(position, orientation, size);
    root.tint = new THREE.Color().setRGB(
      0.75 + random() * 0.18, 0.79 + random() * 0.17, 0.70 + random() * 0.18,
    );
    groups[index % TREE_VARIANTS].roots.push(root);
  });

  let prototypeTriangles = 0;
  for (let variant = 0; variant < groups.length; variant++) {
    const group = groups[variant];
    for (const near of [true, false]) {
      const geometry = makeTreePrototype(Tree, variant, near);
      const level = near ? group.near : group.far;
      for (const [part, material] of [['branches', barkMaterial], ['leaves', leafMaterial]]) {
        const mesh = new THREE.InstancedMesh(geometry[part], material, group.roots.length);
        mesh.name = `Coastal ${near ? 'near' : 'far'} tree ${part} variant ${variant}`;
        mesh.count = 0;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = true;
        mesh.castShadow = near;
        mesh.receiveShadow = near;
        scene.add(mesh);
        level.push(mesh);
        prototypeTriangles += geometry[part].index
          ? geometry[part].index.count / 3
          : geometry[part].getAttribute('position').count / 3;
      }
    }
  }

  const viewFilter = createTreeVisibilityFilter();
  function updateVisibility(camera, { aerialCapture = false } = {}) {
    const x = camera.position.x;
    const z = camera.position.z;
    if (!viewFilter.refresh(camera)) return;
    for (const group of groups) {
      const nearRoots = group.nearRoots;
      const farRoots = group.farRoots;
      nearRoots.length = 0;
      farRoots.length = 0;
      for (const root of group.roots) {
        const detail = treeDetailForRoot(root, x, z, viewFilter,
          aerialCapture ? 1600 : TREE_CULL_DISTANCE);
        if (detail === 'near') nearRoots.push(root);
        if (detail === 'far') farRoots.push(root);
      }
      syncTreeLodMeshes(group.near, nearRoots, group.previousNear);
      syncTreeLodMeshes(group.far, farRoots, group.previousFar);
    }
  }
  return { updateVisibility, prototypeTriangles,
    maxDrawCalls: groups.length * 4 };
}

/**
 * Add a chunked meadow, scattered stone and sheltered coastal trees.
 * `surface(x,z)` is world.js's terrain sampler. World weather updates the
 * returned wind uniform refs; call updateVisibility(camera) once per frame.
 */
export function createVegetation(scene, surface, {
  grassQuality = 76_000, grassDensityMultiplier = 10,
  isLake = noLake, renderedHeight = (x, z) => surface(x, z).height,
  coastalRadius = (x, z) => surface(x, z).radius,
  tier = 'desktop',
} = {}) {
  const random = randomGenerator(0x6d2b79f5);
  const windTime = { value: 0 };
  const windStrength = { value: 0.3 };
  const windDirection = { value: new THREE.Vector2(1, 0.18).normalize() };
  const barkMaps = {
    diffuse: texture('bark_diffuse.jpg', true, 1, 2),
    normal: texture('bark_nor_gl.jpg', false, 1, 2),
    rough: texture('bark_rough.jpg', false, 1, 2),
  };
  const originalGrass = typeof document === 'undefined'
    || new URLSearchParams(location.search).get('grass') === 'original';
  let grass = null;
  let windSwept = null;
  const meadowChunks = [];
  if (originalGrass) {
    const leafyMap = texture('leafy_diffuse.jpg');
    const dryMap = texture('withered_diffuse.jpg');
    const blade = grassGeometry();
    const lushMaterial = windMaterial(leafyMap, windTime, windStrength, windDirection);
    const dryMaterial = windMaterial(dryMap, windTime, windStrength, windDirection);
    grass = addGrassChunks(scene, surface, blade, lushMaterial, dryMaterial, random, isLake);
  } else {
    windSwept = addWindSweptGrass(scene, surface, grassQuality, grassDensityMultiplier,
      isLake, windDirection.value, coastalRadius);
    windSwept.object3d.traverse((child) => {
      if (child.name.startsWith('WorldBladeClusterChunk-')) {
        meadowChunks.push({ mesh: child, bounds: child.geometry.boundingBox });
      }
    });
  }
  const rocks = addRocks(scene, surface, random, isLake);
  const roots = treePositions(surface, random, isLake);
  const existingObstacles = [
    // The tower's stone foundation has no passable ground-floor interior.
    { x: MAIN_LIGHTHOUSE_SITE.x, z: MAIN_LIGHTHOUSE_SITE.z,
      radius: MAIN_LIGHTHOUSE_SITE.radius },
    ...roots.map((root) => ({ x: root.x, z: root.z, radius: 0.38 * root.size + 0.12 })),
    ...rocks.obstacles,
  ];
  const coastalDetails = createCoastalDetails(scene, surface, renderedHeight, {
    isLake, isClear: (x, z, padding) => awayFromStructures(x, z, padding, isLake),
    existingObstacles, tier, windTime, windStrength, windDirection,
  });
  for (const region of coastalDetails.grassClearings) windSwept?.eraseRegion(region);
  const natureObstacles = createStaticCircleObstacles([
    ...existingObstacles,
    ...coastalDetails.obstacles,
  ]);
  const stats = { grassTufts: grass?.count ?? windSwept.renderedBladeCount,
    grassChunks: grass?.chunks.length ?? 0,
    grassSystem: originalGrass ? 'Original' : 'WindSweptGrass',
    grassAuthoredBlades: windSwept?.telemetry.authoredBladeCount ?? grass?.count,
    grassAuthoredClusters: windSwept?.telemetry.authoredClusterCount ?? grass?.count,
    grassDetailBlades: windSwept?.detailBladeCount ?? 0,
    rocks: rocks.count, trees: roots.length, coastalDetails: coastalDetails.counts,
    treePrototypeTriangles: 0, treeMaxDrawCalls: 0 };
  let trees = null;
  if (typeof document !== 'undefined') {
    // Load the MIT geometry subset without EZ-Tree's unused demo textures.
    // Browser-only loading keeps headless world geometry tests valid.
    import('./ezTreeGeometry/tree.js').then(({ Tree }) => {
      trees = addTrees(scene, roots, barkMaps, windTime, windStrength, windDirection,
        random, Tree);
      stats.treePrototypeTriangles = trees.prototypeTriangles;
      stats.treeMaxDrawCalls = trees.maxDrawCalls;
    }).catch((error) => console.error('Could not generate coastal trees:', error));
  }

  function updateVisibility(camera, { aerialCapture = false } = {}) {
    trees?.updateVisibility(camera, { aerialCapture });
    coastalDetails.updateVisibility(camera);
    if (windSwept) {
      const viewLimitSquared = MEADOW_CULL_DISTANCE * MEADOW_CULL_DISTANCE;
      for (const { mesh, bounds } of meadowChunks) {
        const dx = Math.max(bounds.min.x - camera.position.x, 0,
          camera.position.x - bounds.max.x);
        const dz = Math.max(bounds.min.z - camera.position.z, 0,
          camera.position.z - bounds.max.z);
        mesh.visible = dx * dx + dz * dz < viewLimitSquared;
      }
      windSwept.setFlatteners([{ id: 'player', position: camera.position,
        radius: 1.35, strength: 0.8, trail: true }]);
      windSwept.setWindStrength(windStrength.value);
      const now = windTime.value;
      const dt = Math.max(0, Math.min(0.05, now - lastGrassTime));
      windSwept.update(dt, now);
      lastGrassTime = now;
      stats.grassTufts = windSwept.renderedBladeCount;
      return;
    }
    const x = camera.position.x;
    const z = camera.position.z;
    const horizon = GRASS_CULL_DISTANCE + CHUNK_SIZE * 0.7;
    const limitSquared = horizon * horizon;
    for (const chunk of grass.chunks) {
      const dx = x - chunk.x;
      const dz = z - chunk.z;
      chunk.mesh.visible = dx * dx + dz * dz < limitSquared;
    }
  }

  let lastGrassTime = 0;

  return {
    windTime,
    windStrength,
    windDirection,
    updateVisibility,
    stats,
    natureObstacles,
  };
}
