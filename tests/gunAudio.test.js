import test from 'node:test';
import assert from 'node:assert/strict';
import { createGunAudio, GUN_AUDIO_ASSETS } from '../src/gunAudio.js';

function audioFixture(options = {}) {
  const contexts = [];
  const sources = [];
  const filters = [];
  const gains = [];
  const requests = [];
  const limiters = [];
  const param = () => ({ value: 0, events: [],
    setValueAtTime(value, time) { this.events.push([value, time]); },
    linearRampToValueAtTime(value, time) { this.events.push([value, time]); },
    setTargetAtTime(value, time, decay) { this.events.push([value, time, decay]); } });
  const node = () => ({ disconnected: false,
    connect(other) { return other; }, disconnect() { this.disconnected = true; } });
  class Context {
    constructor() { this.currentTime = 5; this.state = 'running'; this.sampleRate = 44100;
      this.destination = node(); contexts.push(this); }
    createGain() { const n = { ...node(), gain: param() }; gains.push(n); return n; }
    createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(),
      ratio: param(), attack: param(), release: param() }; }
    createWaveShaper() { const n = node(); limiters.push(n); return n; }
    createBiquadFilter() { const n = { ...node(), frequency: param(), Q: param() };
      filters.push(n); return n; }
    createStereoPanner() { return { ...node(), pan: param() }; }
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      return { duration: length / sampleRate, getChannelData: () => data };
    }
    createBufferSource() { const s = { ...node(), playbackRate: param(), starts: [],
      stops: [], start(...args) { this.starts.push(args); }, stop(...args) {
        this.stops.push(args); if (!args.length) this.onended?.(); } };
      sources.push(s); return s; }
    async resume() { this.resumed = true; }
    async close() { this.state = 'closed'; }
    async decodeAudioData() { return { duration: 1.2 }; }
  }
  const audio = createGunAudio({ AudioContext: Context,
    fetch: async (url, { signal }) => { requests.push({ url, signal });
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(10) }; },
    random: () => 0.5, ...options });
  return { audio, contexts, sources, gains, filters, requests, limiters };
}

test('gun mix stays lazy until user unlock or playback and caches its CC0 samples', async () => {
  const f = audioFixture();
  assert.equal(f.contexts.length, 0);
  assert.equal(await f.audio.unlock(), true);
  assert.equal(await f.audio.preload(), true);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.requests.length, 13);
  await f.audio.preload();
  assert.equal(f.requests.length, 13);
  assert.equal(f.audio.getState().loadedSamples, 13);
  await f.audio.dispose();
});

test('recorded automatic and single-fire weapons play distinct profiles without clipping gain', async () => {
  const f = audioFixture();
  await f.audio.preload();
  for (const weapon of ['revolver', 'rifle', 'shotgun', 'smg', 'lmg']) {
    assert.equal(f.audio.play(weapon, { gain: 9, pan: 8 }), true);
    const p = f.audio.getState().lastPlayback;
    assert.equal(p.recorded, true);
    assert.equal(p.weapon, weapon);
    assert.ok(p.gain <= 1);
    assert.equal(p.pan, 1);
    assert.ok(p.rate >= 0.97 && p.rate <= 1.03);
  }
  assert.equal(f.audio.play('unknown'), false);
  assert.equal(f.sources.length, 5);
  await f.audio.dispose();
});

test('remote reports use pan, acoustic travel delay and a distance low-pass filter', async () => {
  const f = audioFixture();
  await f.audio.preload();
  f.audio.play('rifle', { gain: 0.1, pan: -0.7, distance: 120 });
  assert.ok(Math.abs(f.audio.getState().lastPlayback.delay - 120 / 343) < 1e-9);
  assert.equal(f.audio.getState().lastPlayback.pan, -0.7);
  assert.ok(f.filters[0].frequency.value < 2500);
  assert.ok(f.sources[0].starts[0][0] > 5.3);
  await f.audio.dispose();
});

