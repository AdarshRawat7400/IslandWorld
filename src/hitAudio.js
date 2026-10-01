import * as THREE from 'three';

// Small CC0 recordings are bundled locally; see assets/hit-audio/SOURCES.md.
// Rabbit/bird voices and unavailable-file fallbacks are original synthesis.
export const HIT_AUDIO_ASSETS = Object.freeze({
  human: Object.freeze(['hurt-01.mp3', 'hurt-02.mp3', 'hurt-03.mp3',
    'hurt-04.mp3', 'hurt-05.mp3', 'hurt-06.mp3']),
  sheep: Object.freeze(['sheep-baa.ogg']),
});
const KINDS = new Set(['human', 'sheep', 'rabbit', 'bird']);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const MAX_DISTANCE = 80;
const ENTITY_COOLDOWN_MS = 700;
const MASTER_GAIN = 0.36;

function vector(value) {
  const tuple = Array.isArray(value) ? value : [value?.x, value?.y, value?.z];
  return tuple?.length >= 3 && tuple.slice(0, 3).every(Number.isFinite)
    ? new THREE.Vector3(...tuple.slice(0, 3)) : null;
}

/** Event-only positional hit vocals. No camera update loop, microphone, timers,
 * or combat authority. Call unlock() from the game's start/resume gesture.
 */
