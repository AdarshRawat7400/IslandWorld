import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_ROUTES, isRoad } from './roads.js';

// Original fixtures and generated textures. Coordinates follow Greywake's
// existing roads and paths; a lamp never creates a new route or playable land.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
const LENS = Object.freeze({ x: 0.63, y: 4.02, z: 0 });
const MAX_LAMPS = 76;
const LIGHT_REACH = 25;
const HANDOFF_OUT_SECONDS = 0.18;
const HANDOFF_IN_SECONDS = 0.22;

const PATH_ROUTES = Object.freeze([
  { id: 'south-approach', width: 3.2, points: [[0, 270], [-18, 246],
    [-39, 222], [-69, 200], [-82, 196]], spacing: 28 },
  { id: 'north-descent', width: 3.0, points: [[-30, -212], [-85, -242],
    [-135, -260], [-100, -290], [-65, -310]], spacing: 42 },
]);
const LANDMARK_LAMPS = Object.freeze([
  { id: 'landing-boardwalk-upper', x: 2.83, z: 286, target: [0, 286], surface: 'boardwalk' },
  { id: 'landing-boardwalk-mid', x: -2.83, z: 309, target: [0, 309], surface: 'boardwalk' },
  { id: 'landing-boardwalk-lower', x: 2.83, z: 333, target: [0, 333], surface: 'boardwalk' },
  { id: 'south-pier-lantern', x: 3.24, z: 355.1, target: [0, 350], surface: 'pier' },
  { id: 'keeper-east', x: -76.8, z: 193.3, target: [-89, 194] },
  { id: 'keeper-west', x: -102.9, z: 193.3, target: [-90, 194] },
  { id: 'archive-entry', x: -158.3, z: 68.6, target: [-170, 68] },
  { id: 'prison-gate-west', x: -65.1, z: 114.5, target: [-58, 112] },
  { id: 'prison-gate-east', x: -50.9, z: 114.5, target: [-58, 112] },
  { id: 'radio-entry', x: 138.8, z: -46.2, target: [150, -47] },
  { id: 'pump-entry', x: 133.9, z: 138.8, target: [125, 137] },
  { id: 'lake-west-path', x: -140, z: -75, target: [-135, -75] },
  { id: 'lake-south-path', x: -105, z: -27, target: [-97, -32] },
  { id: 'lake-north-path', x: -65, z: -130, target: [-65, -125] },
  { id: 'lighthouse-approach', x: -247, z: -130, target: [-247, -136] },
  { id: 'north-landing', x: -73, z: -306, target: [-65, -312] },
]);

/** One fixed cost envelope per renderer; lights remain in the scene all day. */
export function lampRenderBudget(profile = {}) {
  const desktop = !profile.tier || profile.tier === 'desktop';
  return Object.freeze({ lights: desktop ? 4 : 2, shadows: desktop ? 1 : 0,
    shadowMapSize: desktop ? 512 : 256, reach: LIGHT_REACH });
}

/** Dusk photocells switch on gradually. Clouds alone cannot switch on at noon. */
export function lampActivationForClimate(climate = {}) {
  const daylight = Number.isFinite(climate.daylight)
    ? clamp(climate.daylight, 0, 1) : 1;
  const night = Number.isFinite(climate.night) ? clamp(climate.night, 0, 1) : 0;
  const cover = Number.isFinite(climate.cloudCover) ? clamp(climate.cloudCover, 0, 1) : 0;
  const dusk = 1 - smooth(0.08, 0.43 + cover * 0.07, daylight);
  return Math.max(night, dusk);
}

