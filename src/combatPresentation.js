import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAX_HEALTH, WEAPONS } from './multiplayerRules.js';
import { MAX_ARMOR, MAX_GRENADES, MAX_MINES } from './combatLoot.js';
import { createExplosiveMesh, createExplosivePresentation } from './explosivePresentation.js';

// Project-created firearm fallbacks, hands, effects, and audio share this
// presenter with two optional CC0 gun models credited in public/assets/combat/.
// This module only presents server-authoritative combat state; it never deals damage.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const isWeapon = (value) => Object.hasOwn(WEAPONS, value);
const VIEWMODEL_RENDER_ORDER = 10000;
const MAX_TRACERS = 24;
const TRACER_SPEED = Object.freeze({ revolver: 180, rifle: 260, shotgun: 190 });
const TRACER_STREAK_METERS = 6;
const GUNSHOT_MASTER_GAIN = 0.3;
export const EQUIPMENT_IDS = Object.freeze(['revolver', 'rifle', 'shotgun',
  'grenade', 'mine', 'unarmed']);
const REVOLVER_SOURCE_MUZZLE = Object.freeze([0.302, 0.094, 0]);

export function normalizeEquipmentInventory(input = {}, previous = null) {
  const sourceGuns = input.guns ?? previous?.guns ?? ['revolver', 'rifle'];
  const guns = Array.isArray(sourceGuns) ? [...new Set(sourceGuns.filter((id) =>
    isWeapon(id)))].slice(0, 3) : [];
  const count = (name, maximum) => {
    const raw = input[name] ?? input.counts?.[name.slice(0, -1)] ?? previous?.[name] ?? 0;
    return clamp(Math.floor(finite(raw)), 0, maximum);
  };
  return { guns, grenades: count('grenades', MAX_GRENADES),
    mines: count('mines', MAX_MINES) };
}

export function equipmentSlots(inventory) {
  const normalized = normalizeEquipmentInventory(inventory);
  return [0, 1, 2].map((slot) => ({ key: slot + 1,
    id: normalized.guns[slot] ?? null, count: normalized.guns[slot] ? 1 : 0 }))
    .concat([{ key: 4, id: 'grenade', count: normalized.grenades },
      { key: 5, id: 'mine', count: normalized.mines },
      { key: 6, id: 'unarmed', count: 1 }]);
}

export function normalizeCombatHudState(input = {}) {
  const weapon = isWeapon(input.weapon) ? input.weapon : 'revolver';
  const rules = WEAPONS[weapon];
  const ammo = input.ammo ?? {};
  const serverNow = finite(input.serverNow, Date.now());
  const protectedUntil = Math.max(0, finite(input.protectedUntil
    ?? input.spawnProtectedUntil, 0));
  const respawnAt = Math.max(0, finite(input.respawnAt
    ?? input.respawnAvailableAt, 0));
  const reloadingUntil = Math.max(0, finite(ammo.reloadingUntil,
    finite(input.reloadingUntil, 0)));
  const health = clamp(Math.round(finite(input.health, MAX_HEALTH)), 0, MAX_HEALTH);
  const armor = clamp(Math.round(finite(input.armor, 0)), 0, MAX_ARMOR);
  return {
    active: Boolean(input.active),
    holstered: Boolean(input.holstered),
    stance: input.stance === 'prone' ? 'prone'
      : input.stance === 'crouch' ? 'crouch' : 'stand',
    mobile: Boolean(input.mobile),
    mode: input.mode === 'pvp' ? 'pvp' : input.mode === 'solo' ? 'solo' : 'explore',
    weapon,
    weaponLabel: rules.label,
    magazine: clamp(Math.floor(finite(ammo.magazine, rules.magazine)), 0, rules.magazine),
    reserve: Math.max(0, Math.floor(finite(ammo.reserve, rules.reserve))),
    reloading: Boolean(input.reloading)
      || reloadingUntil > serverNow,
    reloadingUntil,
    health,
    armor,
    dead: Boolean(input.dead) || health === 0,
    protected: protectedUntil > 0 ? protectedUntil > serverNow : Boolean(input.protected),
    protectedUntil,
    respawnAt,
    serverNow,
    aiming: Boolean(input.aiming),
  };
}

export function combatHudVisibility(state) {
  const hud = Boolean(state.active);
  const armed = hud && !state.holstered && !state.dead;
  return {
    hud,
    mode: hud,
    health: hud,
    damage: hud,
    death: hud && Boolean(state.dead),
    weapon: armed,
    ammo: armed,
    crosshair: armed,
    mobileControls: armed && Boolean(state.mobile),
  };
}

export function distantShotGain(distance, maxDistance = 160) {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : maxDistance;
  if (d >= maxDistance) return 0;
  return clamp(1 / (1 + (d / 17) ** 1.7), 0, 1);
}

export function sampleTracerTravel(weapon, ageSeconds, maxRange = WEAPONS[weapon]?.range) {
  if (!isWeapon(weapon) || !Number.isFinite(ageSeconds) || !Number.isFinite(maxRange)
    || ageSeconds < 0 || maxRange <= 1) return null;
  const range = Math.min(WEAPONS[weapon].range, maxRange);
  const head = Math.min(range, 0.08 + ageSeconds * TRACER_SPEED[weapon]);
  const tail = Math.max(0.08, head - TRACER_STREAK_METERS);
  const remaining = range - head;
  return {
    head,
    tail,
    length: Math.max(0, head - tail),
    opacity: clamp(remaining / 7, 0, 1),
    done: ageSeconds > (range - 0.08) / TRACER_SPEED[weapon] + 0.08,
  };
}

function textureNoise(x, y, seed) {
  let value = Math.imul(x + seed * 17, 374761393)
    + Math.imul(y + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function makeColorTexture(size, pixel) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const color = pixel(x, y, size);
      data[index] = clamp(Math.round(color[0]), 0, 255);
      data[index + 1] = clamp(Math.round(color[1]), 0, 255);
      data[index + 2] = clamp(Math.round(color[2]), 0, 255);
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function makeProceduralTextures() {
  const walnut = makeColorTexture(128, (x, y) => {
    const swirl = Math.sin((x + Math.sin(y * 0.045) * 4) * 0.36)
      + 0.38 * Math.sin(x * 0.9 + y * 0.04);
    const knot = Math.max(0, 1 - Math.hypot((x - 91) / 18, (y - 47) / 13));
    const grain = swirl * 13 - knot * 24 + (textureNoise(x, y, 1) - 0.5) * 10;
    return [110 + grain, 71 + grain * 0.72, 43 + grain * 0.47];
  });
  const steel = makeColorTexture(128, (x, y) => {
    const noise = (textureNoise(x, y, 2) - 0.5) * 12;
    const scratch = y % 19 === 0 && x > 12 && x < 98 ? 16 : 0;
    const dark = x % 41 === 0 && y > 22 && y < 110 ? -8 : 0;
    return [50 + noise + scratch + dark, 59 + noise + scratch + dark,
      63 + noise + scratch + dark];
  });
  const sleeve = makeColorTexture(64, (x, y) => {
    const warp = x % 4 < 2 ? 3 : -2;
    const weft = y % 4 < 2 ? 2 : -3;
    const noise = (textureNoise(x, y, 3) - 0.5) * 5;
    return [42 + warp + weft + noise, 60 + warp + weft + noise,
      63 + warp + weft + noise];
  });
  const skin = makeColorTexture(128, (x, y) => {
    const pore = (textureNoise(x, y, 4) - 0.5) * 7;
    const blush = textureNoise(Math.floor(x / 9), Math.floor(y / 9), 5) * 5;
    return [184 + pore + blush, 139 + pore * 0.65 + blush * 0.4,
      106 + pore * 0.5];
  });
  return { walnut, steel, sleeve, skin };
}

function makeMaterials(textures) {
  const standard = (color, roughness = 0.7, metalness = 0, map = null,
    bumpScale = 0) => new THREE.MeshStandardMaterial({
    // Grass is in Three's transparent queue. The viewmodel must be there too,
    // or dense grass draws over the gun even with depth testing disabled.
    color, roughness, metalness, transparent: true, opacity: 1,
    depthTest: false, depthWrite: false, map,
    bumpMap: bumpScale > 0 ? map : null, bumpScale,
  });
  const materials = {
    blued: standard(0xc4cbd0, 0.38, 0.78, textures.steel, 0.004),
    darkSteel: standard(0x838b8d, 0.54, 0.65, textures.steel, 0.005),
    polished: standard(0xe1e1da, 0.32, 0.79, textures.steel, 0.003),
    walnut: standard(0xffffff, 0.77, 0.05, textures.walnut, 0.012),
    walnutEdge: standard(0x9b8068, 0.83, 0, textures.walnut, 0.011),
    brass: standard(0x91744a, 0.35, 0.66),
    shell: standard(0x9a4e36, 0.72, 0.05),
    hole: standard(0x101719, 1, 0),
    skin: standard(0xffffff, 0.79, 0, textures.skin, 0.001),
    skinShadow: standard(0xc5af9e, 0.87, 0, textures.skin, 0.001),
    nail: standard(0xd8bea8, 0.58, 0),
    sleeve: standard(0xffffff, 0.94, 0, textures.sleeve, 0.005),
    cuff: standard(0xb4babb, 0.91, 0, textures.sleeve, 0.004),
  };
  // The island often sits under storm cloud and the camera-mounted model does
  // not receive much sky reflection. A restrained emissive fill keeps the
  // steel form and procedural wear legible without making it glow.
  for (const [name, color, intensity] of [
    ['blued', 0x5c6a6f, 0.44],
    ['darkSteel', 0x465356, 0.38],
    ['polished', 0x737d7c, 0.42],
  ]) {
    materials[name].emissive.setHex(color);
    materials[name].emissiveIntensity = intensity;
  }
  return materials;
}

function addBox(group, material, size, position, rotation = [0, 0, 0]) {
  const part = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  part.position.set(...position);
  part.rotation.set(...rotation);
  group.add(part);
  return part;
}

function addCylinder(group, material, radiusTop, radiusBottom, length, position,
  rotation = [0, 0, 0], sides = 12) {
  const part = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom,
    length, sides), material);
  part.position.set(...position);
  part.rotation.set(...rotation);
  group.add(part);
  return part;
}

