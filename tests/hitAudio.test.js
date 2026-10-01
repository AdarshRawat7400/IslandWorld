import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHitAudio, HIT_AUDIO_ASSETS } from '../src/hitAudio.js';

function fixture(options = {}) {
  const contexts = [];
  const sources = [];
  const panners = [];
  const filters = [];
  const gains = [];
  const requests = [];
  let time = 1000;
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 0);
  const param = () => ({ value: 0, events: [],
    setValueAtTime(...args) { this.events.push(args); },
    linearRampToValueAtTime(...args) { this.events.push(args); },
    setTargetAtTime(...args) { this.events.push(args); } });
  const node = () => ({ disconnected: false, connect(other) { return other; },
    disconnect() { this.disconnected = true; } });
  class Context {
    constructor() {
      this.sampleRate = 22050; this.currentTime = 5; this.state = 'running';
      this.destination = node(); this.listener = {};
      for (const key of ['positionX', 'positionY', 'positionZ', 'forwardX',
        'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']) this.listener[key] = param();
      contexts.push(this);
    }
    createGain() { const n = { ...node(), gain: param() }; gains.push(n); return n; }
    createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(),
      ratio: param(), attack: param(), release: param() }; }
    createBiquadFilter() { const n = { ...node(), frequency: param(), Q: param() };
      filters.push(n); return n; }
    createPanner() { const n = { ...node(), positionX: param(), positionY: param(),
      positionZ: param() }; panners.push(n); return n; }
    createBuffer(channels, length, rate) {
      const data = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => data };
    }
    createBufferSource() { const source = { ...node(), playbackRate: param(), starts: [],
      stops: [], start(...args) { this.starts.push(args); }, stop(...args) {
        this.stops.push(args); if (!args.length) this.onended?.(); } };
      sources.push(source); return source; }
    async decodeAudioData() { return { duration: 0.45 }; }
    async resume() { this.resumed = true; }
    async close() { this.state = 'closed'; }
  }
  const audio = createHitAudio({ camera, AudioContext: Context, random: () => 0.5,
    now: () => time, fetch: async (url, { signal }) => {
      requests.push({ url, signal });
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(12) };
    }, ...options });
  return { audio, camera, contexts, sources, panners, filters, gains, requests,
    advance(ms) { time += ms; } };
}

test('hit audio waits for a gesture and preloads seven small local CC0 recordings once', async () => {
  const f = fixture();
  assert.equal(f.contexts.length, 0);
  assert.equal(f.audio.playHit({ id: 'self', local: true }), false);
  assert.equal(f.contexts.length, 0);
  assert.equal(await f.audio.unlock(), true);
  assert.equal(await f.audio.preload(), true);
  assert.equal(f.requests.length, 7);
  await f.audio.preload();
  assert.equal(f.requests.length, 7);
  assert.equal(f.audio.getState().loadedSamples, 7);
  for (const file of Object.values(HIT_AUDIO_ASSETS).flat()) assert.match(file, /^[\w-]+\.(mp3|ogg)$/);
  await f.audio.dispose();
});

test('human hits choose different recorded grunts without immediate repeats', async () => {
  const f = fixture(); await f.audio.unlock(); await f.audio.preload();
  const variants = [];
  for (let i = 0; i < 8; i += 1) {
    assert.equal(f.audio.playHit({ id: 'self', kind: 'human', local: true, damage: 25 }), true);
    const state = f.audio.getState().lastPlayback;
    assert.equal(state.recorded, true);
    assert.ok(state.gain < 1);
    assert.ok(state.duration < 1.2);
    assert.equal(state.distance, 0);
    variants.push(state.variant); f.advance(701);
  }
  for (let i = 1; i < variants.length; i += 1) assert.notEqual(variants[i], variants[i - 1]);
  assert.equal(f.panners.length, 0, 'local pain is centered instead of coming from the ground');
  await f.audio.dispose();
});

test('per-entity cooldown suppresses automatic-fire vocal spam and event IDs suppress ACK duplicates', async () => {
  const f = fixture(); await f.audio.unlock(); await f.audio.preload();
  const hit = { id: 'resident-a', position: [4, 1, -4], eventId: 'shot-a:resident-a' };
  assert.equal(f.audio.playHit(hit), true);
  f.advance(700);
  assert.equal(f.audio.playHit(hit), false, 'the same event remains deduplicated beyond its cooldown');
  assert.equal(f.audio.playHit({ ...hit, eventId: 'shot-b:resident-a' }), true);
  for (let i = 0; i < 6; i += 1) {
    f.advance(100);
    assert.equal(f.audio.playHit({ ...hit, eventId: `burst-${i}` }), false);
  }
  assert.equal(f.sources.length, 2);
  f.advance(100);
  assert.equal(f.audio.playHit({ ...hit, eventId: 'shot-c:resident-a' }), true);
  f.advance(700);
  assert.equal(f.audio.playHit({ ...hit, eventId: 'burst-0' }), false,
    'a suppressed burst event cannot play late when repeated');
  await f.audio.dispose();
});

