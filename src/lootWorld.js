import * as THREE from 'three';
import { ITEM_DEFINITIONS } from './combatLoot.js';

const MAX_PICKUP_VISUALS = 96;
const VISIBLE_DISTANCE = 110;
const DEFAULT_REACH = 2.6;

function makeResources() {
  const geometry = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
    sphere: new THREE.SphereGeometry(1, 10, 7),
    torus: new THREE.TorusGeometry(1, 0.075, 4, 18),
  };
  const material = {
    platform: new THREE.MeshStandardMaterial({ color: 0x24373d, roughness: 0.75,
      metalness: 0.28 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8a9694, roughness: 0.42,
      metalness: 0.72 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x303c40, roughness: 0.53,
      metalness: 0.64 }),
    timber: new THREE.MeshStandardMaterial({ color: 0x765840, roughness: 0.83 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x69745a, roughness: 0.72,
      metalness: 0.22 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xe2a354, roughness: 0.46,
      emissive: 0x7c4216, emissiveIntensity: 0.45 }),
    cyan: new THREE.MeshStandardMaterial({ color: 0x88d3cc, roughness: 0.45,
      emissive: 0x2c7876, emissiveIntensity: 0.65 }),
    red: new THREE.MeshStandardMaterial({ color: 0xda735d, roughness: 0.53,
      emissive: 0x79261e, emissiveIntensity: 0.55 }),
    cream: new THREE.MeshStandardMaterial({ color: 0xe6e2d3, roughness: 0.82 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd2ad63, roughness: 0.36,
      metalness: 0.7, emissive: 0x5b3e14, emissiveIntensity: 0.35 }),
  };
  return { geometry, material };
}

function part(parent, geometry, material, size, position, rotationZ = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(...size);
  mesh.position.set(...position);
  mesh.rotation.z = rotationZ;
  parent.add(mesh);
  return mesh;
}

function makeGun(group, resources, itemId) {
  const { geometry: g, material: m } = resources;
  const long = itemId !== 'revolver';
  const barrelLength = itemId === 'rifle' ? 0.92 : itemId === 'shotgun' ? 0.72 : 0.34;
  const receiverLength = long ? 0.39 : 0.25;
  const silhouette = new THREE.Group();
  silhouette.position.y = 0.53;
  silhouette.rotation.y = -Math.PI / 4;
  group.add(silhouette);
  part(silhouette, g.box, m.darkSteel, [receiverLength, 0.16, 0.18],
    [0.01, 0, 0]);
  part(silhouette, g.cylinder, m.steel, [0.048, barrelLength, 0.048],
    [receiverLength * 0.5 + barrelLength * 0.5, 0.055, 0], -Math.PI / 2);
  part(silhouette, g.box, m.timber, [long ? 0.36 : 0.11, 0.14, 0.13],
    [-receiverLength * 0.5 - (long ? 0.18 : 0.04), -0.045, 0]);
  part(silhouette, g.box, m.timber, [0.12, 0.24, 0.12],
    [-receiverLength * 0.22, -0.18, 0], -0.24);
  if (itemId === 'shotgun') {
    part(silhouette, g.cylinder, m.darkSteel, [0.038, barrelLength * 0.72, 0.038],
      [receiverLength * 0.5 + barrelLength * 0.44, -0.035, 0], -Math.PI / 2);
  }
}

function makeGrenade(group, resources) {
  const { geometry: g, material: m } = resources;
  part(group, g.sphere, m.olive, [0.23, 0.27, 0.23], [0, 0.54, 0]);
  part(group, g.cylinder, m.steel, [0.085, 0.075, 0.085], [0, 0.82, 0]);
  part(group, g.box, m.darkSteel, [0.23, 0.045, 0.075],
    [0.075, 0.86, 0], -0.17);
  part(group, g.torus, m.steel, [0.065, 0.065, 0.065],
    [-0.11, 0.9, 0]).rotation.y = Math.PI / 2;
}