function addSegment(group, material, from, to, radiusStart,
  radiusEnd = radiusStart, sides = 10) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 0.001) return null;
  const part = new THREE.Mesh(new THREE.CylinderGeometry(radiusEnd, radiusStart,
    length, sides), material);
  part.position.copy(start.add(end).multiplyScalar(0.5));
  part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  group.add(part);
  return part;
}

function addPalm(group, material, position, scale, anatomical = false) {
  const geometry = new THREE.SphereGeometry(1, 14, 10);
  if (anatomical) {
    const vertices = geometry.attributes.position;
    for (let index = 0; index < vertices.count; index += 1) {
      const y = vertices.getY(index);
      vertices.setX(index, vertices.getX(index) * (0.72 + 0.19 * (y + 1)));
      vertices.setZ(index, vertices.getZ(index) * (0.91 + 0.05 * y));
    }
    geometry.computeVertexNormals();
  }
  const part = new THREE.Mesh(geometry, material);
  part.position.set(...position);
  part.scale.set(...scale);
  group.add(part);
  return part;
}

function addFinger(group, material, from, bend, tip, radius = 0.016) {
  // Two tapered phalanges, a rounded knuckle, and a shallow nail read more
  // naturally in close first-person views than a single straight cylinder.
  addSegment(group, material.skin, from, bend, radius, radius * 0.87, 12);
  addSegment(group, material.skin, bend, tip, radius * 0.87, radius * 0.69, 12);
  addPalm(group, material.skin, bend, [radius * 0.89, radius * 0.89, radius * 0.89]);
  addPalm(group, material.skin, tip, [radius * 0.72, radius * 0.72, radius * 0.72]);
  const nail = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), material.nail);
  nail.position.set(tip[0], tip[1] + radius * 0.12, tip[2] + radius * 0.58);
  nail.scale.set(radius * 0.67, radius * 0.47, radius * 0.16);
  group.add(nail);
}

function addRevolverHands(group, material) {
  // Right hand encloses the walnut grip; the left braces its knuckles below
  // the trigger guard. Sleeves connect both hands to the bottom of the frame.
  addSegment(group, material.sleeve, [0.20, -0.44, 0.15],
    [0.089, -0.225, -0.013], 0.088, 0.063);
  addSegment(group, material.cuff, [0.103, -0.242, -0.003],
    [0.077, -0.197, -0.034], 0.065, 0.059);
  addPalm(group, material.skin, [0.063, -0.137, -0.057],
    [0.048, 0.077, 0.041], true);
  for (let i = 0; i < 4; i += 1) {
    const y = -0.073 - i * 0.036;
    addFinger(group, material, [0.059, y, -0.094],
      [0.005, y - 0.012, -0.126], [-0.021, y - 0.020, -0.103], 0.017);
  }
  addSegment(group, material.skin, [0.024, -0.070, -0.010],
    [-0.025, -0.104, -0.046], 0.023, 0.015);

  addSegment(group, material.sleeve, [-0.225, -0.42, 0.115],
    [-0.087, -0.221, -0.064], 0.084, 0.061);
  addSegment(group, material.cuff, [-0.098, -0.241, -0.054],
    [-0.074, -0.194, -0.073], 0.064, 0.058);
  addPalm(group, material.skin, [-0.067, -0.155, -0.098],
    [0.043, 0.065, 0.039], true);
  for (let i = 0; i < 4; i += 1) {
    const y = -0.094 - i * 0.032;
    addFinger(group, material, [-0.084, y, -0.116],
      [-0.047, y - 0.007, -0.139], [-0.005, y - 0.012, -0.139], 0.015);
  }
  addSegment(group, material.skin, [-0.082, -0.083, -0.058],
    [-0.024, -0.112, -0.034], 0.021, 0.013);
}

function addRifleHands(group, material) {
  // The right trigger hand cups the stock; the left supports the fore-end.
  addSegment(group, material.sleeve, [0.23, -0.43, 0.35],
    [0.094, -0.22, 0.115], 0.088, 0.061);
  addSegment(group, material.cuff, [0.104, -0.241, 0.134],
    [0.082, -0.195, 0.088], 0.066, 0.059);
  addPalm(group, material.skin, [0.065, -0.130, 0.094],
    [0.049, 0.074, 0.047], true);
  for (let i = 0; i < 4; i += 1) {
    const z = 0.017 + i * 0.038;
    addFinger(group, material, [0.071, -0.105, z],
      [0.041, -0.135, z - 0.006], [0.007, -0.151, z - 0.009], 0.016);
  }
  addSegment(group, material.skin, [0.025, -0.063, 0.076],
    [-0.032, -0.079, 0.020], 0.022, 0.014);

  addSegment(group, material.sleeve, [-0.25, -0.40, -0.24],
    [-0.092, -0.205, -0.432], 0.085, 0.061);
  addSegment(group, material.cuff, [-0.108, -0.230, -0.414],
    [-0.077, -0.185, -0.455], 0.065, 0.059);
  addPalm(group, material.skin, [-0.046, -0.140, -0.468], [0.057, 0.045, 0.083]);
  for (let i = 0; i < 4; i += 1) {
    const z = -0.386 - i * 0.049;
    addFinger(group, material, [-0.068, -0.144, z],
      [-0.016, -0.144, z - 0.009], [0.038, -0.150, z - 0.006], 0.017);
  }
  addSegment(group, material.skin, [-0.043, -0.101, -0.393],
    [0.025, -0.064, -0.373], 0.023, 0.014);
}

function createRevolver(material) {
  const group = new THREE.Group();
  const gun = new THREE.Group();
  gun.name = 'Procedural revolver fallback';
  group.add(gun);
  addBox(gun, material.blued, [0.115, 0.095, 0.19], [0, 0.035, -0.17]);
  addBox(gun, material.blued, [0.082, 0.047, 0.28], [0, 0.095, -0.375]);
  addCylinder(gun, material.darkSteel, 0.032, 0.032, 0.38,
    [0, 0.086, -0.48], [Math.PI / 2, 0, 0], 14);
  addCylinder(gun, material.polished, 0.021, 0.021, 0.007,
    [0, 0.086, -0.676], [Math.PI / 2, 0, 0], 14);
  addCylinder(gun, material.hole, 0.013, 0.013, 0.008,
    [0, 0.086, -0.681], [Math.PI / 2, 0, 0], 14);
  addCylinder(gun, material.polished, 0.075, 0.075, 0.124,
    [0, 0.044, -0.27], [Math.PI / 2, 0, 0], 12);
  for (let i = 0; i < 6; i += 1) {
    const angle = i * Math.PI / 3;
    addCylinder(gun, material.hole, 0.014, 0.014, 0.003,
      [Math.cos(angle) * 0.046, 0.044 + Math.sin(angle) * 0.046, -0.335],
      [Math.PI / 2, 0, 0], 8);
  }
  addBox(gun, material.walnutEdge, [0.084, 0.24, 0.088],
    [0, -0.098, -0.092], [-0.26, 0, 0]);
  addBox(gun, material.walnut, [0.088, 0.22, 0.07],
    [0, -0.107, -0.077], [-0.26, 0, 0]);
  addBox(gun, material.darkSteel, [0.054, 0.02, 0.07],
    [0, 0.092, -0.062], [-0.22, 0, 0]);
  addBox(gun, material.blued, [0.018, 0.031, 0.028], [0, 0.119, -0.63]);
  addBox(gun, material.brass, [0.008, 0.012, 0.017],
    [0.046, -0.16, -0.07]);
  const hands = new THREE.Group();
  hands.name = 'Procedural hands fallback';
  addRevolverHands(hands, material);
  group.add(hands);
  return { group, gun, hands, muzzle: new THREE.Vector3(0, 0.086, -0.695) };
}

