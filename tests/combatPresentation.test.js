import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { combatHudVisibility, createCombatPresentation, distantShotGain,
  equipmentSlots, normalizeCombatHudState, normalizeEquipmentInventory,
  sampleTracerTravel, visualTracerImpactDistance } from '../src/combatPresentation.js';
import { createExplosivePresentation, sampleExplosiveArc } from '../src/explosivePresentation.js';
import { MAX_HEALTH, WEAPONS } from '../src/multiplayerRules.js';
import { MAX_ARMOR } from '../src/combatLoot.js';

test('combat HUD uses shared server weapon capacities and clamps bad values', () => {
  const rifle = normalizeCombatHudState({ weapon: 'rifle', mode: 'pvp',
    health: MAX_HEALTH + 40, ammo: { magazine: 99, reserve: -8 } });
  assert.equal(rifle.weaponLabel, WEAPONS.rifle.label);
  assert.equal(rifle.magazine, WEAPONS.rifle.magazine);
  assert.equal(rifle.reserve, 0);
  assert.equal(rifle.health, MAX_HEALTH);
  assert.equal(rifle.armor, 0);
  assert.equal(rifle.mode, 'pvp');
  const invalid = normalizeCombatHudState({ weapon: 'unknown', health: -90,
    armor: MAX_ARMOR + 90 });
  assert.equal(invalid.weapon, 'revolver');
  assert.equal(invalid.health, 0);
  assert.equal(invalid.armor, MAX_ARMOR);
  assert.equal(invalid.dead, true);
  assert.equal(normalizeCombatHudState({ stance: 'prone' }).stance, 'prone');
  assert.equal(normalizeCombatHudState({ stance: 'crouch' }).stance, 'crouch');
  assert.equal(normalizeCombatHudState({ stance: 'invalid' }).stance, 'stand');
});

test('combat HUD reflects authoritative reload, spawn protection, and respawn timing', () => {
  const state = normalizeCombatHudState({ serverNow: 1_000, health: 0,
    ammo: { magazine: 0, reserve: 12, reloadingUntil: 2_000 },
    spawnProtectedUntil: 4_000, respawnAvailableAt: 3_000 });
  assert.equal(state.reloading, true);
  assert.equal(state.protected, true);
  assert.equal(state.dead, true);
  assert.equal(state.respawnAt, 3_000);
  const after = normalizeCombatHudState({ serverNow: 4_001,
    ammo: { reloadingUntil: 2_000 }, protectedUntil: 4_000 });
  assert.equal(after.reloading, false);
  assert.equal(after.protected, false);
});

test('remote gun reports fall off smoothly and stop beyond the audible range', () => {
  assert.equal(distantShotGain(0), 1);
  assert.ok(distantShotGain(15) > distantShotGain(50));
  assert.ok(distantShotGain(50) > distantShotGain(100));
  assert.equal(distantShotGain(160), 0);
  assert.equal(distantShotGain(Infinity), 0);
});

test('holstering hides controls in every mode while keeping health and death feedback', () => {
  const holstered = normalizeCombatHudState({ active: true, mobile: true,
    mode: 'pvp', holstered: true, health: 45 });
  const shown = combatHudVisibility(holstered);
  assert.equal(shown.hud, true);
  assert.equal(shown.mode, true);
  assert.equal(shown.health, true);
  assert.equal(shown.damage, true);
  assert.equal(shown.weapon, false);
  assert.equal(shown.ammo, false);
  assert.equal(shown.crosshair, false);
  assert.equal(shown.mobileControls, false);

  const dead = combatHudVisibility(normalizeCombatHudState({ ...holstered,
    health: 0, dead: true }));
  assert.equal(dead.death, true);
  assert.equal(dead.health, true);
  const onFoot = combatHudVisibility(normalizeCombatHudState({ ...holstered,
    holstered: false }));
  assert.equal(onFoot.weapon, true);
  assert.equal(onFoot.mobileControls, true);
  const explore = combatHudVisibility(normalizeCombatHudState({ ...holstered,
    mode: 'explore', holstered: false }));
  assert.equal(explore.weapon, true);
  assert.equal(explore.mobileControls, true);
  assert.equal(explore.health, true);
  const solo = normalizeCombatHudState({ active: true, mode: 'solo' });
  assert.equal(solo.mode, 'solo');
  assert.equal(combatHudVisibility(solo).weapon, true);
  const exploreHolstered = combatHudVisibility(normalizeCombatHudState({
    active: true, mode: 'explore', holstered: true }));
  assert.equal(exploreHolstered.weapon, false);
  assert.equal(exploreHolstered.health, true);
});

