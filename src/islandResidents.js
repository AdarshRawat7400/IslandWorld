import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

// Six bundled, distributable MakeHuman characters are shared between distant
// stations. Each type is downloaded once; sparse rig clones avoid multiplying
// textures or filling the scene with crowds that undermine its isolation.
export const RESIDENT_SITES = Object.freeze([
  { id: 'dockhand', name: 'Tamsin', role: 'Dockhand', model: 'tamsin',
    heading: 0, candidates: [[2, 266.6], [2.2, 267.4], [-2.2, 267.4]],
    line: 'The south cove changes with every tide.',
    stormLine: 'The pier is slick. Keep away from the outer rail.' },
  { id: 'lodge_caretaker', name: 'Iris', role: 'Lodge caretaker', model: 'iris',
    heading: -1.1, candidates: [[-77, 186], [-78, 193], [-90, 198]],
    line: 'There is always a dry room at the lodge.',
    stormLine: 'The roof holds. Come in if the wind gets worse.' },
  { id: 'archive_clerk', name: 'Elias', role: 'Archive clerk', model: 'elias',
    heading: -1.3, candidates: [[-155, 63], [-157, 70], [-152, 57]],
    line: 'The survey maps are older than the road.',
    stormLine: 'We keep the older maps clear of the damp.' },
  { id: 'radio_technician', name: 'Oren', role: 'Radio technician', model: 'oren',
    heading: 1.2, candidates: [[136, -54], [134, -45], [137, -61]],
    line: 'The aerial can hear the mainland on clear nights.',
    stormLine: 'Lightning puts a hiss across every channel.' },
  { id: 'signal_keeper', name: 'Jules', role: 'Signal keeper', model: 'elias',
    heading: -1.4, candidates: [[70, -230], [73, -236], [66, -240]],
    line: 'You can see both channels from the tower.',
    stormLine: 'The beam disappears, then returns in the rain.' },
  { id: 'lake_walker', name: 'Mira', role: 'Wildlife watcher', model: 'mira',
    heading: Math.PI, candidates: [[-70, -16], [-56, -16], [-84, -15]],
    line: 'The birds settle near the lake before dusk.',
    stormLine: 'The lake goes silver just before the squall.' },
  { id: 'pump_mechanic', name: 'Dane', role: 'Pump mechanic', model: 'dane',
    heading: Math.PI, candidates: [[124, 145], [113, 135], [127, 150]],
    line: 'The pump keeps the low rooms dry.',
    stormLine: 'I check the drain every time rain comes in.' },
  { id: 'north_jetty', name: 'Nell', role: 'Jetty hand', model: 'iris',
    heading: Math.PI, candidates: [[-71, -300], [-59, -300], [-72, -293]],
    line: 'Fishing boats use this inlet when the sea is calm.',
    stormLine: 'No boat should enter the inlet in this wind.' },
  { id: 'headland_surveyor', name: 'Cal', role: 'Coast surveyor', model: 'elias',
    heading: -Math.PI / 2, candidates: [[-195, -110], [-199, -102], [-191, -117]],
    line: 'The western cliff loses a little ground each winter.',
    stormLine: 'The wind is strongest along that broken edge.' },
  { id: 'south_shore_fisher', name: 'Finn', role: 'Shore fisher',
    model: 'gone-fishing-bree08', heading: 0, bodyRadius: 0.8,
    candidates: [[8, 337], [10, 335], [-8, 336]],
    line: 'The quieter water is just beyond the pier.',
    stormLine: 'I am waiting for the sea to settle.' },
  { id: 'north_shore_fisher', name: 'Bram', role: 'North inlet fisher',
    model: 'old-fisherman-bente-schoone', heading: Math.PI, bodyRadius: 1.45,
    candidates: [[-79, -305], [-80, -299], [-83, -291]],
    line: 'The inlet is good for a slow afternoon.',
    stormLine: 'I have seen this wind turn the inlet white.' },
]);

const TALK_RADIUS = 4.6;
const BODY_RADIUS = 0.42;
const CULL_DISTANCE_SQ = 100 * 100;
const SHADOW_DISTANCE_SQ = 38 * 38;
const RIG_LOAD_DISTANCE_SQ = 115 * 115;
const STATIC_MODELS = Object.freeze({
  'gone-fishing-bree08': {
    scale: 0.00112, offset: [-0.067, 0.0403, -0.376],
    loadDistanceSq: 100 * 100, cullDistanceSq: 88 * 88,
  },
  'old-fisherman-bente-schoone': {
    scale: 10, offset: [0.0126, 0.997, -0.304],
    loadDistanceSq: 75 * 75, cullDistanceSq: 64 * 64, noShadow: true,
    path: '/assets/sketchfab-npcs/old-fisherman-bente-schoone-optimized.glb',
  },
});
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const angleDelta = (target, origin) => Math.atan2(Math.sin(target - origin), Math.cos(target - origin));

// Exported separately so world placement can be checked without a WebGL scene.
export function selectResidentSites(definitions, { isSafe, isRoad }) {
  const selected = [];
  for (const definition of definitions) {
    const spot = definition.candidates.find(([x, z]) =>
      isSafe(x, z, definition) && !isRoad(x, z, definition.bodyRadius || 0.8)
      && selected.every((other) => Math.hypot(x - other.x, z - other.z) > 3));
    if (spot) selected.push({ ...definition, x: spot[0], z: spot[1] });
  }
  return selected;
}