function makeMine(group, resources) {
  const { geometry: g, material: m } = resources;
  part(group, g.cylinder, m.olive, [0.32, 0.11, 0.32], [0, 0.39, 0]);
  part(group, g.cylinder, m.darkSteel, [0.25, 0.025, 0.25], [0, 0.46, 0]);
  part(group, g.cylinder, m.red, [0.065, 0.03, 0.065], [0, 0.49, 0]);
  for (let i = 0; i < 4; i += 1) {
    const angle = i * Math.PI / 2;
    part(group, g.box, m.steel, [0.13, 0.04, 0.07],
      [Math.cos(angle) * 0.3, 0.37, Math.sin(angle) * 0.3]);
  }
}

function makeMedkit(group, resources) {
  const { geometry: g, material: m } = resources;
  part(group, g.box, m.cream, [0.55, 0.24, 0.42], [0, 0.48, 0]);
  part(group, g.box, m.darkSteel, [0.2, 0.045, 0.07], [0, 0.63, -0.18]);
  // Cross on the lid is legible when the player looks down to collect it.
  part(group, g.box, m.red, [0.33, 0.025, 0.09], [0, 0.615, 0]);
  part(group, g.box, m.red, [0.09, 0.027, 0.29], [0, 0.617, 0]);
}

function makeAmmo(group, resources) {
  const { geometry: g, material: m } = resources;
  part(group, g.box, m.olive, [0.54, 0.24, 0.38], [0, 0.46, 0]);
  part(group, g.box, m.darkSteel, [0.57, 0.055, 0.41], [0, 0.61, 0]);
  part(group, g.box, m.brass, [0.28, 0.035, 0.05], [0, 0.643, 0.09]);
  for (const x of [-0.13, 0, 0.13])
    part(group, g.cylinder, m.brass, [0.035, 0.13, 0.035], [x, 0.72, -0.07]);
}

function makeArmor(group, resources) {
  const { geometry: g, material: m } = resources;
  // A compact padded vest and rigid plate silhouette, distinct from supply cases.
  part(group, g.box, m.olive, [0.55, 0.48, 0.16], [0, 0.58, 0]);
  part(group, g.box, m.darkSteel, [0.4, 0.38, 0.045], [0, 0.58, -0.1]);
  part(group, g.box, m.steel, [0.32, 0.29, 0.02], [0, 0.59, -0.13]);
  for (const x of [-0.22, 0.22]) {
    part(group, g.box, m.timber, [0.09, 0.26, 0.18], [x, 0.84, 0]);
    part(group, g.box, m.darkSteel, [0.06, 0.33, 0.21], [x, 0.64, 0]);
  }
}

function accentMaterial(kind, materials) {
  if (kind === 'gun') return materials.orange;
  if (kind === 'grenade') return materials.cyan;
  if (kind === 'ammo') return materials.brass;
  if (kind === 'armor') return materials.steel;
  return materials.red;
}

function createVisual(item, terrainHeight, resources) {
  const { geometry: g, material: m } = resources;
  const group = new THREE.Group();
  group.name = `Pickup ${item.id} ${item.itemId}`;
  const dropIndex = Number(item.id.match(/-(\d+)$/)?.[1] ?? 0);
  const offset = dropIndex * 2.399963229728653;
  const x = item.x + (item.source === 'player' ? Math.cos(offset) * 0.42 : 0);
  const z = item.z + (item.source === 'player' ? Math.sin(offset) * 0.42 : 0);
  const ground = terrainHeight(x, z);
  group.position.set(x, Number.isFinite(ground) ? ground + 0.06 : 0.06, z);
  part(group, g.cylinder, m.platform, [0.48, 0.06, 0.48], [0, 0.04, 0]);
  const accent = accentMaterial(item.kind, m);
  const ring = part(group, g.torus, accent,
  [0.51, 0.51, 0.51], [0, 0.1, 0]);
  ring.rotation.x = Math.PI / 2;
  if (item.kind === 'gun') makeGun(group, resources, item.itemId);
  else if (item.kind === 'grenade') makeGrenade(group, resources);
  else if (item.kind === 'mine') makeMine(group, resources);
  else if (item.kind === 'medkit') makeMedkit(group, resources);
  else if (item.kind === 'ammo') makeAmmo(group, resources);
  else makeArmor(group, resources);
  const beacon = part(group, g.sphere, accent,
  [0.075, 0.075, 0.075], [0, 1.13, 0]);
  return { group, ring, beacon, ground: group.position.y };
}