test('world vocals snapshot camera orientation and use bounded HRTF positions and distance filtering', async () => {
  const f = fixture(); await f.audio.unlock(); await f.audio.preload();
  f.camera.position.set(10, 8, 20);
  f.camera.rotation.y = Math.PI / 2;
  assert.equal(f.audio.playHit({ id: 'near', kind: 'sheep', position: [15, 8, 20] }), true);
  const nearGain = f.audio.getState().lastPlayback.gain;
  assert.equal(f.contexts[0].listener.positionX.value, 10);
  assert.ok(f.contexts[0].listener.forwardX.value < -0.99);
  assert.equal(f.panners[0].panningModel, 'HRTF');
  assert.equal(f.panners[0].positionX.value, 15);
  assert.equal(f.panners[0].rolloffFactor, 0);
  assert.equal(f.audio.playHit({ id: 'far', kind: 'sheep', position: [60, 8, 20] }), true);
  assert.ok(f.audio.getState().lastPlayback.gain < nearGain);
  assert.ok(f.filters[1].frequency.value < f.filters[0].frequency.value);
  assert.equal(f.audio.playHit({ id: 'too-far', position: [90, 8, 20] }), false);
  assert.equal(f.audio.playHit({ id: 'invalid', position: [NaN, 1, 0] }), false);
  assert.equal(f.audio.playHit({ id: 'invalid-kind', kind: 'tree', position: [10, 8, 20] }), false);
  assert.equal(f.audio.playHit({ id: 'no-damage', local: true, damage: 0 }), false);
  await f.audio.dispose();
});

test('voice count and remembered events stay bounded during an explosion or dense combat', async () => {
  const f = fixture({ maxVoices: 99 }); await f.audio.unlock(); await f.audio.preload();
  for (let i = 0; i < 600; i += 1) f.audio.playHit({ id: `entity-${i}`,
    position: [2, 1, -3], eventId: `event-${i}`, dead: true });
  assert.equal(f.audio.getState().activeVoices, 8);
  assert.equal(f.audio.getState().trackedEntities, 512);
  assert.equal(f.audio.getState().rememberedEvents, 256);
  assert.ok(f.sources.slice(0, -8).every((source) => source.disconnected));
  f.sources.at(-1).onended();
  assert.equal(f.audio.getState().activeVoices, 7);
  f.audio.clear();
  assert.equal(f.audio.getState().activeVoices, 0);
  assert.equal(f.audio.getState().trackedEntities, 0);
  assert.equal(f.audio.getState().rememberedEvents, 0);
  assert.ok(f.sources.every((source) => source.disconnected));
  await f.audio.dispose();
});

test('missing assets use cached, finite original human and species-specific animal vocals', async () => {
  const f = fixture({ fetch: async () => { throw new Error('offline'); } });
  await f.audio.unlock(); assert.equal(await f.audio.preload(), false);
  for (const kind of ['human', 'sheep', 'rabbit', 'bird']) {
    assert.equal(f.audio.playHit({ id: kind, kind, position: [3, 1, 2] }), true);
    assert.equal(f.audio.getState().lastPlayback.recorded, false);
    const buffer = f.sources.at(-1).buffer;
    assert.ok(buffer.duration > 0.15 && buffer.duration < 0.5);
    assert.ok(buffer.getChannelData(0).every((n) => Number.isFinite(n) && Math.abs(n) <= 0.65));
  }
  await f.audio.dispose();
});

test('mute immediately stops vocals and volume follows the game audio setting', async () => {
  const f = fixture(); await f.audio.unlock(); await f.audio.preload();
  f.audio.playHit({ id: 'self', local: true });
  f.audio.setMuted(true);
  assert.equal(f.audio.getState().activeVoices, 0);
  assert.equal(f.audio.playHit({ id: 'other', local: true }), false);
  assert.equal(f.gains[0].gain.events.at(-1)[0], 0);
  f.audio.setMuted(false); f.audio.setVolume(0.5);
  assert.equal(f.gains[0].gain.events.at(-1)[0], 0.18);
  f.audio.setVolume(0);
  assert.equal(f.audio.playHit({ id: 'other', local: true }), false);
  await f.audio.dispose();
});

test('dispose aborts downloads, fences late decode, and releases every active node', async () => {
  const finishes = [];
  const signals = [];
  const f = fixture({ fetch: (url, { signal }) => {
    signals.push(signal); return new Promise((resolve) => finishes.push(resolve));
  } });
  await f.audio.unlock(); const pending = f.audio.preload();
  f.audio.playHit({ id: 'self', local: true });
  await f.audio.dispose();
  for (const finish of finishes) finish({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  await pending;
  assert.ok(signals.every((signal) => signal.aborted));
  assert.ok(f.sources.every((source) => source.disconnected));
  assert.equal(f.contexts[0].state, 'closed');
  assert.equal(f.audio.getState().loadedSamples, 0);
  assert.equal(f.audio.playHit({ id: 'self', local: true }), false);
  assert.equal(await f.audio.unlock(), false);
});

test('unsupported audio hardware gracefully disables vocals', async () => {
  const f = fixture({ AudioContext: null });
  assert.equal(await f.audio.unlock(), false);
  assert.equal(await f.audio.preload(), false);
  assert.equal(f.audio.playHit({ id: 'self', local: true }), false);
  await f.audio.dispose();
});