test('sustained machine gun bursts never exceed the bounded voice budget', async () => {
  const f = audioFixture({ maxVoices: 4 });
  await f.audio.preload();
  for (let i = 0; i < 30; i += 1) f.audio.play('smg');
  assert.equal(f.audio.getState().activeVoices, 4);
  assert.ok(f.sources.slice(0, 26).every((s) => s.disconnected));
  f.sources.at(-1).onended();
  assert.equal(f.audio.getState().activeVoices, 3);
  await f.audio.dispose();
  assert.equal(f.audio.getState().activeVoices, 0);
  assert.ok(f.sources.every((s) => s.disconnected));
});

test('reload foley duration uses seconds and cancels on interruption without a gunshot substitute', async () => {
  const f = audioFixture();
  assert.equal(f.audio.playReload('rifle'), false);
  await f.audio.preload();
  assert.equal(f.audio.playReload('rifle', { duration: 3 }), true);
  assert.equal(f.audio.getState().lastPlayback.kind, 'reload');
  assert.equal(f.audio.getState().lastPlayback.rate, 0.72);
  const source = f.sources.at(-1);
  f.audio.cancelReload();
  assert.equal(f.audio.getState().activeVoices, 0);
  assert.equal(source.disconnected, true);
  await f.audio.dispose();
});

test('muting stops active sources immediately and volume follows the game sound setting', async () => {
  const f = audioFixture();
  await f.audio.preload();
  f.audio.play('lmg');
  f.audio.setMuted(true);
  assert.equal(f.audio.getState().activeVoices, 0);
  assert.equal(f.audio.play('lmg'), false);
  assert.equal(f.gains[0].gain.events.at(-1)[0], 0);
  f.audio.setMuted(false);
  f.audio.setVolume(0.5);
  assert.equal(f.gains[0].gain.events.at(-1)[0], 0.17);
  f.audio.setVolume(0);
  assert.equal(f.audio.play('rifle'), false);
  await f.audio.dispose();
});

test('offline or decoding failure has a reusable original fallback and cannot break gameplay', async () => {
  const f = audioFixture({ fetch: async () => { throw new Error('offline'); } });
  assert.equal(await f.audio.preload(), false);
  assert.equal(f.audio.play('shotgun'), true);
  assert.equal(f.audio.getState().lastPlayback.recorded, false);
  const buffer = f.sources.at(-1).buffer;
  assert.ok(buffer.duration >= 0.6);
  assert.ok(buffer.getChannelData(0).every((x) => Number.isFinite(x) && Math.abs(x) <= 0.95));
  f.audio.play('shotgun');
  assert.equal(f.sources.at(-1).buffer, buffer);
  await f.audio.dispose();
});

test('disposal aborts downloads, closes context and fences late decode results', async () => {
  const finish = [];
  const signals = [];
  const f = audioFixture({ fetch: (url, { signal }) => {
    signals.push(signal);
    return new Promise((resolve) => { finish.push(resolve); });
  } });
  const pending = f.audio.preload();
  f.audio.play('revolver');
  await f.audio.dispose();
  for (const resolve of finish) resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  await pending;
  assert.ok(signals.every((s) => s.aborted));
  assert.equal(f.contexts[0].state, 'closed');
  assert.equal(f.audio.play('smg'), false);
  assert.equal(await f.audio.unlock(), false);
  assert.equal(f.audio.getState().loadedSamples, 0);
  assert.equal(f.audio.getState().disposed, true);
});

test('unsupported audio contexts silently disable combat sound', async () => {
  const f = audioFixture({ AudioContext: null });
  assert.equal(f.audio.play('rifle'), false);
  assert.equal(await f.audio.unlock(), false);
  assert.equal(await f.audio.preload(), false);
  await f.audio.dispose();
});

test('sample manifest uses only bundled local assets', () => {
  assert.equal(Object.values(GUN_AUDIO_ASSETS).flat().length, 13);
  for (const file of Object.values(GUN_AUDIO_ASSETS).flat()) assert.match(file, /^[\w-]+\.mp3$/);
});

test('safety limiter keeps normal samples linear and bounds initial stacked transients', async () => {
  const f = audioFixture();
  await f.audio.unlock();
  const limiter = f.limiters[0];
  assert.equal(limiter.oversample, '2x');
  assert.equal(limiter.curve[1024], 0);
  assert.equal(limiter.curve[1536], 0.5);
  assert.ok(limiter.curve.every((x) => Math.abs(x) < 0.85));
  await f.audio.dispose();
  assert.equal(limiter.disconnected, true);
});
