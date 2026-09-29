import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lakeSignedDistance, INLAND_LAKE } from './inlandLake.js';

// These six Poly Haven CC0 models are small enough to instance. The source
// glTF scenes lay their variants out in a row; each mesh is used separately.
const ASSETS = Object.freeze([
  { id: 'grass_medium_02', count: 3100, seed: 0x38a41fe2, variants: [0, 2, 4],
    radius: 0.97, minHeight: 4, trail: 5.5, scale: [1.35, 2.15],
    lakeChance: 0.16, lakeBand: [8, 30], edgeChance: 0.45,
    edgeBand: [0.88, 0.967], edgeMinHeight: 18, edgeMaxSlope: 0.7,
    edgeScale: [1.1, 1.75], maxSlope: 1.0, cull: 115 },
  { id: 'fern_02', count: 1500, seed: 0x2ab9d014, variants: [0, 1, 2, 3],
    radius: 0.83, minHeight: 12, trail: 8, scale: [1.55, 2.85],
    lakeChance: 0.46, lakeBand: [8, 31], maxSlope: 0.9, cull: 120 },
  { id: 'shrub_sorrel_01', count: 2800, seed: 0xc2197d30, variants: [1, 2, 3, 4, 5],
    radius: 0.95, minHeight: 8, trail: 7, scale: [5.2, 8.5],
    lakeChance: 0.34, lakeBand: [8, 33], edgeChance: 0.38,
    edgeBand: [0.86, 0.948], edgeMinHeight: 20, edgeMaxSlope: 0.6,
    edgeScale: [3.5, 5.6], maxSlope: 0.95, cull: 110 },
  { id: 'shrub_03', count: 1200, seed: 0x73d104ad, variants: [0, 1, 2, 3],
    radius: 0.82, minHeight: 12, trail: 9, scale: [2.0, 3.3],
    lakeChance: 0.38, lakeBand: [9, 36], maxSlope: 0.76, cull: 135 },
  { id: 'dry_branches_medium_01', count: 65, seed: 0x74e10b53, variants: [0, 1, 2],
    radius: 0.95, minHeight: 3, trail: 10, scale: [1.0, 1.85],
    lakeChance: 0.27, lakeBand: [10, 34], maxSlope: 0.7, cull: 180,
    obstacleRadius: 0.56 },
  { id: 'rock_moss_set_02', count: 170, seed: 0x19b708a6, variants: [0, 2, 4, 6],
    radius: 0.96, minHeight: 4, trail: 10, scale: [0.55, 1.2],
    lakeChance: 0.56, lakeBand: [9, 34], edgeChance: 0.25,
    edgeBand: [0.87, 0.958], edgeMinHeight: 20, edgeMaxSlope: 0.55,
    edgeScale: [0.5, 0.9], maxSlope: 0.75, cull: 200,
    obstacleRadius: 1.15 },
]);
const CELL_SIZE = 128;
const DETAIL_FACTOR = Object.freeze({
  desktop: 1, 'mobile-high': 0.45, 'mobile-standard': 0.22,
  'mobile-constrained': 0.08,
});
const up = new THREE.Vector3(0, 1, 0);

