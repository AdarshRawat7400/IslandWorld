import test from 'node:test';
import assert from 'node:assert/strict';
import { createDynamicWeather } from '../src/dynamicWeather.js';

const length = (vector) => Math.hypot(vector.x, vector.y ?? 0, vector.z);

test('weather and celestial positions reproduce exactly when seeking out of order', () => {
  const a = createDynamicWeather();
  const b = createDynamicWeather();
  const expected = a.sample(963.25);
  a.sample(5);
  a.sample(3900);
  assert.deepEqual(a.sample(963.25), expected);
  assert.deepEqual(b.sample(963.25), expected);
  assert.ok(Math.abs(length(expected.sunDirection) - 1) < 1e-12);
  assert.ok(Math.abs(length(expected.moonDirection) - 1) < 1e-12);
  assert.ok(Math.abs(length(expected.windDirection) - 1) < 1e-12);
});

test('a full day returns the same solar position while moon phase progresses', () => {
  const clock = createDynamicWeather({ dayLengthSeconds: 18 * 60 });
  const early = clock.sample(75);
  const tomorrow = clock.sample(75 + 18 * 60);
  assert.ok(Math.abs(early.hour - tomorrow.hour) < 1e-12);
  assert.ok(Math.abs(early.sunDirection.y - tomorrow.sunDirection.y) < 1e-12);
  assert.ok(tomorrow.moonPhase > early.moonPhase);
  assert.match(early.timeLabel, /^\d\d:\d\d$/);
});

test('time overrides position sun and moon while a fixed weather mode keeps the clock running', () => {
  const clock = createDynamicWeather();
  const dawn = clock.sample(0, { weatherOverride: 'storm', timeOverride: 'dawn' });
  const noon = clock.sample(100, { weatherOverride: 'storm', timeOverride: 'noon' });
  const dusk = clock.sample(200, { weatherOverride: 'storm', timeOverride: 'dusk' });
  const night = clock.sample(300, { weatherOverride: 'storm', timeOverride: 'night' });
  assert.equal(dawn.mode, 'storm');
  assert.equal(night.mode, 'storm');
  assert.equal(dawn.rain, 1);
  assert.equal(noon.cloudCover, 0.97);
  assert.equal(noon.timeLabel, '12:00');
  assert.equal(night.timeLabel, '00:00');
  assert.ok(noon.daylight > 0.99);
  assert.ok(night.night > 0.99);
  assert.ok(dawn.twilight > noon.twilight);
  assert.ok(dusk.twilight > noon.twilight);
  assert.ok(noon.sunDirection.y > dawn.sunDirection.y);
  assert.ok(dawn.moonPhase < night.moonPhase);
});

test('fixed weather supports clear and the legacy dawn preset', () => {
  const clock = createDynamicWeather();
  const clear = clock.sample(600, { weatherOverride: 'clear' });
  const dawn = clock.sample(600, { weatherOverride: 'dawn' });
  assert.equal(clear.mode, 'clear');
  assert.equal(clear.rain, 0);
  assert.ok(clear.windSpeed >= 3 && clear.windSpeed <= 5);
  assert.equal(dawn.mode, 'dawn');
  assert.equal(dawn.rain, 0);
  assert.equal(clear.hour, dawn.hour);
});

test('automatic fronts transition continuously, including the loop join', () => {
  const clock = createDynamicWeather();
  const modes = new Set();
  let previous = clock.sample(0);
  for (let seconds = 0.2; seconds <= clock.frontCycleSeconds * 2; seconds += 0.2) {
    const current = clock.sample(seconds);
    modes.add(current.mode);
    assert.ok(Math.abs(current.rain - previous.rain) < 0.015,
      `rain jumped at ${seconds}`);
    assert.ok(Math.abs(current.cloudCover - previous.cloudCover) < 0.015,
      `cloud cover jumped at ${seconds}`);
    assert.ok(Math.abs(current.windSpeed - previous.windSpeed) < 0.6,
      `wind speed jumped at ${seconds}`);
    assert.ok(Math.hypot(current.windDirection.x - previous.windDirection.x,
      current.windDirection.z - previous.windDirection.z) < 0.05,
    `wind direction jumped at ${seconds}`);
    previous = current;
  }
  for (const mode of ['clear', 'mist', 'rain', 'storm']) assert.ok(modes.has(mode));
});

test('invalid day durations fail early', () => {
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createDynamicWeather({ dayLengthSeconds: value }), RangeError);
  }
});
