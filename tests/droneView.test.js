import test from 'node:test';
import assert from 'node:assert/strict';
import { createDroneView, DRONE_LIMITS } from '../src/droneView.js';

const flatDrone = () => createDroneView({ terrainHeight: () => 35, waterHeight: () => 0 });
const near = (actual, expected, tolerance = 0.001) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);

test('drone launches above a copied player pose and never edits that pose', () => {
  const player = Object.freeze({ x: 12, z: 20, y: 36.7, yaw: 0.8 });
  const drone = flatDrone();
  assert.equal(drone.enter(player), true);
  assert.equal(drone.active, true);
  assert.equal(drone.enter(player), false);
  assert.deepEqual(player, { x: 12, z: 20, y: 36.7, yaw: 0.8 });
  const pose = drone.pose();
  assert.equal(pose.x, 12);
  assert.equal(pose.z, 20);
  assert.equal(pose.y, 35 + DRONE_LIMITS.launchClearance);
  assert.equal(pose.yaw, 0.8);
  assert.equal(pose.pitch, -0.28);
  pose.x = -999;
  assert.equal(drone.pose().x, 12, 'the exposed pose is a copy');
});

test('WASD uses view heading, pitch permits diving, and diagonals do not gain speed', () => {
  const drone = flatDrone();
  drone.enter({ x: 0, z: 0, yaw: 0, pitch: 0 });
  for (let i = 0; i < 20; i++) drone.update(0.05, { forward: 1 });
  near(drone.pose().z, -DRONE_LIMITS.cruiseSpeed);
  near(drone.pose().x, 0);

  drone.update(0.05, { forward: 1, sideways: 1 });
  const moved = Math.hypot(drone.pose().x,
    drone.pose().z + DRONE_LIMITS.cruiseSpeed);
  near(moved, DRONE_LIMITS.cruiseSpeed * 0.05);

  const pitched = flatDrone();
  pitched.enter({ x: 0, z: 0, pitch: 0.5 });
  const before = pitched.pose();
  pitched.update(0.05, { forward: 1 });
  assert.ok(pitched.pose().y > before.y, 'forward motion climbs when looking up');
  assert.ok(pitched.pose().z < before.z);
});

test('vertical controls and boost respect terrain, waves, and camera limits', () => {
  const drone = createDroneView({
    terrainHeight: (x) => x > 0 ? 80 : -8,
    waterHeight: () => 4,
  });
  drone.enter({ x: -2, z: 0, yaw: -Math.PI / 2, pitch: 0 });
  assert.equal(drone.pose().y, 4 + DRONE_LIMITS.launchClearance);
  const start = drone.pose();
  drone.update(0.05, { ascend: 1, boost: true });
  near(drone.pose().y - start.y, DRONE_LIMITS.boostSpeed * 0.05);
  for (let i = 0; i < 50; i++) drone.update(0.05, { descend: 1 });
  near(drone.pose().y, 4 + DRONE_LIMITS.minClearance);

  for (let i = 0; i < 80; i++) drone.update(0.05, { forward: 1, boost: true });
  assert.ok(drone.pose().x > 0);
  assert.ok(drone.pose().y >= 80 + DRONE_LIMITS.minClearance,
    'rising terrain pushes the observer above the cliff');
  for (let i = 0; i < 300; i++) drone.update(0.05, { ascend: 1, boost: true });
  near(drone.pose().y, DRONE_LIMITS.maxHeight);
  for (let i = 0; i < 1000; i++) drone.update(0.05, { forward: 1, boost: true });
  near(drone.pose().x, DRONE_LIMITS.horizontal);
});

test('look applies walking mouse convention and camera pose; exit freezes observer', () => {
  const drone = flatDrone();
  assert.equal(drone.look(40, -25), false);
  assert.equal(drone.applyToCamera({}), false);
  drone.enter({ x: 2, z: 3, pitch: 0 });
  drone.look(100, -100);
  near(drone.pose().yaw, -100 * DRONE_LIMITS.lookSensitivity);
  near(drone.pose().pitch, 100 * DRONE_LIMITS.lookSensitivity);
  drone.look(0, -100000);
  near(drone.pose().pitch, DRONE_LIMITS.maxPitch);
  let appliedPosition;
  let appliedRotation;
  const camera = {
    position: { set(...coords) { appliedPosition = coords; } },
    rotation: { order: '', set(...angles) { appliedRotation = angles; } },
  };
  assert.equal(drone.applyToCamera(camera), true);
  assert.deepEqual(appliedPosition, [drone.pose().x, drone.pose().y, drone.pose().z]);
  assert.deepEqual(appliedRotation, [drone.pose().pitch, drone.pose().yaw, 0]);
  assert.equal(camera.rotation.order, 'YXZ');
  const pose = drone.pose();
  assert.equal(drone.exit(), true);
  assert.equal(drone.active, false);
  assert.equal(drone.exit(), false);
  assert.equal(drone.update(0.05, { forward: 1 }), false);
  assert.deepEqual(drone.pose(), pose);
});

test('invalid or suspended-frame input cannot launch or jump the camera', () => {
  assert.throws(() => createDroneView(), TypeError);
  const drone = flatDrone();
  assert.equal(drone.enter({ x: NaN, z: 0 }), false);
  drone.enter({ x: 0, z: 0, pitch: 0 });
  drone.update(999, { forward: 1 });
  near(drone.pose().z, -DRONE_LIMITS.cruiseSpeed * DRONE_LIMITS.maxStepSeconds);
  const pose = drone.pose();
  drone.update(NaN, { forward: Infinity, ascend: Infinity });
  assert.deepEqual(drone.pose(), pose);
});