function createRifle(material) {
  const group = new THREE.Group();
  const gun = new THREE.Group();
  gun.name = 'Procedural rifle fallback';
  group.add(gun);
  addBox(gun, material.walnut, [0.115, 0.16, 0.61], [0, -0.055, 0.105]);
  addBox(gun, material.walnutEdge, [0.122, 0.185, 0.042], [0, -0.055, 0.41]);
  addBox(gun, material.walnut, [0.093, 0.07, 0.5], [0, -0.11, -0.43]);
  addBox(gun, material.blued, [0.09, 0.08, 0.31], [0, 0.045, -0.17]);
  addCylinder(gun, material.darkSteel, 0.027, 0.028, 0.9,
    [0, 0.072, -0.71], [Math.PI / 2, 0, 0], 14);
  addCylinder(gun, material.polished, 0.03, 0.03, 0.02,
    [0, 0.072, -1.17], [Math.PI / 2, 0, 0], 14);
  addCylinder(gun, material.hole, 0.017, 0.017, 0.006,
    [0, 0.072, -1.183], [Math.PI / 2, 0, 0], 14);
  addBox(gun, material.blued, [0.11, 0.025, 0.17], [0, -0.008, -0.31]);
  addBox(gun, material.polished, [0.035, 0.018, 0.045],
    [0.055, 0.062, -0.08], [0, 0, -0.3]);
  addBox(gun, material.darkSteel, [0.014, 0.045, 0.018], [0, 0.112, -1.06]);
  addBox(gun, material.darkSteel, [0.014, 0.038, 0.018], [0, 0.111, -0.08]);
  addBox(gun, material.brass, [0.02, 0.038, 0.12], [0, -0.115, -0.07]);
  addBox(gun, material.walnutEdge, [0.08, 0.19, 0.09],
    [0, -0.178, 0.155], [-0.26, 0, 0]);
  const hands = new THREE.Group();
  hands.name = 'Procedural hands fallback';
  addRifleHands(hands, material);
  group.add(hands);
  return { group, gun, hands, muzzle: new THREE.Vector3(0, 0.072, -1.195) };
}

function createShotgun(material) {
  const group = new THREE.Group();
  // A compact island field gun: dark walnut pump, twin steel tubes, plain
  // bead sight, and a few brass-capped shells held on the receiver.
  addBox(group, material.walnut, [0.14, 0.18, 0.57], [0, -0.075, 0.12]);
  addBox(group, material.walnutEdge, [0.145, 0.19, 0.045],
    [0, -0.076, 0.43]);
  addBox(group, material.darkSteel, [0.116, 0.105, 0.33],
    [0, 0.032, -0.195]);
  addBox(group, material.walnutEdge, [0.13, 0.092, 0.32],
    [0, -0.095, -0.47]);
  addBox(group, material.walnut, [0.14, 0.075, 0.29],
    [0, -0.094, -0.475]);
  for (const x of [-0.028, 0.028]) {
    addCylinder(group, material.blued, 0.029, 0.031, 0.72,
      [x, 0.071, -0.688], [Math.PI / 2, 0, 0], 12);
    addCylinder(group, material.polished, 0.033, 0.033, 0.025,
      [x, 0.071, -1.06], [Math.PI / 2, 0, 0], 12);
    addCylinder(group, material.hole, 0.020, 0.020, 0.006,
      [x, 0.071, -1.076], [Math.PI / 2, 0, 0], 12);
  }
  addBox(group, material.blued, [0.012, 0.015, 0.61],
    [0, 0.107, -0.71]);
  addBox(group, material.brass, [0.014, 0.018, 0.014],
    [0, 0.122, -1.022]);
  addCylinder(group, material.darkSteel, 0.028, 0.028, 0.56,
    [0, -0.035, -0.59], [Math.PI / 2, 0, 0], 10);
  addBox(group, material.darkSteel, [0.07, 0.18, 0.09],
    [0, -0.175, 0.11], [-0.25, 0, 0]);
  for (let i = 0; i < 3; i += 1) {
    addCylinder(group, material.shell, 0.022, 0.022, 0.064,
      [0.073, 0.028, -0.18 + i * 0.07], [0, 0, Math.PI / 2], 10);
    addCylinder(group, material.brass, 0.023, 0.023, 0.012,
      [0.108, 0.028, -0.18 + i * 0.07], [0, 0, Math.PI / 2], 10);
  }
  const hands = new THREE.Group();
  hands.name = 'Procedural hands fallback';
  addRifleHands(hands, material);
  group.add(hands);
  return { group, hands, muzzle: new THREE.Vector3(0, 0.071, -1.09) };
}

function createHeldEquipment(kind, material) {
  const group = new THREE.Group();
  const object = createExplosiveMesh(kind, { viewmodel: true });
  object.position.set(-0.018, kind === 'grenade' ? -0.023 : -0.035,
    kind === 'grenade' ? -0.30 : -0.34);
  if (kind === 'mine') object.rotation.x = 0.36;
  group.add(object);
  addSegment(group, material.sleeve, [0.18, -0.48, 0.13],
    [0.058, -0.22, -0.17], 0.087, 0.063);
  addSegment(group, material.cuff, [0.066, -0.25, -0.14],
    [0.037, -0.194, -0.19], 0.064, 0.058);
  addPalm(group, material.skin, [0.022, -0.126, -0.275],
    [0.084, 0.041, 0.068]);
  for (let i = 0; i < 4; i += 1) {
    const z = -0.21 - i * 0.038;
    addFinger(group, material, [0.09, -0.11, z],
      [0.005, -0.101, z - 0.018], [-0.075, -0.107, z - 0.022], 0.014);
  }
  return group;
}

function makeFlash({ viewmodel = true } = {}) {
  const group = new THREE.Group();
  group.renderOrder = viewmodel ? VIEWMODEL_RENDER_ORDER + 1 : 0;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe9ab, transparent: true,
      opacity: 0.9, depthTest: !viewmodel, depthWrite: false, toneMapped: false }));
  glow.renderOrder = group.renderOrder;
  group.add(glow);
  const petalMaterial = new THREE.MeshBasicMaterial({ color: 0xffc66a,
    side: THREE.DoubleSide, transparent: true, opacity: 0.9,
    depthTest: !viewmodel, depthWrite: false, toneMapped: false });
  for (let i = 0; i < 4; i += 1) {
    const petal = new THREE.Mesh(new THREE.ConeGeometry(0.043, 0.17, 3), petalMaterial);
    petal.rotation.x = -Math.PI / 2;
    petal.rotation.z = i * Math.PI / 2;
    petal.position.z = -0.071;
    petal.renderOrder = group.renderOrder;
    group.add(petal);
  }
  group.visible = false;
  return group;
}

function vectorFrom(value) {
  if (value?.isVector3) return value.clone();
  const parts = Array.isArray(value) ? value : [value?.x, value?.y, value?.z];
  return parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)
    ? new THREE.Vector3(parts[0], parts[1], parts[2]) : null;
}

export function visualTracerImpactDistance({ weapon, origin, direction, muzzle,
  distance } = {}) {
  if (!isWeapon(weapon) || !Number.isFinite(distance) || distance <= 0) return null;
  const shotOrigin = vectorFrom(origin);
  const shotDirection = vectorFrom(direction);
  const visualOrigin = vectorFrom(muzzle);
  if (!shotOrigin || !shotDirection || !visualOrigin
    || shotDirection.lengthSq() < 0.9 || shotDirection.lengthSq() > 1.1) return null;
  const impact = shotOrigin.addScaledVector(shotDirection.normalize(), distance);
  return clamp(visualOrigin.distanceTo(impact), 1.01, WEAPONS[weapon].range);
}

function createGunAudio() {
  let context = null;
  let master = null;
  let limiter = null;
  let noise = null;
  let muted = false;
  let volume = 1;
  const active = new Set();

  function ensureContext() {
    if (context && context.state !== 'closed') return true;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    try {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : volume * GUNSHOT_MASTER_GAIN;
      limiter = context.createDynamicsCompressor?.() ?? null;
      if (limiter) {
        limiter.threshold.value = -11;
        limiter.knee.value = 12;
        limiter.ratio.value = 4;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.17;
        master.connect(limiter).connect(context.destination);
      } else master.connect(context.destination);
      const length = Math.round(context.sampleRate * 0.62);
      noise = context.createBuffer(1, length, context.sampleRate);
      const channel = noise.getChannelData(0);
      for (let i = 0; i < length; i += 1) channel[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      context = null;
      return false;
    }
  }

  function play(weapon, { gain = 1, pan = 0 } = {}) {
    if (muted || gain <= 0 || !ensureContext()) return;
    void context.resume().catch(() => {});
    const rifle = weapon === 'rifle';
    const shotgun = weapon === 'shotgun';
    const now = context.currentTime;
    const noiseSource = context.createBufferSource();
    noiseSource.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = shotgun ? 1300 : rifle ? 1900 : 2900;
    const envelope = context.createGain();
    const peak = clamp(gain, 0, 1) * (shotgun ? 0.82 : rifle ? 0.73 : 0.61);
    const decay = shotgun ? 0.52 : rifle ? 0.42 : 0.26;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    const stereo = context.createStereoPanner?.();
    if (stereo) stereo.pan.value = clamp(pan, -1, 1);
    noiseSource.connect(filter).connect(envelope);
    envelope.connect(stereo ?? master);
    stereo?.connect(master);
    noiseSource.start(now, Math.random() * 0.12, decay + 0.01);
    noiseSource.stop(now + decay + 0.02);
    active.add(noiseSource);
    noiseSource.onended = () => {
      active.delete(noiseSource);
      noiseSource.disconnect();
      filter.disconnect();
      envelope.disconnect();
      stereo?.disconnect();
    };

    // A short filtered crack gives the shot definition over rain and surf;
    // the compressor and bounded master gain keep stacked reports comfortable.
    const crack = context.createBufferSource();
    crack.buffer = noise;
    const crackFilter = context.createBiquadFilter();
    crackFilter.type = 'highpass';
    crackFilter.frequency.value = shotgun ? 740 : rifle ? 1300 : 1650;
    const crackGain = context.createGain();
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.31),
      now + 0.0015);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.052);
    crack.connect(crackFilter).connect(crackGain).connect(stereo ?? master);
    crack.start(now, Math.random() * 0.14, 0.06);
    crack.stop(now + 0.065);
    active.add(crack);
    crack.onended = () => {
      active.delete(crack);
      crack.disconnect();
      crackFilter.disconnect();
      crackGain.disconnect();
    };

    const body = context.createOscillator();
    const bodyGain = context.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(shotgun ? 92 : rifle ? 118 : 155, now);
    body.frequency.exponentialRampToValueAtTime(shotgun ? 31 : rifle ? 39 : 57,
      now + 0.16);
    bodyGain.gain.setValueAtTime(Math.max(0.0001, peak * 0.16), now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    body.connect(bodyGain).connect(stereo ?? master);
    body.start(now);
    body.stop(now + 0.19);
    active.add(body);
    body.onended = () => {
      active.delete(body);
      body.disconnect();
      bodyGain.disconnect();
    };
  }

  return {
    play,
    setMuted(value) {
      muted = Boolean(value);
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume * GUNSHOT_MASTER_GAIN,
        context.currentTime, 0.035);
    },
    setVolume(value) {
      volume = clamp(finite(value, 1), 0, 1);
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume * GUNSHOT_MASTER_GAIN,
        context.currentTime, 0.035);
    },
    async dispose() {
      for (const source of active) {
        try { source.stop(); } catch { /* Source already ended. */ }
      }
      active.clear();
      if (context && context.state !== 'closed') await context.close().catch(() => {});
      context = master = limiter = noise = null;
    },
  };
}

