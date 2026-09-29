import test from 'node:test';
import assert from 'node:assert/strict';
import { createDynamicWeather } from '../src/dynamicWeather.js';
import { DISTANT_ISLANDS } from '../src/distantIslands.js';
import {
  evaluateShowcase, FULL_ORBIT, SHOWCASE_DURATION_SECONDS,
  TEASER_DURATION_SECONDS,
} from '../src/showcaseTimeline.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('showcase covers the full 11:00 with finite capture poses', () => {
  assert.equal(SHOWCASE_DURATION_SECONDS, 660);
  assert.equal(TEASER_DURATION_SECONDS, 30);
  for (let second = 0; second <= SHOWCASE_DURATION_SECONDS; second += 0.25) {
    const frame = evaluateShowcase(second);
    assert.ok(frame.shotStart <= second && frame.shotEnd >= second);
    assert.ok(Number.isFinite(frame.weatherSeconds));
    assert.ok(Number.isFinite(frame.simulationSeconds));
    assert.ok(Number.isFinite(frame.camera.fov));
    for (const coordinate of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(frame.camera.position[coordinate]));
      assert.ok(Number.isFinite(frame.camera.target[coordinate]));
    }
    assert.ok(distance(frame.camera.position, frame.camera.target) > 1);
  }
  assert.equal(evaluateShowcase(0).section, 'teaser');
  assert.equal(evaluateShowcase(629.9).section, 'distant-islands');
  assert.equal(evaluateShowcase(630).section, 'final-aerial');
  assert.equal(evaluateShowcase(659.9).title, 'ISLAND WORLD');
  assert.equal(evaluateShowcase(660).title, 'ISLAND WORLD');
});

test('the signature shot travels around the whole island and joins the approach', () => {
  const start = evaluateShowcase(FULL_ORBIT.start);
  const quarter = evaluateShowcase(FULL_ORBIT.start + 15);
  const half = evaluateShowcase(FULL_ORBIT.start + 30);
  const threeQuarter = evaluateShowcase(FULL_ORBIT.start + 45);
  const end = evaluateShowcase(FULL_ORBIT.end);
  assert.equal(start.shot, 'full-island-orbit');
  assert.equal(end.shot, 'full-island-orbit');
  assert.ok(distance(start.camera.position, end.camera.position) < 1e-9);
  assert.ok(distance(start.camera.position, half.camera.position) > 1700);
  assert.ok(distance(quarter.camera.position, threeQuarter.camera.position) > 1700);
  for (const sample of [start, quarter, half, threeQuarter, end]) {
    assert.ok(Math.abs(Math.hypot(sample.camera.position.x,
      sample.camera.position.z) - FULL_ORBIT.radius) < 1e-9);
    assert.equal(sample.camera.position.y, FULL_ORBIT.altitude);
    assert.deepEqual(sample.camera.target, { x: 0, y: 25, z: 0 });
  }
  assert.ok(distance(evaluateShowcase(49.999).camera.position,
    start.camera.position) < 0.1);
  assert.ok(distance(evaluateShowcase(110.001).camera.position,
    end.camera.position) < 0.1);
});

test('each fixed viewpoint follows the existing weather clock through clearing', () => {
  const weather = createDynamicWeather();
  const expected = [
    [0, 'clear'], [8, 'mist'], [15, 'rain'], [20, 'storm'],
    [30, 'rain'], [34, 'mist'], [38, 'clear'],
  ];
  for (const start of [270, 310, 350]) {
    const camera = evaluateShowcase(start).camera;
    for (const [offset, mode] of expected) {
      const sample = evaluateShowcase(start + offset);
      assert.equal(sample.weatherOverride, 'auto');
      assert.equal(sample.timeOverride, 'noon');
      assert.deepEqual(sample.camera, camera);
      assert.equal(weather.sample(sample.weatherSeconds).mode, mode);
    }
  }
});