export function createIslandResidents(scene, groundHeight, { isSafe, isRoad }) {
  const group = new THREE.Group();
  group.name = 'Sparse island residents';
  scene.add(group);
  const people = selectResidentSites(RESIDENT_SITES, { isSafe, isRoad }).map((site, index) => ({
    ...site, index, baseY: groundHeight(site.x, site.z) + 0.025,
    root: null, meshParts: null,
  }));
  const gltfLoader = new GLTFLoader();
  const models = new Map();
  const requested = new Set();
  let disposed = false;
  async function loadModel(modelId) {
    if (requested.has(modelId)) return;
    requested.add(modelId);
    const style = STATIC_MODELS[modelId];
    const path = style?.path || (style
      ? `/assets/sketchfab-npcs/${modelId}.glb` : `/assets/${modelId}.glb`);
    try {
      const { scene: source } = await gltfLoader.loadAsync(path);
      models.set(modelId, source);
      if (disposed) return;
      for (const person of people.filter((entry) => entry.model === modelId)) {
        const root = new THREE.Group();
        root.name = `${person.role} ${person.name}`;
        root.position.set(person.x, person.baseY, person.z);
        root.rotation.y = person.heading;
        const character = style ? source.clone(true) : cloneSkeleton(source);
        if (style) {
          character.scale.setScalar(style.scale);
          character.position.set(...style.offset);
        }
        const meshParts = [];
        character.traverse((object) => {
          if (object.isMesh) {
            // The source's two bright decorative ground/water card batches
            // clash with the island terrain. Keep the seated figure, chair,
            // tackle and rod; let the existing shoreline supply their setting.
            if (modelId === 'old-fisherman-bente-schoone'
              && /Material_(1018|1021)$/.test(object.name)) {
              object.visible = false;
              return;
            }
            object.castShadow = !style?.noShadow;
            object.receiveShadow = false;
            meshParts.push(object);
          }
        });
        root.add(character);
        root.visible = false;
        group.add(root);
        person.root = root;
        person.meshParts = meshParts;
        person.shadowsActive = !style?.noShadow;
      }
    } catch (error) {
      console.warn(`Could not load resident model ${modelId}`, error);
    }
  }
  // The landing dockhand is ready before the menu clears. Other rigs and the
  // larger Sketchfab scenes load once when the visitor approaches their area.
  const ready = Promise.allSettled(['tamsin'].filter((modelId) =>
    people.some((person) => person.model === modelId)).map(loadModel));

  function update(elapsed = 0, { dt = 0, cameraX = 0, cameraZ = 0,
    playerX = cameraX, playerZ = cameraZ, windDirection = null,
    windSpeed = 0 } = {}) {
    for (const person of people) {
      const dx = cameraX - person.x;
      const dz = cameraZ - person.z;
      const distanceSq = dx * dx + dz * dz;
      const style = STATIC_MODELS[person.model];
      if (!person.root) {
        if (distanceSq < (style?.loadDistanceSq || RIG_LOAD_DISTANCE_SQ)) {
          void loadModel(person.model);
        }
        continue;
      }
      person.root.visible = distanceSq < (style?.cullDistanceSq || CULL_DISTANCE_SQ);
      if (!person.root.visible) continue;
      const shadow = !style?.noShadow && distanceSq < SHADOW_DISTANCE_SQ;
      if (shadow !== person.shadowsActive) {
        for (const mesh of person.meshParts) mesh.castShadow = shadow;
        person.shadowsActive = shadow;
      }
      if (style) continue;
      const toPlayerX = playerX - person.x;
      const toPlayerZ = playerZ - person.z;
      const nearby = toPlayerX * toPlayerX + toPlayerZ * toPlayerZ < 7.5 * 7.5;
      // MakeHuman's authored forward axis is +Z.
      const face = Math.atan2(toPlayerX, toPlayerZ);
      const desiredYaw = person.heading + (nearby
        ? clamp(angleDelta(face, person.heading), -0.65, 0.65) : 0);
      person.root.rotation.y += angleDelta(desiredYaw, person.root.rotation.y)
        * clamp(dt * 2.4, 0, 1);
      person.root.position.y = person.baseY + Math.sin(elapsed * 1.15 + person.index) * 0.0025;
      const gust = clamp(windSpeed / 22, 0, 1) * 0.024;
      person.root.rotation.z = (windDirection?.x || 0) * gust;
      person.root.rotation.x = -(windDirection?.z || 0) * gust;
    }
  }

  function nearestPerson(x, z, maxDistance = TALK_RADIUS) {
    let nearest = null;
    let nearestDistance = maxDistance;
    for (const person of people) {
      if (!person.root) continue;
      const distance = Math.hypot(x - person.x, z - person.z);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = { id: person.id, name: person.name, role: person.role,
          line: person.line, stormLine: person.stormLine, distance };
      }
    }
    return nearest;
  }

  function collides(x, z, radius = 0.35) {
    return people.some((person) => person.root
      && Math.hypot(x - person.x, z - person.z)
        < (person.bodyRadius || BODY_RADIUS) + radius);
  }

  function dispose() {
    disposed = true;
    scene.remove(group);
    for (const source of models.values()) source.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
  }

  return { group, people, ready, update, nearestPerson, collides, dispose };
}
