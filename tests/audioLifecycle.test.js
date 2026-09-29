import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../src/audio.js';

class FakeParam {
  value = 0;
  setTargetAtTime(value) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
}

class FakeNode {
  connect(target) { return target; }
  start() {}
  stop() {}
}

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.sampleRate = 8000;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new FakeNode();
    this.oscillatorCount = 0;
    this.stereoPans = [];
    FakeAudioContext.instances.push(this);
  }

  createBuffer(_channels, size) {
    return { duration: size / this.sampleRate,
      getChannelData: () => new Float32Array(size) };
  }

  createBufferSource() {
    const source = new FakeNode();
    source.playbackRate = new FakeParam();
    return source;
  }

  createOscillator() {
    this.oscillatorCount += 1;
    const source = new FakeNode();
    source.frequency = new FakeParam();
    return source;
  }

  createBiquadFilter() {
    const filter = new FakeNode();
    filter.frequency = new FakeParam();
    filter.Q = new FakeParam();
    return filter;
  }

  createGain() {
    const gain = new FakeNode();
    gain.gain = new FakeParam();
    return gain;
  }

  createStereoPanner() {
    const panner = new FakeNode();
    panner.pan = new FakeParam();
    this.stereoPans.push(panner.pan);
    return panner;
  }

  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

test('audio starts, follows outdoor to indoor transitions, and schedules indoor creaks', async () => {
  const originalContext = globalThis.AudioContext;
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.fetch = () => Promise.reject(new Error('Asset unavailable in test'));
  globalThis.document = { baseURI: 'http://localhost:4173/' };
  const sound = createAudio();
  try {
    assert.equal(await sound.start(), true, 'the soundscape must survive its first update');
    const context = FakeAudioContext.instances.at(-1);
    const baseOscillators = context.oscillatorCount;
    for (let i = 0; i < 112; i += 1) {
      context.currentTime += 0.1;
      sound.update(0.25, 'rain', { id: 'lodge', indoors: false });
    }
    assert.equal(context.oscillatorCount, baseOscillators,
      'outdoor playback must not trigger an interior creak');
    context.currentTime += 0.1;
    sound.update(0.1, 'rain', { id: 'lodge', indoors: true });
    assert.equal(context.oscillatorCount, baseOscillators + 1,
      'a creak should play after entering the lodge');
    sound.playThunder(-0.65);
    sound.playThunder(0.6);
    assert.deepEqual(context.stereoPans.slice(-2).map((pan) => pan.value), [-0.65, 0.6],
      'thunder should follow the strike from left to right');
  } finally {
    await sound.dispose();
    if (originalContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalContext;
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
