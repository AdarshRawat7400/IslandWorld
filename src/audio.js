// CC0 field recordings are layered with original procedural ambience and cues.
// Missing/unsupported recordings fade back to synthesis. Sources: ../CREDITS.md.
// AudioContext is created only from start(), which should be called by a click/key gesture.

const RECORDINGS = {
  waves: ['ocean-wave-1.flac', 'ocean-wave-2.flac', 'ocean-wave-3.flac', 'ocean-wave-4.flac'],
  wind: 'wind.ogg',
  rain: 'rain.ogg',
  window: 'rain-on-window.wav',
};

// Keep the surf in the background; wind, dialogue cues, and soft piano carry
// the foreground. These levels still pass through the player's master volume.
const SEA_WAVE_PEAK = 0.72;
const SEA_BED_LEVEL = { shore: 0.055, inland: 0.04 };
const SEA_RECORDING_LEVEL = { shore: 0.09, inland: 0.065 };
export const DEFAULT_SEA_VOLUME = 1;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function level(value, fallback = 0) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number) : fallback;
}

function readWeather(weather) {
  if (typeof weather === 'number') {
    const intensity = level(weather);
    return { wind: 0.25 + intensity * 0.7, rain: intensity, storm: intensity };
  }

  if (typeof weather === 'string') {
    const name = weather.toLowerCase();
    if (/storm|squall|thunder/.test(name)) return { wind: 1, rain: 1, storm: 1 };
    if (/rain|shower/.test(name)) return { wind: 0.55, rain: 0.72, storm: 0.25 };
    if (/mist|fog|overcast/.test(name)) return { wind: 0.3, rain: 0.07, storm: 0.08 };
    return { wind: 0.22, rain: 0, storm: 0 };
  }

  if (weather && typeof weather === 'object') {
    const intensity = level(weather.intensity, 0);
    return {
      wind: level(weather.wind, 0.25 + intensity * 0.65),
      rain: level(weather.rain, intensity),
      storm: level(weather.storm, intensity),
    };
  }

  return { wind: 0.3, rain: 0.1, storm: 0.08 };
}

function readLocation(location) {
  const name = String(
    typeof location === 'string'
      ? location
      : location?.id ?? location?.name ?? location?.type ?? 'shore',
  ).toLowerCase();
  const inside = typeof location === 'object' && location !== null && 'indoors' in location
    ? Boolean(location.indoors)
    : /inside|interior|house|lodge|archive|room|station|bunker|tunnel/.test(name);
  const nearMachinery = /station|tower|generator|pump|tunnel|bunker|radio/.test(name);
  const shore = /shore|beach|landing|dock|pier|cliff|headland|coast/.test(name);
  const lake = /lake/.test(name);
  return { inside, nearMachinery, shore, lake };
}

// Keep the sea control downstream of the procedural bed and the wave-recording
// bus. Wind, rain, window rain, and cues have independent paths to the master.
export function selectAmbienceTargets({ weather = 'mist', location = 'shore', elapsed = 0,
  recordings = {}, seaVolume = DEFAULT_SEA_VOLUME } = {}) {
  const conditions = readWeather(weather);
  const place = readLocation(location);
  const seaSwell = 0.84 + 0.14 * Math.sin(elapsed * 0.64) + 0.07 * Math.sin(elapsed * 0.29);
  // Broad squalls sit under shorter gusts, so exposed storm scenes breathe
  // without turning the wind recording into a steady wall of noise.
  const windSwell = 0.76 + 0.12 * Math.sin(elapsed * 0.31 + 1.7)
    + conditions.wind * 0.20 * Math.max(0, Math.sin(elapsed * 0.83 + 0.9));
  const outdoors = place.inside ? 0.3 : 1;
  const hasWaves = Boolean(recordings.waves);
  const hasWind = Boolean(recordings.wind);
  const hasRain = Boolean(recordings.rain);
  const sea = level(seaVolume, DEFAULT_SEA_VOLUME);
  return {
    seaBed: (place.lake ? 0.009 : place.shore ? SEA_BED_LEVEL.shore : SEA_BED_LEVEL.inland)
      * (place.inside ? 0.27 : 1) * seaSwell * (hasWaves ? 0.32 : 1) * sea,
    seaRecording: hasWaves
      ? (place.lake ? 0.012 : place.shore ? SEA_RECORDING_LEVEL.shore : SEA_RECORDING_LEVEL.inland)
        * (place.inside ? 0.2 : 1) * sea : 0,
    windBed: (0.035 + conditions.wind * 0.105) * outdoors * windSwell * (hasWind ? 0.2 : 1),
    rainBed: conditions.rain * 0.085 * (place.inside ? 0.25 : 1) * (hasRain ? 0.18 : 1),
    windRecording: hasWind ? (0.055 + conditions.wind * 0.22) * outdoors * windSwell : 0,
    rainRecording: hasRain ? conditions.rain * 0.15 * (place.inside ? 0.14 : 1) : 0,
    windowRecording: recordings.window && place.inside ? conditions.rain * 0.11 : 0,
    hum: place.nearMachinery ? 0.023 : place.inside ? 0.008 : 0.002,
  };
}