function makeButton(doc, label, title) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', title);
  button.style.cssText = `min-width:56px;min-height:48px;padding:7px 9px;
    border:1px solid #e8ddba9c;border-radius:7px;color:#f5f1e6;
    background:#0b2028dc;font:600 11px 'DM Sans',sans-serif;
    letter-spacing:.08em;touch-action:none;user-select:none;`;
  return button;
}

/**
 * Lightweight first-person viewmodels and combat HUD. The caller owns input,
 * server requests, ammo, damage, and respawn. `setState` accepts the current
 * authoritative state; `fire` only animates a shot already requested/accepted.
 */
export function createCombatPresentation({ camera, scene, root = globalThis.document?.body,
  onFire = () => {}, onReload = () => {}, onAim = () => {},
  onSelectWeapon = () => {}, onSelectEquipment = null,
  onUseEquipment = () => {}, onRespawn = () => {}, mobile = false } = {}) {
  if (!camera?.add || !scene?.add || !root?.ownerDocument) {
    throw new TypeError('Combat presentation requires a camera, scene, and DOM root.');
  }
  const doc = root.ownerDocument;
  const textures = makeProceduralTextures();
  const materials = makeMaterials(textures);
  const models = { revolver: createRevolver(materials), rifle: createRifle(materials),
    shotgun: createShotgun(materials) };
  const held = { grenade: createHeldEquipment('grenade', materials),
    mine: createHeldEquipment('mine', materials) };
  const viewRoot = new THREE.Group();
  viewRoot.name = 'First-person equipment viewmodel';
  viewRoot.renderOrder = VIEWMODEL_RENDER_ORDER;
  viewRoot.position.set(0.38, -0.32, -0.63);
  for (const [id, model] of Object.entries(models)) {
    model.group.name = id;
    model.group.visible = id === 'revolver';
    model.group.traverse((part) => {
      if (!part.isMesh) return;
      part.renderOrder = VIEWMODEL_RENDER_ORDER;
      part.frustumCulled = false;
    });
    model.flash = makeFlash();
    model.flash.position.copy(model.muzzle);
    model.group.add(model.flash);
    viewRoot.add(model.group);
  }
  for (const [id, group] of Object.entries(held)) {
    group.name = `held-${id}`;
    group.visible = false;
    group.traverse((part) => {
      if (!part.isMesh) return;
      part.renderOrder = VIEWMODEL_RENDER_ORDER;
      part.frustumCulled = false;
    });
    viewRoot.add(group);
  }
  camera.add(viewRoot);
  const sound = createGunAudio();
  const explosives = createExplosivePresentation({ scene, camera });
  const transientFlashes = [];
  const activeTracers = [];

  function removeTracer(index) {
    const [entry] = activeTracers.splice(index, 1);
    if (!entry) return;
    entry.mesh.parent?.remove(entry.mesh);
    disposeThreeObject(entry.mesh);
  }

  function spawnTracer(weapon, origin, direction, hitDistance,
    { local = false, sourceOrigin = null, sourceDirection = null } = {}) {
    const start = vectorFrom(origin);
    const travel = vectorFrom(direction);
    if (!start || !travel || travel.lengthSq() < 0.9 || travel.lengthSq() > 1.1
      || camera.position.distanceTo(start) > 180) return;
    travel.normalize();
    const maxRange = Number.isFinite(hitDistance)
      ? clamp(hitDistance, 1.01, WEAPONS[weapon].range) : WEAPONS[weapon].range;
    const mesh = new THREE.Group();
    // A slim pale core and a softer halo remain visible for several frames.
    // Both are world-space and depth-tested, unlike the camera-attached gun.
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xfff6d7,
      transparent: true, opacity: 0.96, depthTest: true, depthWrite: false,
      toneMapped: false });
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: weapon === 'rifle' ? 0xffd98d : 0xffbc70,
      transparent: true, opacity: 0.37, depthTest: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false });
    const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 1, 6),
      haloMaterial);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 1, 6),
      coreMaterial);
    halo.renderOrder = 2;
    core.renderOrder = 3;
    halo.frustumCulled = core.frustumCulled = false;
    mesh.add(halo, core);
    mesh.visible = false;
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), travel);
    scene.add(mesh);
    if (activeTracers.length >= MAX_TRACERS) removeTracer(0);
    activeTracers.push({ mesh, start, travel, weapon, maxRange, age: 0,
      coreMaterial, haloMaterial, local, sourceOrigin: vectorFrom(sourceOrigin),
      sourceDirection: vectorFrom(sourceDirection), confirmed: false });
  }

  function confirmLocalHit(distance, { weapon, origin } = {}) {
    if (disposed || !Number.isFinite(distance)) return false;
    const expectedOrigin = vectorFrom(origin);
    for (let i = activeTracers.length - 1; i >= 0; i -= 1) {
      const trace = activeTracers[i];
      if (!trace.local || trace.confirmed || trace.age > 1
        || (weapon && trace.weapon !== weapon)
        || (expectedOrigin && (!trace.sourceOrigin
          || trace.sourceOrigin.distanceTo(expectedOrigin) > 0.2))) continue;
      const cap = visualTracerImpactDistance({ weapon: trace.weapon,
        origin: trace.sourceOrigin, direction: trace.sourceDirection,
        muzzle: trace.start, distance });
      if (cap === null) return false;
      trace.maxRange = Math.min(trace.maxRange, cap);
      trace.confirmed = true;
      return true;
    }
    return false;
  }

  const hud = doc.createElement('div');
  hud.id = 'combat-presentation';
  hud.hidden = true;
  hud.style.cssText = 'position:fixed;inset:0;z-index:8;pointer-events:none;color:#f4efe5;font-family:DM Sans,sans-serif;text-shadow:0 2px 10px #000;';
  const crosshair = doc.createElement('div');
  crosshair.setAttribute('aria-hidden', 'true');
  crosshair.style.cssText = `position:absolute;left:50%;top:50%;width:18px;height:18px;
    transform:translate(-50%,-50%);border:1.5px solid #f1eac8;border-radius:50%;
    box-shadow:0 0 8px #0009;`;
  crosshair.innerHTML = '<span style="position:absolute;left:8px;top:8px;width:2px;height:2px;background:#f1eac8;border-radius:50%"></span>';
  const hitmarker = doc.createElement('div');
  hitmarker.setAttribute('aria-hidden', 'true');
  hitmarker.textContent = '×';
  hitmarker.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-54%);
    opacity:0;color:#ffe0aa;font:400 40px Georgia,serif;transition:none;`;
  const ammoHud = doc.createElement('div');
  ammoHud.id = 'combat-ammo';
  ammoHud.setAttribute('role', 'status');
  ammoHud.style.cssText = `position:absolute;right:max(${mobile ? '12px' : '24px'},env(safe-area-inset-right));
    bottom:${mobile ? 'calc(var(--mobile-combat-bottom,12px) + 116px + env(safe-area-inset-bottom,0px))' : 'max(24px,env(safe-area-inset-bottom))'};
    padding:${mobile ? '5px 8px' : '10px 14px'};
    background:${mobile ? '#0b2028a8' : '#0b2028bc'};border:1px solid #d9c69f70;border-radius:${mobile ? '8px' : '0'};
    min-width:${mobile ? '88px' : '160px'};text-align:right;
    font-size:${mobile ? '11px' : '14px'};letter-spacing:.07em;`;
  const healthHud = doc.createElement('div');
  healthHud.id = 'combat-health';
  healthHud.style.cssText = `position:absolute;
    left:max(${mobile ? '12px' : '24px'},env(safe-area-inset-left));
    ${mobile ? 'top:calc(var(--mobile-health-top,58px) + env(safe-area-inset-top,0px))' : 'bottom:max(24px,env(safe-area-inset-bottom))'};
    padding:${mobile ? '5px 7px' : '9px 12px'};
    background:${mobile ? '#0b2028a8' : '#0b2028bc'};border:1px solid #d9c69f70;border-radius:${mobile ? '8px' : '0'};
    font-size:${mobile ? '9px' : '12px'};
    letter-spacing:${mobile ? '.06em' : '.09em'};min-width:${mobile ? '108px' : '155px'};`;
  const modeHud = doc.createElement('div');
  modeHud.id = 'combat-mode';
  modeHud.style.cssText = `position:absolute;left:50%;top:${mobile ? 'calc(8px + env(safe-area-inset-top,0px))' : '15px'};
    transform:translateX(-50%);padding:5px 9px;background:#0b2028ba;
    border:1px solid #d9c69f70;border-radius:${mobile ? '6px' : '0'};
    font-size:${mobile ? '9px' : '11px'};letter-spacing:${mobile ? '.09em' : '.13em'};white-space:nowrap;`;
  const damage = doc.createElement('div');
  damage.setAttribute('aria-hidden', 'true');
  damage.style.cssText = `position:absolute;inset:0;opacity:0;
    background:radial-gradient(ellipse at center,transparent 37%,#a71926a8 100%);`;
  const death = doc.createElement('div');
  death.setAttribute('role', 'status');
  death.style.cssText = `position:absolute;inset:0;display:none;align-items:center;
    justify-content:center;flex-direction:column;gap:22px;background:#07131ab8;text-align:center;
    font:400 clamp(22px,5vw,42px) Georgia,serif;letter-spacing:.13em;`;
  const deathLabel = doc.createElement('div');
  deathLabel.textContent = 'RETURNING TO SAFE GROUND';
  const respawnButton = makeButton(doc, 'RESPAWN', 'Respawn at a safe island location');
  respawnButton.style.cssText += 'pointer-events:auto;padding:12px 20px;font-size:13px;';
  death.append(deathLabel, respawnButton);
  const mobileButtons = doc.createElement('div');
  mobileButtons.id = 'combat-mobile-controls';
  mobileButtons.className = 'combat-mobile-controls';
  mobileButtons.setAttribute('aria-label', 'Combat controls');
  mobileButtons.style.cssText = `position:absolute;right:max(12px,env(safe-area-inset-right));
    bottom:calc(var(--mobile-combat-bottom,12px) + env(safe-area-inset-bottom,0px));
    display:none;grid-template-columns:48px 58px;grid-template-rows:58px 44px;
    gap:6px;align-items:end;pointer-events:auto;`;
  const fireButton = makeButton(doc, 'FIRE', 'Fire weapon');
  fireButton.id = 'combat-fire';
  fireButton.style.cssText += `width:58px;height:58px;min-width:58px;min-height:58px;
    padding:0;border-radius:50%;background:#5b342bc4;font-size:11px;
    grid-column:2;grid-row:1;`;
  const aimButton = makeButton(doc, 'AIM', 'Hold to aim');
  const reloadButton = makeButton(doc, 'RELOAD', 'Reload weapon');
  const wheelButton = makeButton(doc, 'WHEEL', 'Open equipment wheel');
  for (const [button, id] of [[aimButton, 'combat-aim'],
    [reloadButton, 'combat-reload'], [wheelButton, 'combat-wheel']]) {
    button.id = id;
    button.style.cssText += `min-width:44px;min-height:44px;height:44px;
      padding:0 3px;border-radius:50%;font-size:9px;letter-spacing:.03em;
      background:#0b2028a8;`;
  }
  aimButton.style.cssText += 'grid-column:1;grid-row:1;';
  reloadButton.style.cssText += 'grid-column:1;grid-row:2;';
  wheelButton.style.cssText += 'grid-column:2;grid-row:2;';
  // Two short rows keep the right thumb's reach small and leave the horizon
  // available for looking. Equipment and holstering stay in the on-demand wheel.
  mobileButtons.append(aimButton, fireButton, reloadButton, wheelButton);
  const wheelOverlay = doc.createElement('div');
  wheelOverlay.setAttribute('aria-label', 'Equipment wheel');
  wheelOverlay.style.cssText = `position:absolute;inset:0;display:none;pointer-events:none;`;
  const wheelRing = doc.createElement('div');
  wheelRing.style.cssText = `position:absolute;left:50%;top:50%;
    transform:translate(-50%,-50%);width:min(380px,78vw,78vh);aspect-ratio:1;
    border-radius:50%;background:radial-gradient(circle,#10232bee 0 25%,
      #10232bd9 26% 63%,#132d35c9 64% 100%);
    border:1px solid #d9c69f8c;box-shadow:0 8px 36px #0009,0 0 0 10px #091a1e50 inset;`;
  const wheelCenter = doc.createElement('div');
  wheelCenter.setAttribute('role', 'status');
  wheelCenter.style.cssText = `position:absolute;left:50%;top:50%;
    transform:translate(-50%,-50%);width:32%;text-align:center;
    color:#f2ddaa;font:600 11px 'DM Sans',sans-serif;letter-spacing:.09em;
    white-space:pre-line;line-height:1.5;`;
  wheelRing.appendChild(wheelCenter);
  const slotButtons = Array.from({ length: EQUIPMENT_IDS.length }, () => {
    const button = makeButton(doc, '', 'Equipment slot');
    const index = wheelRing.children.length - 1;
    const angle = -Math.PI / 2 + index * Math.PI * 2 / EQUIPMENT_IDS.length;
    button.style.cssText += `position:absolute;left:${50 + Math.cos(angle) * 34}%;
      top:${50 + Math.sin(angle) * 34}%;transform:translate(-50%,-50%);
      width:clamp(62px,19vw,86px);min-width:0;min-height:58px;
      padding:5px 2px;white-space:pre-line;line-height:1.2;
      font-size:10px;pointer-events:auto;`;
    wheelRing.appendChild(button);
    return button;
  });
  wheelOverlay.appendChild(wheelRing);
  hud.append(crosshair, hitmarker, ammoHud, healthHud, modeHud, damage, death,
    mobileButtons, wheelOverlay);
  root.appendChild(hud);

  let state = normalizeCombatHudState({ mobile });
  let inventory = normalizeEquipmentInventory();
  let selectedEquipment = 'revolver';
  let wheelOpen = false;
  let wheelHighlight = 'revolver';
  const wheelVector = { x: 0, y: 0 };
  let healthFeedback = null;
  let healthFeedbackTime = 0;
  let recoil = 0;
  let flashTime = 0;
  let damageAlpha = 0;
  let hitTime = 0;
  let walkPhase = 0;
  let disposed = false;
  let rifleAssetStatus = 'fallback';
  let revolverAssetStatus = 'fallback';
  let handAssetStatus = 'fallback';
  let aiming = false;
  let statusSeconds = -1;
  const oldCrosshair = doc.getElementById('crosshair');
  const previousCrosshairOpacity = oldCrosshair?.style.opacity ?? '';

  const handleFire = (event) => {
    event.preventDefault();
    if (state.dead || !state.active || state.holstered || wheelOpen
      || selectedEquipment === 'unarmed') return;
    if (selectedEquipment === 'grenade' || selectedEquipment === 'mine') {
      const count = selectedEquipment === 'grenade' ? inventory.grenades : inventory.mines;
      if (count > 0) onUseEquipment(selectedEquipment);
    } else onFire();
  };
  const handleReload = (event) => {
    event.preventDefault();
    if (!wheelOpen && isWeapon(selectedEquipment)) onReload();
  };
  const handleWheelButton = (event) => {
    event.preventDefault();
    if (wheelOpen) closeEquipmentWheel({ commit: false });
    else openEquipmentWheel();
  };
  const handleAimStart = (event) => {
    event.preventDefault();
    if (wheelOpen || selectedEquipment === 'unarmed') return;
    aimButton.setPointerCapture?.(event.pointerId);
    aiming = true;
    setAiming(true);
    onAim(true);
  };
  const handleAimEnd = (event) => {
    event.preventDefault();
    if (!aiming) return;
    aiming = false;
    setAiming(false);
    onAim(false);
  };
  fireButton.addEventListener('pointerdown', handleFire);
  reloadButton.addEventListener('click', handleReload);
  wheelButton.addEventListener('click', handleWheelButton);
  respawnButton.addEventListener('click', (event) => {
    event.preventDefault();
    if (state.dead && state.serverNow >= state.respawnAt) onRespawn();
  });
  aimButton.addEventListener('pointerdown', handleAimStart);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    aimButton.addEventListener(type, handleAimEnd);
  }
  for (let index = 0; index < slotButtons.length; index += 1) {
    slotButtons[index].addEventListener('pointerenter', () => {
      if (!wheelOpen) return;
      const slot = equipmentSlots(inventory)[index];
      if (!slot?.id || slot.count <= 0) return;
      wheelHighlight = slot.id;
      renderHud();
    });
    slotButtons[index].addEventListener('click', (event) => {
      event.preventDefault();
      const slot = equipmentSlots(inventory)[index];
      if (!slot?.id || slot.count <= 0) return;
      wheelHighlight = slot.id;
      closeEquipmentWheel({ commit: true });
    });
  }

  function renderHud() {
    const visibility = combatHudVisibility(state);
    if (!visibility.weapon) wheelOpen = false;
    const unarmed = selectedEquipment === 'unarmed';
    hud.hidden = !visibility.hud;
    viewRoot.visible = visibility.weapon && !unarmed;
    if (oldCrosshair) oldCrosshair.style.opacity = state.active
      ? '0' : previousCrosshairOpacity;
    for (const [id, model] of Object.entries(models)) {
      model.group.visible = selectedEquipment === id;
    }
    for (const [id, group] of Object.entries(held)) {
      group.visible = selectedEquipment === id;
    }
    if (!state.active) return;
    modeHud.textContent = mobile
      ? state.mode === 'pvp' ? 'PVP · DAMAGE ON'
        : state.mode === 'solo' ? 'SOLO' : 'EXPLORE · SAFE'
      : state.mode === 'pvp' ? 'PVP · PLAYER DAMAGE ON'
        : state.mode === 'solo' ? 'SOLO · NPCS RESPOND TO GUNFIRE'
          : 'EXPLORE · NO PLAYER-VS-PLAYER DAMAGE';
    ammoHud.hidden = !visibility.ammo || unarmed;
    const explosive = selectedEquipment === 'grenade' || selectedEquipment === 'mine';
    const selectedCount = selectedEquipment === 'grenade' ? inventory.grenades : inventory.mines;
    const ammoMessage = explosive ? `× ${selectedCount}`
      : state.reloading ? 'RELOADING' : `${state.magazine} / ${state.reserve}`;
    const title = explosive ? selectedEquipment.toUpperCase() : state.weaponLabel.toUpperCase();
    ammoHud.innerHTML = `<span style="font-size:${mobile ? '8px' : '10px'};color:#dec998">${title}</span><br>
      <strong style="font-size:${mobile ? '18px' : '24px'};font-weight:600">${ammoMessage}</strong>
      ${explosive && !mobile ? '<br><small style="font-size:10px;color:#dec998">USE TO DEPLOY</small>' : ''}`;
    const healthColor = healthFeedbackTime > 0 && healthFeedback === 'healed'
      ? '#7ce0ac' : state.health < 30 ? '#ed7773'
        : state.health < 60 ? '#e8bd70' : '#b4d79e';
    const healthStatus = healthFeedbackTime > 0
      ? healthFeedback === 'healed' ? 'RECOVERING' : 'HURT' : '';
    healthHud.style.borderColor = healthFeedbackTime > 0
      ? healthFeedback === 'healed' ? '#79dca0' : '#e87670' : '#d9c69f70';
    healthHud.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px">
      <span>HEALTH</span><strong>${mobile ? state.health : `${state.health} / ${MAX_HEALTH}`}</strong></div>
      ${healthStatus ? `<small style="display:block;color:${healthColor};margin-top:3px">${healthStatus}</small>` : ''}
      <div role="progressbar" aria-label="Health" aria-valuemin="0"
        aria-valuemax="${MAX_HEALTH}" aria-valuenow="${state.health}"
        style="height:${mobile ? '4px' : '8px'};margin-top:${mobile ? '3px' : '7px'};background:#26383a;border:1px solid #78918b7d;border-radius:6px;overflow:hidden">
      <div style="width:${state.health}%;height:100%;background:${healthColor};
        box-shadow:0 0 9px ${healthColor};transition:width .14s linear"></div></div>
      <div style="display:flex;justify-content:space-between;gap:8px;
        margin-top:${mobile ? '3px' : '6px'};color:#b8d8e9"><span>ARMOR</span>
        <strong>${mobile ? state.armor : `${state.armor} / ${MAX_ARMOR}`}</strong></div>
      <div role="progressbar" aria-label="Armor" aria-valuemin="0"
        aria-valuemax="${MAX_ARMOR}" aria-valuenow="${state.armor}"
        style="height:${mobile ? '3px' : '6px'};margin-top:${mobile ? '3px' : '5px'};background:#26383a;border:1px solid #6f94a47d;border-radius:6px;overflow:hidden">
      <div style="width:${state.armor}%;height:100%;background:#81c4d9;
        box-shadow:0 0 8px #81c4d9;transition:width .14s linear"></div></div>
      ${state.protected ? `<small style="color:#d9c69f">SPAWN PROTECTION${state.protectedUntil > 0 ? ` · ${Math.ceil((state.protectedUntil - state.serverNow) / 1000)}s` : ''}</small>` : ''}`;
    death.style.display = visibility.death ? 'flex' : 'none';
    const respawnRemaining = Math.max(0, Math.ceil((state.respawnAt - state.serverNow) / 1000));
    respawnButton.disabled = respawnRemaining > 0;
    respawnButton.textContent = respawnRemaining > 0 ? `RESPAWN IN ${respawnRemaining}s` : 'RESPAWN';
    mobileButtons.style.display = visibility.mobileControls ? 'grid' : 'none';
    wheelOverlay.style.display = wheelOpen ? 'block' : 'none';
    crosshair.style.display = visibility.crosshair && !wheelOpen && !unarmed
      ? 'block' : 'none';
    crosshair.style.borderStyle = explosive ? 'dashed' : 'solid';
    reloadButton.style.display = unarmed ? 'none' : '';
    aimButton.style.display = unarmed ? 'none' : '';
    fireButton.style.display = unarmed ? 'none' : '';
    reloadButton.disabled = wheelOpen || unarmed || explosive || state.reloading || state.reserve === 0
      || state.magazine >= WEAPONS[state.weapon].magazine;
    aimButton.disabled = wheelOpen || unarmed || explosive;
    fireButton.textContent = explosive ? 'USE' : 'FIRE';
    fireButton.setAttribute('aria-label', explosive
      ? `Use ${selectedEquipment}` : 'Fire weapon');
    fireButton.disabled = wheelOpen || unarmed || (explosive ? selectedCount <= 0
      : state.reloading || state.magazine === 0);
    wheelButton.textContent = wheelOpen ? 'CLOSE' : 'WHEEL';
    wheelButton.setAttribute('aria-label', wheelOpen
      ? 'Close equipment wheel' : 'Open equipment wheel');
    const preview = wheelHighlight === 'grenade' ? `GRENADE\n×${inventory.grenades}`
      : wheelHighlight === 'mine' ? `MINE\n×${inventory.mines}`
        : wheelHighlight === 'unarmed' ? 'HOLSTER\nHANDS FREE'
          : wheelHighlight?.toUpperCase() ?? 'EQUIPMENT';
    wheelCenter.textContent = `${preview}\n${mobile ? 'TAP TO EQUIP' : 'RELEASE TO EQUIP'}`;
    for (const [index, slot] of equipmentSlots(inventory).entries()) {
      const button = slotButtons[index];
      const label = slot.id === 'unarmed' ? 'HOLSTER'
        : slot.id ? slot.id.toUpperCase() : 'EMPTY';
      const counted = slot.id === 'grenade' || slot.id === 'mine';
      button.textContent = `${slot.key}  ${label}${counted ? `\n×${slot.count}` : ''}`;
      button.disabled = !slot.id || slot.count <= 0;
      button.setAttribute('aria-label', slot.id
        ? `Select ${label.toLowerCase()}, slot ${slot.key}${counted ? `, ${slot.count} left` : ''}`
        : `Empty gun slot ${slot.key}`);
      const active = wheelHighlight === slot.id && slot.count > 0;
      button.style.borderColor = active ? '#ffdf96' : '#e8ddba7c';
      button.style.background = active ? '#73522be8' : '#0b2028dc';
      button.style.boxShadow = active ? '0 0 0 2px #eec67d45 inset' : 'none';
      button.style.opacity = button.disabled ? '0.5' : '1';
    }
  }

  function availableEquipment() {
    return equipmentSlots(inventory).filter((slot) => slot.id && slot.count > 0)
      .map((slot) => slot.id);
  }

  function openEquipmentWheel() {
    if (disposed || wheelOpen || !state.active || state.dead || state.holstered) return false;
    const available = availableEquipment();
    if (!available.length) return false;
    wheelOpen = true;
    wheelHighlight = available.includes(selectedEquipment) ? selectedEquipment : available[0];
    wheelVector.x = wheelVector.y = 0;
    if (aiming || state.aiming) {
      aiming = false;
      state.aiming = false;
      onAim(false);
    }
    renderHud();
    return true;
  }

  function moveEquipmentWheel(dx, dy) {
    if (!wheelOpen || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    wheelVector.x = clamp(wheelVector.x + dx, -140, 140);
    wheelVector.y = clamp(wheelVector.y + dy, -140, 140);
    if (Math.hypot(wheelVector.x, wheelVector.y) < 24) return wheelHighlight;
    const angle = Math.atan2(wheelVector.y, wheelVector.x);
    const slots = equipmentSlots(inventory);
    let closest = null;
    for (const [index, slot] of slots.entries()) {
      if (!slot.id || slot.count <= 0) continue;
      const slotAngle = -Math.PI / 2 + index * Math.PI * 2 / EQUIPMENT_IDS.length;
      const delta = Math.atan2(Math.sin(angle - slotAngle),
        Math.cos(angle - slotAngle));
      const distance = Math.abs(delta);
      if (!closest || distance < closest.distance) closest = { id: slot.id, distance };
    }
    if (closest && closest.id !== wheelHighlight) {
      wheelHighlight = closest.id;
      renderHud();
    }
    return wheelHighlight;
  }

  function rotateEquipmentWheel(step = 1) {
    if (!wheelOpen) return null;
    const available = availableEquipment();
    if (!available.length) return null;
    const index = available.indexOf(wheelHighlight);
    const offset = Math.sign(Number(step)) || 1;
    const base = index < 0 ? (offset > 0 ? -1 : 0) : index;
    wheelHighlight = available[(base + offset + available.length) % available.length];
    wheelVector.x = wheelVector.y = 0;
    renderHud();
    return wheelHighlight;
  }

  function closeEquipmentWheel({ commit = true } = {}) {
    if (!wheelOpen) return null;
    wheelOpen = false;
    const choice = commit && availableEquipment().includes(wheelHighlight)
      ? wheelHighlight : null;
    renderHud();
    if (choice && choice !== selectedEquipment) {
      if (onSelectEquipment) onSelectEquipment(choice);
      else selectEquipment(choice);
    }
    return choice;
  }

  function setInventory(next = {}) {
    if (disposed) return;
    inventory = normalizeEquipmentInventory(next, inventory);
    const heldCount = selectedEquipment === 'grenade' ? inventory.grenades
      : selectedEquipment === 'mine' ? inventory.mines : 1;
    if ((isWeapon(selectedEquipment) && !inventory.guns.includes(selectedEquipment))
      || heldCount <= 0) {
      selectedEquipment = inventory.guns.includes(state.weapon) ? state.weapon
        : inventory.guns[0] ?? (inventory.grenades > 0 ? 'grenade'
          : inventory.mines > 0 ? 'mine' : 'unarmed');
      if (selectedEquipment && isWeapon(selectedEquipment)
        && state.weapon !== selectedEquipment) setState({ weapon: selectedEquipment });
    }
    if (!availableEquipment().includes(wheelHighlight)) {
      wheelHighlight = availableEquipment()[0] ?? null;
    }
    renderHud();
  }

  function setState(next = {}) {
    if (disposed) return;
    // Updates are patches; retain prior authoritative values unless replaced.
    const previousWeapon = state.weapon;
    const previousHealth = state.health;
    const newWeapon = isWeapon(next.weapon) ? next.weapon : state.weapon;
    const defaultAmmo = newWeapon !== previousWeapon
      ? { magazine: WEAPONS[newWeapon].magazine, reserve: WEAPONS[newWeapon].reserve,
        reloadingUntil: 0 }
      : { magazine: state.magazine, reserve: state.reserve,
        reloadingUntil: state.reloadingUntil };
    const merged = { ...state, ...next,
      ammo: next.ammo ?? defaultAmmo,
      reloading: next.reloading ?? (next.ammo ? false : state.reloading) };
    if (next.spawnProtectedUntil !== undefined) merged.protectedUntil = next.spawnProtectedUntil;
    if (next.respawnAvailableAt !== undefined) merged.respawnAt = next.respawnAvailableAt;
    state = normalizeCombatHudState(merged);
    if (selectedEquipment === 'unarmed') state.aiming = false;
    if (!state.active || state.dead || state.holstered) wheelOpen = false;
    if (state.health > previousHealth) {
      healthFeedback = 'healed';
      healthFeedbackTime = 1.15;
    } else if (state.health < previousHealth) {
      healthFeedback = 'hurt';
      healthFeedbackTime = 1.15;
    }
    if (newWeapon !== previousWeapon) recoil = 0;
    renderHud();
  }

  function setAiming(value) {
    if (disposed) return;
    state.aiming = wheelOpen || selectedEquipment === 'unarmed'
      ? false : Boolean(value);
  }

  function selectWeapon(weapon) {
    if (!isWeapon(weapon) || disposed || !inventory.guns.includes(weapon)) return false;
    selectedEquipment = weapon;
    setState({ weapon });
    return true;
  }

  function selectEquipment(id) {
    if (disposed || !EQUIPMENT_IDS.includes(id)) return false;
    if (isWeapon(id)) return selectWeapon(id);
    if (id === 'grenade' && inventory.grenades <= 0
      || id === 'mine' && inventory.mines <= 0) return false;
    selectedEquipment = id;
    state.aiming = false;
    if (id === 'unarmed') {
      recoil = 0;
      flashTime = 0;
    }
    renderHud();
    return true;
  }

  function cycleEquipment(step = 1) {
    if (disposed) return null;
    const available = availableEquipment();
    if (!available.length) return null;
    const index = available.indexOf(selectedEquipment);
    const offset = Math.sign(Number(step)) || 1;
    const base = index < 0 ? (offset > 0 ? -1 : 0) : index;
    const next = available[(base + offset + available.length)
      % available.length];
    if (onSelectEquipment) onSelectEquipment(next);
    else selectEquipment(next);
    return next;
  }

  function fire({ weapon = state.weapon, hit = false, origin, direction,
    hitDistance, local = true } = {}) {
    if (disposed || !isWeapon(weapon)) return;
    if (local) {
      if (!state.active || state.dead || state.holstered
        || selectedEquipment !== weapon) return;
      recoil = weapon === 'shotgun' ? 0.34 : weapon === 'rifle' ? 0.24 : 0.15;
      flashTime = 0.075;
      models[weapon].flash.visible = true;
      if (hit) hitTime = 0.21;
      sound.play(weapon);
    } else {
      const point = vectorFrom(origin);
      if (!point) return;
      const distance = camera.position.distanceTo(point);
      const gain = distantShotGain(distance);
      if (gain > 0) {
        const toward = point.clone().sub(camera.position).normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        sound.play(weapon, { gain, pan: toward.dot(right) * 0.7 });
        // Remote muzzle flashes belong in world depth, so cliffs can hide them.
        const flash = makeFlash({ viewmodel: false });
        flash.visible = true;
        flash.position.copy(point);
        if (direction) {
          const vector = Array.isArray(direction)
            ? new THREE.Vector3(...direction) : new THREE.Vector3(direction.x,
              direction.y, direction.z);
          if (vector.lengthSq() > 0.001) flash.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, -1), vector.normalize());
        }
        scene.add(flash);
        transientFlashes.push({ flash, time: 0.08 });
      }
    }
    if (local) {
      const aimOrigin = vectorFrom(origin);
      const aimDirection = vectorFrom(direction);
      if (aimOrigin && aimDirection && aimDirection.lengthSq() > 0.9) {
        camera.updateMatrixWorld(true);
        const muzzle = models[weapon].group.localToWorld(models[weapon].muzzle.clone());
        const aimRange = Number.isFinite(hitDistance)
          ? clamp(hitDistance, 1.01, WEAPONS[weapon].range) : WEAPONS[weapon].range;
        const target = aimOrigin.addScaledVector(aimDirection.normalize(), aimRange);
        const visualTravel = target.sub(muzzle);
        const visualRange = Math.min(WEAPONS[weapon].range, visualTravel.length());
        spawnTracer(weapon, muzzle, visualTravel.normalize(), visualRange,
          { local: true, sourceOrigin: origin, sourceDirection: direction });
      }
    } else {
      spawnTracer(weapon, origin, direction, hitDistance);
    }
  }

  function showDamage(amount = 0) {
    if (disposed || amount <= 0) return;
    damageAlpha = clamp(damageAlpha + 0.25 + Math.min(0.5, amount / MAX_HEALTH), 0, 0.85);
    healthFeedback = 'hurt';
    healthFeedbackTime = 1.15;
    renderHud();
  }

  function showHit() {
    if (!disposed) hitTime = 0.21;
  }

  function showDeath() {
    if (disposed) return;
    state.dead = true;
    renderHud();
  }

  function showRespawn() {
    if (disposed) return;
    state.dead = false;
    damageAlpha = 0;
    healthFeedback = null;
    healthFeedbackTime = 0;
    renderHud();
  }

  function update(dt, { moving = false, aiming: aimOverride } = {}) {
    if (disposed) return;
    const step = clamp(finite(dt), 0, 0.1);
    const hadHealthFeedback = healthFeedbackTime > 0;
    healthFeedbackTime = Math.max(0, healthFeedbackTime - step);
    if (hadHealthFeedback && healthFeedbackTime === 0) renderHud();
    state.serverNow += step * 1000;
    const wasProtected = state.protected;
    const wasReloading = state.reloading;
    if (state.protectedUntil > 0) state.protected = state.protectedUntil > state.serverNow;
    if (state.reloading && state.reloadingUntil > 0
      && state.reloadingUntil <= state.serverNow) state.reloading = false;
    const second = Math.floor(state.serverNow / 1000);
    if (wasProtected !== state.protected || wasReloading !== state.reloading
      || (second !== statusSeconds && (state.dead || state.protected))) {
      statusSeconds = second;
      renderHud();
    }
    if (aimOverride !== undefined) state.aiming = selectedEquipment === 'unarmed'
      ? false : Boolean(aimOverride);
    walkPhase += step * (moving ? 9 : 2);
    recoil = Math.max(0, recoil - step * 1.7);
    flashTime = Math.max(0, flashTime - step);
    for (const [id, model] of Object.entries(models)) {
      model.flash.visible = flashTime > 0 && selectedEquipment === id;
    }
    damageAlpha = Math.max(0, damageAlpha - step * 0.7);
    damage.style.opacity = String(damageAlpha);
    hitTime = Math.max(0, hitTime - step);
    hitmarker.style.opacity = String(hitTime > 0 ? Math.min(1, hitTime * 8) : 0);
    const prone = state.stance === 'prone';
    const targetX = state.aiming ? 0 : selectedEquipment === 'rifle'
      || selectedEquipment === 'shotgun' ? 0.28 : 0.38;
    const targetY = state.aiming ? (prone ? -0.22 : -0.18)
      : prone ? -0.38 : state.stance === 'crouch' ? -0.34 : -0.32;
    const targetZ = state.aiming ? -0.48 : prone ? -0.57 : -0.63;
    const ease = 1 - Math.exp(-step * 13);
    viewRoot.position.x += (targetX - viewRoot.position.x) * ease;
    viewRoot.position.y += (targetY - viewRoot.position.y) * ease;
    viewRoot.position.z += (targetZ - viewRoot.position.z) * ease;
    viewRoot.rotation.x = recoil * 0.43;
    viewRoot.rotation.y = recoil * 0.11;
    viewRoot.position.y += (moving ? Math.sin(walkPhase)
      * (prone ? 0.0003 : state.stance === 'crouch' ? 0.001 : 0.002) : 0);
    crosshair.style.transform = `translate(-50%,-50%) scale(${state.aiming ? 0.65 : 1})`;
    for (let i = transientFlashes.length - 1; i >= 0; i -= 1) {
      const entry = transientFlashes[i];
      entry.time -= step;
      if (entry.time > 0) continue;
      entry.flash.parent?.remove(entry.flash);
      disposeThreeObject(entry.flash);
      transientFlashes.splice(i, 1);
    }
    for (let i = activeTracers.length - 1; i >= 0; i -= 1) {
      const tracer = activeTracers[i];
      tracer.age += step;
      const frame = sampleTracerTravel(tracer.weapon, tracer.age, tracer.maxRange);
      if (!frame || frame.done) {
        removeTracer(i);
        continue;
      }
      tracer.mesh.visible = frame.length > 0.02 && frame.opacity > 0.01;
      tracer.mesh.scale.y = Math.max(0.001, frame.length);
      tracer.mesh.position.copy(tracer.start).addScaledVector(tracer.travel,
        (frame.head + frame.tail) / 2);
      tracer.coreMaterial.opacity = 0.96 * frame.opacity;
      tracer.haloMaterial.opacity = 0.37 * frame.opacity;
    }
    explosives.update(step);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    hud.remove();
    if (oldCrosshair) oldCrosshair.style.opacity = previousCrosshairOpacity;
    camera.remove(viewRoot);
    disposeThreeObject(viewRoot);
    for (const entry of transientFlashes) {
      entry.flash.parent?.remove(entry.flash);
      disposeThreeObject(entry.flash);
    }
    transientFlashes.length = 0;
    while (activeTracers.length) removeTracer(activeTracers.length - 1);
    void sound.dispose();
    explosives.dispose();
  }

  // para's CC0 MakeHuman-derived trigger arm uses a baked camera-relative pose.
  // Keep the original authored hands visible until the optional mesh loads.
  if (doc.defaultView) {
    handAssetStatus = 'loading';
    new GLTFLoader().load('/assets/combat/fps-hands-para-cc0.glb?pose=30-trigger-v2', (gltf) => {
      const source = gltf.scene;
      if (disposed) { disposeThreeObject(source); return; }
      source.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
      if (size.x < 0.2 || size.x > 0.45 || size.y < 0.18 || size.y > 0.4) {
        handAssetStatus = 'fallback';
        hud.dataset.handAsset = handAssetStatus;
        disposeThreeObject(source);
        return;
      }
      // GLTFLoader sanitizes spaces in node names, so match the stable side
      // prefix rather than the exact Blender object label.
      const rightArm = source.children.find((child) => /^Right/.test(child.name));
      if (!rightArm) {
        handAssetStatus = 'fallback';
        hud.dataset.handAsset = handAssetStatus;
        disposeThreeObject(source);
        return;
      }
      // The revolver reads naturally with a single trigger arm. The longer
      // rifle/shotgun stocks keep their fitted procedural two-hand poses.
      rightArm.position.set(-0.08, 0.07, 0.26);
      source.name = 'para anatomical revolver trigger arm (CC0)';
      source.traverse((part) => {
          if (!part.isMesh) return;
          part.renderOrder = VIEWMODEL_RENDER_ORDER;
          part.frustumCulled = false;
          part.castShadow = false;
          for (const surface of Array.isArray(part.material)
            ? part.material : [part.material]) {
            if (surface.name === 'Island coat sleeve') {
              surface.map = textures.sleeve;
              surface.color.setHex(0xffffff);
              surface.roughness = 0.94;
              surface.needsUpdate = true;
            }
            surface.transparent = true;
            surface.depthTest = false;
            surface.depthWrite = false;
            surface.emissive.setHex(surface.name === 'Island coat sleeve'
              ? 0x10191b : 0x302018);
            surface.emissiveIntensity = 0.18;
          }
      });
      models.revolver.group.add(source);
      models.revolver.hands.visible = false;
      handAssetStatus = 'ready';
      hud.dataset.handAsset = handAssetStatus;
    }, undefined, () => {
      handAssetStatus = 'fallback';
      hud.dataset.handAsset = handAssetStatus;
    });
  }

  // OpenGameArt's CC0 revolver is optional. Its grip and barrel align with the
  // authored hands; the procedural firearm remains available on load failure.
  if (doc.defaultView) {
    revolverAssetStatus = 'loading';
    new GLTFLoader().load('/assets/combat/revolver-loafbrr-cc0.glb', (gltf) => {
      const asset = gltf.scene;
      if (disposed) { disposeThreeObject(asset); return; }
      asset.name = 'loafbrr_1 Revolver Game Asset (CC0)';
      // Source barrel +X becomes camera forward -Z. The source muzzle ring
      // is centered at (0.302, 0.094, 0), measured from the source geometry.
      asset.rotation.y = Math.PI / 2;
      asset.scale.setScalar(2);
      asset.position.set(0, -0.115, -0.08);
      asset.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(asset);
      const size = bounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.z) || size.z < 0.5 || size.z > 1.2) {
        revolverAssetStatus = 'fallback';
        disposeThreeObject(asset);
        return;
      }
      asset.traverse((part) => {
        if (!part.isMesh) return;
        part.renderOrder = VIEWMODEL_RENDER_ORDER;
        part.frustumCulled = false;
        part.castShadow = false;
        for (const surface of Array.isArray(part.material)
          ? part.material : [part.material]) {
          surface.transparent = true;
          surface.depthTest = false;
          surface.depthWrite = false;
          // A little ambient fill preserves the source's worn metal texture
          // in overcast scenes without turning its steel into white plastic.
          surface.emissive.setHex(0x293034);
          surface.emissiveIntensity = 0.07;
        }
      });
      models.revolver.group.add(asset);
      models.revolver.gun.visible = false;
      models.revolver.group.updateMatrixWorld(true);
      models.revolver.muzzle.copy(models.revolver.group.worldToLocal(
        asset.localToWorld(new THREE.Vector3(...REVOLVER_SOURCE_MUZZLE))));
      models.revolver.flash.position.copy(models.revolver.muzzle);
      revolverAssetStatus = 'ready';
    }, undefined, () => { revolverAssetStatus = 'fallback'; });
  }

  // Poly Haven's CC0 rifle is optional. The procedural rifle stays ready while
  // it loads and is restored automatically if the request or parse fails.
  if (doc.defaultView) {
    rifleAssetStatus = 'loading';
    new GLTFLoader().load(
      '/assets/combat/bolt_action_rifle_7_62/bolt_action_rifle_7_62_1k.gltf',
      (gltf) => {
        const asset = gltf.scene;
        if (disposed) { disposeThreeObject(asset); return; }
        asset.name = 'Poly Haven Bolt Action Rifle 7.62 (CC0)';
        // The source muzzle faces +X. Turn it toward the camera's -Z view.
        asset.rotation.y = Math.PI / 2;
        asset.scale.setScalar(1.2);
        asset.position.set(0, 0.05, -0.25);
        asset.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(asset);
        const size = bounds.getSize(new THREE.Vector3());
        if (!Number.isFinite(size.z) || size.z < 0.7 || size.z > 2.5) {
          rifleAssetStatus = 'fallback';
          disposeThreeObject(asset);
          return;
        }
        asset.traverse((part) => {
          if (!part.isMesh) return;
          part.renderOrder = VIEWMODEL_RENDER_ORDER;
          part.frustumCulled = false;
          part.castShadow = false;
          for (const surface of Array.isArray(part.material)
            ? part.material : [part.material]) {
            surface.transparent = true;
            surface.depthTest = false;
            surface.depthWrite = false;
          }
        });
        models.rifle.group.add(asset);
        models.rifle.gun.visible = false;
        models.rifle.muzzle.set(0, 0.075, -0.98);
        models.rifle.flash.position.copy(models.rifle.muzzle);
        rifleAssetStatus = 'ready';
      }, undefined, () => { rifleAssetStatus = 'fallback'; });
  }
  renderHud();
  return { setState, setInventory, setAiming, setAim: setAiming,
    selectWeapon, selectEquipment, cycleEquipment,
    openEquipmentWheel, moveEquipmentWheel, rotateEquipmentWheel,
    closeEquipmentWheel,
    get selectedWeapon() { return state.weapon; },
    get selectedEquipment() { return selectedEquipment; },
    get equipmentWheelOpen() { return wheelOpen; },
    get revolverAssetStatus() { return revolverAssetStatus; },
    get rifleAssetStatus() { return rifleAssetStatus; },
    get handAssetStatus() { return handAssetStatus; },
    fire, confirmLocalHit,
    remoteFire(event) {
      fire({ ...event, hitDistance: event?.hit?.distance ?? event?.hitDistance,
        local: false });
    },
    showDamage, showHit, showDeath, showRespawn,
    showExplosiveThrow: explosives.showExplosiveThrow,
    showMinePlacement: explosives.showMinePlacement,
    showExplosion: explosives.showExplosion,
    syncExplosives: explosives.syncExplosives,
    removeExplosive: explosives.removeExplosive,
    update,
    setMuted(value) { sound.setMuted(value); explosives.setMuted(value); },
    setVolume(value) { sound.setVolume(value); explosives.setVolume(value); },
    dispose, element: hud };
}

function disposeThreeObject(object) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  object.traverse((part) => {
    if (part.geometry) geometries.add(part.geometry);
    if (part.material) {
      for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
        materials.add(material);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const key of ['map', 'bumpMap', 'normalMap', 'roughnessMap',
      'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
      if (material[key]) textures.add(material[key]);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}
