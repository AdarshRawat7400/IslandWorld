import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createPlayerStateBuffer } from './multiplayerInterpolation.js';
import { createHumanReaction, advanceHumanReaction, resetHumanReaction,
  triggerHumanHit, humanBoneBend, HUMAN_COLLAPSE_SECONDS } from './humanCombatReaction.js';

const MODEL_PATHS = ['/assets/elias.glb', '/assets/mira.glb', '/assets/tamsin.glb'];
const COAT_COLORS = [0x607d77, 0x788498, 0x897a68, 0x71806a,
  0x786b77, 0x8a8068, 0x667f82, 0x87736b, 0x68748c];
const SWING_AXIS = new THREE.Vector3(1, 0, 0);
const swing = new THREE.Quaternion();
// The models are about 1.85 m tall. Rotate around their midsection so prone
// players lie along their facing direction instead of pivoting around a foot.
const BODY_PIVOT_Y = 0.92;
export const REMOTE_PLAYER_POSES = Object.freeze({
  stand: Object.freeze({ scaleY: 1, lean: 0, pivotY: BODY_PIVOT_Y, labelY: 2.35,
    stride: 1 }),
  crouch: Object.freeze({ scaleY: 0.62, lean: 0.22, pivotY: 0.60, labelY: 1.50,
    stride: 0.55 }),
  prone: Object.freeze({ scaleY: 0.76, lean: 1.43, pivotY: 0.30, labelY: 0.96,
    stride: 0.16 }),
});

function hashId(id) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function makeFallback(color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.42, 0.94, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.92 }));
  body.position.y = 1.05;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xb99b83, roughness: 0.9 }));
  head.position.y = 1.72;
  head.userData.reactionPart = 'head';
  group.add(head);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.12, 0.75, 6),
      new THREE.MeshStandardMaterial({ color: 0x303d3d, roughness: 0.95 }));
    leg.position.set(side * 0.14, 0.38, 0);
    leg.userData.reactionPart = side < 0 ? 'thigh_l' : 'thigh_r';
    group.add(leg);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.085, 0.72, 6),
      body.material.clone());
    arm.position.set(side * 0.39, 1.13, 0);
    arm.rotation.z = side * 0.13;
    arm.userData.reactionPart = side < 0 ? 'upperarm_l' : 'upperarm_r';
    group.add(arm);
  }
  return group;
}

function disposeFallback(group) {
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    object.material?.dispose();
  });
}

function nameplate(name, disconnected) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = disconnected ? '#172126c4' : '#0b2328df';
  ctx.fillRect(0, 6, 256, 52);
  ctx.strokeStyle = disconnected ? '#89928b' : '#dbc48e';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 7, 254, 50);
  ctx.font = '600 23px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = disconnected ? '#b6bab2' : '#f5eedc';
  let label = String(name || 'Player').slice(0, 24);
  while (ctx.measureText(label).width > 230 && label.length > 3) label = `${label.slice(0, -2)}…`;
  ctx.fillText(label, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true,
    depthTest: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.y = 2.35;
  sprite.scale.set(2.35, 0.59, 1);
  sprite.userData.dispose = () => { texture.dispose(); material.dispose(); };
  return sprite;
}

