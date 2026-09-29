/*
 * Wave spectrum and Gerstner displacement adapted from Open Water:
 * https://github.com/bob6664569/open-water/blob/285b6ce32057c70191a7fe16c31d979fa383ac64/site/js/simulation/waves.js
 *
 * MIT License
 * Copyright (c) 2026 bob6664569
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import * as THREE from 'three';

const G = 9.81;
const TAU = Math.PI * 2;
const WAVE_COUNT = 16;
const DEFAULT_SEA_LEVEL = 0.055;

// Significant wave heights in metres. A single fixed peak period makes weather
// changes alter wave energy without abruptly moving crests along the coast.
export const OCEAN_WEATHER = Object.freeze({
  clear: 0.70,
  mist: 0.85,
  rain: 1.55,
  storm: 3.45,
  dawn: 0.70,
});

export const OCEAN_WAVE_COUNT = WAVE_COUNT;

// GLSL 1.00 for the existing WebGLRenderer/ShaderMaterial. The caller should
// add this before main(), call oceanWaveDisplacement(world.xz), then attenuate
// that displacement with its own harbor, shoreline and patch masks.
export const OCEAN_WAVE_GLSL = `
  uniform vec4 uOceanWaveDirs[${WAVE_COUNT}];
  uniform vec4 uOceanWaveParams[${WAVE_COUNT}];
  uniform float uOceanWaveTime;
  vec3 oceanWaveDisplacement(vec2 p) {
    vec3 displacement = vec3(0.0);
    for (int i = 0; i < ${WAVE_COUNT}; i++) {
      vec4 direction = uOceanWaveDirs[i];
      vec4 wave = uOceanWaveParams[i];
      float phase = direction.z * dot(direction.xy, p)
        - direction.w * uOceanWaveTime + wave.z;
      float horizontal = wave.x * wave.y * cos(phase);
      displacement.xz += direction.xy * horizontal;
      displacement.y += wave.x * sin(phase);
    }
    return displacement;
  }
`;

function makeRng(seed) {
  let state = Math.floor(seed) % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = state * 16807 % 2147483647;
    return state / 2147483647;
  };
}

function jonswapShape(ratio) {
  const sigma = ratio <= 1 ? 0.07 : 0.09;
  const peak = Math.exp(-((ratio - 1) ** 2) / (2 * sigma * sigma));
  return ratio ** -5 * Math.exp(-1.25 * ratio ** -4) * 3.3 ** peak;
}

function makeSpectrum(seed, peakPeriod) {
  const rnd = makeRng(seed);
  const windDir = Math.atan2(0.18, 1);
  const components = [];
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const ratio = 0.56 * (2.65 / 0.56) ** t;
    const spread = THREE.MathUtils.lerp(0.08, 0.62,
      THREE.MathUtils.smoothstep(ratio, 0.65, 2.4));
    components.push({
      ratio,
      weight: Math.sqrt(Math.max(jonswapShape(ratio) * ratio, 1e-7)),
      direction: windDir + (rnd() - 0.5) * 2 * spread,
      phase: rnd() * TAU,
    });
  }
  const crossDir = windDir + 52 * Math.PI / 180;
  for (let i = 0; i < 4; i++) {
    const ratio = THREE.MathUtils.lerp(0.58, 1.12, i / 3);
    components.push({
      ratio,
      weight: Math.sqrt(Math.max(jonswapShape(ratio) * ratio, 1e-7)) * 0.34,
      direction: crossDir + (rnd() - 0.5) * 0.16,
      phase: rnd() * TAU,
    });
  }
  return components.sort((a, b) => a.ratio - b.ratio).map((component) => {
    const omega = TAU * component.ratio / peakPeriod;
    return {
      ...component,
      dx: Math.cos(component.direction),
      dz: Math.sin(component.direction),
      omega,
      k: omega * omega / G,
      amplitude: 0,
      steepness: 0,
    };
  });
}

/** A shared, deterministic wave field for GPU vertices and CPU buoyancy. */
export class OceanWaveField {
  constructor({ seaLevel = DEFAULT_SEA_LEVEL, peakPeriod = 5.8,
    seed = 987654321 } = {}) {
    if (!Number.isFinite(peakPeriod) || peakPeriod <= 0) {
      throw new RangeError('peakPeriod must be positive');
    }
    this.seaLevel = seaLevel;
    this.time = 0;
    this.weather = 'mist';
    this.significantWaveHeight = OCEAN_WEATHER.mist;
    this.waves = makeSpectrum(seed, peakPeriod);
    this.variance = this.waves.reduce((sum, wave) =>
      sum + wave.weight * wave.weight * 0.5, 0);
    this.uniforms = {
      uOceanWaveDirs: { value: this.waves.map((wave) =>
        new THREE.Vector4(wave.dx, wave.dz, wave.k, wave.omega)) },
      uOceanWaveParams: { value: this.waves.map((wave) =>
        new THREE.Vector4(0, 0, wave.phase, 0)) },
      uOceanWaveTime: { value: 0 },
    };
    this.syncAmplitudes();
  }