test('shot traces stay short, stop at weapon range, and expire promptly', () => {
  for (const weapon of ['revolver', 'rifle', 'shotgun']) {
    const early = sampleTracerTravel(weapon, 0.018);
    assert.ok(early.head > early.tail);
    assert.ok(early.length <= 6);
    assert.ok(early.head < WEAPONS[weapon].range);
    const eightFrames = sampleTracerTravel(weapon, 8 / 60);
    assert.equal(eightFrames.done, false);
    assert.ok(eightFrames.opacity > 0.6);
    const clipped = sampleTracerTravel(weapon, 0.5, 18);
    assert.equal(clipped.head, 18);
    assert.ok(clipped.length <= 6);
    assert.equal(clipped.done, true);
  }
  assert.equal(sampleTracerTravel('unknown', 0.02), null);
  assert.equal(sampleTracerTravel('rifle', Infinity), null);
});

test('inventory exposes at most three unique guns and bounded explosive counts', () => {
  const inventory = normalizeEquipmentInventory({
    guns: ['revolver', 'rifle', 'shotgun', 'revolver', 'invalid'],
    grenades: 4.8, mines: -30,
  });
  assert.deepEqual(inventory, { guns: ['revolver', 'rifle', 'shotgun'],
    grenades: 3, mines: 0 });
  const slots = equipmentSlots(inventory);
  assert.deepEqual(slots.map((slot) => slot.id),
    ['revolver', 'rifle', 'shotgun', 'grenade', 'mine', 'unarmed']);
  assert.deepEqual(slots.map((slot) => slot.count), [1, 1, 1, 3, 0, 1]);
  assert.deepEqual(equipmentSlots({ guns: ['shotgun'] }).slice(0, 3)
    .map((slot) => slot.id), ['shotgun', null, null]);
});

class FakeElement {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.attributes = new Map();
    this.events = new Map();
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(name, callback) {
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).push(callback);
  }
  dispatch(name) {
    for (const callback of this.events.get(name) ?? []) {
      callback({ preventDefault() {}, pointerId: 1 });
    }
  }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const match = child.find(predicate);
      if (match) return match;
    }
    return null;
  }
}

