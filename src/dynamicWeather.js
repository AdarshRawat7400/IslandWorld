// A deterministic, allocation-light weather clock. Its inputs are elapsed game
// seconds, so pausing, seeking, and screenshots always reproduce the same sky.
// Celestial positions use a simple local horizon model at a northern coastal
// latitude; no browser clock or external weather service is involved.

const TAU = Math.PI * 2;
const DEFAULT_DAY_LENGTH_SECONDS = 20 * 60;
const START_HOUR = 16.5;
const LATITUDE = 57 * Math.PI / 180;
const SOLAR_DECLINATION = -4 * Math.PI / 180;
const FRONT_NAMES = Object.freeze([
  'mist', 'rain', 'storm', 'rain', 'mist', 'clear',
  'mist', 'rain', 'storm', 'rain', 'mist', 'clear',
]);

const WEATHER = Object.freeze({
  clear: Object.freeze({ rain: 0, cloudCover: 0.22, windSpeed: 3.8 }),
  mist: Object.freeze({ rain: 0.025, cloudCover: 0.64, windSpeed: 5.5 }),
  rain: Object.freeze({ rain: 0.65, cloudCover: 0.85, windSpeed: 11.5 }),
  storm: Object.freeze({ rain: 1, cloudCover: 0.97, windSpeed: 20 }),
  // The pre-existing island world exposes dawn as a weather preset. Preserve
  // that debug override while the clock itself still controls sun position.
  dawn: Object.freeze({ rain: 0, cloudCover: 0.40, windSpeed: 4.5 }),
});

const FIXED_HOURS = Object.freeze({ dawn: 6.5, noon: 12, day: 12,
  dusk: 17.5, night: 0 });

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeFronts() {
  const random = randomGenerator(0x56f21c7b);
  let start = 0;
  const fronts = FRONT_NAMES.map((mode, index) => {
    const duration = 148 + random() * 92;
    const transition = 42 + random() * 16;
    const speedVariation = 0.90 + random() * 0.20;
    // Angles complete almost one revolution before looping. Circular
    // interpolation below also smooths the final-front/first-front join.
    const angle = 3.45 + index * 0.48 + (random() - 0.5) * 0.46;
    const front = { mode, start, duration, transition, speedVariation, angle };
    start += duration;
    return front;
  });
  return { fronts, cycleSeconds: start };
}

const FRONT_SEQUENCE = makeFronts();

function timeHour(value, elapsed, dayLengthSeconds) {
  if (typeof value === 'number' && Number.isFinite(value)) return positiveModulo(value, 24);
  if (typeof value === 'string') {
    const name = value.toLowerCase();
    if (Object.hasOwn(FIXED_HOURS, name)) return FIXED_HOURS[name];
    const match = /^(\d{1,2}):(\d{2})$/.exec(name);
    if (match && Number(match[1]) < 24 && Number(match[2]) < 60) {
      return Number(match[1]) + Number(match[2]) / 60;
    }
  }
  return positiveModulo(START_HOUR + elapsed * 24 / dayLengthSeconds, 24);
}

function directionFor(hourAngle, declination) {
  const cosDeclination = Math.cos(declination);
  return {
    // World +X is east, +Z is north. Solar noon therefore points south.
    x: -cosDeclination * Math.sin(hourAngle),
    y: Math.sin(LATITUDE) * Math.sin(declination)
      + Math.cos(LATITUDE) * cosDeclination * Math.cos(hourAngle),
    z: Math.cos(LATITUDE) * Math.sin(declination)
      - Math.sin(LATITUDE) * cosDeclination * Math.cos(hourAngle),
  };
}