export function createRemotePlayers(scene, { groundHeight = () => 0,
  cullDistance = 235, now = () => performance.now(), loadModels = true,
  createNameplate = nameplate } = {}) {
  const group = new THREE.Group();
  group.name = 'Online room players';
  scene.add(group);
  const records = new Map();
  const buffer = createPlayerStateBuffer();
  const loader = new GLTFLoader();
  const sources = MODEL_PATHS.map(() => null);
  const requested = new Set();
  let disposed = false;
  const reactionAxis = new THREE.Vector3();
  const reactionRotation = new THREE.Quaternion();
  const reactionBoneEuler = new THREE.Euler();
  const reactionBoneRotation = new THREE.Quaternion();

  function collectReactionBones(model) {
    const bones = [];
    model.traverse((object) => {
      const name = object.isBone ? object.name : object.userData.reactionPart;
      if (name && /^(thigh_|calf_|upperarm_|lowerarm_|spine_0[23]$|head$)/i.test(name)) {
        bones.push({ bone: object, name, rest: object.quaternion.clone() });
      }
    });
    return bones;
  }

  function disposeSource(source) {
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

  function loadModel(index) {
    if (requested.has(index)) return;
    requested.add(index);
    loader.loadAsync(MODEL_PATHS[index]).then(({ scene: source }) => {
      if (disposed) { disposeSource(source); return; }
      sources[index] = source;
      for (const record of records.values()) {
        if (record.modelIndex === index) installModel(record, source);
      }
    }).catch((error) => {
      console.warn(`Could not load remote player ${MODEL_PATHS[index]}`, error);
    });
  }

  function installModel(record, source) {
    if (record.hasRig) return;
    const rig = cloneSkeleton(source);
    record.meshParts = [];
    record.shadowActive = false;
    rig.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;
        record.meshParts.push(object);
      }
    });
    record.limbs = [];
    rig.traverse((object) => {
      if (!object.isBone) return;
      const limb = {
        thigh_l: [0, 0.47], thigh_r: [Math.PI, 0.47],
        upperarm_l: [Math.PI, 0.24], upperarm_r: [0, 0.24],
      }[object.name.toLowerCase()];
      if (limb) record.limbs.push({ bone: object, rest: object.quaternion.clone(),
        phase: limb[0], amplitude: limb[1] });
    });
    record.figure.remove(record.model);
    disposeFallback(record.model);
    record.model = rig;
    record.reactionBones = collectReactionBones(rig);
    rig.position.y = -BODY_PIVOT_Y;
    record.figure.add(rig);
    record.hasRig = true;
  }

  function add(player) {
    const variant = hashId(player.id);
    const modelIndex = variant % MODEL_PATHS.length;
    const root = new THREE.Group();
    root.name = `Room player ${player.name || player.id}`;
    const figure = new THREE.Group();
    const model = makeFallback(COAT_COLORS[variant % COAT_COLORS.length]);
    const initialPose = REMOTE_PLAYER_POSES[player.stance] || REMOTE_PLAYER_POSES.stand;
    figure.position.y = initialPose.pivotY;
    figure.scale.y = initialPose.scaleY;
    figure.rotation.x = initialPose.lean;
    model.position.y = -BODY_PIVOT_Y;
    figure.add(model);
    root.add(figure);
    const label = createNameplate(player.name, player.connected === false);
    label.position.y = initialPose.labelY;
    root.add(label);
    group.add(root);
    const record = { root, figure, model, label, modelIndex, hasRig: false,
      name: player.name, disconnected: player.connected === false, limbs: [],
      latest: player, lastX: player.x, lastZ: player.z, stride: 0,
      movementSpeed: 0, meshParts: [], shadowActive: false,
      reaction: createHumanReaction(variant), deathAnchor: null,
      reactionBones: collectReactionBones(model), stanceLean: initialPose.lean,
      stanceScale: initialPose.scaleY, stancePivot: initialPose.pivotY,
      stanceLabelY: initialPose.labelY };
    records.set(player.id, record);
    if (sources[modelIndex]) installModel(record, sources[modelIndex]);
    else if (loadModels) loadModel(modelIndex);
    return record;
  }

  function remove(id) {
    const record = records.get(id);
    if (!record) return;
    group.remove(record.root);
    record.label.userData.dispose();
    if (!record.hasRig) disposeFallback(record.model);
    else record.model.traverse((object) => { if (object.isSkinnedMesh) object.skeleton?.dispose(); });
    records.delete(id);
    buffer.remove(id);
  }

  function ingest(room, selfId, receivedAt = now()) {
    if (!room?.players) return;
    const liveIds = new Set();
    for (const player of room.players) {
      if (player.id === selfId || typeof player.id !== 'string') continue;
      liveIds.add(player.id);
      const record = records.get(player.id) || add(player);
      if (record.name !== player.name || record.disconnected !== (player.connected === false)) {
        record.root.remove(record.label);
        record.label.userData.dispose();
        record.label = createNameplate(player.name, player.connected === false);
        record.root.add(record.label);
        record.name = player.name;
        record.disconnected = player.connected === false;
      }
      if (player.dead && !record.deathAnchor) {
        record.deathAnchor = { x: player.x, z: player.z, yaw: player.yaw,
          y: groundHeight(player.x, player.z), stance: player.stance };
        record.deathStartRotation = record.figure.quaternion.clone();
        if (Number.isFinite(room.serverNow) && Number.isFinite(player.deadAt) && player.deadAt > 0) {
          advanceHumanReaction(record.reaction, 0, true);
          record.reaction.deathTime = Math.min(HUMAN_COLLAPSE_SECONDS,
            Math.max(0, (room.serverNow - player.deadAt) / 1000));
        }
      } else if (!player.dead && record.deathAnchor) {
        record.deathAnchor = null;
        resetHumanReaction(record.reaction);
        record.lastX = player.x;
        record.lastZ = player.z;
        record.movementSpeed = record.stride = 0;
        const pose = REMOTE_PLAYER_POSES[player.stance] || REMOTE_PLAYER_POSES.stand;
        record.stanceLean = pose.lean;
        record.stanceScale = pose.scaleY;
        record.stancePivot = pose.pivotY;
        record.stanceLabelY = pose.labelY;
      }
      if (Number.isFinite(player.health) && Number.isFinite(record.latest.health)
        && player.health < record.latest.health && !record.latest.dead) {
        triggerHumanHit(record.reaction, { damage: record.latest.health - player.health,
          heading: player.yaw + Math.PI });
      }
      record.latest = player;
      buffer.push(player, receivedAt);
    }
    for (const id of records.keys()) if (!liveIds.has(id)) remove(id);
  }

  function update(at = now(), dt = 0, camera = null) {
    for (const [id, record] of records) {
      const poseReaction = advanceHumanReaction(record.reaction, dt, Boolean(record.latest.dead));
      const state = record.deathAnchor || buffer.sample(id, at);
      if (!state) continue;
      const hidden = !record.latest.dead && (record.latest.connected === false
        || state.mode === 'drive' || state.mode === 'drone');
      const dx = (camera?.position.x || 0) - state.x;
      const dz = (camera?.position.z || 0) - state.z;
      record.root.visible = !hidden && (!camera || dx * dx + dz * dz < cullDistance ** 2);
      if (!record.root.visible) continue;
      const shadow = dx * dx + dz * dz < 58 ** 2;
      if (shadow !== record.shadowActive) {
        for (const mesh of record.meshParts) mesh.castShadow = shadow;
        record.shadowActive = shadow;
      }
      record.label.visible = !record.latest.dead;
      record.root.position.set(state.x, record.deathAnchor?.y ?? groundHeight(state.x, state.z), state.z);
      record.root.rotation.y = state.yaw + Math.PI;
      const speed = Math.hypot(state.x - record.lastX, state.z - record.lastZ)
        / Math.max(0.016, dt || 0.016);
      record.lastX = state.x;
      record.lastZ = state.z;
      record.movementSpeed += (Math.min(18, speed) - record.movementSpeed)
        * Math.min(1, Math.max(0, dt) * 9);
      const stance = state.stance === 'prone' ? 'prone'
        : state.stance === 'crouch' ? 'crouch' : 'stand';
      const pose = REMOTE_PLAYER_POSES[stance];
      const poseBlend = Math.min(1, Math.max(0, dt) * 10);
      record.stanceScale += (pose.scaleY - record.stanceScale) * poseBlend;
      record.stanceLean += (pose.lean - record.stanceLean) * poseBlend;
      record.stanceLabelY += (pose.labelY - record.stanceLabelY) * poseBlend;
      record.label.position.y = record.stanceLabelY;
      const moving = !record.latest.dead && record.movementSpeed > 0.3 && record.movementSpeed < 18;
      if (moving) record.stride += Math.min(0.1, dt) * Math.min(12, 5 + record.movementSpeed);
      const strideStrength = moving ? Math.min(1, record.movementSpeed / 3)
        * pose.stride : 0;
      for (const { bone, rest } of record.reactionBones) bone.quaternion.copy(rest);
      for (const limb of record.limbs) {
        swing.setFromAxisAngle(SWING_AXIS,
          Math.sin(record.stride + limb.phase) * limb.amplitude * strideStrength);
        limb.bone.quaternion.copy(limb.rest).multiply(swing);
      }
      const bob = moving && stance === 'stand'
        ? Math.abs(Math.sin(record.stride)) * 0.035 : 0;
      record.stancePivot += (pose.pivotY + bob - record.stancePivot) * poseBlend;
      const proneStart = record.latest.dead && record.deathAnchor?.stance === 'prone';
      const crouchStart = record.latest.dead && record.deathAnchor?.stance === 'crouch';
      const startingScale = proneStart ? REMOTE_PLAYER_POSES.prone.scaleY
        : crouchStart ? REMOTE_PLAYER_POSES.crouch.scaleY : 1;
      record.figure.scale.y = record.latest.dead
        ? (startingScale + (1 - startingScale) * poseReaction.collapse) * poseReaction.scaleY
        : record.stanceScale;
      if (record.latest.dead) {
        reactionAxis.set(proneStart ? 1 : poseReaction.fallZ, 0,
          proneStart ? 0 : -poseReaction.fallX);
        reactionRotation.setFromAxisAngle(reactionAxis, Math.PI / 2);
        record.figure.quaternion.copy(record.deathStartRotation)
          .slerp(reactionRotation, poseReaction.collapse);
        const startingPivot = crouchStart ? REMOTE_PLAYER_POSES.crouch.pivotY : BODY_PIVOT_Y;
        record.figure.position.y = proneStart
          ? 0.27 + (poseReaction.rootOffset - 0.27) * poseReaction.collapse
          : poseReaction.rootOffset + startingPivot
            * Math.cos(poseReaction.angle) * poseReaction.scaleY;
      } else {
        record.figure.position.y = record.stancePivot;
        record.figure.rotation.set(record.stanceLean, 0,
          moving && stance === 'stand' ? Math.sin(record.stride * 0.5) * 0.012 : 0);
        reactionAxis.set(poseReaction.fallZ, 0, -poseReaction.fallX);
        reactionRotation.setFromAxisAngle(reactionAxis, poseReaction.angle);
        record.figure.quaternion.multiply(reactionRotation);
      }
      for (const { bone, name } of record.reactionBones) {
        const bend = humanBoneBend(name, poseReaction);
        reactionBoneEuler.set(bend.x, 0, bend.z);
        reactionBoneRotation.setFromEuler(reactionBoneEuler);
        bone.quaternion.multiply(reactionBoneRotation);
      }
    }
  }

  function showCombatHit(id, options = {}) {
    const record = records.get(id);
    if (!record) return;
    triggerHumanHit(record.reaction, { ...options, heading: record.latest.yaw + Math.PI });
  }

  function getCombatPosition(id) {
    const record = records.get(id);
    if (!record) return null;
    const position = record.deathAnchor || record.latest;
    return { x: position.x, y: (record.deathAnchor?.y ?? groundHeight(position.x, position.z))
      + (record.latest.dead ? 0.35 : 1.2), z: position.z };
  }

  function clear() {
    for (const id of [...records.keys()]) remove(id);
    buffer.clear();
  }

  function dispose() {
    disposed = true;
    clear();
    for (const source of sources) if (source) disposeSource(source);
    scene.remove(group);
  }

  return { group, ingest, update, clear, dispose, showCombatHit, getCombatPosition,
    get count() { return records.size; } };
}
