// Recorded CC0 firearm reports and reload foley; full provenance is beside the
// files in public/assets/combat-audio/SOURCES.md. No microphone is ever opened.
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const MASTER_GAIN = 0.34;
export const GUN_AUDIO_ASSETS = Object.freeze({
  revolver: Object.freeze(['revolver-1.mp3', 'revolver-2.mp3']),
  rifle: Object.freeze(['rifle-1.mp3', 'rifle-2.mp3']),
  shotgun: Object.freeze(['shotgun-1.mp3', 'shotgun-2.mp3']),
  smg: Object.freeze(['smg-1.mp3', 'smg-2.mp3']),
  lmg: Object.freeze(['lmg-1.mp3', 'lmg-2.mp3']),
  reloadHandgun: Object.freeze(['reload-handgun.mp3']),
  reloadRifle: Object.freeze(['reload-rifle.mp3']),
  reloadShotgun: Object.freeze(['reload-shotgun.mp3']),
});

const PROFILES = Object.freeze({
  revolver: { gain: 0.9, decay: 0.4, bass: 135, filter: 10500 },
  rifle: { gain: 0.94, decay: 0.56, bass: 105, filter: 11000 },
  shotgun: { gain: 0.95, decay: 0.6, bass: 80, filter: 8000 },
  smg: { gain: 0.68, decay: 0.23, bass: 160, filter: 9000 },
  lmg: { gain: 0.76, decay: 0.33, bass: 112, filter: 9500 },
});

/** A bounded, lazily loaded WebAudio gun mix, independent of combat authority.
 * `play` is synchronous. `unlock` should run from a user gesture to preload.
 * Remote shots may supply gain/pan and distance in metres; distance softens
 * high frequencies and delays the report by its approximate travel time.
 */