function hash(index) {
  const n = Math.sin(index * 127.1 + 17.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Pure deterministic placement. canPlace(x,z,radius,definition) can reject
 * existing trees, props, structures or resident footprints. Boardwalk/pier
 * candidates still require canPlace; their authored support is not terrain.
 */
export function planIslandLamps({ terrainHeight, groundHeight = terrainHeight,
  isWalkable = () => true, isLake = () => false, canPlace = () => true,
  routes = ROAD_ROUTES, maxCount = MAX_LAMPS } = {}) {
  if (typeof terrainHeight !== 'function' || typeof groundHeight !== 'function') {
    throw new TypeError('Island lamps require terrainHeight(x,z)');
  }
  const definitions = [];
  function accept(candidate) {
    if (definitions.length >= maxCount) return false;
    const { x, z } = candidate;
    if (!Number.isFinite(x) || !Number.isFinite(z) || isLake(x, z, 1.5)) return false;
    if (candidate.routeId && isRoad(x, z, 0.5)) return false;
    if (!['pier', 'boardwalk'].includes(candidate.surface) && !isWalkable(x, z)) return false;
    const y = groundHeight(x, z);
    if (!Number.isFinite(y) || y < 0.15) return false;
    // Don't balance a heavy cast base across an abrupt bank or cliff step.
    if (!candidate.surface && Math.max(
      Math.abs(terrainHeight(x + 0.45, z) - terrainHeight(x - 0.45, z)),
      Math.abs(terrainHeight(x, z + 0.45) - terrainHeight(x, z - 0.45))) > 1.05) return false;
    if (definitions.some((other) => Math.hypot(other.x - x, other.z - z) < 13)) return false;
    if (!canPlace(x, z, 0.38, candidate)) return false;
    const target = candidate.target || [x + 1, z];
    const yaw = Math.atan2(-(target[1] - z), target[0] - x);
    const scale = candidate.surface ? 0.88 : 0.97 + hash(definitions.length) * 0.055;
    const definition = Object.freeze({ ...candidate, y: y + 0.018, yaw, scale,
      radius: 0.28 * scale, sourceX: x + Math.cos(yaw) * LENS.x * scale,
      sourceY: y + 0.018 + LENS.y * scale,
      sourceZ: z - Math.sin(yaw) * LENS.x * scale });
    definitions.push(definition);
    return true;
  }
  // Landmark lights have priority so route lamps cannot displace an entrance.
  LANDMARK_LAMPS.forEach(accept);
  for (const route of [...routes, ...PATH_ROUTES]) {
    const curve = new THREE.CatmullRomCurve3(route.points.map(([x, z]) =>
      new THREE.Vector3(x, 0, z)), false, 'centripetal', 0.5);
    const length = curve.getLength();
    const spacing = route.spacing || 35;
    if (length < 18) continue;
    let ordinal = 0;
    for (let distance = 11; distance < length - 5; distance += spacing) {
      const preferredSide = (ordinal++ % 2) ? -1 : 1;
      // A handful of deterministic alternatives handles an occupied verge.
      for (const [side, advance, extra] of [[preferredSide, 0, 0], [-preferredSide, 0, 0],
        [preferredSide, 5, 0.8], [-preferredSide, -5, 0.8]]) {
        const t = clamp((distance + advance) / length, 0.01, 0.99);
        const p = curve.getPointAt(t), tangent = curve.getTangentAt(t);
        const offset = route.width * 0.75 + 0.75 + extra;
        if (accept({ id: `lamp-${route.id}-${ordinal}`, routeId: route.id,
          x: p.x + tangent.z * offset * side,
          z: p.z - tangent.x * offset * side, target: [p.x, p.z] })) break;
      }
    }
  }
  return Object.freeze(definitions);
}

function weatheredTextures() {
  const size = 96, color = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(color.length), bump = new Uint8Array(color.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const grain = hash(x * 7 + y * 391);
    const blotch = Math.sin(x * 0.14 + Math.sin(y * 0.2))
      * Math.sin(y * 0.11 + x * 0.033);
    const rust = smooth(0.4, 0.9, blotch) * (0.45 + grain * 0.55);
    color[i] = 40 + grain * 11 + rust * 79;
    color[i + 1] = 50 + grain * 10 + rust * 17;
    color[i + 2] = 43 + grain * 9 - rust * 9;
    color[i + 3] = 255;
    const r = 175 + grain * 25 + rust * 44;
    rough.set([r, r, r, 255], i);
    const b = 110 + grain * 37 + rust * 38;
    bump.set([b, b, b, 255], i);
  }
  function texture(data, colorSpace) {
    const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    if (colorSpace) map.colorSpace = colorSpace;
    map.needsUpdate = true;
    return map;
  }
  return { color: texture(color, THREE.SRGBColorSpace), rough: texture(rough), bump: texture(bump) };
}

function lampGeometries() {
  const metal = [], brass = [], glass = [];
  function part(list, geometry, x = 0, y = 0, z = 0) {
    geometry.translate(x, y, z);
    list.push(geometry);
  }
  part(metal, new THREE.LatheGeometry([[0.26, 0], [0.26, 0.12], [0.20, 0.16],
    [0.17, 0.38], [0.135, 0.46], [0.12, 0.53], [0.098, 0.59],
    [0.086, 3.54], [0.12, 3.58], [0.12, 3.68], [0.085, 3.74],
    [0.065, 3.86]].map(([x, y]) => new THREE.Vector2(x, y)), 12));
  for (const y of [0.16, 0.48, 3.6]) {
    part(brass, new THREE.CylinderGeometry(y > 3 ? 0.124 : 0.18,
      y > 3 ? 0.124 : 0.18, 0.037, 12), 0, y, 0);
  }
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 3.68, 0), new THREE.Vector3(0.18, 4.35, 0),
    new THREE.Vector3(0.61, 4.55, 0), new THREE.Vector3(0.85, 4.36, 0),
    new THREE.Vector3(0.63, 4.28, 0),
  ]);
  part(metal, new THREE.TubeGeometry(armCurve, 16, 0.043, 6, false));
  const brace = new THREE.TorusGeometry(0.23, 0.028, 5, 12, Math.PI * 1.6);
  brace.rotateZ(-Math.PI * 0.6);
  part(metal, brace, 0.19, 3.85, 0);
  // A four-sided glazed lantern with a sloping rain cap and chimney finial.
  part(metal, new THREE.BoxGeometry(0.54, 0.055, 0.54), LENS.x, 4.28, 0);
  // The lower frame is an open ring. A solid plate would shadow every metre
  // of ground below the glass, despite the visible glowing source inside it.
  for (const side of [-1, 1]) {
    part(metal, new THREE.BoxGeometry(0.54, 0.055, 0.046), LENS.x, 3.67, side * 0.247);
    part(metal, new THREE.BoxGeometry(0.046, 0.055, 0.448), LENS.x + side * 0.247, 3.67, 0);
  }
  for (const x of [-0.245, 0.245]) for (const z of [-0.245, 0.245]) {
    part(metal, new THREE.CylinderGeometry(0.023, 0.03, 0.58, 5), LENS.x + x, 3.975, z);
  }
  const cap = new THREE.ConeGeometry(0.42, 0.20, 4);
  cap.rotateY(Math.PI / 4);
  part(metal, cap, LENS.x, 4.405, 0);
  part(brass, new THREE.SphereGeometry(0.046, 8, 6), LENS.x, 4.535, 0);
  part(brass, new THREE.CylinderGeometry(0.025, 0.045, 0.19, 8), LENS.x, 3.77, 0);
  for (let side = 0; side < 4; side++) {
    const pane = new THREE.PlaneGeometry(0.435, 0.54);
    pane.translate(0, 0, 0.24);
    pane.rotateY(side * Math.PI / 2);
    part(glass, pane, LENS.x, 3.975, 0);
  }
  function merge(parts) {
    const geometry = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return geometry;
  }
  const bulb = new THREE.SphereGeometry(0.084, 10, 8);
  bulb.scale(0.85, 1.35, 0.85);
  bulb.translate(LENS.x, LENS.y, 0);
  return { metal: merge(metal), brass: merge(brass), glass: merge(glass), bulb };
}

