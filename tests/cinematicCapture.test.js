import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCinematicCapture, orbitCameraPose } from '../src/cinematicCapture.js';

test('orbit is a translating full circuit with fixed radius, altitude, and closing bearing', () => {
  const options = { centerX: 14, centerZ: -28, radius: 900, altitude: 270,
    startBearing: 0.37 };
  const start = orbitCameraPose(0, options);
  const halfway = orbitCameraPose(0.5, options);
  const finish = orbitCameraPose(1, options);
  for (const fraction of [0, 0.125, 0.25, 0.5, 0.75, 1]) {
    const pose = orbitCameraPose(fraction, options);
    assert.ok(Math.abs(Math.hypot(pose.position.x - options.centerX,
      pose.position.z - options.centerZ) - options.radius) < 1e-9);
    assert.equal(pose.position.y, options.altitude);
    assert.equal(pose.target.x, options.centerX);
    assert.equal(pose.target.z, options.centerZ);
  }
  assert.ok(Math.hypot(start.position.x - halfway.position.x,
    start.position.z - halfway.position.z) > 1700);
  assert.ok(Math.hypot(start.position.x - finish.position.x,
    start.position.z - finish.position.z) < 1e-9);
  assert.ok(Math.abs(finish.bearing - start.bearing - Math.PI * 2) < 1e-9);
});

test('controller exposes orbit progress, permits exact seeks, and holds its final frame', () => {
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 3200);
  const capture = createCinematicCapture(camera);
  capture.startOrbit({ durationSeconds: 60 });
  capture.update(15);
  assert.equal(capture.state().progress, 0.25);
  assert.equal(capture.state().complete, false);
  capture.applyToCamera();
  assert.ok(Math.abs(camera.position.x - 900) < 1e-9);
  assert.ok(Math.abs(camera.position.z) < 1e-9);
  assert.equal(camera.fov, 60);
  capture.seekOrbit(60);
  const finish = capture.state();
  assert.equal(finish.progress, 1);
  assert.equal(finish.complete, true);
  capture.update(30);
  assert.equal(capture.state().progress, 1);
  capture.stop();
  assert.equal(capture.state().active, false);
  assert.equal(camera.fov, 72);
});

test('static scripted view applies exact position and target', () => {
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 3200);
  const capture = createCinematicCapture(camera);
  capture.setView({ position: { x: -300, y: 80, z: 200 },
    target: { x: -100, y: 35, z: 100 }, fov: 52,
    fogDensityCap: 0.001, aerialTrees: true, nightFill: 1 });
  assert.equal(capture.state().mode, 'view');
  assert.equal(capture.state().fogDensityCap, 0.001);
  assert.equal(capture.state().nightFill, 1);
  capture.applyToCamera();
  assert.deepEqual(camera.position.toArray(), [-300, 80, 200]);
  assert.equal(camera.fov, 52);
});
