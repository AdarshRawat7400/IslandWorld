import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerLocomotion } from '../src/playerLocomotion.js';
import { PLAYER_STANCES } from '../src/playerStance.js';

const openGround = (dx, dz) => ({ dx, dz });
function advance(controller, duration, input, move = openGround, dt = 0.02) {
  let state;
  for (let time = 0; time < duration - 1e-8; time += dt) state = controller.step(dt, input, move);
  return state;
}

test('movement accelerates in metres per second and brakes without snapping', () => {
  const controller = createPlayerLocomotion();
  const first = controller.step(0.02, { forward: 1 }, openGround);
  assert.ok(Math.abs(first.speed - 0.24) < 1e-8);
  assert.equal(first.vx, 0);
  assert.ok(first.vz < 0);
  const walk = advance(controller, 1, { forward: 1 });
  assert.ok(Math.abs(walk.speed - PLAYER_STANCES.stand.walkSpeed) < 1e-8);
  const braking = controller.step(0.02, {}, openGround);
  assert.ok(Math.abs(braking.speed - (walk.speed - 0.36)) < 1e-8);
  assert.equal(advance(controller, 1, {}).speed, 0);
});

test('analogue input survives diagonal capping and reverse travel remains slower', () => {
  const controller = createPlayerLocomotion();
  const analog = advance(controller, 1, { forward: 0.35 });
  assert.ok(Math.abs(analog.speed - PLAYER_STANCES.stand.walkSpeed * 0.35) < 1e-8);
  controller.reset();
  const diagonal = advance(controller, 1, { forward: 1, side: 1 });
  assert.ok(diagonal.speed <= PLAYER_STANCES.stand.walkSpeed);
  assert.ok(diagonal.vx > 0 && diagonal.vz < 0);
  controller.reset();
  const reverse = advance(controller, 1, { forward: -1, sprint: true });
  assert.ok(reverse.speed < PLAYER_STANCES.stand.walkSpeed);
  assert.equal(reverse.sprinting, false);
  assert.equal(reverse.stamina, 100);
  controller.reset();
  const turned = advance(controller, 1, { forward: 1, yaw: Math.PI / 2 });
  assert.ok(turned.vx < -4.5 && Math.abs(turned.vz) < 1e-8);
});

test('uphill samples slow movement while downhill never increases the established cap', () => {
  const uphill = createPlayerLocomotion();
  const downhill = createPlayerLocomotion();
  const slow = advance(uphill, 1, { forward: 1, groundHeight: (_x, z) => -z * 0.5 });
  const fast = advance(downhill, 1, { forward: 1, groundHeight: (_x, z) => z * 0.5 });
  assert.ok(slow.speed < 3);
  assert.ok(Math.abs(fast.speed - PLAYER_STANCES.stand.walkSpeed) < 1e-8);
  const unavailable = advance(createPlayerLocomotion(), 1,
    { forward: 1, groundHeight() { throw new Error('sample missing'); } });
  assert.ok(Math.abs(unavailable.speed - fast.speed) < 1e-8);
});

test('posture and combat actions prevent sprint and heavy weapons reduce speed', () => {
  for (const blocked of [{ aiming: true }, { reloading: true }, { firing: true },
    { stance: 'crouch' }, { stance: 'prone' }]) {
    const controller = createPlayerLocomotion();
    const state = advance(controller, 1, { forward: 1, sprint: true, ...blocked });
    assert.equal(state.sprinting, false);
    assert.equal(state.stamina, 100);
    assert.ok(state.speed <= PLAYER_STANCES[blocked.stance ?? 'stand'].walkSpeed + 1e-8);
  }
  const heavy = advance(createPlayerLocomotion(), 1, { forward: 1, weaponMultiplier: 0.84 });
  assert.ok(Math.abs(heavy.speed - PLAYER_STANCES.stand.walkSpeed * 0.84) < 1e-8);
});

test('stamina follows actual running; walls and idle recover without draining', () => {
  const controller = createPlayerLocomotion();
  const wall = advance(controller, 2, { forward: 1, sprint: true }, () => ({ dx: 0, dz: 0 }));
  assert.equal(wall.speed, 0);
  assert.equal(wall.stamina, 100);
  assert.equal(wall.sprinting, false);
  const running = advance(controller, 3, { forward: 1, sprint: true });
  assert.ok(running.stamina < 87 && running.stamina > 83);
  assert.ok(running.sprintFactor > 0.98);
  const beforeRest = running.stamina;
  const shortRest = advance(controller, 0.8, {}, () => ({ dx: 0, dz: 0 }));
  assert.equal(shortRest.stamina, beforeRest);
  const longRest = advance(controller, 1.1, {}, () => ({ dx: 0, dz: 0 }));
  assert.ok(longRest.stamina > beforeRest + 9.9);
});

test('exhaustion has a recovery threshold and resets preserve stamina unless refill requested', () => {
  const controller = createPlayerLocomotion();
  let state;
  for (let i = 0; i < 1200; i += 1) {
    state = controller.step(0.02, { forward: 1, sprint: true }, openGround);
    if (state.exhausted) break;
  }
  assert.equal(state.exhausted, true);
  assert.equal(state.stamina, 0);
  assert.equal(state.sprinting, false);
  state = advance(controller, 2, { active: false });
  assert.equal(state.exhausted, true);
  assert.ok(state.stamina < 28);
  assert.equal(state.speed, 0);
  assert.equal(state.sprintFactor, 0);
  state = advance(controller, 1.8, { active: false });
  assert.equal(state.exhausted, false);
  assert.ok(state.stamina >= 28);
  const stamina = state.stamina;
  assert.equal(controller.reset().stamina, stamina);
  assert.equal(controller.reset({ refill: true }).stamina, 100);
});

test('collision-resolved velocity keeps sliding movement and timestep/input validation stays finite', () => {
  const controller = createPlayerLocomotion();
  const sliding = advance(controller, 1, { forward: 1, side: 1 },
    (dx) => ({ dx, dz: 0 }));
  assert.ok(sliding.vx > 0);
  assert.equal(sliding.vz, 0);
  controller.reset();
  const bounded = controller.step(10, { forward: 1 }, openGround);
  assert.ok(Math.abs(bounded.speed - 0.6) < 1e-8);
  const stable = controller.step(NaN, { forward: Infinity, yaw: NaN }, openGround);
  assert.ok(Object.values(stable).filter((value) => typeof value === 'number').every(Number.isFinite));
  controller.step(0.02, { forward: 1 }, () => ({ dx: NaN, dz: Infinity }));
  assert.equal(controller.readState().speed, 0);
});
