import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIslandLamps, lampActivationForClimate, lampRenderBudget,
  planIslandLamps } from '../src/islandLamps.js';
import { islandTerrainHeightAt, islandCoastalRadiusAt } from '../src/world.js';
import { isLake } from '../src/inlandLake.js';
import { isRoad } from '../src/roads.js';
import { createDynamicWeather } from '../src/dynamicWeather.js';

const world = { terrainHeight: islandTerrainHeightAt, isLake,
  isWalkable: (x, z) => islandCoastalRadiusAt(x, z) < 0.955,
  groundHeight: (x, z) => (Math.abs(x) < 3.8 && z >= 342 && z <= 357)
    ? Math.max(0.49, islandTerrainHeightAt(x, z)) : islandTerrainHeightAt(x, z) };

test('lamps follow real Greywake routes with separated bases, safe slopes and dry banks', () => {
  const definitions = planIslandLamps(world);
  assert.ok(definitions.length >= 50 && definitions.length <= 76, `placed ${definitions.length}`);
  assert.deepEqual(definitions, planIslandLamps(world));
  assert.ok(definitions.some((lamp) => lamp.id === 'south-pier-lantern'));
  assert.ok(definitions.some((lamp) => lamp.id.startsWith('lake-')));
  assert.ok(definitions.some((lamp) => lamp.routeId === 'west-coast'));
  assert.ok(definitions.some((lamp) => lamp.routeId === 'east-ridge'));
  for (let i = 0; i < definitions.length; i++) {
    const lamp = definitions[i];
    assert.equal(isLake(lamp.x, lamp.z, 1.5), false, lamp.id);
    assert.ok(Number.isFinite(lamp.y) && lamp.y > 0.15, lamp.id);
    assert.ok(lamp.sourceY > lamp.y + 3.5 && lamp.sourceY < lamp.y + 4.2);
    if (lamp.routeId && !['south-approach', 'north-descent'].includes(lamp.routeId)) {
      assert.equal(isRoad(lamp.x, lamp.z, 0.5), false, lamp.id);
    }
    for (const other of definitions.slice(i + 1)) {
      assert.ok(Math.hypot(other.x - lamp.x, other.z - lamp.z) >= 13, `${lamp.id} / ${other.id}`);
    }
  }
});

test('placement honours every external obstacle rejection and immutable maximum count', () => {
  const calls = [];
  const definitions = planIslandLamps({ ...world, maxCount: 12,
    canPlace: (x, z, radius, definition) => {
      calls.push({ x, z, radius, definition });
      return x < -50;
    } });
  assert.equal(definitions.length, 12);
  assert.ok(definitions.every((lamp) => lamp.x < -50));
  assert.ok(calls.every((call) => call.radius === 0.38));
  assert.ok(Object.isFrozen(definitions) && definitions.every(Object.isFrozen));
  assert.equal(planIslandLamps({ ...world, canPlace: () => false }).length, 0);
  assert.throws(() => planIslandLamps(), TypeError);
});

test('day, storm noon, dusk and night photocell levels are bounded and gradual', () => {
  assert.equal(lampActivationForClimate(), 0);
  assert.equal(lampActivationForClimate({ daylight: 1, cloudCover: 1, night: 0 }), 0);
  assert.equal(lampActivationForClimate({ daylight: 0, night: 1 }), 1);
  const twilight = lampActivationForClimate({ daylight: 0.25, cloudCover: 0.7, night: 0.15 });
  assert.ok(twilight > 0.15 && twilight < 1);
  assert.equal(lampActivationForClimate({ daylight: -10, night: 10 }), 1);
});