function randomGenerator(initialSeed) {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function candidatePosition(definition, random, surface) {
  const region = random();
  if (region < definition.lakeChance) {
    const angle = random() * Math.PI * 2;
    const extra = definition.lakeBand[0]
      + random() * (definition.lakeBand[1] - definition.lakeBand[0]);
    return {
      x: INLAND_LAKE.x + Math.cos(angle) * (INLAND_LAKE.radiusX + extra),
      z: INLAND_LAKE.z + Math.sin(angle) * (INLAND_LAKE.radiusZ + extra),
    };
  }
  if (definition.edgeBand && region < definition.lakeChance + definition.edgeChance) {
    // Map an annulus to the actual irregular coastline, including headlands
    // beyond the old +/-310 m candidate square. One radius sample gives the
    // correct scale at this angle without a costly search per placement.
    const angle = random() * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const [inner, outer] = definition.edgeBand;
    const targetRadius = Math.sqrt(inner * inner
      + random() * (outer * outer - inner * inner));
    const scale = targetRadius / surface(dx * 350, dz * 350).radius;
    return { x: dx * 350 * scale, z: dz * 350 * scale, edge: true };
  }
  return { x: -310 + random() * 620, z: -310 + random() * 620 };
}

function overlapsObstacle(x, z, radius, obstacles) {
  for (const other of obstacles) {
    const reach = radius + other.radius + 0.35;
    const dx = x - other.x;
    const dz = z - other.z;
    if (dx * dx + dz * dz < reach * reach) return true;
  }
  return false;
}

export function planCoastalDetails(surface, groundHeight, {
  isClear, isLake, existingObstacles = [], tier = 'desktop',
} = {}) {
  const factor = DETAIL_FACTOR[tier] ?? 1;
  const plans = [];
  const obstacles = [];
  for (const definition of ASSETS) {
    const random = randomGenerator(definition.seed);
    const placements = [];
    const target = Math.round(definition.count * factor);
    for (let attempt = 0; attempt < target * 26 && placements.length < target; attempt++) {
      const { x, z, edge = false } = candidatePosition(definition, random, surface);
      const large = Boolean(definition.obstacleRadius);
      if (isLake?.(x, z, large ? 6 : 5) || !isClear?.(x, z, large ? 1.6 : 0)) continue;
      // Keep the lake's north-bank sightline open from the player viewpoint.
      if (x > -79 && x < -61 && z > -31 && z < -7) continue;
      const sample = surface(x, z);
      if (sample.radius >= definition.radius || sample.height < definition.minHeight
        || sample.trailDistance < definition.trail) continue;
      if (edge && (sample.radius < definition.edgeBand[0]
        || sample.radius > definition.edgeBand[1]
        || sample.height < definition.edgeMinHeight)) continue;
      const nearLake = lakeSignedDistance(x, z);
      const exposure = sample.radius;
      if (definition.id === 'fern_02' && exposure > 0.61 && nearLake > 40) continue;
      if (definition.id === 'dry_branches_medium_01'
        && exposure < 0.55 && nearLake > 35) continue;
      if (definition.id === 'rock_moss_set_02'
        && exposure < 0.55 && nearLake > 35) continue;
      const slope = Math.hypot(surface(x + 1.2, z).height - sample.height,
        surface(x, z + 1.2).height - sample.height);
      if (slope > (edge ? definition.edgeMaxSlope : definition.maxSlope)) continue;
      const scaleRange = edge ? definition.edgeScale : definition.scale;
      const scale = scaleRange[0] + random() * (scaleRange[1] - scaleRange[0]);
      const radius = (definition.obstacleRadius ?? 0) * scale;
      if (large && overlapsObstacle(x, z, radius,
        [...existingObstacles, ...obstacles])) continue;
      const y = groundHeight(x, z);
      const variant = definition.variants[
        Math.floor(random() * definition.variants.length)];
      placements.push({ x, y, z, variant, scale,
        angle: random() * Math.PI * 2, tint: random() });
      if (large) obstacles.push({ x, z, radius });
    }
    plans.push({ definition, placements });
  }
  return { plans, obstacles };
}

function prepareGeometry(source) {
  const geometry = source.geometry.clone();
  const transform = new THREE.Matrix4().compose(new THREE.Vector3(),
    source.quaternion, source.scale);
  geometry.applyMatrix4(transform);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  geometry.translate(-(box.min.x + box.max.x) * 0.5, -box.min.y,
    -(box.min.z + box.max.z) * 0.5);
  geometry.computeBoundingSphere();
  return geometry;
}

function windMaterial(material, windTime, windStrength, windDirection) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.coastalWindTime = windTime;
    shader.uniforms.coastalWindStrength = windStrength;
    shader.uniforms.coastalWindDirection = windDirection;
    shader.vertexShader = `uniform float coastalWindTime;
      uniform float coastalWindStrength;
      uniform vec2 coastalWindDirection;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      float coastalBladeHeight = max(position.y, 0.0);
      float coastalPhase = instanceMatrix[3].x * 0.083 + instanceMatrix[3].z * 0.071;
      float coastalGust = sin(coastalWindTime * 1.34 + coastalPhase)
        + 0.38 * sin(coastalWindTime * 2.57 - coastalPhase * 1.7);
      transformed.x += coastalWindDirection.x * coastalBladeHeight * coastalWindStrength * 0.075 * coastalGust;
      transformed.z += coastalWindDirection.y * coastalBladeHeight * coastalWindStrength * 0.075 * coastalGust;`);
  };
  material.customProgramCacheKey = () => 'island-coastal-detail-wind-v2';
}