  /** elapsed is absolute scene time; call once per frame before rendering. */
  update(elapsed, weather = this.weather, windSpeed = null) {
    if (!Number.isFinite(elapsed)) return;
    const nextTime = Math.max(this.time, elapsed);
    const delta = Math.min(0.2, Math.max(0, nextTime - this.time));
    this.time = nextTime;
    this.weather = Object.hasOwn(OCEAN_WEATHER, weather) ? weather : 'mist';
    // Old swell energy decays gradually after a front passes. Local wind adds
    // shorter wave energy without instantly turning the offshore spectrum.
    const baseTarget = OCEAN_WEATHER[this.weather];
    const target = Number.isFinite(windSpeed)
      ? THREE.MathUtils.lerp(baseTarget,
        THREE.MathUtils.clamp(0.3 + windSpeed * 0.13, 0.5, 4), 0.4)
      : baseTarget;
    this.significantWaveHeight += (target - this.significantWaveHeight)
      * (1 - Math.exp(-delta * (Number.isFinite(windSpeed) ? 0.11 : 0.55)));
    this.uniforms.uOceanWaveTime.value = this.time;
    this.syncAmplitudes();
  }

  syncAmplitudes() {
    const energyScale = (this.significantWaveHeight / 4) / Math.sqrt(this.variance);
    let rawSteepness = 0;
    for (const wave of this.waves) {
      wave.amplitude = wave.weight * energyScale;
      rawSteepness += 0.72 * wave.k * wave.amplitude;
    }
    const steepnessScale = Math.min(1, 0.62 / Math.max(rawSteepness, 1e-6));
    for (let i = 0; i < this.waves.length; i++) {
      const wave = this.waves[i];
      wave.steepness = 0.72 * steepnessScale;
      this.uniforms.uOceanWaveParams.value[i].set(
        wave.amplitude, wave.steepness, wave.phase, 0);
    }
  }

  displacementAt(x, z, time = this.time, out = new THREE.Vector3()) {
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (const wave of this.waves) {
      const phase = wave.k * (wave.dx * x + wave.dz * z)
        - wave.omega * time + wave.phase;
      const horizontal = wave.steepness * wave.amplitude * Math.cos(phase);
      dx += horizontal * wave.dx;
      dz += horizontal * wave.dz;
      dy += wave.amplitude * Math.sin(phase);
    }
    return out.set(dx, dy, dz);
  }

  // An observed world-space x/z is displaced from its material point by the
  // Gerstner horizontal component. Three iterations solve that small offset.
  materialPointAt(x, z, time = this.time, attenuation = 1) {
    let px = x;
    let pz = z;
    const displacement = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      this.displacementAt(px, pz, time, displacement);
      px = x - displacement.x * attenuation;
      pz = z - displacement.z * attenuation;
    }
    return { x: px, z: pz };
  }

  heightAt(x, z, time = this.time, attenuation = 1) {
    if (attenuation <= 0) return this.seaLevel;
    const point = this.materialPointAt(x, z, time, attenuation);
    return this.seaLevel
      + attenuation * this.displacementAt(point.x, point.z, time).y;
  }

  normalAt(x, z, time = this.time, attenuation = 1,
    out = new THREE.Vector3()) {
    if (attenuation <= 0) return out.set(0, 1, 0);
    const point = this.materialPointAt(x, z, time, attenuation);
    let nx = 0;
    let ny = 1;
    let nz = 0;
    for (const wave of this.waves) {
      const phase = wave.k * (wave.dx * point.x + wave.dz * point.z)
        - wave.omega * time + wave.phase;
      const ka = wave.k * wave.amplitude * attenuation;
      const cosine = Math.cos(phase);
      const sine = Math.sin(phase);
      nx -= wave.dx * ka * cosine;
      nz -= wave.dz * ka * cosine;
      ny -= wave.steepness * ka * sine;
    }
    return out.set(nx, ny, nz).normalize();
  }

  sample(x, z, time = this.time, attenuation = 1) {
    return {
      height: this.heightAt(x, z, time, attenuation),
      normal: this.normalAt(x, z, time, attenuation),
    };
  }
}

export function createOceanWaveField(options) {
  return new OceanWaveField(options);
}

/** Convert a water normal to Euler pitch/roll for a hull facing local +Z. */
export function boatTiltFromNormal(normal, heading, maxPitch = 0.10, maxRoll = 0.12) {
  if (!normal || !Number.isFinite(normal.x) || !Number.isFinite(normal.y)
    || !Number.isFinite(normal.z) || normal.y <= 0 || !Number.isFinite(heading)) {
    return null;
  }
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const towardBow = normal.x * sin + normal.z * cos;
  const towardStarboard = normal.x * cos - normal.z * sin;
  return {
    pitch: THREE.MathUtils.clamp(Math.atan2(towardBow, normal.y), -maxPitch, maxPitch),
    roll: THREE.MathUtils.clamp(-Math.atan2(towardStarboard, normal.y), -maxRoll, maxRoll),
  };
}
