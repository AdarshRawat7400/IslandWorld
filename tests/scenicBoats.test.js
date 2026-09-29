import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createScenicBoats } from '../src/scenicBoats.js';
import { SITES } from '../src/worldSites.js';

test('both permanent boats stay moored at the island landings', () => {
  const scene = new THREE.Scene();
  const south = SITES.find((site) => site.id === 'landing');
  const north = SITES.find((site) => site.id === 'north_jetty');
  const craft = createScenicBoats(scene, () => 0.4);

  assert.ok(scene.children.includes(craft.ferry));
  assert.ok(scene.children.includes(craft.utilityLaunch));
  assert.ok(Math.hypot(craft.ferry.position.x - south.x,
    craft.ferry.position.z - south.z) < 100);
  assert.ok(Math.hypot(craft.utilityLaunch.position.x - north.x,
    craft.utilityLaunch.position.z - north.z) < 40);
  assert.ok(craft.ferry.children.some((child) => child.isGroup));
  assert.ok(craft.utilityLaunch.children.some((child) => child.isGroup));

  const calmY = craft.ferry.position.y;
  craft.update(10, 'storm');
  assert.ok(Number.isFinite(craft.ferry.position.y));
  assert.ok(Number.isFinite(craft.utilityLaunch.position.y));
  assert.notEqual(craft.ferry.position.y, calmY);
  assert.ok(Math.abs(craft.ferry.position.y - 0.4) < 1);
  assert.ok(Math.abs(craft.utilityLaunch.position.y - 0.4) < 1);

  craft.dispose();
  assert.equal(scene.children.length, 0);
});

test('water height failures cannot produce broken boat transforms', () => {
  const scene = new THREE.Scene();
  const craft = createScenicBoats(scene, () => Number.NaN);
  craft.update(Number.NaN, 'rain');
  assert.ok(Number.isFinite(craft.ferry.position.y));
  assert.ok(Number.isFinite(craft.utilityLaunch.position.y));
  craft.dispose();
});
