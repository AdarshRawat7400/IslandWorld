// "Forget Me Not" by Kistol, CC0. See CREDITS.md for the source recording.
// The former synthesized score has been removed. Music loads only after the
// player starts the game, and the separate level control can turn it off.

export const PIANO_TRACK_URL = '/assets/music/forget-me-not-loop.ogg';
export const DEFAULT_MUSIC_VOLUME = 0.4;
const MAX_PIANO_GAIN = 0.22;
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));

function stormStrength(weather) {
  if (typeof weather === 'number') return clamp(weather);
  if (typeof weather === 'string') {
    if (/storm|squall|thunder/i.test(weather)) return 1;
    if (/rain|shower/i.test(weather)) return 0.28;
    return 0;
  }
  if (weather && typeof weather === 'object') {
    const candidate = weather.storm ?? weather.intensity ?? 0;
    return Number.isFinite(Number(candidate)) ? clamp(Number(candidate)) : 0;
  }
  return 0;
}

/** Music remains beneath the weather and is reduced while a panel is open. */
export function selectMusicPlan({ weather = 'mist', indoors = false, dialogue = false } = {}) {
  const storm = stormStrength(weather);
  return Object.freeze({
    storm,
    level: clamp((1 - storm * 0.48) * (indoors ? 0.82 : 1) * (dialogue ? 0.32 : 1)),
  });
}

export function musicTargetVolume(volume, muted, plan) {
  return muted ? 0 : clamp(MAX_PIANO_GAIN * clamp(volume) * plan.level);
}

export function createMusic() {
  let track = null;
  let started = false;
  let muted = false;
  let volume = DEFAULT_MUSIC_VOLUME;
  let currentLevel = 0;
  let inputs = {};

  function ensureTrack() {
    if (track) return track;
    if (typeof globalThis.Audio !== 'function') return null;
    track = new globalThis.Audio(PIANO_TRACK_URL);
    track.loop = true;
    track.preload = 'none';
    track.volume = 0;
    if (typeof document !== 'undefined') {
      track.id = 'background-piano';
      track.hidden = true;
      document.body.appendChild(track);
    }
    return track;
  }

  function playIfAudible() {
    if (!started || muted || volume <= 0) return Promise.resolve(true);
    const audio = ensureTrack();
    if (!audio) return Promise.resolve(false);
    if (!audio.paused) return Promise.resolve(true);
    try {
      return Promise.resolve(audio.play()).then(() => true, () => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  function update(dt = 0, options = inputs) {
    inputs = options && typeof options === 'object' ? options : {};
    const plan = selectMusicPlan(inputs);
    if (!track) return plan;
    const target = musicTargetVolume(volume, muted, plan);
    if (target === 0) {
      currentLevel = 0;
    } else {
      const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 1);
      currentLevel += (target - currentLevel) * (1 - Math.exp(-step / 0.65));
    }
    track.volume = clamp(currentLevel);
    return plan;
  }

  function start() {
    started = true;
    return playIfAudible();
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (muted && track) {
      currentLevel = 0;
      track.volume = 0;
      track.pause();
    } else if (!muted) {
      void playIfAudible();
    }
  }

  function setVolume(value) {
    const candidate = Number(value);
    if (!Number.isFinite(candidate)) return;
    volume = clamp(candidate);
    if (track && volume <= 0) {
      currentLevel = 0;
      track.volume = 0;
      track.pause();
    } else if (volume > 0) {
      void playIfAudible();
    }
  }

  function dispose() {
    started = false;
    if (track) {
      track.pause();
      track.removeAttribute('src');
      track.load();
      track.remove?.();
      track = null;
    }
    currentLevel = 0;
    return Promise.resolve();
  }

  return { start, update, setMuted, setVolume, dispose };
}
