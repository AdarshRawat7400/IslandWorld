import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHealthDamage, blastDamageForTarget, playerDownedPose } from '../src/combatDamage.js';
import { EXPLOSIVES } from '../src/multiplayerRules.js';

test('solo blast damage uses radius, cover and spawn protection including the owner', () => {
  const origin = { x: 0, y: 1, z: 0 };
  const target = { ...origin, id: 'owner', health: 100 };
  for (const config of Object.values(EXPLOSIVES)) {
    assert.equal(blastDamageForTarget(origin, target, config), config.damage);
    assert.equal(blastDamageForTarget(origin, { ...target, x: config.radius }, config), config.minDamage);
    assert.equal(blastDamageForTarget(origin, { ...target, x: config.radius + 0.01 }, config), 0);
    assert.equal(blastDamageForTarget(origin, target, config, { visible: () => false }), 0);
    assert.equal(blastDamageForTarget(origin, { ...target, spawnProtectedUntil: 5000 }, config, { now: 4999 }), 0);
    assert.equal(blastDamageForTarget(origin, target, config, { enabled: false }), 0);
    assert.equal(blastDamageForTarget(origin, { ...target, dead: true }, config), 0);
  }
});
test('armor absorbs damage and overkill clamps health without mutating input', () => {
  const original = { health: 60, armor: 25 };
  const hit = applyHealthDamage(original, 90);
  assert.deepEqual(hit, { health: 0, armor: 0, damage: 85, armorDamage: 25, healthDamage: 60, dead: true });
  assert.deepEqual(original, { health: 60, armor: 25 });
  assert.equal(applyHealthDamage(hit, 90).damage, 0);
  assert.equal(applyHealthDamage(original, NaN).damage, 0);
});
test('first-person death falls progressively and settles above ground for every stance', () => {
  for (const height of [2.05, 1.15, 0.45]) {
    const samples = [0, 0.2, 0.5, 0.9, 1.25, 3].map(t => playerDownedPose(t, height));
    assert.equal(samples[0].drop, 0);
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i].drop >= samples[i - 1].drop);
      assert.ok(height - samples[i].drop >= 0.2599);
    }
    assert.deepEqual(samples.at(-1), samples.at(-2));
    assert.equal(samples.at(-1).settled, true);
  }
});
