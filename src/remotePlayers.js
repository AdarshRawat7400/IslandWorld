import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createPlayerStateBuffer } from './multiplayerInterpolation.js';

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
  group.add(head);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.12, 0.75, 6),
      new THREE.MeshStandardMaterial({ color: 0x303d3d, roughness: 0.95 }));
    leg.position.set(side * 0.14, 0.38, 0);
    group.add(leg);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.085, 0.72, 6),
      body.material.clone());
    arm.position.set(side * 0.39, 1.13, 0);
    arm.rotation.z = side * 0.13;
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
  cullDistance = 235, now = () => performance.now() } = {}) {
  const group = new THREE.Group();
  group.name = 'Online room players';
  scene.add(group);
  const records = new Map();
  const buffer = createPlayerStateBuffer();
  const loader = new GLTFLoader();
  const sources = MODEL_PATHS.map(() => null);
  const requested = new Set();
  let disposed = false;

  function loadModel(index) {
    if (requested.has(index)) return;
    requested.add(index);
    loader.loadAsync(MODEL_PATHS[index]).then(({ scene: source }) => {
      if (disposed) return;
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
    figure.position.y = BODY_PIVOT_Y;
    model.position.y = -BODY_PIVOT_Y;
    figure.add(model);
    root.add(figure);
    const label = nameplate(player.name, player.connected === false);
    root.add(label);
    group.add(root);
    const record = { root, figure, model, label, modelIndex, hasRig: false,
      name: player.name, disconnected: player.connected === false, limbs: [],
      latest: player, lastX: player.x, lastZ: player.z, stride: 0,
      movementSpeed: 0, meshParts: [], shadowActive: false };
    records.set(player.id, record);
    if (sources[modelIndex]) installModel(record, sources[modelIndex]);
    else loadModel(modelIndex);
    return record;
  }

  function remove(id) {
    const record = records.get(id);
    if (!record) return;
    group.remove(record.root);
    record.label.userData.dispose();
    if (!record.hasRig) disposeFallback(record.model);
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
        record.label = nameplate(player.name, player.connected === false);
        record.root.add(record.label);
        record.name = player.name;
        record.disconnected = player.connected === false;
      }
      record.latest = player;
      buffer.push(player, receivedAt);
    }
    for (const id of records.keys()) if (!liveIds.has(id)) remove(id);
  }

  function update(at = now(), dt = 0, camera = null) {
    for (const [id, record] of records) {
      const state = buffer.sample(id, at);
      if (!state) continue;
      const hidden = record.latest.dead || record.latest.connected === false
        || state.mode === 'drive' || state.mode === 'drone';
      const dx = (camera?.position.x || 0) - state.x;
      const dz = (camera?.position.z || 0) - state.z;
      record.root.visible = !hidden && (!camera || dx * dx + dz * dz < cullDistance ** 2);
      if (!record.root.visible) continue;
      const shadow = dx * dx + dz * dz < 58 ** 2;
      if (shadow !== record.shadowActive) {
        for (const mesh of record.meshParts) mesh.castShadow = shadow;
        record.shadowActive = shadow;
      }
      record.root.position.set(state.x, groundHeight(state.x, state.z), state.z);
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
      record.figure.scale.y += (pose.scaleY - record.figure.scale.y) * poseBlend;
      record.figure.rotation.x += (pose.lean - record.figure.rotation.x) * poseBlend;
      record.label.position.y += (pose.labelY - record.label.position.y) * poseBlend;
      const moving = record.movementSpeed > 0.3 && record.movementSpeed < 18;
      if (moving) record.stride += Math.min(0.1, dt) * Math.min(12, 5 + record.movementSpeed);
      const strideStrength = moving ? Math.min(1, record.movementSpeed / 3)
        * pose.stride : 0;
      for (const limb of record.limbs) {
        swing.setFromAxisAngle(SWING_AXIS,
          Math.sin(record.stride + limb.phase) * limb.amplitude * strideStrength);
        limb.bone.quaternion.copy(limb.rest).multiply(swing);
      }
      const bob = moving && stance === 'stand'
        ? Math.abs(Math.sin(record.stride)) * 0.035 : 0;
      record.figure.position.y += (pose.pivotY + bob - record.figure.position.y) * poseBlend;
      record.figure.rotation.z = moving && stance === 'stand'
        ? Math.sin(record.stride * 0.5) * 0.012 : 0;
    }
  }

  function clear() {
    for (const id of [...records.keys()]) remove(id);
    buffer.clear();
  }

  function dispose() {
    disposed = true;
    clear();
    scene.remove(group);
  }

  return { group, ingest, update, clear, dispose,
    get count() { return records.size; } };
}
