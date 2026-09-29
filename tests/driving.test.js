import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDriving } from '../src/driving.js';

function makeVehicle(id = 'staff_car') {
  const group = new THREE.Group();
  const collider = { id, x: 0, z: 0, width: 2.18, depth: 5.15, rotation: 0 };
  let wheelTurns = 0;
  return {
    id, type: 'sedan', x: 0, z: 0, heading: 0, width: 2.18, length: 5.15,
    group, collider,
    animateWheels(speed, steering, dt) { wheelTurns += Math.abs(speed) * dt; },
    get wheelTurns() { return wheelTurns; },
  };
}

test('a period car accelerates, steers, brakes and moves its live collider', () => {
  const vehicle = makeVehicle();
  const drive = createDriving([vehicle], () => 0);
  assert.equal(drive.nearbyVehicle(1, 2)?.vehicle.id, vehicle.id);
  assert.equal(drive.enter(vehicle.id), true);
  for (let i = 0; i < 120; i++) drive.update(1 / 60, { throttle: 1 }, () => true);
  assert.ok(vehicle.speed > 5 && vehicle.z > 6);
  assert.equal(vehicle.collider.z, vehicle.z);
  assert.equal(vehicle.group.position.z, vehicle.z);
  assert.ok(vehicle.wheelTurns > 5);
  for (let i = 0; i < 60; i++) drive.update(1 / 60,
    { throttle: 1, steer: 1 }, () => true);
  assert.ok(vehicle.heading < -0.2 && vehicle.x < 0,
    'D should turn toward the driver’s right from the chase camera');
  for (let i = 0; i < 100; i++) drive.update(1 / 60, { brake: true }, () => true);
  assert.ok(Math.abs(vehicle.speed) < 0.01);
  const pose = drive.cameraPose();
  assert.ok(pose.position.y > vehicle.y && pose.target.z > vehicle.z);
});

test('A steers left and reverse steering follows the car’s travel direction', () => {
  const leftCar = makeVehicle('left_car');
  const left = createDriving([leftCar], () => 0);
  left.enter(leftCar.id);
  for (let i = 0; i < 150; i++) left.update(1 / 60,
    { throttle: 1, steer: -1 }, () => true);
  assert.ok(leftCar.heading > 0 && leftCar.x > 0,
    'A should turn toward the driver’s left while moving forward');

  const reverseCar = makeVehicle('reverse_car');
  const reverse = createDriving([reverseCar], () => 0);
  reverse.enter(reverseCar.id);
  for (let i = 0; i < 150; i++) reverse.update(1 / 60,
    { throttle: -1, steer: 1 }, () => true);
  assert.ok(reverseCar.z < 0 && reverseCar.heading > 0,
    'D while reversing should swing the car’s rear to the right');
});

test('whole vehicle footprint stops at obstacles and steep ground', () => {
  const obstacleCar = makeVehicle();
  const drive = createDriving([obstacleCar], () => 0);
  drive.enter(obstacleCar.id);
  for (let i = 0; i < 300; i++) drive.update(1 / 60, { throttle: 1 },
    (_x, z) => z < 9);
  assert.ok(obstacleCar.z < 7, `obstacle was crossed at ${obstacleCar.z}`);
  assert.equal(obstacleCar.speed, 0);

  const slopeCar = makeVehicle('slope_car');
  const heightAt = (_x, z) => Math.max(0, z - 7) * 2;
  const slopeDrive = createDriving([slopeCar], heightAt);
  slopeDrive.enter(slopeCar.id);
  for (let i = 0; i < 300; i++) slopeDrive.update(1 / 60, { throttle: 1 },
    () => true);
  assert.ok(slopeCar.z < 7, `steep grade was climbed at ${slopeCar.z}`);
});

test('exit chooses a safe space, and vehicle positions survive restoration', () => {
  const vehicle = makeVehicle();
  const drive = createDriving([vehicle], () => 0);
  drive.enter(vehicle.id);
  assert.equal(drive.exit(() => false), null);
  assert.equal(drive.active, vehicle);
  const outside = drive.exit((x) => x > 0);
  assert.ok(outside && outside.x > 0);
  assert.equal(drive.active, null);
  const saved = [{ id: vehicle.id, x: 12, z: 8, heading: 0.7 }];
  assert.equal(drive.restore(saved, () => true), 1);
  assert.deepEqual(drive.snapshot(), { vehicles: saved, activeId: null });
  assert.equal(vehicle.collider.x, 12);
  assert.equal(vehicle.group.rotation.y, 0.7);
  assert.equal(drive.restore([{ id: vehicle.id, x: Infinity, z: 0, heading: 0 }]), 0);
  assert.equal(drive.restore({ vehicles: saved, activeId: vehicle.id }, () => true), 1);
  assert.equal(drive.active, vehicle);
  assert.equal(drive.snapshot().activeId, vehicle.id);
});

test('unsurfaced ground lowers grip and cruising speed', () => {
  const roadCar = makeVehicle('road');
  const grassCar = makeVehicle('grass');
  const road = createDriving([roadCar], () => 0, { onRoad: () => true });
  const grass = createDriving([grassCar], () => 0, { onRoad: () => false });
  road.enter('road');
  grass.enter('grass');
  for (let i = 0; i < 240; i++) {
    road.update(1 / 60, { throttle: 1 }, () => true);
    grass.update(1 / 60, { throttle: 1 }, () => true);
  }
  assert.ok(roadCar.speed > grassCar.speed + 3);
});
