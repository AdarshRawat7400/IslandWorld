import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const MAX_CUES = 24;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function point(value, fallback) {
  if (Array.isArray(value)) return new THREE.Vector3(
    Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, Number.isFinite(value.y) ? value.y : fallback.y,
      value.z);
  }
  return fallback.clone();
}

// Short pooled mesh cues communicate NPC shots and thrown objects without
// starting audio contexts, creating timers, or adding a permanent draw load.
export function createNpcAttackPresentation(parent) {
  const group = new THREE.Group();
  group.name = 'NPC combat cues';
  parent.add(group);
  const sphere = new THREE.SphereGeometry(1, 7, 5);
  const beam = new THREE.CylinderGeometry(1, 1, 1, 5, 1);
  const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffe7aa,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const hitMaterial = new THREE.MeshBasicMaterial({ color: 0xffcf88,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pebbleMaterial = new THREE.MeshStandardMaterial({ color: 0x847d6e,
    roughness: 0.98 });
  const cues = [];

  function add(cue) {
    while (cues.length >= MAX_CUES) {
      const oldest = cues.shift();
      for (const mesh of oldest.meshes) group.remove(mesh);
    }
    for (const mesh of cue.meshes) group.add(mesh);
    cues.push(cue);
    return cue;
  }

  function showHit(at) {
    const origin = point(at, new THREE.Vector3());
    const mark = new THREE.Mesh(sphere, hitMaterial);
    mark.position.copy(origin);
    mark.scale.setScalar(0.13);
    add({ kind: 'hit', meshes: [mark], age: 0, lifetime: 0.24 });
  }

  function showAttack(kind, from, to) {
    const origin = point(from, new THREE.Vector3());
    const target = point(to, origin.clone().add(new THREE.Vector3(0, 0, 8)));
    if (kind === 'guard' || kind === 'guard_muzzle') {
      const flash = new THREE.Mesh(sphere, flashMaterial);
      flash.position.copy(origin);
      flash.scale.set(0.16, 0.16, 0.24);
      const meshes = [flash];
      if (kind === 'guard') {
        const vector = target.clone().sub(origin);
        const length = Math.min(vector.length(), 42);
        if (length > 0.01) {
          vector.normalize();
          const tracer = new THREE.Mesh(beam, flashMaterial);
          tracer.position.copy(origin).addScaledVector(vector, length / 2);
          tracer.quaternion.setFromUnitVectors(UP, vector);
          tracer.scale.set(0.012, length, 0.012);
          meshes.push(tracer);
        }
      }
      add({ kind, meshes, age: 0, lifetime: 0.13 });
    } else {
      const pebble = new THREE.Mesh(sphere, pebbleMaterial);
      pebble.position.copy(origin);
      pebble.scale.setScalar(0.085);
      add({ kind: 'throw', meshes: [pebble], age: 0, lifetime: 0.48,
        origin, target });
    }
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (let index = cues.length - 1; index >= 0; index--) {
      const cue = cues[index];
      cue.age += dt;
      const t = clamp(cue.age / cue.lifetime, 0, 1);
      if (cue.kind === 'throw') {
        cue.meshes[0].position.lerpVectors(cue.origin, cue.target, t);
        cue.meshes[0].position.y += Math.sin(Math.PI * t) * 0.58;
      } else {
        const scale = cue.kind === 'hit' ? 1 + t * 2.8 : 1 - t * 0.55;
        cue.meshes[0].scale.setScalar((cue.kind === 'hit' ? 0.13 : 0.16) * scale);
      }
      if (t >= 1) {
        for (const mesh of cue.meshes) group.remove(mesh);
        cues.splice(index, 1);
      }
    }
  }

  function dispose() {
    parent.remove(group);
    cues.length = 0;
    sphere.dispose();
    beam.dispose();
    flashMaterial.dispose();
    hitMaterial.dispose();
    pebbleMaterial.dispose();
  }

  return { group, showHit, showAttack, update, dispose,
    get activeCount() { return cues.length; } };
}
