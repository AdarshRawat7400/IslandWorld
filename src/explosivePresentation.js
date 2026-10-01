import * as THREE from 'three';

// Original, low-poly equipment and effects. Damage and timing come from the server.
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const MAX_WORLD_EQUIPMENT = 32;
const MAX_BURSTS = 8;
const MAX_THROW_DISTANCE = 80;

function point(value) {
  const parts = Array.isArray(value) ? value : [value?.x, value?.y, value?.z];
  return parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n)
    && Math.abs(n) < 100_000) ? new THREE.Vector3(...parts.slice(0, 3)) : null;
}

export function sampleExplosiveArc(origin, target, progress, lift = 2.2) {
  const from = point(origin);
  const to = point(target);
  if (!from || !to || !Number.isFinite(progress) || !Number.isFinite(lift)
    || from.distanceTo(to) > MAX_THROW_DISTANCE) return null;
  const t = clamp(progress, 0, 1);
  const at = from.lerp(to, t);
  at.y += clamp(lift, 0, 8) * 4 * t * (1 - t);
  return { x: at.x, y: at.y, z: at.z };
}

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.77,
    metalness: 0.18, ...options });
}

function add(group, geometry, surface, position = [0, 0, 0], rotation = null) {
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

export function createExplosiveMesh(kind, { viewmodel = false } = {}) {
  if (kind !== 'grenade' && kind !== 'mine') return null;
  const group = new THREE.Group();
  group.name = kind === 'grenade' ? 'Original fragmentation grenade' : 'Original pressure mine';
  const casing = material(kind === 'grenade' ? 0x56664a : 0x394e48);
  const edge = material(0x273839, { metalness: 0.58, roughness: 0.49 });
  const brass = material(0xa88a58, { metalness: 0.68, roughness: 0.38 });
  const marking = material(0xd9a769, { emissive: 0x754420, emissiveIntensity: 0.18 });
  if (kind === 'grenade') {
    const body = add(group, new THREE.SphereGeometry(0.105, 10, 8), casing);
    body.scale.set(0.85, 1.17, 0.85);
    // Raised ribs make the small silhouette readable at arm's length.
    for (const y of [-0.065, -0.015, 0.035, 0.081]) {
      add(group, new THREE.TorusGeometry(0.088 * Math.sqrt(1 - (y / 0.15) ** 2),
        0.006, 4, 10), edge, [0, y, 0], [Math.PI / 2, 0, 0]);
    }
    for (let i = 0; i < 8; i += 1) {
      const a = i * Math.PI / 4;
      const rib = add(group, new THREE.BoxGeometry(0.012, 0.17, 0.011), edge,
        [Math.sin(a) * 0.075, 0, Math.cos(a) * 0.075]);
      rib.rotation.y = a;
    }
    add(group, new THREE.CylinderGeometry(0.04, 0.045, 0.026, 9), brass,
      [0, 0.127, 0]);
    add(group, new THREE.BoxGeometry(0.026, 0.11, 0.018), edge,
      [0.036, 0.108, 0]);
    add(group, new THREE.TorusGeometry(0.025, 0.005, 4, 8), brass,
      [-0.059, 0.13, 0], [0, Math.PI / 2, 0]);
  } else {
    add(group, new THREE.CylinderGeometry(0.185, 0.2, 0.058, 12), edge,
      [0, 0.029, 0]);
    add(group, new THREE.CylinderGeometry(0.16, 0.17, 0.026, 12), casing,
      [0, 0.068, 0]);
    add(group, new THREE.CylinderGeometry(0.103, 0.115, 0.021, 12), edge,
      [0, 0.092, 0]);
    add(group, new THREE.CylinderGeometry(0.091, 0.091, 0.008, 12), casing,
      [0, 0.106, 0]);
    for (let i = 0; i < 6; i += 1) {
      const a = i * Math.PI / 3;
      add(group, new THREE.BoxGeometry(0.025, 0.015, 0.052), marking,
        [Math.sin(a) * 0.139, 0.086, Math.cos(a) * 0.139], [0, a, 0]);
    }
    add(group, new THREE.SphereGeometry(0.018, 6, 5), marking,
      [0, 0.116, 0]);
  }
  if (viewmodel) group.traverse((part) => {
    if (!part.isMesh) return;
    part.material.transparent = true;
    part.material.depthTest = false;
    part.material.depthWrite = false;
    part.frustumCulled = false;
    part.renderOrder = 10_000;
  });
  return group;
}

function disposeObject(object) {
  const geometries = new Set();
  const materials = new Set();
  object.traverse((part) => {
    if (part.geometry) geometries.add(part.geometry);
    if (part.material) {
      for (const item of Array.isArray(part.material) ? part.material : [part.material]) {
        materials.add(item);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const surface of materials) surface.dispose();
}

function makeBurst(position, radius) {
  const group = new THREE.Group();
  group.position.copy(position);
  const core = add(group, new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd789, transparent: true,
      opacity: 0.84, depthWrite: false, toneMapped: false }));
  const ring = add(group, new THREE.TorusGeometry(1, 0.055, 5, 24),
    new THREE.MeshBasicMaterial({ color: 0xffc47b, transparent: true,
      opacity: 0.75, depthWrite: false, toneMapped: false }),
    [0, 0, 0], [Math.PI / 2, 0, 0]);
  const sparks = [];
  for (let i = 0; i < 18; i += 1) {
    const azimuth = i * 2.3999632;
    const elevation = 0.15 + ((i * 7) % 11) / 15;
    const vector = new THREE.Vector3(Math.cos(azimuth), elevation,
      Math.sin(azimuth)).normalize();
    const spark = add(group, new THREE.IcosahedronGeometry(0.045, 0),
      new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffb663 : 0xffedbc,
        transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    sparks.push({ mesh: spark, vector, speed: 2.1 + (i % 5) * 0.38 });
  }
  return { group, core, ring, sparks, radius, age: 0 };
}

function createBlastAudio() {
  let context;
  let output;
  let noise;
  let muted = false;
  let volume = 1;
  const active = new Set();
  function ensure() {
    if (context?.state !== 'closed' && context) return true;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    try {
      context = new AudioContext();
      output = context.createGain();
      output.gain.value = muted ? 0 : volume * 0.24;
      output.connect(context.destination);
      noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.7),
        context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      context = output = noise = null;
      return false;
    }
  }
  function play(distance = 0) {
    if (muted || !ensure()) return;
    const gain = clamp(1 / (1 + (Math.max(0, distance) / 28) ** 1.7), 0, 1);
    if (gain < 0.02) return;
    void context.resume().catch(() => {});
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(160, now + 0.58);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.75 * gain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
    source.connect(filter).connect(envelope).connect(output);
    source.start(now);
    source.stop(now + 0.62);
    active.add(source);
    source.onended = () => {
      active.delete(source);
      source.disconnect(); filter.disconnect(); envelope.disconnect();
    };
  }
  return { play,
    setMuted(value) {
      muted = Boolean(value);
      if (output) output.gain.setTargetAtTime(muted ? 0 : volume * 0.24,
        context.currentTime, 0.035);
    },
    setVolume(value) {
      volume = clamp(Number.isFinite(Number(value)) ? Number(value) : 1, 0, 1);
      if (output) output.gain.setTargetAtTime(muted ? 0 : volume * 0.24,
        context.currentTime, 0.035);
    },
    async dispose() {
      for (const source of active) {
        try { source.stop(); } catch { /* Already stopped. */ }
      }
      active.clear();
      if (context && context.state !== 'closed') await context.close().catch(() => {});
      context = output = noise = null;
    },
  };
}

/** World-only visualization of authoritative grenade and mine state. */
export function createExplosivePresentation({ scene, camera } = {}) {
  if (!scene?.add || !camera?.position) throw new TypeError('Scene and camera required.');
  const equipment = new Map();
  const bursts = [];
  const sound = createBlastAudio();
  let anonymousId = 0;
  let disposed = false;

  function removeExplosive(id) {
    const key = String(id);
    const entry = equipment.get(key);
    if (!entry) return false;
    entry.mesh.parent?.remove(entry.mesh);
    disposeObject(entry.mesh);
    equipment.delete(key);
    return true;
  }

  function addEquipment(id, kind, location) {
    if (disposed || (kind !== 'grenade' && kind !== 'mine') || !location) return null;
    const key = String(id);
    const existing = equipment.get(key);
    if (existing?.kind === kind) return existing;
    if (existing) removeExplosive(key);
    while (equipment.size >= MAX_WORLD_EQUIPMENT) {
      removeExplosive(equipment.keys().next().value);
    }
    const mesh = createExplosiveMesh(kind);
    mesh.position.copy(location);
    scene.add(mesh);
    const entry = { id: key, kind, mesh, throw: null };
    equipment.set(key, entry);
    return entry;
  }

  function showExplosiveThrow(event = {}) {
    const kind = event.kind ?? event.type ?? 'grenade';
    const origin = point(event.origin);
    const target = point(event.target ?? event.position);
    if (kind !== 'grenade' || !origin || !target
      || origin.distanceTo(target) > MAX_THROW_DISTANCE) return false;
    const id = event.id ?? `local-throw-${++anonymousId}`;
    const entry = addEquipment(id, kind, origin);
    if (!entry) return false;
    entry.throw = { origin, target,
      duration: clamp(Number(event.duration) || 0.72, 0.18, 2.5), age: 0 };
    return true;
  }

  function showMinePlacement(event = {}) {
    const position = point(event.position ?? event);
    if (!position) return false;
    return Boolean(addEquipment(event.id ?? `local-mine-${++anonymousId}`,
      'mine', position));
  }

  function syncExplosives(items = [], serverNow = Date.now()) {
    if (disposed || !Array.isArray(items)) return;
    const seen = new Set();
    for (const item of items.slice(0, MAX_WORLD_EQUIPMENT)) {
      const id = item?.id;
      const kind = item?.kind ?? item?.type;
      const position = point(item?.position ?? item);
      if (id === undefined || id === null || !position
        || (kind !== 'grenade' && kind !== 'mine')) continue;
      const key = String(id);
      seen.add(key);
      const entry = addEquipment(key, kind, position);
      if (!entry || entry.throw) continue;
      entry.mesh.position.copy(position);
      // A timed grenade pulses gently while waiting for the server detonation.
      entry.detonatesAt = Number.isFinite(item.detonatesAt) ? item.detonatesAt : 0;
      entry.serverNow = Number.isFinite(serverNow) ? serverNow : Date.now();
    }
    for (const id of [...equipment.keys()]) {
      if (!seen.has(id)) removeExplosive(id);
    }
  }

  function showExplosion(event = {}) {
    if (disposed) return false;
    const position = point(event.position ?? event.center ?? event);
    if (!position) return false;
    if (event.id !== undefined && event.id !== null) removeExplosive(event.id);
    const radius = clamp(Number(event.radius) || 5, 1, 16);
    while (bursts.length >= MAX_BURSTS) {
      const oldest = bursts.shift();
      oldest.group.parent?.remove(oldest.group);
      disposeObject(oldest.group);
    }
    const burst = makeBurst(position, radius);
    scene.add(burst.group);
    bursts.push(burst);
    sound.play(camera.position.distanceTo(position));
    return true;
  }

  function update(dt) {
    if (disposed) return;
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    for (const entry of equipment.values()) {
      if (entry.throw) {
        entry.throw.age += step;
        const t = clamp(entry.throw.age / entry.throw.duration, 0, 1);
        const location = sampleExplosiveArc(entry.throw.origin, entry.throw.target, t);
        if (location) entry.mesh.position.set(location.x, location.y, location.z);
        entry.mesh.rotation.x += step * 8;
        entry.mesh.rotation.z += step * 4;
        if (t >= 1) {
          entry.throw = null;
          entry.mesh.rotation.set(0, 0, 0);
        }
      } else if (entry.kind === 'grenade' && entry.detonatesAt > 0) {
        entry.mesh.rotation.y += step * 0.7;
      }
    }
    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      const burst = bursts[i];
      burst.age += step;
      const t = burst.age / 0.7;
      if (t >= 1) {
        burst.group.parent?.remove(burst.group);
        disposeObject(burst.group);
        bursts.splice(i, 1);
        continue;
      }
      burst.core.scale.setScalar((0.2 + t * 0.48) * burst.radius);
      burst.core.material.opacity = 0.78 * (1 - t) ** 2;
      burst.ring.scale.setScalar((0.2 + t * 0.82) * burst.radius);
      burst.ring.material.opacity = 0.68 * (1 - t);
      for (const spark of burst.sparks) {
        spark.mesh.position.copy(spark.vector).multiplyScalar(
          burst.radius * Math.min(1, t * spark.speed));
        spark.mesh.position.y -= burst.radius * t * t * 0.3;
        spark.mesh.material.opacity = 0.9 * (1 - t);
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const id of [...equipment.keys()]) removeExplosive(id);
    for (const burst of bursts) {
      burst.group.parent?.remove(burst.group);
      disposeObject(burst.group);
    }
    bursts.length = 0;
    void sound.dispose();
  }
  return { showExplosiveThrow, showMinePlacement, showExplosion,
    syncExplosives, removeExplosive, update, dispose,
    setMuted: sound.setMuted, setVolume: sound.setVolume,
    get activeCount() { return equipment.size; },
    get burstCount() { return bursts.length; } };
}