test('the actual weather clock keeps lamps off whenever the sun is above the horizon', () => {
  const weatherClock = createDynamicWeather();
  for (const weatherOverride of ['clear', 'mist', 'rain', 'storm', 'dawn']) {
    for (const timeOverride of ['dawn', 'noon', 'dusk', '06:45', '17:15']) {
      const climate = weatherClock.sample(0, { weatherOverride, timeOverride });
      assert.ok(climate.sunDirection.y >= 0, `${weatherOverride} / ${timeOverride}`);
      assert.equal(lampActivationForClimate(climate), 0,
        `sunlit ${weatherOverride} / ${timeOverride} must not light the ground`);
      assert.equal(lampActivationForClimate({ ...climate, daylight: 0, night: 1 }), 0,
        'the solar position takes precedence over contradictory legacy light levels');
    }
  }
});

test('the actual weather clock brings lamps on smoothly below the horizon independently of clouds', () => {
  const weatherClock = createDynamicWeather();
  const hours = [17.65, 17.75, 18, 18.5];
  const activations = hours.map((hour) => {
    const clear = weatherClock.sample(0, { weatherOverride: 'clear', timeOverride: hour });
    const storm = weatherClock.sample(0, { weatherOverride: 'storm', timeOverride: hour });
    assert.ok(clear.sunDirection.y < 0);
    const activation = lampActivationForClimate(clear);
    assert.equal(lampActivationForClimate(storm), activation,
      'rain and storm cloud cover do not advance the night-lamp switch');
    return activation;
  });
  assert.ok(activations[0] > 0 && activations[0] < activations[1]);
  assert.ok(activations[1] < activations[2] && activations[2] < 1);
  assert.equal(activations[3], 1);
  assert.equal(lampActivationForClimate(weatherClock.sample(0, { timeOverride: 'night' })), 1);
  assert.equal(lampActivationForClimate({ sunDirection: { y: 0 }, night: 1, daylight: 0 }), 0);
});

test('a genuine night-to-day change extinguishes the pooled lights and both emitting materials', () => {
  const weatherClock = createDynamicWeather();
  const lamps = createIslandLamps(new THREE.Scene(), world);
  const camera = new THREE.PerspectiveCamera();
  const near = lamps.definitions.find((lamp) => lamp.id === 'keeper-east');
  camera.position.set(near.x - 4, near.y + 2, near.z + 5);
  const flags = lamps.lightPool.map((light) => ({ visible: light.visible, castShadow: light.castShadow }));
  try {
    lamps.update(5, 0, weatherClock.sample(0, { timeOverride: 'night', weatherOverride: 'storm' }), camera);
    assert.ok(lamps.getState().activeLights > 0);
    assert.ok(lamps.meshes.bulb.material.emissiveIntensity > 0);
    assert.ok(lamps.meshes.glass.material.emissiveIntensity > 0);
    for (const timeOverride of ['dawn', 'noon', 'dusk']) {
      lamps.update(5, 1, weatherClock.sample(1, { timeOverride: 'night', weatherOverride: 'storm' }), camera);
      assert.ok(lamps.getState().activeLights > 0);
      lamps.update(1 / 60, 1 + 1 / 60,
        weatherClock.sample(1 + 1 / 60, { timeOverride, weatherOverride: 'storm' }), camera);
      assert.equal(lamps.getState().brightness, 0, `${timeOverride}: off in the first rendered frame`);
      assert.equal(lamps.getState().activeLights, 0);
      assert.equal(lamps.getState().shadowUpdates, 0);
      assert.equal(lamps.meshes.bulb.material.emissiveIntensity, 0);
      assert.equal(lamps.meshes.glass.material.emissiveIntensity, 0);
      assert.ok(lamps.lightPool.every((light) => light.intensity === 0 && !light.shadow.autoUpdate));
      assert.equal(lamps.lightPool.length, 4);
      assert.deepEqual(lamps.lightPool.map((light) => ({ visible: light.visible, castShadow: light.castShadow })), flags);
    }
  } finally {
    lamps.dispose();
  }
});