export function createGunAudio({
  AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  fetch = globalThis.fetch?.bind(globalThis), random = Math.random,
  assetBase = '/assets/combat-audio/', maxVoices = 16,
} = {}) {
  let context = null;
  let master = null;
  let compressor = null;
  let safetyLimiter = null;
  let muted = false;
  let volume = 1;
  let disposed = false;
  let loading = null;
  let lastPlayback = null;
  const controller = new AbortController();
  const samples = new Map();
  const fallback = new Map();
  const active = new Set();
  const limit = clamp(Math.floor(finite(maxVoices, 16)), 1, 24);
  let reloadVoice = null;

  function ensureContext() {
    if (disposed) return false;
    if (context?.state !== 'closed') {
      if (context) return true;
    }
    if (typeof AudioContext !== 'function') return false;
    try {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : volume * MASTER_GAIN;
      compressor = context.createDynamicsCompressor?.() ?? null;
      safetyLimiter = context.createWaveShaper?.() ?? null;
      if (safetyLimiter) {
        // Preserve ordinary reports; soften only exceptionally stacked peaks.
        // This also bounds the first millisecond before compressor attack.
        const curve = new Float32Array(2049);
        for (let i = 0; i < curve.length; i += 1) {
          const x = i * 2 / (curve.length - 1) - 1;
          const absolute = Math.abs(x);
          curve[i] = Math.sign(x) * (absolute <= 0.65 ? absolute
            : 0.65 + 0.2 * (1 - Math.exp(-(absolute - 0.65) / 0.2)));
        }
        safetyLimiter.curve = curve;
        safetyLimiter.oversample = '2x';
      }
      if (compressor) {
        compressor.threshold.value = -13;
        compressor.knee.value = 8;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.001;
        compressor.release.value = 0.16;
        master.connect(compressor).connect(safetyLimiter ?? context.destination);
      } else master.connect(safetyLimiter ?? context.destination);
      safetyLimiter?.connect(context.destination);
      return true;
    } catch {
      void context?.close?.().catch?.(() => {});
      context = master = compressor = safetyLimiter = null;
      return false;
    }
  }

  function preload() {
    if (loading) return loading;
    if (!ensureContext() || typeof fetch !== 'function') return Promise.resolve(false);
    const owner = context;
    const files = [...new Set(Object.values(GUN_AUDIO_ASSETS).flat())];
    loading = Promise.allSettled(files.map(async (file) => {
      const response = await fetch(`${assetBase}${file}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Gun audio unavailable: ${response.status}`);
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
    void preload();
    return !disposed;
  }

  // Missing assets or slow downloads retain a compact original ballistic mix,
  // generated once per firearm rather than allocating oscillators every shot.
  function fallbackBuffer(weapon) {
    if (fallback.has(weapon)) return fallback.get(weapon);
    const p = PROFILES[weapon];
    const rate = context.sampleRate;
    const buffer = context.createBuffer(1, Math.ceil(rate * p.decay), rate);
    const data = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < data.length; i += 1) {
      const t = i / rate;
      const noise = random() * 2 - 1;
      low += (noise - low) * 0.19;
      const crack = noise * Math.exp(-t * 110) * 0.58;
      const body = low * Math.exp(-t * 12) * 0.72;
      const bass = Math.sin(2 * Math.PI * p.bass * t * Math.exp(-t * 3))
        * Math.exp(-t * 22) * 0.25;
      const attack = Math.min(1, t / 0.0008);
      const release = Math.min(1, (p.decay - t) / 0.025);
      data[i] = clamp((crack + body + bass) * attack * release, -0.95, 0.95);
    }
    fallback.set(weapon, buffer);
    return buffer;
  }

  function endVoice(voice, stop = false) {
    if (!voice || voice.ended) return;
    voice.ended = true;
    active.delete(voice);
    if (reloadVoice === voice) reloadVoice = null;
    if (stop) {
      try { voice.source.stop(); } catch { /* Already ended. */ }
    }
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* Already disconnected. */ }
    }
  }

  function sample(files) {
    const ready = files.map((name) => samples.get(name)).filter(Boolean);
    return ready.length ? ready[Math.min(ready.length - 1,
      Math.floor(clamp(finite(random(), 0.5), 0, 0.999999) * ready.length))] : null;
  }

  function emit(buffer, { gain, pan, distance, rate, kind, weapon }) {
    while (active.size >= limit) endVoice(active.values().next().value, true);
    const now = context.currentTime;
    const delay = kind === 'shot' ? Math.min(distance / 343, 0.65) : 0;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const panner = context.createStereoPanner?.() ?? null;
    source.buffer = buffer;
    source.playbackRate.value = rate;
    filter.type = 'lowpass';
    filter.frequency.value = kind === 'shot'
      ? clamp(PROFILES[weapon].filter / (1 + distance / 28), 650, 12000) : 6500;
    filter.Q.value = 0.5;
    const span = buffer.duration / rate;
    envelope.gain.setValueAtTime(gain, now + delay);
    // Short terminal fade prevents sample tails or explicit length limits clicking.
    envelope.gain.setValueAtTime(gain, now + delay + Math.max(0, span - 0.018));
    envelope.gain.linearRampToValueAtTime(0, now + delay + span);
    if (panner) panner.pan.value = pan;
    source.connect(filter).connect(envelope).connect(panner ?? master);
    panner?.connect(master);
    const voice = { source, nodes: [source, filter, envelope, panner].filter(Boolean),
      ended: false, kind };
    source.onended = () => endVoice(voice);
    active.add(voice);
    source.start(now + delay);
    source.stop(now + delay + span + 0.02);
    lastPlayback = { weapon, kind, recorded: samples.size > 0
      && [...samples.values()].includes(buffer), rate, gain, pan, distance,
      delay, duration: span };
    return voice;
  }

  function play(weapon, { gain = 1, pan = 0, distance = 0 } = {}) {
    if (!Object.hasOwn(PROFILES, weapon) || muted || volume <= 0
      || finite(gain, 0) <= 0 || !ensureContext()) return false;
    void context.resume().catch(() => {});
    void preload();
    const buffer = sample(GUN_AUDIO_ASSETS[weapon]) ?? fallbackBuffer(weapon);
    emit(buffer, { weapon, kind: 'shot',
      gain: clamp(finite(gain, 0), 0, 1) * PROFILES[weapon].gain,
      pan: clamp(finite(pan, 0), -1, 1),
      distance: clamp(finite(distance, 0), 0, 2000),
      rate: 0.97 + clamp(finite(random(), 0.5), 0, 1) * 0.06 });
    return true;
  }

  function cancelReload() { endVoice(reloadVoice, true); }

  function playReload(weapon, { duration = 2, gain = 1, pan = 0 } = {}) {
    cancelReload();
    if (!Object.hasOwn(PROFILES, weapon) || muted || volume <= 0
      || finite(gain, 0) <= 0 || !ensureContext()) return false;
    void context.resume().catch(() => {});
    void preload();
    const key = weapon === 'revolver' ? 'reloadHandgun'
      : weapon === 'shotgun' ? 'reloadShotgun' : 'reloadRifle';
    const buffer = sample(GUN_AUDIO_ASSETS[key]);
    // Reload foley is only played when ready; never substitute a gunshot.
    if (!buffer) return false;
    reloadVoice = emit(buffer, { weapon, kind: 'reload',
      gain: clamp(finite(gain, 0), 0, 1) * 0.52,
      pan: clamp(finite(pan, 0), -1, 1), distance: 0,
      rate: clamp(buffer.duration / clamp(finite(duration, 2), 0.25, 8), 0.72, 1.55) });
    return true;
  }

  function updateMaster() {
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume * MASTER_GAIN,
      context.currentTime, 0.025);
  }

  return {
    play, playReload, cancelReload, unlock, preload,
    setMuted(value) {
      muted = Boolean(value);
      if (muted) for (const voice of [...active]) endVoice(voice, true);
      updateMaster();
    },
    setVolume(value) { volume = clamp(finite(value, 1), 0, 1); updateMaster(); },
    getState() { return { muted, volume, disposed, activeVoices: active.size,
      loadedSamples: samples.size, lastPlayback: lastPlayback && { ...lastPlayback } }; },
    async dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      for (const voice of [...active]) endVoice(voice, true);
      samples.clear();
      fallback.clear();
      master?.disconnect();
      compressor?.disconnect();
      safetyLimiter?.disconnect();
      if (context?.state !== 'closed') await context?.close?.().catch(() => {});
      context = master = compressor = safetyLimiter = null;
    },
  };
}