test('equipment selection keeps last gun, updates held model, and mobile USE routes by count', () => {
  const doc = { createElement(tag) { return new FakeElement(this, tag); },
    getElementById() { return null; } };
  const root = new FakeElement(doc, 'body');
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  const selections = [];
  const uses = [];
  const combat = createCombatPresentation({ camera, scene, root, mobile: true,
    onSelectEquipment: (id) => selections.push(id),
    onUseEquipment: (id) => uses.push(id) });
  combat.setState({ active: true });
  combat.setInventory({ guns: ['revolver', 'rifle', 'shotgun'], grenades: 2, mines: 1 });
  assert.equal(combat.selectEquipment('shotgun'), true);
  assert.equal(combat.selectedWeapon, 'shotgun');
  assert.equal(combat.selectEquipment('grenade'), true);
  assert.equal(combat.selectedEquipment, 'grenade');
  assert.equal(combat.selectedWeapon, 'shotgun');
  const modelRoot = camera.children.find((item) =>
    item.name === 'First-person equipment viewmodel');
  assert.equal(combat.revolverAssetStatus, 'fallback');
  assert.equal(combat.rifleAssetStatus, 'fallback');
  assert.equal(modelRoot.children.find((item) => item.name === 'shotgun').visible, false);
  assert.equal(modelRoot.children.find((item) => item.name === 'held-grenade').visible, true);
  const use = root.find((element) => element.attributes.get('aria-label') === 'Use grenade');
  assert.ok(use);
  assert.equal(use.disabled, false);
  const health = root.find((element) => element.innerHTML?.includes('role="progressbar"'));
  assert.ok(health.innerHTML.includes('aria-valuenow="100"'));
  assert.ok(health.innerHTML.includes('aria-label="Armor"'));
  assert.ok(health.innerHTML.includes('ARMOR'));
  use.dispatch('pointerdown');
  assert.deepEqual(uses, ['grenade']);
  assert.equal(combat.cycleEquipment(1), 'mine');
  assert.deepEqual(selections, ['mine']);
  combat.setInventory({ grenades: 0 });
  assert.equal(combat.selectedEquipment, 'shotgun');
  assert.equal(combat.selectEquipment('grenade'), false);
  const grenadeSlot = root.find((element) => element.attributes.get('aria-label')
    === 'Select grenade, slot 4, 0 left');
  assert.equal(grenadeSlot.disabled, true);
  combat.dispose();
  assert.equal(camera.children.includes(modelRoot), false);
  assert.equal(root.children.length, 0);
});

test('radial wheel opens on demand, previews owned equipment, and commits on release', () => {
  const doc = { createElement(tag) { return new FakeElement(this, tag); },
    getElementById() { return null; } };
  const root = new FakeElement(doc, 'body');
  const selections = [];
  const combat = createCombatPresentation({ camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(), root, onSelectEquipment: (id) => selections.push(id) });
  combat.setState({ active: true });
  combat.setInventory({ guns: ['revolver', 'rifle', 'shotgun'], grenades: 1, mines: 1 });
  const wheel = root.find((element) => element.attributes.get('aria-label')
    === 'Equipment wheel');
  assert.equal(wheel.style.display, 'none');
  assert.equal(combat.openEquipmentWheel(), true);
  assert.equal(combat.equipmentWheelOpen, true);
  assert.equal(wheel.style.display, 'block');
  assert.equal(combat.moveEquipmentWheel(-90, 0), 'mine');
  assert.equal(combat.closeEquipmentWheel({ commit: true }), 'mine');
  assert.deepEqual(selections, ['mine']);
  assert.equal(wheel.style.display, 'none');
  assert.equal(combat.openEquipmentWheel(), true);
  assert.equal(combat.rotateEquipmentWheel(1), 'rifle');
  assert.equal(combat.closeEquipmentWheel({ commit: false }), null);
  assert.deepEqual(selections, ['mine']);
  combat.showDamage(22);
  const health = root.find((element) => element.innerHTML?.includes('role="progressbar"'));
  assert.ok(health.innerHTML.includes('HURT'));
  combat.setState({ health: 62 });
  combat.setState({ health: 80 });
  assert.ok(health.innerHTML.includes('RECOVERING'));
  assert.ok(health.innerHTML.includes('aria-valuenow="80"'));
  combat.setState({ armor: 50 });
  assert.ok(health.innerHTML.includes('aria-label="Armor"'));
  assert.ok(health.innerHTML.includes('aria-valuenow="50"'));
  combat.dispose();
});