test('fixtures use four instanced draws and constant pooled lights/shadow shader flags', () => {
  const scene = new THREE.Scene(), lamps = createIslandLamps(scene, world);
  const camera = new THREE.PerspectiveCamera();
  const near = lamps.definitions.find((lamp) => lamp.id === 'keeper-east');
  camera.position.set(near.x - 4, near.y + 2, near.z + 5);
  assert.equal(lamps.getState().fixtureDrawCalls, 4);
  assert.equal(lamps.lightPool.length, 4);
  assert.equal(lamps.lightPool.filter((light) => light.castShadow).length, 1);
  assert.ok(Object.values(lamps.meshes).every((mesh) => mesh.isInstancedMesh
    && mesh.count === lamps.definitions.length && mesh.geometry.getAttribute('position').count > 12));
  lamps.update(5, 0, { daylight: 0, night: 1, rain: 1 }, camera);
  assert.ok(lamps.getState().activeLights >= 2 && lamps.getState().activeLights <= 4);
  assert.ok(lamps.getState().shadowUpdates <= 1);
  assert.ok(lamps.meshes.metal.material.roughness < 0.8);
  for (const light of lamps.lightPool.filter((light) => light.intensity)) {
    assert.ok(light.intensity > 0 && light.intensity <= 285);
    assert.ok(light.position.y > light.target.position.y + 3);
    assert.equal(light.distance, 25);
    assert.equal(light.decay, 2);
  }
  const flags = lamps.lightPool.map((light) => ({ visible: light.visible, castShadow: light.castShadow }));
  lamps.update(6, 6, { daylight: 1, night: 0, rain: 0 }, camera);
  assert.ok(lamps.getState().brightness < 0.001);
  assert.equal(lamps.getState().shadowUpdates, 0);
  assert.deepEqual(lamps.lightPool.map((light) => ({ visible: light.visible, castShadow: light.castShadow })), flags);
  camera.position.set(0, 400, 1500);
  lamps.update(1, 7, { daylight: 0, night: 1 }, camera);
  assert.equal(lamps.getState().activeLights, 0);
  assert.ok(lamps.meshes.bulb.material.emissiveIntensity > 0);
  lamps.dispose();
});

test('mobile budget uses two real lights without additional shadow maps or changes to fixtures', () => {
  assert.deepEqual(lampRenderBudget({ tier: 'mobile-standard' }), {
    lights: 2, shadows: 0, shadowMapSize: 256, reach: 25 });
  const scene = new THREE.Scene(), lamps = createIslandLamps(scene,
    { ...world, profile: { tier: 'mobile-constrained' } });
  assert.equal(lamps.definitions.length, planIslandLamps(world).length);
  assert.equal(lamps.lightPool.length, 2);
  assert.equal(lamps.lightPool.filter((light) => light.castShadow).length, 0);
  assert.ok(lamps.lightPool.every((light) => light.shadow.mapSize.x === 256));
  lamps.dispose();
});

const handoffDefinitions = [-20, 0, 20, 40, 60].map((x, index) => ({
  id: `handoff-${index}`, x, y: 0, z: 0, yaw: 0, scale: 1, radius: 0.28,
  sourceX: x + 0.63, sourceY: 4.02, sourceZ: 0,
}));