function makeNoiseBuffer(context, seconds = 7) {
  const size = Math.ceil(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, size, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < size; i += 1) samples[i] = Math.random() * 2 - 1;
  // Blend the last few milliseconds toward the start to hide the loop seam.
  const blend = Math.min(2048, Math.floor(size / 8));
  for (let i = 0; i < blend; i += 1) {
    const at = size - blend + i;
    const weight = (i + 1) / blend;
    samples[at] = samples[at] * (1 - weight) + samples[blend - 1 - i] * weight;
  }
  return buffer;
}

export function createAudio() {
  let context = null;
  let noise = null;
  let master = null;
  let seaGain = null;
  let windGain = null;
  let rainGain = null;
  let humGain = null;
  let engineGain = null;
  let engineLow = null;
  let engineHigh = null;
  let recordedGains = null;
  let recordedBuffers = null;
  let waveBuffers = [];
  let waveIndex = 0;
  let nextWaveTime = 0;
  let loadingController = null;
  let muted = false;
  let volume = 1;
  let seaVolume = DEFAULT_SEA_VOLUME;
  let elapsed = 0;
  let nextCreakAt = 27;
  let lastControlTime = -Infinity;
  let currentWeather = 'mist';
  let currentLocation = 'shore';
  let vehicleEngine = { running: false, effort: 0, proximity: 1 };
  const runningSources = [];
  const activeWaves = new Set();

  function noiseLayer(filters, rate) {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.playbackRate.value = rate;
    let output = source;
    for (const [type, frequency, q] of filters) {
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      output.connect(filter);
      output = filter;
    }
    const gain = context.createGain();
    gain.gain.value = 0;
    output.connect(gain);
    gain.connect(master);
    source.start();
    runningSources.push(source);
    return gain;
  }

  function oscillator(frequency, type, destination, volume = 1) {
    const source = context.createOscillator();
    const gain = context.createGain();
    source.type = type;
    source.frequency.value = frequency;
    gain.gain.value = volume;
    source.connect(gain).connect(destination);
    source.start();
    runningSources.push(source);
    return source;
  }

  function setTarget(gain, value, timeConstant = 0.34) {
    gain.gain.setTargetAtTime(Math.max(0, value), context.currentTime, timeConstant);
  }

  function startRecordedLoop(name, buffer, expectedContext) {
    if (context !== expectedContext || !recordedGains || context.state === 'closed') return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(recordedGains[name]);
    source.start();
    runningSources.push(source);
    recordedBuffers[name] = buffer;
    lastControlTime = -Infinity;
  }

  function scheduleWaves() {
    if (!context || !recordedGains || context.state === 'closed') return;
    if (seaVolume <= 0) return;
    const available = waveBuffers.filter(Boolean);
    if (!available.length) return;
    if (nextWaveTime < context.currentTime + 0.04) nextWaveTime = context.currentTime + 0.04;

    // Crossfade individual field recordings rather than hard-looping a short wave.
    for (let count = 0; nextWaveTime < context.currentTime + 5 && count < 5; count += 1) {
      const buffer = available[waveIndex % available.length];
      const source = context.createBufferSource();
      const gain = context.createGain();
      const playbackRate = 0.94 + Math.random() * 0.12;
      const duration = buffer.duration / playbackRate;
      const startAt = nextWaveTime;
      const endAt = startAt + duration;
      const fade = Math.min(0.6, duration * 0.22);
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.linearRampToValueAtTime(SEA_WAVE_PEAK, startAt + fade);
      gain.gain.setValueAtTime(SEA_WAVE_PEAK, endAt - fade);
      gain.gain.linearRampToValueAtTime(0.0001, endAt);
      source.connect(gain).connect(recordedGains.sea);
      source.onended = () => activeWaves.delete(source);
      source.start(startAt);
      source.stop(endAt + 0.02);
      activeWaves.add(source);
      nextWaveTime = endAt - fade;
      waveIndex += 1;
    }
  }

  function loadRecordings(expectedContext) {
    loadingController = new AbortController();
    const signal = loadingController.signal;
    const decode = async (file) => {
      const url = new URL(`assets/audio/${file}`, document.baseURI);
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Audio asset unavailable: ${file}`);
      return expectedContext.decodeAudioData(await response.arrayBuffer());
    };

    RECORDINGS.waves.forEach((file, index) => {
      void decode(file).then((buffer) => {
        if (context !== expectedContext) return;
        waveBuffers[index] = buffer;
        lastControlTime = -Infinity;
        scheduleWaves();
      }).catch(() => { /* Procedural surf remains available. */ });
    });
    for (const name of ['wind', 'rain', 'window']) {
      void decode(RECORDINGS[name])
        .then((buffer) => startRecordedLoop(name, buffer, expectedContext))
        .catch(() => { /* Procedural ambience remains available. */ });
    }
  }

  function update(dt = 0, weather = currentWeather, location = currentLocation) {
    currentWeather = weather ?? currentWeather;
    currentLocation = location ?? currentLocation;
    if (Number.isFinite(dt) && dt > 0) elapsed += Math.min(dt, 0.25);
    if (!context || context.state === 'closed') return;

    scheduleWaves();

    // Throttle AudioParam automation if the game calls update every frame.
    const now = context.currentTime;
    if (now - lastControlTime < 0.09) return;
    lastControlTime = now;

    const mix = selectAmbienceTargets({ weather: currentWeather, location: currentLocation,
      elapsed, seaVolume, recordings: { waves: waveBuffers.some(Boolean),
        wind: recordedBuffers.wind, rain: recordedBuffers.rain,
        window: recordedBuffers.window } });
    setTarget(seaGain, mix.seaBed);
    setTarget(windGain, mix.windBed);
    setTarget(rainGain, mix.rainBed);
    setTarget(recordedGains.sea, mix.seaRecording);
    setTarget(recordedGains.wind, mix.windRecording);
    setTarget(recordedGains.rain, mix.rainRecording);
    setTarget(recordedGains.window, mix.windowRecording);
    setTarget(humGain, mix.hum, 0.65);
    const effort = clamp(vehicleEngine.effort);
    setTarget(engineGain, vehicleEngine.running
      ? (0.014 + effort * 0.012) * clamp(vehicleEngine.proximity) : 0, 0.18);
    engineLow.frequency.setTargetAtTime(40 + effort * 72, now, 0.12);
    engineHigh.frequency.setTargetAtTime(81 + effort * 144, now, 0.12);
    if (elapsed > nextCreakAt && readLocation(currentLocation).inside) {
      playCreak();
      nextCreakAt = elapsed + 24 + Math.random() * 24;
    }
  }

  function start() {
    if (context && context.state !== 'closed') return context.resume().then(() => true).catch(() => false);
    const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextType) return Promise.resolve(false);

    try {
      context = new AudioContextType();
      noise = makeNoiseBuffer(context);
      master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);

      seaGain = noiseLayer([['lowpass', 1150, 0.45], ['highpass', 55, 0.4]], 0.93);
      windGain = noiseLayer([['bandpass', 330, 0.42]], 1.07);
      rainGain = noiseLayer([['highpass', 1300, 0.7], ['lowpass', 7600, 0.7]], 1.19);

      humGain = context.createGain();
      humGain.gain.value = 0;
      humGain.connect(master);
      oscillator(55, 'sine', humGain, 0.65);
      oscillator(110, 'sine', humGain, 0.22);

      // A restrained, original engine layer gives the period cars a low idle
      // and rising harmonic pulse without masking dialogue or soft piano.
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineGain.connect(master);
      engineLow = oscillator(40, 'triangle', engineGain, 0.72);
      engineHigh = oscillator(81, 'sawtooth', engineGain, 0.12);

      recordedGains = {};
      recordedBuffers = { wind: null, rain: null, window: null };
      waveBuffers = new Array(RECORDINGS.waves.length).fill(null);
      waveIndex = 0;
      nextWaveTime = 0;
      for (const name of ['sea', 'wind', 'rain', 'window']) {
        const gain = context.createGain();
        gain.gain.value = 0;
        gain.connect(master);
        recordedGains[name] = gain;
      }

      lastControlTime = -Infinity;
      update(0, currentWeather, currentLocation);
      master.gain.setTargetAtTime(muted ? 0 : 0.82 * volume, context.currentTime, 0.55);
      loadRecordings(context);
      return context.resume().then(() => true).catch(() => false);
    } catch {
      if (context && context.state !== 'closed') context.close().catch(() => {});
      context = null;
      return Promise.resolve(false);
    }
  }

  function burst({ frequency = 800, duration = 0.12, volume = 0.1, highpass = false }) {
    if (!context || context.state !== 'running') return;
    const when = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = highpass ? 'highpass' : 'lowpass';
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(when, Math.random() * Math.max(0.1, noise.duration - duration - 0.1), duration);
    source.stop(when + duration + 0.01);
  }

  function tone(frequency, duration, volume, type = 'sine', endFrequency = frequency) {
    if (!context || context.state !== 'running') return;
    const when = context.currentTime;
    const source = context.createOscillator();
    const gain = context.createGain();
    source.type = type;
    source.frequency.setValueAtTime(frequency, when);
    source.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), when + duration);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(gain).connect(master);
    source.start(when);
    source.stop(when + duration + 0.01);
  }

  function playInteraction() {
    burst({ frequency: 850, duration: 0.11, volume: 0.07 });
    tone(140, 0.1, 0.035, 'sine', 85);
  }

  function playRadio() {
    burst({ frequency: 1050, duration: 0.3, volume: 0.11, highpass: true });
    tone(218, 0.24, 0.018, 'triangle', 174);
  }

  function playFootstep(surface = 'ground') {
    const wet = /wet|mud|shore|gravel/.test(String(surface));
    burst({ frequency: wet ? 1200 : 630, duration: 0.105, volume: wet ? 0.055 : 0.042 });
    tone(92 + Math.random() * 15, 0.085, 0.012, 'sine', 55);
  }

  function playCreak() {
    burst({ frequency: 520, duration: 0.38, volume: 0.015 });
    tone(165, 0.45, 0.008, 'triangle', 112);
  }

  function playFallStart() {
    burst({ frequency: 1350, duration: 0.64, volume: 0.058, highpass: true });
  }

  function playFallImpact() {
    burst({ frequency: 1700, duration: 0.47, volume: 0.11 });
    burst({ frequency: 430, duration: 0.62, volume: 0.052 });
    tone(74, 0.36, 0.023, 'sine', 48);
  }

  function playBirdCall(distance = 24) {
    if (!context || context.state !== 'running') return;
    // Two quiet, uneven gull notes. The bird renderer decides when a flock is
    // active; its distance controls level in the ambient mix.
    const proximity = clamp(1 - Math.max(0, distance - 8) / 105);
    if (proximity <= 0) return;
    const now = context.currentTime;
    for (const [delay, startHz, endHz, seconds, strength] of [
      [0, 760, 490, 0.23, 0.014],
      [0.31, 650, 890, 0.17, 0.008],
    ]) {
      const at = now + delay;
      const source = context.createOscillator();
      const gain = context.createGain();
      source.type = 'triangle';
      source.frequency.setValueAtTime(startHz, at);
      source.frequency.exponentialRampToValueAtTime(endHz, at + seconds);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(strength * proximity, at + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      source.connect(gain).connect(master);
      source.start(at);
      source.stop(at + seconds + 0.01);
    }
  }

  function playThunder(pan = 0) {
    if (!context || context.state !== 'running' || !noise) return;
    // A short, distant crack follows the flash, then a rolling low-frequency
    // rumble. Both are synthesized from the same in-memory noise as the wind.
    const stereo = typeof context.createStereoPanner === 'function'
      ? context.createStereoPanner() : null;
    if (stereo) {
      stereo.pan.value = clamp(Number.isFinite(pan) ? pan : 0, -0.8, 0.8);
      stereo.connect(master);
    }
    const output = stereo ?? master;
    const startAt = context.currentTime + 0.45 + Math.random() * 0.65;
    const crack = context.createBufferSource();
    crack.buffer = noise;
    const crackFilter = context.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.value = 1050;
    crackFilter.Q.value = 0.45;
    const crackGain = context.createGain();
    crackGain.gain.setValueAtTime(0.0001, startAt);
    crackGain.gain.exponentialRampToValueAtTime(0.13, startAt + 0.013);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.31);
    crack.connect(crackFilter).connect(crackGain).connect(output);
    crack.start(startAt, Math.random() * 3, 0.32);

    const rumble = context.createBufferSource();
    rumble.buffer = noise;
    const low = context.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(290, startAt);
    low.frequency.exponentialRampToValueAtTime(95, startAt + 4.8);
    const rumbleGain = context.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, startAt);
    rumbleGain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.11);
    rumbleGain.gain.exponentialRampToValueAtTime(0.09, startAt + 0.8);
    rumbleGain.gain.exponentialRampToValueAtTime(0.12, startAt + 1.5);
    rumbleGain.gain.exponentialRampToValueAtTime(0.05, startAt + 2.9);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 4.8);
    rumble.connect(low).connect(rumbleGain).connect(output);
    rumble.start(startAt, Math.random() * 1.6, 4.85);
  }

  function setVolume(value) {
    volume = level(value, volume);
    if (context && context.state !== 'closed') {
      master.gain.setTargetAtTime(muted ? 0 : 0.82 * volume, context.currentTime, 0.07);
    }
  }

  function setSeaVolume(value) {
    seaVolume = level(value, seaVolume);
    if (context && context.state !== 'closed') {
      lastControlTime = -Infinity;
      update(0, currentWeather, currentLocation);
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (context && context.state !== 'closed') {
      master.gain.setTargetAtTime(muted ? 0 : 0.82 * volume, context.currentTime, 0.07);
    }
  }

  function setVehicleEngine(running, effort = 0, proximity = 1) {
    vehicleEngine = { running: Boolean(running), effort: clamp(Number(effort) || 0),
      proximity: clamp(Number(proximity) || 0) };
  }

  function dispose() {
    if (!context) return Promise.resolve();
    const closing = context;
    loadingController?.abort();
    loadingController = null;
    for (const source of runningSources) {
      try { source.stop(); } catch { /* Already stopped. */ }
    }
    for (const source of activeWaves) {
      try { source.stop(); } catch { /* Already stopped. */ }
    }
    activeWaves.clear();
    runningSources.length = 0;
    context = null;
    noise = null;
    master = seaGain = windGain = rainGain = humGain = engineGain = null;
    engineLow = engineHigh = null;
    recordedGains = recordedBuffers = null;
    waveBuffers = [];
    return closing.state === 'closed' ? Promise.resolve() : closing.close().catch(() => {});
  }

  return { start, update, playInteraction, playRadio, playFootstep,
    playCreak, playFallStart, playFallImpact, playBirdCall, playThunder,
    setVehicleEngine, setVolume, setSeaVolume, setMuted, dispose };
}
