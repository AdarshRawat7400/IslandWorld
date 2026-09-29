import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDroneView } from '../src/droneView.js';
import { orientFirstPersonCamera } from '../src/firstPersonCamera.js';

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not near ${expected}`);

test('walking camera keeps vertical look upright after a drone flight at east and west headings', () => {
  const camera = new THREE.PerspectiveCamera();
  const drone = createDroneView({ terrainHeight: () => 35, waterHeight: () => 0 });

  for (const yaw of [-Math.PI / 2, Math.PI / 2]) {
    const player = { x: 12, z: 20, yaw, pitch: 0.45 };
    orientFirstPersonCamera(camera, player.yaw, player.pitch);
    const before = camera.getWorldDirection(new THREE.Vector3()).clone();
    drone.enter({ ...player, y: 36.7 });
    drone.look(700, -400);
    drone.applyToCamera(camera);
    drone.exit();

    orientFirstPersonCamera(camera, player.yaw, player.pitch);
    const after = camera.getWorldDirection(new THREE.Vector3());
    near(after.x, before.x);
    near(after.y, Math.sin(player.pitch));
    near(after.z, before.z);
    near(camera.rotation.z, 0);
    assert.equal(camera.rotation.order, 'YXZ');
    assert.deepEqual(player, { x: 12, z: 20, yaw, pitch: 0.45 },
      'drone flight cannot change the walking pose');
  }
});