export function createHitAudio({
  camera,
  AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  fetch = globalThis.fetch?.bind(globalThis), random = Math.random,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  assetBase = '/assets/hit-audio/', maxVoices = 8,
} = {}) {
  let context = null;
  let master = null;
  let compressor = null;
  let muted = false;
  let volume = 1;
  let unlocked = false;
  let disposed = false;
  let loading = null;
  let lastPlayback = null;
  const limit = clamp(Math.floor(finite(maxVoices, 8)), 1, 8);
  const samples = new Map();
  const fallbacks = new Map();
  const active = new Set();
  const recentEntities = new Map();
  const seenEvents = new Map();
  const lastVariants = new Map();
  const abort = new AbortController();
  const listenerPosition = new THREE.Vector3();
  const listenerForward = new THREE.Vector3(0, 0, -1);
  const listenerUp = new THREE.Vector3(0, 1, 0);
  const listenerRight = new THREE.Vector3(1, 0, 0);
  const rotation = new THREE.Quaternion();

  function ensureContext() {
    if (disposed || typeof AudioContext !== 'function') return false;
    if (context) return context.state !== 'closed';
    try {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : volume * MASTER_GAIN;
      compressor = context.createDynamicsCompressor?.() ?? null;
      if (compressor) {
        compressor.threshold.value = -15;
        compressor.knee.value = 10;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.14;
        master.connect(compressor).connect(context.destination);
      } else master.connect(context.destination);
      return true;
    } catch {
      void context?.close?.().catch?.(() => {});
      context = master = compressor = null;
      return false;
    }
  }

  function preload() {
    if (disposed) return Promise.resolve(false);
    if (loading) return loading;
    if (!ensureContext() || typeof fetch !== 'function') return Promise.resolve(false);
    const owner = context;
    loading = Promise.allSettled(Object.values(HIT_AUDIO_ASSETS).flat().map(async (file) => {
      const response = await fetch(`${assetBase}${file}`, { signal: abort.signal });
      if (!response.ok) throw new Error('Hit vocal unavailable');
      const bytes = await response.arrayBuffer();
      if (disposed || owner !== context) return;
      const buffer = await owner.decodeAudioData(bytes);
      if (!disposed && owner === context && buffer?.duration > 0) samples.set(file, buffer);
    })).then(() => samples.size > 0);
    return loading;
  }

  async function unlock() {
    if (!ensureContext()) return false;
    try { await context.resume(); } catch { return false; }
    if (disposed) return false;
    unlocked = true;
    void preload();
    return true;
  }

  function fallbackBuffer(kind, variant) {
    const key = `${kind}:${variant}`;
    if (fallbacks.has(key)) return fallbacks.get(key);
    const span = kind === 'bird' ? 0.21 : kind === 'rabbit' ? 0.25 : 0.38;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * span), context.sampleRate);
    const data = buffer.getChannelData(0);
    const pitch = (kind === 'human' ? 125 : kind === 'sheep' ? 190
      : kind === 'rabbit' ? 620 : 1850) * (0.9 + variant * 0.12);
    let breath = 0;
    let phase = 0;
    for (let i = 0; i < data.length; i += 1) {
      const t = i / context.sampleRate;
      const p = t / span;
      breath += ((random() * 2 - 1) - breath) * 0.12;
      phase += 2 * Math.PI * pitch * (1 - p * 0.26
        + Math.sin(t * 65) * (kind === 'sheep' ? 0.09 : 0.025)) / context.sampleRate;
      const voiced = Math.sin(phase) * 0.35 + Math.sin(phase * 2) * 0.12
        + Math.sin(phase * 3) * 0.08;
      const envelope = Math.sin(Math.PI * p) ** 0.8 * Math.exp(-p * 1.6);
      data[i] = clamp((voiced + breath * (kind === 'human' ? 1.1 : 0.32))
        * envelope, -0.65, 0.65);
    }
    fallbacks.set(key, buffer);
    return buffer;
  }

  function chooseVoice(kind) {
    const recorded = (HIT_AUDIO_ASSETS[kind] ?? []).filter((file) => samples.has(file));
    // The one sheep recording gets three subtle pitch variants; humans have
    // six different recorded performances. Synthesis has three cached voices.
    const variants = recorded.length > 1 ? recorded.map((file) => ({ file, variant: 0,
      key: file })) : [0, 1, 2].map((variant) => ({ file: recorded[0], variant,
      key: `${recorded[0] ?? kind}:${variant}` }));
    const choices = variants.filter(({ key }) => key !== lastVariants.get(kind));
    const chosen = choices[Math.floor(clamp(finite(random(), 0.5), 0, 0.999999) * choices.length)];
    lastVariants.set(kind, chosen.key);
    return { ...chosen, buffer: chosen.file ? samples.get(chosen.file)
      : fallbackBuffer(kind, chosen.variant), recorded: Boolean(chosen.file) };
  }

  function endVoice(voice, stop = false) {
    if (!voice || voice.ended) return;
    voice.ended = true;
    active.delete(voice);
    if (stop) { try { voice.source.stop(); } catch { /* Already stopped. */ } }
    voice.source.onended = null;
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* Already disconnected. */ }
    }
  }

  function readListener() {
    camera?.updateWorldMatrix?.(true, false);
    if (camera?.getWorldPosition) camera.getWorldPosition(listenerPosition);
    else listenerPosition.copy(vector(camera?.position) ?? new THREE.Vector3());
    if (camera?.getWorldDirection) camera.getWorldDirection(listenerForward);
    else listenerForward.set(0, 0, -1);
    listenerUp.set(0, 1, 0);
    if (camera?.getWorldQuaternion) listenerUp.applyQuaternion(camera.getWorldQuaternion(rotation));
    listenerRight.crossVectors(listenerForward, listenerUp).normalize();
  }

  function syncListener() {
    const listener = context.listener;
    if (!listener) return;
    const values = { positionX: listenerPosition.x, positionY: listenerPosition.y,
      positionZ: listenerPosition.z, forwardX: listenerForward.x,
      forwardY: listenerForward.y, forwardZ: listenerForward.z,
      upX: listenerUp.x, upY: listenerUp.y, upZ: listenerUp.z };
    if (listener.positionX) {
      for (const [key, value] of Object.entries(values)) listener[key].value = value;
    } else {
      listener.setPosition?.(listenerPosition.x, listenerPosition.y, listenerPosition.z);
      listener.setOrientation?.(listenerForward.x, listenerForward.y, listenerForward.z,
        listenerUp.x, listenerUp.y, listenerUp.z);
    }
  }

  function playHit({ id, kind = 'human', position, local = false,
    damage = 15, dead = false, eventId } = {}) {
    if (disposed || muted || volume <= 0 || !unlocked || !context
      || !KINDS.has(kind) || (!dead && finite(damage, 0) <= 0)) return false;
    readListener();
    const point = vector(position) ?? (local ? listenerPosition.clone() : null);
    if (!point) return false;
    const time = finite(now(), 0);
    for (const [key, stamp] of seenEvents) if (time - stamp > 30_000) seenEvents.delete(key);
    const dedupeKey = eventId == null ? null : String(eventId).slice(0, 192);
    if (dedupeKey && seenEvents.has(dedupeKey)) return false;
    if (dedupeKey) {
      seenEvents.set(dedupeKey, time);
      if (seenEvents.size > 256) seenEvents.delete(seenEvents.keys().next().value);
    }
    const distance = local ? 0 : point.distanceTo(listenerPosition);
    if (distance >= MAX_DISTANCE) return false;
    for (const [key, stamp] of recentEntities) if (time - stamp > 15_000) recentEntities.delete(key);
    const entityKey = `${kind}:${String(id ?? `${point.x.toFixed(1)},${point.z.toFixed(1)}`).slice(0, 128)}`;
    if (time - (recentEntities.get(entityKey) ?? -Infinity) < ENTITY_COOLDOWN_MS) return false;
    recentEntities.set(entityKey, time);
    if (recentEntities.size > 512) recentEntities.delete(recentEntities.keys().next().value);
    const voice = chooseVoice(kind);
    while (active.size >= limit) endVoice(active.values().next().value, true);
    syncListener();
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const spatial = !local ? context.createPanner?.() ?? context.createStereoPanner?.() ?? null : null;
    const rate = (voice.file && kind === 'sheep' ? 0.94 + voice.variant * 0.055 : 1)
      * (0.97 + clamp(finite(random(), 0.5), 0, 1) * 0.06);
    const span = Math.min(1.15, voice.buffer.duration / rate);
    const gain = (local ? 0.74 : 0.82) * (1 - distance / MAX_DISTANCE) ** 1.5
      * (dead ? 1 : 0.8 + clamp(finite(damage, 15) / 100, 0, 1) * 0.2);
    source.buffer = voice.buffer;
    source.playbackRate.value = rate;
    filter.type = 'lowpass';
    filter.frequency.value = clamp(6500 / (1 + distance / 32), 1800, 6500);
    filter.Q.value = 0.5;
    const at = context.currentTime;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(gain, at + 0.005);
    envelope.gain.setValueAtTime(gain, at + Math.max(0.006, span - 0.025));
    envelope.gain.linearRampToValueAtTime(0, at + span);
    let pan = 0;
    if (spatial) {
      if ('panningModel' in spatial || spatial.positionX || spatial.setPosition) {
        spatial.panningModel = 'HRTF';
        spatial.distanceModel = 'inverse';
        spatial.refDistance = 1;
        spatial.maxDistance = MAX_DISTANCE;
        spatial.rolloffFactor = 0; // Explicit, bounded distance gain above.
        if (spatial.positionX) {
          spatial.positionX.value = point.x; spatial.positionY.value = point.y;
          spatial.positionZ.value = point.z;
        } else spatial.setPosition?.(point.x, point.y, point.z);
      } else if (spatial.pan) {
        pan = distance > 0.01 ? point.clone().sub(listenerPosition).dot(listenerRight) / distance : 0;
        spatial.pan.value = clamp(pan, -1, 1);
      }
    }
    source.connect(filter).connect(envelope).connect(spatial ?? master);
    spatial?.connect(master);
    const entry = { source, nodes: [source, filter, envelope, spatial].filter(Boolean), ended: false };
    source.onended = () => endVoice(entry);
    active.add(entry);
    source.start(at);
    source.stop(at + span + 0.01);
    lastPlayback = { id, kind, local: Boolean(local), dead: Boolean(dead), eventId,
      recorded: voice.recorded, variant: voice.key, rate, gain, distance,
      duration: span, pan, position: point.toArray() };
    return true;
  }

  function clear() {
    for (const voice of [...active]) endVoice(voice, true);
    recentEntities.clear(); seenEvents.clear(); lastVariants.clear();
    lastPlayback = null;
  }

  function updateMaster() {
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume * MASTER_GAIN,
      context.currentTime, 0.025);
  }

  return {
    unlock, preload, playHit, clear,
    setMuted(value) {
      muted = Boolean(value);
      if (muted) for (const voice of [...active]) endVoice(voice, true);
      updateMaster();
    },
    setVolume(value) { volume = clamp(finite(value, 1), 0, 1); updateMaster(); },
    getState() { return { muted, volume, unlocked, disposed, activeVoices: active.size,
      loadedSamples: samples.size, trackedEntities: recentEntities.size,
      rememberedEvents: seenEvents.size, lastPlayback: lastPlayback && { ...lastPlayback,
        position: [...lastPlayback.position] } }; },
    async dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      clear(); samples.clear(); fallbacks.clear();
      master?.disconnect(); compressor?.disconnect();
      if (context?.state !== 'closed') await context?.close?.().catch(() => {});
      context = master = compressor = null;
      unlocked = false;
    },
  };
}
