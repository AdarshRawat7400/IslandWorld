import test from 'node:test';
import assert from 'node:assert/strict';
import { createHumanReaction, triggerHumanHit, advanceHumanReaction,
  resetHumanReaction, humanBoneBend, HUMAN_COLLAPSE_SECONDS } from '../src/humanCombatReaction.js';

test('humanoid collapse stages a stagger, knee buckle, directional fall and bounded settle', () => {
  const reaction = createHumanReaction(2);
  triggerHumanHit(reaction, { direction: { x: 1, z: 0 }, heading: Math.PI / 2, damage: 100 });
  let pose = advanceHumanReaction(reaction, 0.1, true);
  assert.equal(pose.angle, 0, 'impact precedes the fall');
  assert.ok(pose.knee > 0);
  for (let i = 0; i < 5; i++) pose = advanceHumanReaction(reaction, 0.1, true);
  assert.ok(pose.angle > 0.3 && pose.angle < 1.3);
  assert.ok(pose.knee > 0.5, 'legs buckle while falling');
  assert.ok(Math.abs(pose.fallX) < 0.001 && pose.fallZ > 0.99,
    'world shot direction is transformed into the body heading');
  assert.ok(humanBoneBend('calf_l', pose).x > 0.5, 'rig knees articulate during collapse');
  for (let i = 0; i < 15; i++) pose = advanceHumanReaction(reaction, 0.1, true);
  assert.equal(reaction.deathTime, HUMAN_COLLAPSE_SECONDS);
  assert.equal(pose.settled, true);
  assert.equal(pose.angle, Math.PI / 2);
  assert.ok(pose.rootOffset >= 0.25 && pose.rootOffset <= 0.26);
  assert.equal(pose.scaleY, 1);
  const settled = { ...pose };
  triggerHumanHit(reaction, { direction: { x: -1, z: 0 }, damage: 100 });
  assert.deepEqual(advanceHumanReaction(reaction, 0.1, true), settled,
    'settled corpses cannot restart on a hit');
});

test('nonlethal flinch expires and respawn immediately removes death state', () => {
  const reaction = createHumanReaction();
  triggerHumanHit(reaction, { damage: 20 });
  const flinch = advanceHumanReaction(reaction, 0.1, false);
  assert.ok(flinch.angle > 0.02 && flinch.angle < 0.15);
  assert.equal(flinch.collapse, 0);
  advanceHumanReaction(reaction, 0.25, false);
  assert.equal(advanceHumanReaction(reaction, 0.25, false).angle, 0);
  for (let i = 0; i < 16; i++) advanceHumanReaction(reaction, 0.1, true);
  const respawn = advanceHumanReaction(reaction, 0, false);
  assert.equal(respawn.angle, 0);
  assert.equal(respawn.scaleY, 1);
  assert.equal(respawn.rootOffset, 0);
  assert.equal(respawn.settled, false);
  resetHumanReaction(reaction);
  assert.equal(reaction.dead, false);
});

test('invalid timing and degenerate shot vectors cannot corrupt animation state', () => {
  const reaction = createHumanReaction(3);
  triggerHumanHit(reaction, { direction: { x: 0, z: 0 }, damage: NaN });
  const pose = advanceHumanReaction(reaction, NaN, true);
  for (const value of Object.values(pose)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
  assert.equal(reaction.deathTime, 0);
  assert.equal(advanceHumanReaction(reaction, -1, true).angle, 0);
});
