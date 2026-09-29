import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createScenicBoats } from '../src/scenicBoats.js';
import { createSeaLife } from '../src/seaLife.js';
import { boatTiltFromNormal } from '../src/oceanWaveField.js';

function waveSampler() {
  const height = () => 0.45;
  height.normalAt = () => ({ x: 0.1, y: 0.99, z: 0.08 });
  return height;
}

test('moored craft follow the sampled sea without drifting from either landing', () => {
  const boats = createScenicBoats(new THREE.Scene(), waveSampler());
  const positions = [boats.ferry, boats.utilityLaunch]
    .map((craft) => [craft.position.x, craft.position.z]);
  boats.update(2, 'storm');
  assert.equal(boats.ferry.position.y, 0.64);
  assert.equal(boats.utilityLaunch.position.y, 0.64);
  assert.deepEqual([boats.ferry, boats.utilityLaunch]
    .map((craft) => [craft.position.x, craft.position.z]), positions);
  assert.ok(Math.abs(boats.ferry.rotation.x) <= 0.045);
  assert.ok(Math.abs(boats.ferry.rotation.z) <= 0.06);
  assert.ok(Math.abs(boats.utilityLaunch.rotation.x) <= 0.075);
  assert.ok(Math.abs(boats.utilityLaunch.rotation.z) <= 0.095);
  assert.notEqual(boats.ferry.rotation.z, 0);
  assert.notEqual(boats.utilityLaunch.rotation.z, 0);
  boats.dispose();
});

test('offshore vessels keep their lanes and respond to the sampled slope', () => {
  const seaLife = createSeaLife(new THREE.Scene(), { waterHeight: waveSampler() });
  seaLife.update(0, 'mist');
  const visible = seaLife.ships.find((ship) => ship.group.visible);
  assert.ok(visible);
  const tilt = boatTiltFromNormal({ x: 0.1, y: 0.99, z: 0.08 },
    visible.pose.yaw, 0.09, 0.11);
  assert.ok(Math.abs(visible.group.rotation.x - tilt.pitch) <= 0.00501);
  assert.ok(Math.abs(visible.group.rotation.z - tilt.roll) <= 0.00501);
  assert.ok(Math.abs(visible.group.position.x - visible.pose.x) < 1e-9);
  assert.ok(Math.abs(visible.group.position.z - visible.pose.z) < 1e-9);
  seaLife.dispose();
});