test('day to night timelapse locks the aerial camera while the sun crosses the sky', () => {
  const samples = [435, 460, 485, 509].map(evaluateShowcase);
  for (const sample of samples) assert.deepEqual(sample.camera, samples[0].camera);
  assert.ok(samples[0].timeOverride < 6);
  assert.ok(samples[1].timeOverride > 11 && samples[1].timeOverride < 13);
  assert.ok(samples[2].timeOverride > 17 && samples[2].timeOverride < 19);
  assert.ok(samples[3].timeOverride > 23);
});

test('new distant-island footage faces the two authored silhouettes and lights', () => {
  const north = DISTANT_ISLANDS.find((island) => island.id === 'north-watch');
  const southwest = DISTANT_ISLANDS.find((island) => island.id === 'southwest-warden');
  assert.ok(north?.lighthouse);
  assert.ok(southwest?.lighthouse);
  const facingAngle = (frame, island) => {
    const { position, target } = frame.camera;
    const forward = [target.x - position.x, target.y - position.y,
      target.z - position.z];
    const islandVector = [island.x - position.x, island.cliffHeight - position.y,
      island.z - position.z];
    const dot = forward.reduce((sum, value, index) => sum + value * islandVector[index], 0);
    return Math.acos(dot / (Math.hypot(...forward) * Math.hypot(...islandVector)));
  };
  for (const [time, island] of [[611, north], [617, southwest], [625, southwest],
    [640, north], [652, southwest], [658, southwest]]) {
    const frame = evaluateShowcase(time);
    assert.ok(facingAngle(frame, island) < Math.PI / 9);
    assert.ok(distance(frame.camera.position,
      { x: island.x, y: island.cliffHeight, z: island.z }) < 3200);
  }
  assert.equal(evaluateShowcase(611).weatherOverride, 'clear');
  assert.equal(evaluateShowcase(617).weatherOverride, 'mist');
  assert.equal(evaluateShowcase(625).weatherOverride, 'storm');
  const nightShot = evaluateShowcase(625);
  assert.equal(nightShot.timeOverride, 'night');
  assert.equal(nightShot.camera.nightFill, 1);
  assert.ok(distance(nightShot.camera.position,
    { x: southwest.x, y: southwest.cliffHeight, z: southwest.z }) < 900);
  assert.ok(createDynamicWeather().sample(nightShot.weatherSeconds, {
    weatherOverride: nightShot.weatherOverride,
    timeOverride: nightShot.timeOverride,
  }).night > 0.8);
  assert.deepEqual(evaluateShowcase(620).camera, evaluateShowcase(625).camera);
  for (const time of [630, 637, 645, 650, 658]) {
    assert.equal(evaluateShowcase(time).timeOverride, 'night');
    assert.equal(evaluateShowcase(time).camera.nightFill, 1);
  }
  assert.deepEqual(evaluateShowcase(655).camera,
    evaluateShowcase(660).camera);
});

test('the authored revolving beams sweep toward the camera during the night holds', () => {
  const islandById = Object.fromEntries(DISTANT_ISLANDS.map((island) => [island.id, island]));
  const sweeps = [
    [620, 630, islandById['southwest-warden']],
    [630, 645, islandById['north-watch']],
    [645, 660, islandById['southwest-warden']],
  ];
  for (const [start, end, island] of sweeps) {
    const beaconX = island.x + island.lighthouse.x;
    const beaconZ = island.z + island.lighthouse.z;
    const period = Math.min(12, Math.max(8, island.lighthouse.period));
    let closest = Infinity;
    for (let second = start; second <= end; second += 0.05) {
      const position = evaluateShowcase(second).camera.position;
      const bearing = Math.atan2(position.x - beaconX, position.z - beaconZ);
      const heading = second * Math.PI * 2 / period + island.lighthouse.phase;
      const delta = Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading));
      closest = Math.min(closest, Math.abs(delta));
    }
    assert.ok(closest < 0.105, `${island.id} beam should pass the viewer`);
  }
});