/**
 * Instanced original lamp fixtures plus a constant nearest-light pool. Four
 * spotlights illuminate actual materials, with one local shadow map on
 * desktop. Far lamps keep only the small, depth-tested glass and bulb source.
 */
export function createIslandLamps(scene, { terrainHeight, groundHeight = terrainHeight,
  isWalkable, isLake, canPlace, profile = {}, definitions: supplied } = {}) {
  if (!scene?.add) throw new TypeError('Island lamps require a Three.js scene');
  const definitions = supplied || planIslandLamps({ terrainHeight, groundHeight,
    isWalkable, isLake, canPlace });
  const budget = lampRenderBudget(profile);
  const group = new THREE.Group();
  group.name = 'Greywake vintage cast-iron night lamps';
  const textures = weatheredTextures();
  const geometries = lampGeometries();
  const materials = {
    metal: new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.color,
      roughnessMap: textures.rough, bumpMap: textures.bump, bumpScale: 0.008,
      metalness: 0.72, roughness: 0.94 }),
    brass: new THREE.MeshStandardMaterial({ color: 0x927a43, metalness: 0.78, roughness: 0.48 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xc1b58d, roughness: 0.22,
      transparent: true, opacity: 0.23, depthWrite: false, side: THREE.DoubleSide,
      clearcoat: 1, clearcoatRoughness: 0.10, emissive: 0xf1ae51,
      emissiveIntensity: 0, bumpMap: textures.bump, bumpScale: 0.002 }),
    bulb: new THREE.MeshStandardMaterial({ color: 0xece4c8, roughness: 0.26,
      emissive: 0xffcf89, emissiveIntensity: 0 }),
  };
  const dummy = new THREE.Object3D(), tempColor = new THREE.Color();
  const meshes = {};
  for (const name of Object.keys(materials)) {
    const mesh = new THREE.InstancedMesh(geometries[name], materials[name], definitions.length);
    mesh.name = `Vintage lamp ${name}, ${definitions.length} instances`;
    mesh.castShadow = ['metal', 'brass'].includes(name);
    mesh.receiveShadow = true;
    for (let i = 0; i < definitions.length; i++) {
      const lamp = definitions[i];
      dummy.position.set(lamp.x, lamp.y, lamp.z);
      dummy.rotation.set(0, lamp.yaw, 0);
      dummy.scale.setScalar(lamp.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (name === 'metal') {
        tempColor.setRGB(0.84 + hash(i) * 0.16, 0.85 + hash(i + 39) * 0.15,
          0.85 + hash(i + 91) * 0.15);
        mesh.setColorAt(i, tempColor);
      }
    }
    mesh.computeBoundingSphere();
    group.add(mesh);
    meshes[name] = mesh;
  }
  const lightPool = Array.from({ length: budget.lights }, (_, index) => {
    const light = new THREE.SpotLight(0xffd194, 0, budget.reach, Math.PI * 0.34, 0.70, 2);
    light.name = `Nearest warm vintage lamp pool ${index + 1}`;
    light.castShadow = index < budget.shadows;
    light.shadow.mapSize.set(budget.shadowMapSize, budget.shadowMapSize);
    light.shadow.camera.near = 0.50;
    light.shadow.camera.far = budget.reach;
    light.shadow.bias = -0.0002;
    light.shadow.normalBias = 0.035;
    light.shadow.radius = 2.2;
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = false;
    light.userData.lampIndex = -1;
    light.userData.transition = { phase: 'steady', gain: 1, nextIndex: -1 };
    group.add(light, light.target);
    return light;
  });
  scene.add(group);
  const colliders = Object.freeze(definitions.map(({ id, x, z, radius }) =>
    Object.freeze({ id, x, z, radius })));
  let brightness = 0, wetness = 0, lastSelection = -Infinity, disposed = false;
  const lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  const candidates = definitions.map((lamp, index) => ({ lamp, index, distanceSq: 0, score: 0 }));
  const assigned = new Set();

  function intendedIndex(light) {
    const transition = light.userData.transition;
    return transition.phase === 'out' ? transition.nextIndex : light.userData.lampIndex;
  }

  function assign(light, index) {
    light.userData.lampIndex = index;
    const lamp = definitions[index];
    if (lamp) {
      light.position.set(lamp.sourceX, lamp.sourceY - 0.035, lamp.sourceZ);
      light.target.position.set(lamp.sourceX, lamp.y + 0.12, lamp.sourceZ);
      light.target.updateMatrixWorld();
      light.shadow.needsUpdate = light.castShadow && brightness > 0.02;
    } else light.shadow.needsUpdate = false;
  }

  function requestAssignment(light, index, camera) {
    const transition = light.userData.transition;
    if (index === light.userData.lampIndex) {
      // A camera reversal can cancel a handoff before the source has moved.
      if (transition.phase === 'out') transition.phase = 'in';
      transition.nextIndex = index;
      return;
    }
    const oldLamp = definitions[light.userData.lampIndex];
    const oldOutsideView = !oldLamp || camera.position.distanceTo(light.position) >= 70;
    if (oldOutsideView || brightness <= 0.025 || light.intensity <= 0.01) {
      // Initial assignments and teleports out of the previous light's range
      // need no dimming of a source that the player cannot see.
      assign(light, index);
      Object.assign(transition, { phase: 'steady', gain: 1, nextIndex: index });
      return;
    }
    // Keep the old position until its output reaches zero. Changing only the
    // next index also makes repeated selection passes safe during this fade.
    transition.phase = 'out';
    transition.nextIndex = index;
  }

  function advanceHandoff(light, seconds) {
    const transition = light.userData.transition;
    let remaining = seconds;
    if (transition.phase === 'out') {
      const needed = transition.gain * HANDOFF_OUT_SECONDS;
      if (remaining < needed) {
        transition.gain = Math.max(0, transition.gain - remaining / HANDOFF_OUT_SECONDS);
        return;
      }
      remaining -= needed;
      transition.gain = 0;
      light.intensity = 0;
      assign(light, transition.nextIndex);
      transition.phase = 'in';
    }
    if (transition.phase === 'in') {
      transition.gain = Math.min(1, transition.gain + remaining / HANDOFF_IN_SECONDS);
      if (transition.gain >= 1) transition.phase = 'steady';
    }
  }

  function selectNearby(camera) {
    assigned.clear();
    for (const light of lightPool) if (intendedIndex(light) >= 0) assigned.add(intendedIndex(light));
    for (const candidate of candidates) {
      const { lamp } = candidate;
      candidate.distanceSq = (camera.position.x - lamp.sourceX) ** 2
        + (camera.position.z - lamp.sourceZ) ** 2
        + (camera.position.y - lamp.sourceY) ** 2;
      candidate.score = candidate.distanceSq * (assigned.has(candidate.index) ? 0.77 : 1);
    }
    candidates.sort((a, b) => a.score - b.score || a.index - b.index);
    // Keep slots attached to their old lamp when possible: moving a pool lamp
    // between slots would invalidate both shadow caches for no visual benefit.
    const selected = candidates.filter((c) => c.distanceSq < 70 ** 2).slice(0, budget.lights);
    const pending = selected.filter((c) => !lightPool.some((light) => intendedIndex(light) === c.index));
    for (const light of lightPool) {
      if (selected.some((c) => c.index === intendedIndex(light))) continue;
      const candidate = pending.shift();
      const nextIndex = candidate?.index ?? -1;
      requestAssignment(light, nextIndex, camera);
    }
    lastCamera.copy(camera.position);
  }

  function update(dt, elapsed, climate = {}, camera) {
    if (disposed || !camera?.position) return;
    const frameSeconds = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const target = lampActivationForClimate(climate);
    const previous = brightness;
    brightness += (target - brightness) * (1 - Math.exp(-frameSeconds * 2.1));
    if (Math.abs(brightness - target) < 0.0001) brightness = target;
    const moisture = Number.isFinite(climate.wetness) ? climate.wetness
      : Number.isFinite(climate.groundWetness) ? climate.groundWetness : climate.rain || 0;
    wetness += (clamp(moisture, 0, 1) - wetness) * (1 - Math.exp(-frameSeconds * 0.65));
    materials.metal.roughness = 0.94 - wetness * 0.21;
    materials.brass.roughness = 0.48 - wetness * 0.17;
    materials.glass.roughness = 0.22 - wetness * 0.10;
    materials.glass.emissiveIntensity = brightness * 0.36;
    materials.bulb.emissiveIntensity = brightness * 5.5;
    const seconds = Number.isFinite(elapsed) ? elapsed : 0;
    if (seconds < lastSelection || seconds - lastSelection >= 0.25
      || camera.position.distanceToSquared(lastCamera) > 15 ** 2) {
      selectNearby(camera);
      lastSelection = seconds;
    }
    for (const light of lightPool) {
      advanceHandoff(light, frameSeconds);
      const index = light.userData.lampIndex;
      const lamp = definitions[index];
      if (!lamp) { light.intensity = 0; light.shadow.autoUpdate = false; continue; }
      const distance = camera.position.distanceTo(light.position);
      const localFade = 1 - smooth(49, 67, distance);
      // A tungsten source is steady; sub-percent output variation avoids an
      // artificial synchronized flicker without altering the light's colour.
      const subtleVariation = 0.996 + Math.sin(seconds * 0.37 + index * 2.3) * 0.004;
      light.intensity = 285 * brightness * localFade * subtleVariation * light.userData.transition.gain;
      light.shadow.autoUpdate = light.castShadow && brightness > 0.025 && distance < 43;
      if (light.castShadow && previous <= 0.025 && brightness > 0.025) light.shadow.needsUpdate = true;
    }
  }

  function collides(x, z, radius = 0.32) {
    if (disposed || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0) return false;
    return colliders.some((lamp) => (lamp.x - x) ** 2 + (lamp.z - z) ** 2 < (radius + lamp.radius) ** 2);
  }

  function getState() {
    return { count: definitions.length, brightness, wetness, disposed,
      lightBudget: budget.lights, shadowBudget: budget.shadows,
      activeLights: lightPool.filter((light) => light.intensity > 0.01).length,
      shadowUpdates: lightPool.filter((light) => light.castShadow && light.shadow.autoUpdate).length,
      assignedLampIds: lightPool.map((light) => definitions[light.userData.lampIndex]?.id ?? null),
      transitioningLights: lightPool.filter((light) => light.userData.transition.phase !== 'steady').length,
      fixtureDrawCalls: Object.keys(meshes).length };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(group);
    Object.values(meshes).forEach((mesh) => mesh.dispose());
    Object.values(geometries).forEach((geometry) => geometry.dispose());
    Object.values(materials).forEach((material) => material.dispose());
    Object.values(textures).forEach((texture) => texture.dispose());
    lightPool.forEach((light) => { light.intensity = 0; light.shadow.autoUpdate = false; light.dispose(); });
    group.clear();
  }

  return { group, definitions, colliders, lightPool, meshes, update, collides, getState, dispose };
}
