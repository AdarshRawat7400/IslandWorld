import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEA_VOLUME, selectAmbienceTargets } from '../src/audio.js';

const stormShore = {
  weather: 'thunderstorm', location: { id: 'landing', indoors: false }, elapsed: 14,
  recordings: { waves: true, wind: true, rain: true, window: true },
};

test('the existing quiet shoreline mix remains the default', () => {
  assert.equal(DEFAULT_SEA_VOLUME, 1);
  const unchanged = selectAmbienceTargets(stormShore);
  const explicit = selectAmbienceTargets({ ...stormShore, seaVolume: 1 });
  assert.deepEqual(unchanged, explicit);
  assert.ok(unchanged.seaBed > 0 && unchanged.seaRecording > 0);
  assert.equal(unchanged.seaRecording, 0.09);
});

test('turning off sea ambience silences procedural and recorded surf only', () => {
  const normal = selectAmbienceTargets(stormShore);
  const off = selectAmbienceTargets({ ...stormShore, seaVolume: 0 });
  assert.equal(off.seaBed, 0);
  assert.equal(off.seaRecording, 0);
  for (const key of ['windBed', 'windRecording', 'rainBed',
    'rainRecording', 'windowRecording', 'hum']) {
    assert.equal(off[key], normal[key], `${key} must be independent of sea volume`);
    if (['windBed', 'windRecording', 'rainBed', 'rainRecording'].includes(key)) {
      assert.ok(off[key] > 0);
    }
  }
});

test('the sea fader scales both surf layers through indoor and recording fallbacks', () => {
  for (const options of [
    stormShore,
    { weather: 'rain', location: { id: 'lodge', indoors: true }, elapsed: 5,
      recordings: { waves: true, wind: true, rain: true, window: true } },
    { weather: 'mist', location: 'inland', elapsed: 2, recordings: {} },
  ]) {
    const full = selectAmbienceTargets({ ...options, seaVolume: 1 });
    const half = selectAmbienceTargets({ ...options, seaVolume: 0.5 });
    assert.ok(Math.abs(half.seaBed - full.seaBed * 0.5) < 1e-12);
    assert.ok(Math.abs(half.seaRecording - full.seaRecording * 0.5) < 1e-12);
    assert.equal(half.rainBed, full.rainBed);
    assert.equal(half.windBed, full.windBed);
  }
});

test('storm gusts are stronger outdoors and soften inside shelter', () => {
  const settings = { location: { id: 'headland', indoors: false },
    recordings: { wind: true }, elapsed: 8 };
  const storm = selectAmbienceTargets({ ...settings, weather: 'storm' });
  const rain = selectAmbienceTargets({ ...settings, weather: 'rain' });
  const sheltered = selectAmbienceTargets({ ...settings, weather: 'storm',
    location: { id: 'lodge', indoors: true } });
  assert.ok(storm.windRecording > rain.windRecording);
  assert.ok(sheltered.windRecording < storm.windRecording * 0.5);
  const later = selectAmbienceTargets({ ...settings, weather: 'storm', elapsed: 11 });
  assert.notEqual(later.windRecording, storm.windRecording);
});

test('surf falls into the background beside the inland lake', () => {
  const options = { weather: 'storm', elapsed: 5, recordings: { waves: true },
    seaVolume: 1 };
  const shore = selectAmbienceTargets({ ...options, location: 'shore' });
  const lake = selectAmbienceTargets({ ...options, location: 'lake' });
  assert.ok(lake.seaBed < shore.seaBed * 0.25);
  assert.ok(lake.seaRecording < shore.seaRecording * 0.25);
  assert.equal(lake.windBed, shore.windBed);
});