test('holster remains selectable with empty inventory and keeps health and wheel accessible', () => {
  const doc = { createElement(tag) { return new FakeElement(this, tag); },
    getElementById() { return null; } };
  const root = new FakeElement(doc, 'body');
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  const combat = createCombatPresentation({ camera, scene, root, mobile: true });
  combat.setState({ active: true, stance: 'prone' });
  combat.setInventory({ guns: [], grenades: 0, mines: 0 });
  assert.equal(combat.selectEquipment('unarmed'), true);
  assert.equal(combat.selectedEquipment, 'unarmed');
  assert.equal(combat.openEquipmentWheel(), true);
  assert.equal(combat.closeEquipmentWheel({ commit: true }), 'unarmed');
  const modelRoot = camera.children.find((item) =>
    item.name === 'First-person equipment viewmodel');
  assert.equal(modelRoot.visible, false);
  const fireButton = root.find((element) =>
    element.attributes.get('aria-label') === 'Fire weapon');
  assert.equal(fireButton.style.display, 'none');
  const wheelButton = root.find((element) =>
    element.attributes.get('aria-label') === 'Open equipment wheel');
  assert.ok(wheelButton);
  const holsterSlot = root.find((element) =>
    element.attributes.get('aria-label') === 'Select holster, slot 6');
  assert.ok(holsterSlot);
  assert.equal(holsterSlot.disabled, false);
  const beforeShot = scene.children.length;
  combat.fire({ weapon: 'revolver', origin: [0, 1.7, 0], direction: [0, 0, -1] });
  assert.equal(scene.children.length, beforeShot);
  const health = root.find((element) => element.innerHTML?.includes('role="progressbar"'));
  assert.ok(health.innerHTML.includes('HEALTH'));
  combat.dispose();
});

test('throw arc has stable endpoints and rejects impossible data', () => {
  const from = { x: 0, y: 1, z: 0 };
  const target = { x: 8, y: 0, z: -6 };
  assert.deepEqual(sampleExplosiveArc(from, target, 0), from);
  assert.deepEqual(sampleExplosiveArc(from, target, 1), target);
  const middle = sampleExplosiveArc(from, target, 0.5);
  assert.equal(middle.x, 4);
  assert.ok(middle.y > 2);
  assert.equal(sampleExplosiveArc(from, { x: 100, y: 0, z: 0 }, 0.5), null);
  assert.equal(sampleExplosiveArc(from, target, Infinity), null);
});

test('explosive snapshots reconcile world meshes and burst count stays bounded', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const effects = createExplosivePresentation({ scene, camera });
  assert.equal(effects.showExplosiveThrow({ id: 'g1', kind: 'grenade',
    origin: [0, 1, 0], target: [4, 0, 0] }), true);
  effects.update(0.1);
  assert.equal(effects.activeCount, 1);
  effects.syncExplosives([{ id: 'g1', kind: 'grenade', x: 4, y: 0, z: 0 },
    { id: 'm1', kind: 'mine', x: 3, y: 0, z: 2 }]);
  assert.equal(effects.activeCount, 2);
  effects.syncExplosives([{ id: 'm1', kind: 'mine', x: 3, y: 0, z: 2 }]);
  assert.equal(effects.activeCount, 1);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(effects.showExplosion({ id: `e${i}`, position: [1, 0, 1],
      radius: 6 }), true);
  }
  assert.ok(effects.burstCount <= 8);
  effects.update(0.1);
  effects.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(effects.activeCount, 0);
  assert.equal(effects.burstCount, 0);
});

test('server hit distance caps a cosmetic muzzle-origin tracer at the same impact', () => {
  const cap = visualTracerImpactDistance({ weapon: 'rifle',
    origin: { x: 0, y: 1.7, z: 0 }, direction: { x: 0, y: 0, z: -1 },
    muzzle: { x: 0.4, y: 1.3, z: -1 }, distance: 10 });
  assert.ok(Math.abs(cap - Math.hypot(0.4, 0.4, 9)) < 1e-6);
  assert.equal(visualTracerImpactDistance({ weapon: 'rifle', distance: -1 }), null);
  assert.equal(visualTracerImpactDistance({ weapon: 'revolver',
    origin: [0, 1.7, 0], direction: [0, 0, -1],
    muzzle: [0.4, 1.3, -1], distance: 100 }), WEAPONS.revolver.range);
});