function validPickup(value) {
  const definition = Object.hasOwn(ITEM_DEFINITIONS, value?.itemId)
    ? ITEM_DEFINITIONS[value.itemId] : null;
  return definition && typeof value.id === 'string' && value.id.length <= 128
    && Number.isFinite(value.x) && Number.isFinite(value.z)
    && (value.kind === undefined || value.kind === definition.kind);
}

/** Visual, network-agnostic pickups. Call sync for solo or room snapshots. */
export function createLootWorld(scene, terrainHeight, options = {}) {
  if (!scene?.add || typeof terrainHeight !== 'function')
    throw new TypeError('createLootWorld requires a scene and terrainHeight(x, z)');
  const resources = makeResources();
  const root = new THREE.Group();
  root.name = 'Collectible equipment and supplies';
  scene.add(root);
  const records = new Map();
  const visuals = new Map();
  const maxVisuals = Math.min(MAX_PICKUP_VISUALS,
    Math.max(1, Math.floor(options.maxVisuals ?? MAX_PICKUP_VISUALS)));
  let disposed = false;
  let clock = 0;

  function sync(items = []) {
    if (disposed) return;
    const fresh = new Map();
    for (const raw of Array.isArray(items) ? items : []) {
      if (!validPickup(raw) || raw.active === false || raw.available === false
        || raw.collected === true || raw.count === 0 || fresh.has(raw.id)) continue;
      const definition = ITEM_DEFINITIONS[raw.itemId];
      fresh.set(raw.id, { id: raw.id, kind: definition.kind, itemId: raw.itemId,
        x: raw.x, z: raw.z,
        count: Number.isInteger(raw.count) && raw.count > 0 ? raw.count : 1,
        source: raw.source === 'player' ? 'player' : 'world',
        label: definition.label });
    }
    for (const [id, visual] of visuals) {
      const current = fresh.get(id);
      const previous = records.get(id);
      if (current && previous?.x === current.x && previous?.z === current.z
        && previous?.itemId === current.itemId) continue;
      root.remove(visual.group);
      visuals.delete(id);
    }
    records.clear();
    for (const [id, item] of fresh) records.set(id, item);
    // Limit the object count even if a malformed or crowded snapshot arrives.
    for (const item of records.values()) {
      if (visuals.size >= maxVisuals) break;
      if (visuals.has(item.id)) continue;
      const visual = createVisual(item, terrainHeight, resources);
      visuals.set(item.id, visual);
      root.add(visual.group);
    }
  }

  function nearby(x, z, maxDistance = DEFAULT_REACH) {
    if (disposed || !Number.isFinite(x) || !Number.isFinite(z)
      || !Number.isFinite(maxDistance) || maxDistance < 0) return null;
    let closest = null;
    let distanceSquared = maxDistance * maxDistance;
    for (const item of records.values()) {
      const dx = item.x - x;
      const dz = item.z - z;
      const squared = dx * dx + dz * dz;
      if (squared <= distanceSquared) {
        closest = item;
        distanceSquared = squared;
      }
    }
    return closest ? { item: { ...closest }, distance: Math.sqrt(distanceSquared) } : null;
  }

  function update(dt = 0, elapsed, camera) {
    if (disposed) return;
    clock = Number.isFinite(elapsed) ? elapsed
      : clock + (Number.isFinite(dt) ? Math.max(0, dt) : 0);
    const cameraX = camera?.position?.x;
    const cameraZ = camera?.position?.z;
    for (const [id, visual] of visuals) {
      const item = records.get(id);
      if (Number.isFinite(cameraX) && Number.isFinite(cameraZ)) {
        const dx = item.x - cameraX;
        const dz = item.z - cameraZ;
        visual.group.visible = dx * dx + dz * dz <= VISIBLE_DISTANCE ** 2;
      } else visual.group.visible = true;
      if (!visual.group.visible) continue;
      visual.ring.rotation.z = clock * 0.3;
      visual.beacon.position.y = 1.13 + Math.sin(clock * 2.1 + item.x) * 0.08;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(root);
    root.clear();
    records.clear();
    visuals.clear();
    for (const item of Object.values(resources.geometry)) item.dispose();
    for (const item of Object.values(resources.material)) item.dispose();
  }

  return { group: root, sync, nearby, getNearby: nearby, update, dispose,
    get count() { return records.size; }, get visualCount() { return visuals.size; } };
}
