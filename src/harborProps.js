import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Small, authored groups of weathered CC0 objects. Each model is loaded once
// when the player approaches, then its geometry and maps are shared by clones.
// Keep navigable paths, the ferry gap, and the lake's open sightline uncluttered.
export const HARBOR_PROP_SITES = Object.freeze([
  { id: 'south-safety-ring', model: 'lifebuoy', x: -3.7, z: 350.8,
    surface: 'south-pier', height: 0.78, yaw: 0, yOffset: 0.43 },
  { id: 'north-safety-ring', model: 'lifebuoy', x: -67.6, z: -321,
    surface: 'north-jetty', height: 0.78, yaw: Math.PI, yOffset: 0.67 },
  { id: 'south-cargo', model: 'wooden_crate_02', x: -2.75, z: 346,
    surface: 'south-pier', width: 0.55, yaw: 0.24, radius: 0.74 },
  { id: 'north-cargo', model: 'wooden_crate_02', x: -62.8, z: -317,
    surface: 'north-jetty', width: 0.54, yaw: -0.28, radius: 0.72 },
  { id: 'keeper-cargo', model: 'wooden_crate_02', x: -69.4, z: 185,
    surface: 'ground', width: 0.55, yaw: -0.16, radius: 0.74 },
  { id: 'pump-cargo', model: 'wooden_crate_02', x: 112.7, z: 129,
    surface: 'ground', width: 0.54, yaw: 0.37, radius: 0.72 },
  { id: 'south-fishing-bucket', model: 'wooden_bucket_02', x: 10.5, z: 336,
    surface: 'ground', width: 0.59, yaw: 0.6, radius: 0.34 },
  { id: 'north-fishing-bucket', model: 'wooden_bucket_02', x: -84, z: -303,
    surface: 'ground', width: 0.6, yaw: -0.52, radius: 0.35 },
  { id: 'keeper-water-bucket', model: 'wooden_bucket_02', x: -68.2, z: 188,
    surface: 'ground', width: 0.59, yaw: 1.15, radius: 0.34 },
  { id: 'radio-utility-box', model: 'utility_box_02', x: 130.4, z: -55,
    surface: 'ground', width: 1.05, yaw: 0.22, radius: 0.74 },
  { id: 'pump-utility-box', model: 'utility_box_02', x: 111.7, z: 136,
    surface: 'ground', width: 1.05, yaw: -0.68, radius: 0.74 },
  { id: 'west-searchlight', model: 'portable_searchlight', x: -187.5, z: -115,
    surface: 'ground', height: 0.48, yaw: -Math.PI / 2, yOffset: 0.75, radius: 0.62 },
  { id: 'east-searchlight', model: 'portable_searchlight', x: 223.5, z: -123,
    surface: 'ground', height: 0.48, yaw: Math.PI / 2, yOffset: 0.75, radius: 0.62 },
  { id: 'south-channel-buoy', model: 'ocean_buoy', x: 29, z: 373,
    surface: 'sea', height: 3.1, yaw: 0.27, immersion: 0.8 },
  { id: 'north-channel-buoy', model: 'ocean_buoy', x: -38, z: -361,
    surface: 'sea', height: 3.1, yaw: -0.58, immersion: 0.8 },
]);

const LOAD_DISTANCE = 165;
const VISIBLE_DISTANCE = 215;
const SHADOW_DISTANCE = 48;

/** Resolve the static scene plan before any models are downloaded. */
export function planHarborProps(sites, {
  groundHeight, pierHeight, northJettyHeight, waterHeight, isGroundSafe,
}) {
  const planned = [];
  for (const site of sites) {
    if (site.surface === 'ground' && !isGroundSafe(site.x, site.z, site.radius ?? 0)) continue;
    const y = site.surface === 'south-pier' ? pierHeight(site.x, site.z)
      : site.surface === 'north-jetty' ? northJettyHeight
        : site.surface === 'sea' ? waterHeight(site.x, site.z, 0) : groundHeight(site.x, site.z);
    if (!Number.isFinite(y)) continue;
    planned.push({ ...site, y });
  }
  return planned;
}

