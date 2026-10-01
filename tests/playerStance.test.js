import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_STANCES, playerStance, stanceEyeHeight,
  togglePlayerStance, validPlayerStance } from '../src/playerStance.js';
import { rayPlayerHit } from '../src/multiplayerRules.js';

test('stance heights and movement are bounded below standing eye and sprint', () => {
  assert.ok(PLAYER_STANCES.stand.eyeHeight > PLAYER_STANCES.crouch.eyeHeight);
  assert.ok(PLAYER_STANCES.crouch.eyeHeight > PLAYER_STANCES.prone.eyeHeight);
  assert.ok(PLAYER_STANCES.stand.runSpeed > PLAYER_STANCES.crouch.walkSpeed);
  assert.ok(PLAYER_STANCES.crouch.walkSpeed > PLAYER_STANCES.prone.walkSpeed);
  assert.ok(Math.abs(stanceEyeHeight(31.88, 'prone') - 30.56) < 1e-9);
});

test('stance toggles and invalid values cannot create an unknown pose', () => {
  assert.equal(togglePlayerStance('stand', 'crouch'), 'crouch');
  assert.equal(togglePlayerStance('crouch', 'crouch'), 'stand');
  assert.equal(togglePlayerStance('crouch', 'prone'), 'prone');
  assert.equal(togglePlayerStance('prone', 'crouch'), 'crouch');
  assert.equal(validPlayerStance('flying'), false);
  assert.equal(playerStance('flying'), PLAYER_STANCES.stand);
});

test('server hitbox follows a crouched or prone player instead of standing height', () => {
  const shot = { x: 0, y: 2.1, z: 0 };
  const direction = { x: 0, y: 0, z: -1 };
  const stand = { x: 0, y: 1.88, z: -8, stance: 'stand' };
  const crouch = { ...stand, y: 1.18, stance: 'crouch' };
  const prone = { ...stand, y: 0.56, stance: 'prone' };
  assert.equal(rayPlayerHit(shot, direction, stand, 30), 8);
  assert.equal(rayPlayerHit(shot, direction, crouch, 30), null);
  assert.equal(rayPlayerHit(shot, direction, prone, 30), null);
  assert.equal(rayPlayerHit({ x: 0, y: 0.55, z: 0 }, direction, prone, 30), 8);
});