function weatherAt(elapsed) {
  const { fronts, cycleSeconds } = FRONT_SEQUENCE;
  const withinCycle = positiveModulo(elapsed, cycleSeconds);
  let index = fronts.length - 1;
  for (let i = 0; i < fronts.length; i++) {
    if (withinCycle < fronts[i].start + fronts[i].duration) {
      index = i;
      break;
    }
  }
  const from = fronts[index];
  const to = fronts[(index + 1) % fronts.length];
  const frontAge = withinCycle - from.start;
  const transitionStart = from.duration - from.transition;
  const transition = smoothstep(0, 1,
    (frontAge - transitionStart) / from.transition);
  const fromWeather = WEATHER[from.mode];
  const toWeather = WEATHER[to.mode];
  const gust = 1 + 0.075 * Math.sin(elapsed * 0.19 + 0.7)
    + 0.035 * Math.sin(elapsed * 0.53 + 1.4);

  // Interpolate the shortest arc, including the end of the repeating cycle.
  const turn = Math.atan2(Math.sin(to.angle - from.angle),
    Math.cos(to.angle - from.angle));
  const angle = from.angle + turn * transition
    + 0.065 * Math.sin(elapsed * 0.013);
  return {
    mode: transition >= 0.5 ? to.mode : from.mode,
    rain: mix(fromWeather.rain, toWeather.rain, transition),
    cloudCover: mix(fromWeather.cloudCover, toWeather.cloudCover, transition),
    windSpeed: mix(fromWeather.windSpeed * from.speedVariation,
      toWeather.windSpeed * to.speedVariation, transition) * gust,
    windDirection: { x: Math.cos(angle), z: Math.sin(angle) },
  };
}

/**
 * Create an elapsed-time-driven coastal weather system.
 *
 * `windSpeed` is in approximate metres per second and `windDirection` is a
 * unit vector in world XZ coordinates. A full game day is 20 minutes by
 * default. `sample()` is pure: seeking or sampling out of order is supported.
 */
export function createDynamicWeather({ dayLengthSeconds = DEFAULT_DAY_LENGTH_SECONDS } = {}) {
  if (!Number.isFinite(dayLengthSeconds) || dayLengthSeconds <= 0) {
    throw new RangeError('dayLengthSeconds must be a positive finite number');
  }

  function sample(elapsed, { weatherOverride = 'auto', timeOverride = 'auto' } = {}) {
    const seconds = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    const hour = timeHour(timeOverride, seconds, dayLengthSeconds);
    const solarHourAngle = (hour - 12) * TAU / 24;
    const sunDirection = directionFor(solarHourAngle, SOLAR_DECLINATION);
    // The moon changes phase slowly across successive accelerated days. A
    // roughly full moon is visible over the first night's storm fronts.
    const moonPhase = positiveModulo(0.53 + seconds / dayLengthSeconds * 0.035, 1);
    const moonDeclination = SOLAR_DECLINATION * Math.cos(moonPhase * TAU);
    const moonDirection = directionFor(solarHourAngle + moonPhase * TAU,
      moonDeclination);
    const daylight = smoothstep(-0.045, 0.21, sunDirection.y);
    const twilight = smoothstep(-0.24, -0.02, sunDirection.y)
      * (1 - smoothstep(0.025, 0.20, sunDirection.y));
    const night = 1 - smoothstep(-0.17, -0.015, sunDirection.y);
    const weather = weatherAt(seconds);
    const override = typeof weatherOverride === 'string'
      ? weatherOverride.toLowerCase() : 'auto';
    if (Object.hasOwn(WEATHER, override)) {
      const fixed = WEATHER[override];
      weather.mode = override;
      weather.rain = fixed.rain;
      weather.cloudCover = fixed.cloudCover;
      weather.windSpeed = fixed.windSpeed
        * (1 + 0.075 * Math.sin(seconds * 0.19 + 0.7)
          + 0.035 * Math.sin(seconds * 0.53 + 1.4));
    }
    const totalMinutes = Math.floor(hour * 60 + 1e-8) % (24 * 60);
    const timeLabel = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}`
      + `:${String(totalMinutes % 60).padStart(2, '0')}`;
    return {
      ...weather,
      hour,
      timeLabel,
      daylight,
      twilight,
      night,
      sunDirection,
      moonDirection,
      moonPhase,
    };
  }

  return { sample, dayLengthSeconds, frontCycleSeconds: FRONT_SEQUENCE.cycleSeconds };
}