test('a visible pool handoff dims at the old lamp, moves only at zero, then fades in', () => {
  const lamps = createIslandLamps(new THREE.Scene(), { definitions: handoffDefinitions });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 0);
  const night = { daylight: 0, night: 1 };
  lamps.update(5, 0, night, camera);
  const changed = lamps.lightPool.find((light) => light.userData.lampIndex === 0);
  const initial = changed.intensity, oldPosition = changed.position.clone();
  const flags = lamps.lightPool.map((light) => ({ visible: light.visible, castShadow: light.castShadow }));
  assert.equal(lamps.getState().transitioningLights, 0, 'initial assignments are immediate');
  camera.position.x = 30;
  lamps.update(0.02, 0.25, night, camera);
  assert.equal(changed.userData.transition.phase, 'out');
  assert.equal(changed.userData.transition.nextIndex, 4);
  assert.deepEqual(changed.position, oldPosition);
  assert.ok(changed.intensity > 0 && changed.intensity < initial);
  lamps.update(0.08, 0.33, night, camera);
  assert.deepEqual(changed.position, oldPosition);
  const halfway = changed.intensity;
  assert.ok(halfway > 0 && halfway < initial * 0.55);
  lamps.update(0.08, 0.41, night, camera);
  assert.equal(changed.userData.lampIndex, 4);
  assert.equal(changed.position.x, handoffDefinitions[4].sourceX);
  assert.ok(changed.intensity < 0.001, 'position changes at effectively zero output');
  lamps.update(0.11, 0.52, night, camera);
  assert.ok(changed.intensity > 100 && changed.intensity < 170);
  lamps.update(0.13, 0.65, night, camera);
  assert.equal(changed.userData.transition.phase, 'steady');
  assert.ok(changed.intensity > 280);
  assert.deepEqual(lamps.lightPool.map((light) => ({ visible: light.visible, castShadow: light.castShadow })), flags);
  assert.equal(lamps.lightPool.length, 4);
  lamps.dispose();
});

test('camera reversal cancels a handoff at its old source and large teleports cannot leave ghost lights', () => {
  const lamps = createIslandLamps(new THREE.Scene(), { definitions: handoffDefinitions });
  const camera = new THREE.PerspectiveCamera();
  const night = { daylight: 0, night: 1 };
  camera.position.set(0, 2, 0);
  lamps.update(5, 0, night, camera);
  const changed = lamps.lightPool.find((light) => light.userData.lampIndex === 0);
  const oldPosition = changed.position.clone();
  camera.position.x = 30;
  lamps.update(0.04, 0.3, night, camera);
  assert.equal(changed.userData.transition.phase, 'out');
  camera.position.x = 0;
  lamps.update(0.02, 0.32, night, camera);
  assert.equal(changed.userData.lampIndex, 0);
  assert.equal(changed.userData.transition.phase, 'in');
  assert.deepEqual(changed.position, oldPosition);
  lamps.update(0.3, 0.62, night, camera);
  assert.equal(changed.userData.transition.phase, 'steady');
  camera.position.x = 2000;
  lamps.update(0.01, 0.63, night, camera);
  assert.equal(lamps.getState().activeLights, 0);
  assert.ok(lamps.lightPool.every((light) => light.userData.lampIndex === -1
    && light.userData.transition.phase === 'steady'));
  lamps.dispose();
});

test('lamp bases block movement and disposal releases original maps, meshes and shadow resources once', () => {
  const scene = new THREE.Scene(), lamps = createIslandLamps(scene, world);
  const lamp = lamps.definitions[0];
  assert.equal(lamps.collides(lamp.x, lamp.z), true);
  assert.equal(lamps.collides(lamp.x + 2, lamp.z), false);
  assert.equal(lamps.collides(NaN, lamp.z), false);
  let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0;
  for (const mesh of Object.values(lamps.meshes)) {
    mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
    mesh.material.addEventListener('dispose', () => materialDisposals++);
  }
  for (const map of new Set([lamps.meshes.metal.material.map,
    lamps.meshes.metal.material.roughnessMap, lamps.meshes.metal.material.bumpMap])) {
    map.addEventListener('dispose', () => textureDisposals++);
  }
  lamps.dispose(); lamps.dispose();
  assert.equal(scene.children.includes(lamps.group), false);
  assert.equal(lamps.collides(lamp.x, lamp.z), false);
  assert.equal(geometryDisposals, 4);
  assert.equal(materialDisposals, 4);
  assert.equal(textureDisposals, 3);
  assert.equal(lamps.getState().disposed, true);
  assert.equal(lamps.getState().activeLights, 0);
  assert.equal(lamps.group.children.length, 0);
});
