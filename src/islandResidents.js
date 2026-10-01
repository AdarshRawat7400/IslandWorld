import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createNpcAttackPresentation } from './npcAttackPresentation.js';
import { createHumanReaction, advanceHumanReaction, resetHumanReaction,
  triggerHumanHit, humanBoneBend } from './humanCombatReaction.js';

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

export function createIslandResidents(scene, groundHeight,
  { isSafe, isRoad, loadModels = true }) {
  const group = new THREE.Group();
  group.name = 'Sparse island residents';
  scene.add(group);
  const people = selectResidentSites(RESIDENT_SITES, { isSafe, isRoad }).map((site, index) => ({
    ...site, index, baseY: groundHeight(site.x, site.z) + 0.025,
    spawnX: site.x, spawnZ: site.z, root: null, meshParts: null,
    kind: 'resident', health: 100, maxHealth: 100, dead: false, alerted: false,
    collapse: 0, reaction: createHumanReaction(index), reactionBones: [],
    attackFaceRemaining: 0, attackTarget: null,
  }));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const cues = createNpcAttackPresentation(group);
  const gunGeometry = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  };
  const gunMaterials = {
    metal: new THREE.MeshStandardMaterial({ color: 0x343b3a, metalness: 0.66,
      roughness: 0.47 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x674a35, metalness: 0.03,
      roughness: 0.82 }),
  };
  const gunRest = new THREE.Vector3(0.36, 0.86, 0.07);
  const gunRaised = new THREE.Vector3(0.36, 1.18, 0.31);
  const reactionAxis = new THREE.Vector3();
  const reactionTilt = new THREE.Quaternion();
  const boneRotation = new THREE.Quaternion();
  const boneEuler = new THREE.Euler();

  function createResidentGun() {
    const gun = new THREE.Group();
    gun.name = 'Weathered island revolver';
    const part = (geometry, material, x, y, z, sx, sy, sz) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true;
      gun.add(mesh);
      return mesh;
    };
    part(gunGeometry.box, gunMaterials.metal, 0, 0, 0.04,
      0.17, 0.11, 0.25);
    part(gunGeometry.box, gunMaterials.metal, 0, 0.015, 0.23,
      0.07, 0.07, 0.22);
    const chamber = part(gunGeometry.cylinder, gunMaterials.metal,
      0, 0, 0.065, 0.10, 0.16, 0.10);
    chamber.rotation.x = Math.PI / 2;
    part(gunGeometry.box, gunMaterials.wood, 0, -0.14, -0.075,
      0.09, 0.22, 0.11);
    gun.position.set(0.36, 0.86, 0.07);
    gun.rotation.x = 0.92;
    return gun;
  }
  const gltfLoader = new GLTFLoader();
  const models = new Map();
  const requested = new Set();
  let disposed = false;
  function disposeModelSource(source) {
    const resources = new Set();
    source.traverse((object) => {
      if (!object.isMesh) return;
      if (object.geometry) resources.add(object.geometry);
      if (object.skeleton) resources.add(object.skeleton);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
    });
    for (const resource of resources) resource.dispose?.();
  }
  async function loadModel(modelId) {
    if (requested.has(modelId)) return;
    requested.add(modelId);
    const style = STATIC_MODELS[modelId];
    const path = style?.path || (style
      ? `/assets/sketchfab-npcs/${modelId}.glb` : `/assets/${modelId}.glb`);
    try {
      const { scene: source } = await gltfLoader.loadAsync(path);
      if (disposed) { disposeModelSource(source); return; }
      models.set(modelId, source);
      for (const person of people.filter((entry) => entry.model === modelId)) {
        const root = new THREE.Group();
        root.name = `${person.role} ${person.name}`;
        root.position.set(person.x, person.baseY, person.z);
        root.rotation.y = person.heading;
        root.rotation.order = 'YXZ';
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
        const gun = createResidentGun();
        root.add(gun);
        root.visible = false;
        group.add(root);
        person.root = root;
        person.gun = gun;
        person.meshParts = meshParts;
        person.shadowsActive = !style?.noShadow;
        character.traverse((object) => {
          if (object.isBone && /^(thigh_|calf_|upperarm_|lowerarm_|spine_0[23]$|head$)/i.test(object.name)) {
            person.reactionBones.push({ bone: object, rest: object.quaternion.clone() });
          }
        });
      }
    } catch (error) {
      console.warn(`Could not load resident model ${modelId}`, error);
    }
  }
  // The landing dockhand is ready before the menu clears. Other rigs and the
  // larger Sketchfab scenes load once when the visitor approaches their area.
  const ready = Promise.allSettled((loadModels ? ['tamsin'] : []).filter((modelId) =>
    people.some((person) => person.model === modelId)).map(loadModel));

  function update(elapsed = 0, { dt = 0, cameraX = 0, cameraZ = 0,
    playerX = cameraX, playerZ = cameraZ, windDirection = null,
    windSpeed = 0 } = {}) {
    cues.update(dt);
    for (const person of people) {
      if (person.dead && !person.reaction.dead) {
        person.deathHeading = person.root?.rotation.y ?? person.heading;
      }
      const reaction = advanceHumanReaction(person.reaction, dt, person.dead);
      person.collapse = reaction.collapse;
      person.attackFaceRemaining = Math.max(0,
        person.attackFaceRemaining - Math.max(0, dt));
      const dx = cameraX - person.x;
      const dz = cameraZ - person.z;
      const distanceSq = dx * dx + dz * dz;
      const style = STATIC_MODELS[person.model];
      if (!person.root) {
        if (loadModels && distanceSq < (style?.loadDistanceSq || RIG_LOAD_DISTANCE_SQ)) {
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
      person.root.position.set(person.x, person.baseY, person.z);
      person.root.scale.y = reaction.scaleY;
      if (person.gun) {
        const raised = person.alerted && !person.dead;
        const blend = clamp(dt * 7, 0, 1);
        person.gun.position.lerp(raised ? gunRaised : gunRest, blend);
        person.gun.rotation.x += ((raised ? -0.08 : 0.92) - person.gun.rotation.x)
          * blend;
      }
      if (person.dead) {
        person.root.rotation.set(0, person.deathHeading, 0, 'YXZ');
        applyReaction(person, reaction);
        continue;
      }
      person.root.rotation.x = 0;
      if (style) {
        if (person.alerted || person.attackFaceRemaining > 0) {
          const target = person.attackFaceRemaining > 0
            ? person.attackTarget : { x: playerX, z: playerZ };
          const face = Math.atan2(target.x - person.x, target.z - person.z);
          person.root.rotation.y += angleDelta(face, person.root.rotation.y)
            * clamp(dt * 2.4, 0, 1);
        }
        person.root.rotation.x = person.root.rotation.z = 0;
        applyReaction(person, reaction);
        continue;
      }
      const toPlayerX = playerX - person.x;
      const toPlayerZ = playerZ - person.z;
      const nearby = toPlayerX * toPlayerX + toPlayerZ * toPlayerZ < 7.5 * 7.5;
      // MakeHuman's authored forward axis is +Z.
      const faceX = person.attackFaceRemaining > 0 ? person.attackTarget.x : playerX;
      const faceZ = person.attackFaceRemaining > 0 ? person.attackTarget.z : playerZ;
      const face = Math.atan2(faceX - person.x, faceZ - person.z);
      const desiredYaw = person.alerted || person.attackFaceRemaining > 0 ? face
        : person.heading + (nearby
          ? clamp(angleDelta(face, person.heading), -0.65, 0.65) : 0);
      person.root.rotation.y += angleDelta(desiredYaw, person.root.rotation.y)
        * clamp(dt * (person.alerted ? 5.2 : 2.4), 0, 1);
      person.root.position.y = person.baseY + Math.sin(elapsed * 1.15 + person.index) * 0.0025;
      const gust = clamp(windSpeed / 22, 0, 1) * 0.024;
      person.root.rotation.z = (windDirection?.x || 0) * gust;
      person.root.rotation.x = -(windDirection?.z || 0) * gust;
      applyReaction(person, reaction);
    }
  }

  function applyReaction(person, pose) {
    reactionAxis.set(pose.fallZ, 0, -pose.fallX);
    reactionTilt.setFromAxisAngle(reactionAxis, pose.angle);
    person.root.quaternion.multiply(reactionTilt);
    person.root.position.y += pose.rootOffset;
    for (const { bone, rest } of person.reactionBones) {
      const bend = humanBoneBend(bone.name, pose);
      boneEuler.set(bend.x, 0, bend.z);
      boneRotation.setFromEuler(boneEuler);
      bone.quaternion.copy(rest).multiply(boneRotation);
    }
  }

  function nearestPerson(x, z, maxDistance = TALK_RADIUS) {
    let nearest = null;
    let nearestDistance = maxDistance;
    for (const person of people) {
      if (!person.root || person.dead) continue;
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
    return people.some((person) => person.root && !person.dead
      && Math.hypot(x - person.x, z - person.z)
        < (person.bodyRadius || BODY_RADIUS) + radius);
  }

  function getCombatTargets() {
    return people.map((person) => ({ id: person.id, kind: 'resident',
      x: person.x, y: person.baseY + 1.05, z: person.z,
      radius: 0.65, alive: !person.dead, health: person.health,
      maxHealth: person.maxHealth }));
  }

  function setCombatStates(states) {
    for (const state of Array.isArray(states) ? states : Object.values(states || {})) {
      const person = peopleById.get(state?.id);
      if (!person) continue;
      const nextDead = typeof state.dead === 'boolean' ? state.dead
        : Number.isFinite(state.health) ? state.health <= 0 : person.dead;
      if (!(person.dead && nextDead) && Number.isFinite(state.x) && Number.isFinite(state.z)) {
        person.x = state.x;
        person.z = state.z;
        person.baseY = Number.isFinite(state.y)
          ? state.y + 0.025 : groundHeight(state.x, state.z) + 0.025;
      }
      if (Number.isFinite(state.health)) {
        if (state.health < person.health && !person.dead) triggerHumanHit(person.reaction,
          { damage: person.health - state.health, heading: person.root?.rotation.y || person.heading });
        person.health = Math.max(0, state.health);
      }
      if (Number.isFinite(state.maxHealth)) person.maxHealth = Math.max(1, state.maxHealth);
      if (typeof state.dead === 'boolean') person.dead = state.dead;
      else if (Number.isFinite(state.health)) person.dead = state.health <= 0;
      if (typeof state.alerted === 'boolean') person.alerted = state.alerted;
      if ('targetId' in state) person.targetId = state.targetId;
    }
  }

  function resetCombatStates() {
    for (const person of people) {
      person.x = person.spawnX;
      person.z = person.spawnZ;
      person.baseY = groundHeight(person.x, person.z) + 0.025;
      person.health = person.maxHealth = 100;
      person.dead = person.alerted = false;
      person.targetId = null;
      person.collapse = 0;
      resetHumanReaction(person.reaction);
      person.attackFaceRemaining = 0;
      if (person.root) {
        person.root.rotation.set(0, person.heading, 0, 'YXZ');
        person.root.scale.y = 1;
        person.root.position.set(person.x, person.baseY, person.z);
      }
      for (const { bone, rest } of person.reactionBones) bone.quaternion.copy(rest);
    }
  }

  function showCombatHit(id, options = {}) {
    const person = peopleById.get(id);
    if (!person) return;
    triggerHumanHit(person.reaction, { ...options,
      heading: person.root?.rotation.y ?? person.heading });
    cues.showHit({ x: person.x, y: person.baseY + 1.22, z: person.z });
  }

  function getCombatPosition(id) {
    const person = peopleById.get(id);
    return person ? { x: person.x, y: person.baseY + (person.dead ? 0.35 : 1.2),
      z: person.z } : null;
  }

  function showAttack(id, target, { noProjectile = false } = {}) {
    const person = peopleById.get(id);
    if (!person || person.dead) return;
    person.alerted = true;
    if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
      person.attackTarget = target;
      person.attackFaceRemaining = 0.75;
    }
    cues.showAttack(noProjectile ? 'guard_muzzle' : 'guard',
      { x: person.x, y: person.baseY + 1.28, z: person.z }, target);
  }

  function dispose() {
    disposed = true;
    cues.dispose();
    for (const geometry of Object.values(gunGeometry)) geometry.dispose();
    for (const material of Object.values(gunMaterials)) material.dispose();
    scene.remove(group);
    for (const person of people) person.root?.traverse((object) => {
      if (object.isSkinnedMesh) object.skeleton?.dispose();
    });
    for (const source of models.values()) disposeModelSource(source);
    models.clear();
  }

  return { group, people, ready, update, nearestPerson, collides,
    getCombatTargets, setCombatStates, resetCombatStates,
    showCombatHit, showAttack, getCombatPosition, dispose };
}