function centeredVisual(source, site) {
  const visual = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(visual);
  const size = bounds.getSize(new THREE.Vector3());
  const dimension = site.height ? size.y : size.x;
  const target = site.height || site.width;
  const scale = target / Math.max(dimension, 0.001);
  visual.scale.setScalar(scale);
  visual.position.set(-(bounds.min.x + bounds.max.x) * 0.5 * scale,
    -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * 0.5 * scale);
  return visual;
}

function addSearchlightTripod(root) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x414c49,
    metalness: 0.58, roughness: 0.69 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.055, 12), metal);
  top.position.y = 0.73;
  top.castShadow = true;
  root.add(top);
  const up = new THREE.Vector3(0, 1, 0);
  const start = new THREE.Vector3(0, 0.7, 0);
  for (let index = 0; index < 3; index++) {
    const angle = index * Math.PI * 2 / 3;
    const end = new THREE.Vector3(Math.cos(angle) * 0.42, 0.04,
      Math.sin(angle) * 0.42);
    const axis = end.clone().sub(start);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035,
      axis.length(), 8), metal);
    leg.position.copy(start).add(end).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(up, axis.normalize());
    leg.castShadow = true;
    root.add(leg);
  }
}

export function createHarborProps(scene, {
  groundHeight, pierHeight, northJettyHeight, waterHeight, isGroundSafe,
}) {
  const sites = planHarborProps(HARBOR_PROP_SITES, {
    groundHeight, pierHeight, northJettyHeight, waterHeight, isGroundSafe,
  });
  const colliders = sites.filter((site) => site.radius).map((site) => ({
    x: site.x, z: site.z, radius: site.radius,
  }));
  const group = new THREE.Group();
  group.name = 'Weathered harbor and service props';
  scene.add(group);
  const loader = new GLTFLoader();
  const models = new Map();
  const pending = new Set();
  const objects = new Map();

  function attach(modelId, source) {
    for (const site of sites.filter((entry) => entry.model === modelId)) {
      const root = new THREE.Group();
      root.name = site.id;
      root.position.set(site.x, site.y, site.z);
      root.rotation.y = site.yaw ?? 0;
      const visual = centeredVisual(source, site);
      visual.position.y += site.yOffset ?? 0;
      visual.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) mat.side = THREE.DoubleSide;
        }
      });
      root.add(visual);
      if (modelId === 'portable_searchlight') addSearchlightTripod(root);
      if (site.id === 'north-safety-ring') {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.42, 8),
          new THREE.MeshStandardMaterial({ color: 0x394341, metalness: 0.64, roughness: 0.61 }));
        post.position.y = 0.71;
        post.castShadow = true;
        root.add(post);
      }
      group.add(root);
      objects.set(site.id, root);
    }
  }

  async function ensureLoaded(modelId) {
    if (pending.has(modelId) || models.has(modelId)) return;
    pending.add(modelId);
    try {
      const path = `${import.meta.env.BASE_URL}assets/harbor-props/${modelId}/${modelId}_1k.gltf`;
      const { scene: source } = await loader.loadAsync(path);
      models.set(modelId, source);
      attach(modelId, source);
    } catch (error) {
      console.warn(`Could not load harbor prop ${modelId}:`, error);
    }
  }

  function update(camera, elapsed = 0, rain = 0) {
    const x = camera.position.x, z = camera.position.z;
    for (const site of sites) {
      const distanceSq = (site.x - x) ** 2 + (site.z - z) ** 2;
      if (distanceSq < LOAD_DISTANCE ** 2) ensureLoaded(site.model);
      const root = objects.get(site.id);
      if (!root) continue;
      root.visible = distanceSq < VISIBLE_DISTANCE ** 2;
      if (!root.visible) continue;
      if (site.surface === 'sea') {
        root.position.y = waterHeight(site.x, site.z, elapsed) - site.immersion;
        root.rotation.z = Math.sin(elapsed * 0.72 + site.x) * (0.022 + rain * 0.028);
        root.rotation.x = Math.cos(elapsed * 0.63 + site.z) * (0.018 + rain * 0.024);
      }
      const shadow = distanceSq < SHADOW_DISTANCE ** 2;
      root.traverse((child) => { if (child.isMesh) child.castShadow = shadow; });
    }
  }

  return {
    group, sites, colliders, update,
    collides(x, z, radius = 0) {
      return colliders.some((item) => (item.x - x) ** 2 + (item.z - z) ** 2
        < (item.radius + radius) ** 2);
    },
  };
}