function addAsset(scene, definition, placements, gltf, alphaMap, windTime,
  windStrength, windDirection, visibleMeshes) {
  const sources = [];
  gltf.scene.traverse((child) => {
    if (child.isMesh) sources.push(child);
  });
  const assetGroup = new THREE.Group();
  assetGroup.name = `CC0 ${definition.id} coastal detail`;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let variant = 0; variant < sources.length; variant++) {
    const specs = placements.filter((p) => p.variant === variant);
    if (!specs.length) continue;
    const source = sources[variant];
    const geometry = prepareGeometry(source);
    const material = source.material.clone();
    material.side = THREE.DoubleSide;
    if (alphaMap) {
      material.alphaMap = alphaMap;
      material.alphaTest = 0.49;
      material.transparent = false;
      windMaterial(material, windTime, windStrength, windDirection);
    } else {
      material.roughness = Math.max(material.roughness, 0.86);
    }
    const cells = new Map();
    for (const spec of specs) {
      const ix = Math.floor(spec.x / CELL_SIZE);
      const iz = Math.floor(spec.z / CELL_SIZE);
      const key = `${ix},${iz}`;
      if (!cells.has(key)) cells.set(key, { ix, iz, specs: [] });
      cells.get(key).specs.push(spec);
    }
    for (const cell of cells.values()) {
      const cx = (cell.ix + 0.5) * CELL_SIZE;
      const cz = (cell.iz + 0.5) * CELL_SIZE;
      const mesh = new THREE.InstancedMesh(geometry, material, cell.specs.length);
      mesh.name = `${definition.id} variant ${variant} ${cell.ix},${cell.iz}`;
      mesh.position.set(cx, 0, cz);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      for (let i = 0; i < cell.specs.length; i++) {
        const p = cell.specs[i];
        dummy.position.set(p.x - cx, p.y - (alphaMap ? 0.025 : 0.09), p.z - cz);
        dummy.quaternion.setFromAxisAngle(up, p.angle);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const shade = 0.81 + p.tint * 0.23;
        color.setRGB(shade, shade * (alphaMap ? 1.01 : 0.98), shade);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      assetGroup.add(mesh);
      visibleMeshes.push({ mesh, cx, cz, distance: definition.cull });
    }
  }
  scene.add(assetGroup);
}

export function createCoastalDetails(scene, surface, groundHeight, options) {
  const { plans, obstacles } = planCoastalDetails(surface, groundHeight, options);
  const visibleMeshes = [];
  const windTime = options.windTime;
  const windStrength = options.windStrength;
  const windDirection = options.windDirection;
  const counts = Object.fromEntries(plans.map(({ definition, placements }) =>
    [definition.id, placements.length]));
  const grassClearings = obstacles.map((item) => ({
    x: item.x, z: item.z, radius: item.radius + 0.5,
    hardness: 0.56, strength: 0.78,
  }));
  const fernPlacements = plans.find(({ definition }) => definition.id === 'fern_02')
    ?.placements ?? [];
  for (let i = 0; i < fernPlacements.length; i += 5) {
    const p = fernPlacements[i];
    if (lakeSignedDistance(p.x, p.z) > 42) continue;
    grassClearings.push({ x: p.x, z: p.z, radius: 1.75,
      hardness: 0.32, strength: 0.52 });
  }
  if (typeof document !== 'undefined') {
    const loader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();
    const base = `${import.meta.env.BASE_URL}assets/coastal-models/`;
    for (const { definition, placements } of plans) {
      if (!placements.length) continue;
      const directory = `${base}${definition.id}/`;
      const alphaMap = ['grass_medium_02', 'fern_02', 'shrub_sorrel_01', 'shrub_03']
        .includes(definition.id)
        ? textureLoader.load(`${directory}textures/${definition.id}_alpha_1k.png`)
        : null;
      // GLTFLoader sets flipY=false on the color atlas. The separate cutout
      // mask must use the same UV orientation or fronds disappear.
      if (alphaMap) alphaMap.flipY = false;
      loader.load(`${directory}${definition.id}_1k.gltf`, (gltf) => {
        addAsset(scene, definition, placements, gltf, alphaMap,
          windTime, windStrength, windDirection, visibleMeshes);
      }, undefined, (error) => console.error(`Could not load ${definition.id}:`, error));
    }
  }
  return {
    obstacles,
    counts,
    grassClearings,
    updateVisibility(camera) {
      for (const entry of visibleMeshes) {
        const dx = Math.max(Math.abs(entry.cx - camera.position.x) - CELL_SIZE * 0.5, 0);
        const dz = Math.max(Math.abs(entry.cz - camera.position.z) - CELL_SIZE * 0.5, 0);
        entry.mesh.visible = dx * dx + dz * dz < entry.distance * entry.distance;
      }
    },
  };
}
