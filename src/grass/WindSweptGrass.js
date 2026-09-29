/*
 * Adapted from WindSweptGrass.js by J Hanlon / I Dream Of AI (2026).
 * Source: https://gist.github.com/kitchenbeats/7e80e53ee4cc1a3177925f48cdf61793
 * Revision: de189ffe172c8f69895b59a847c851a4e406241d
 * License: MIT; the complete copyright and permission notice is in LICENSE.txt.
 * Island adaptations: weather wind scaling and muted coastal palette.
 */
import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

const MAX_FLATTENERS = 12;
const MASK_SIZE = 256;
const HEIGHT_MAP_SIZE = 256;
const TAU = Math.PI * 2;
const BLADES_PER_MEADOW_CLUSTER = 4;
const HIGH_DENSITY_STEPS = Object.freeze([0.40, 0.52, 0.66, 0.82, 1.00]);
const MEDIUM_DENSITY_STEPS = Object.freeze([0.72, 0.82, 1.00]);
const LOW_DENSITY_STEPS = Object.freeze([0.55, 0.72, 0.86, 1.00]);
const CUSTOM_DENSITY_STEPS = Object.freeze([0.50, 0.68, 0.84, 1.00]);

const GOVERNOR_WARMUP_SECONDS = 6;
const GOVERNOR_WINDOW_SECONDS = 2.5;
const GOVERNOR_SLOW_FRAME_SECONDS = 1 / 48;
const GOVERNOR_FAST_FRAME_SECONDS = 1 / 58;
const GOVERNOR_SLOW_WINDOWS_TO_STEP_DOWN = 2;
const GOVERNOR_FAST_WINDOWS_TO_STEP_UP = 10;
const GOVERNOR_MAX_VALID_DELTA = 0.08;
const GOVERNOR_MAX_SAMPLED_DELTA = 0.05;
const GOVERNOR_MAX_SLOW_DELTA = 1;
const GOVERNOR_MIN_SLOW_WINDOW_FRAMES = 6;

/** Deterministic Mulberry32-style source with the `random()` shape Three uses. */
function seededRandom(seed) {
  let value = seed >>> 0;
  return {
    random() {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Paints or erases a feathered world-space circle in the grass density map. */
function paintRegionMask(
  data,
  resolution,
  worldSize,
  region,
  mode = 'fill',
) {
  const { x, z, radius } = region ?? {};
  if (![x, z, radius].every(Number.isFinite) || radius <= 0) {
    throw new TypeError(
      'Grass regions require finite x/z coordinates and a positive radius.',
    );
  }

  const centerX = (x / worldSize + 0.5) * resolution;
  const centerY = (0.5 - z / worldSize) * resolution;
  const pixelRadius = Math.ceil((radius / worldSize) * resolution);
  const minX = Math.max(0, Math.floor(centerX - pixelRadius));
  const maxX = Math.min(resolution - 1, Math.ceil(centerX + pixelRadius));
  const minY = Math.max(0, Math.floor(centerY - pixelRadius));
  const maxY = Math.min(resolution - 1, Math.ceil(centerY + pixelRadius));

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = (
        ((px + 0.5) / resolution - 0.5) * worldSize - x
      ) / radius;
      const dz = (
        (0.5 - (py + 0.5) / resolution) * worldSize - z
      ) / radius;
      const distance = Math.hypot(dx, dz);
      if (distance > 1) continue;
      const amount = (
        1 - THREE.MathUtils.smoothstep(
          distance,
          region.hardness ?? 0.7,
          1,
        )
      ) * (region.strength ?? 1);
      const painted = Math.round(amount * 255);
      const index = py * resolution + px;
      data[index] = mode === 'erase'
        ? Math.min(data[index], 255 - painted)
        : Math.max(data[index], painted);
    }
  }
}

function hash(index, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function isMobileDevice() {
  return typeof navigator !== 'undefined'
    && (/Mobi|Android/i.test(navigator.userAgent) || navigator.maxTouchPoints > 2);
}

function readDeviceHints() {
  if (typeof navigator === 'undefined') {
    return {
      mobile: false,
      deviceMemory: null,
      hardwareConcurrency: null,
    };
  }

  return {
    mobile: isMobileDevice(),
    deviceMemory: Number.isFinite(navigator.deviceMemory)
      ? navigator.deviceMemory
      : null,
    hardwareConcurrency: Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : null,
  };
}

function lowQualityProfile({
  tier = 'low',
  initialDensityScale = 1,
  deviceHints = readDeviceHints(),
} = {}) {
  return {
    tier,
    meadowTuftCount: 52_000,
    tuftChunkDivisions: 5,
    detailGridSize: 141,
    detailSpacing: 0.36,
    densitySteps: LOW_DENSITY_STEPS,
    initialDensityScale,
    adaptive: true,
    deviceHints,
  };
}

function mediumQualityProfile({
  tier = 'medium',
  initialDensityScale = 1,
  deviceHints = readDeviceHints(),
} = {}) {
  return {
    tier,
    meadowTuftCount: 108_000,
    tuftChunkDivisions: 6,
    detailGridSize: 181,
    detailSpacing: 0.30,
    densitySteps: MEDIUM_DENSITY_STEPS,
    initialDensityScale,
    adaptive: true,
    deviceHints,
  };
}

function highQualityProfile({
  tier = 'high',
  initialDensityScale = 1,
  deviceHints = readDeviceHints(),
} = {}) {
  return {
    tier,
    meadowTuftCount: 220_000,
    tuftChunkDivisions: 8,
    detailGridSize: 241,
    detailSpacing: 0.24,
    densitySteps: HIGH_DENSITY_STEPS,
    initialDensityScale,
    adaptive: true,
    deviceHints,
  };
}

function resolveGrassQuality(quality) {
  if (Number.isFinite(quality)) {
    const total = Math.max(12_000, Math.floor(quality));
    return {
      tier: 'custom',
      meadowTuftCount: Math.max(12_000, Math.floor(total * 0.88)),
      tuftChunkDivisions: total > 90_000 ? 6 : 5,
      detailGridSize: total > 90_000 ? 181 : 151,
      detailSpacing: total > 90_000 ? 0.30 : 0.34,
      densitySteps: CUSTOM_DENSITY_STEPS,
      initialDensityScale: 1,
      adaptive: true,
      deviceHints: readDeviceHints(),
    };
  }

  if (quality === 'low') return lowQualityProfile();
  if (quality === 'medium') return mediumQualityProfile();
  if (quality === 'high') return highQualityProfile();

  const deviceHints = readDeviceHints();
  if (deviceHints.mobile) {
    return lowQualityProfile({
      tier: 'auto-mobile',
      initialDensityScale: 0.86,
      deviceHints,
    });
  }

  const constrainedMemory = deviceHints.deviceMemory != null
    && deviceHints.deviceMemory <= 4;
  const constrainedCpu = deviceHints.hardwareConcurrency != null
    && deviceHints.hardwareConcurrency <= 4;
  if (constrainedMemory || constrainedCpu) {
    return mediumQualityProfile({
      tier: 'auto-conservative',
      initialDensityScale: 0.82,
      deviceHints,
    });
  }

  const highMemory = deviceHints.deviceMemory != null
    && deviceHints.deviceMemory >= 8;
  const highCpu = deviceHints.hardwareConcurrency != null
    && deviceHints.hardwareConcurrency >= 10;
  if (highMemory && highCpu) {
    return highQualityProfile({
      tier: 'auto-high',
      initialDensityScale: 1,
      deviceHints,
    });
  }

  const balancedMemory = deviceHints.deviceMemory != null
    && deviceHints.deviceMemory >= 6;
  const balancedCpu = deviceHints.hardwareConcurrency != null
    && deviceHints.hardwareConcurrency >= 8;
  return highQualityProfile({
    tier: balancedMemory || balancedCpu ? 'auto-balanced' : 'auto-default',
    initialDensityScale: balancedMemory || balancedCpu ? 0.82 : 0.66,
    deviceHints,
  });
}

function createBladeGeometry(dense = false) {
  const geometry = new THREE.BufferGeometry();
  if (dense) {
    // At ten times the blade density the individual five-segment silhouette
    // is smaller than a pixel at normal viewing distance. One tapered face
    // preserves the blade count and wind sway for one fifth the GPU work.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.50, 0, 0, 0.50, 0, 0, 0, 1, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0, 1, 0, 0.5, 1,
    ], 2));
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
    return geometry;
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.50, 0.00, 0, 0.50, 0.00, 0,
    -0.43, 0.36, 0, 0.43, 0.36, 0,
    -0.22, 0.72, 0, 0.22, 0.72, 0,
     0.00, 1.00, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0.07, 0.36, 0.93, 0.36, 0.28, 0.72, 0.72, 0.72, 0.5, 1,
  ], 2));
  geometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
  geometry.computeVertexNormals();
  return geometry;
}

function createWindTexture(seed) {
  const simplex = new SimplexNoise(seededRandom(seed));
  const size = 128;
  const data = new Uint8Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const ax = (x / size) * TAU;
      const ay = (y / size) * TAU;
      const large = simplex.noise4d(
        Math.cos(ax) * 0.62,
        Math.sin(ax) * 0.62,
        Math.cos(ay) * 0.62,
        Math.sin(ay) * 0.62,
      );
      const small = simplex.noise4d(
        Math.cos(ax) * 1.8,
        Math.sin(ax) * 1.8,
        Math.cos(ay) * 1.8,
        Math.sin(ay) * 1.8,
      );
      data[y * size + x] = Math.round(
        THREE.MathUtils.clamp(0.5 + large * 0.34 + small * 0.16, 0, 1) * 255,
      );
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.name = 'GrassWindNoise';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createFarClusterTexture(seed) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('A 2D canvas context is required for distant grass.');

  const random = seededRandom(seed);
  context.clearRect(0, 0, size, size);

  // A feathered, irregular ground splat becomes low-frequency meadow texture
  // after mipmapping. There are deliberately no drawn blade silhouettes here:
  // individual geometry is handled by the near and medium LODs.
  const rootGradient = context.createRadialGradient(
    size * 0.5,
    size * 0.5,
    size * 0.04,
    size * 0.5,
    size * 0.5,
    size * 0.49,
  );
  rootGradient.addColorStop(0, 'rgba(255,255,255,0.54)');
  rootGradient.addColorStop(0.52, 'rgba(255,255,255,0.34)');
  rootGradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = rootGradient;
  context.fillRect(0, 0, size, size);

  for (let index = 0; index < 18; index += 1) {
    const angle = random.random() * TAU;
    const distance = Math.sqrt(random.random()) * size * 0.29;
    const x = size * 0.5 + Math.cos(angle) * distance;
    const y = size * 0.5 + Math.sin(angle) * distance;
    const radius = size * (0.06 + random.random() * 0.13);
    const patch = context.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = 0.07 + random.random() * 0.13;
    patch.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
    patch.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = patch;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'SoftDistantGrassCluster';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createMeadowTuftTexture(seed) {
  const tileSize = 128;
  const atlasColumns = 2;
  const size = tileSize * atlasColumns;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('A 2D canvas context is required for meadow tufts.');

  const random = seededRandom(seed);
  context.clearRect(0, 0, size, size);
  for (let variant = 0; variant < atlasColumns * atlasColumns; variant += 1) {
    const tileX = (variant % atlasColumns) * tileSize;
    const tileY = Math.floor(variant / atlasColumns) * tileSize;
    const bladeCount = 38 + Math.floor(random.random() * 17);

    for (let index = 0; index < bladeCount; index += 1) {
      const baseX = tileX + tileSize * (0.055 + random.random() * 0.89);
      const baseY = tileY + tileSize * 0.95;
      const bladeHeight = tileSize * (
        0.28 + Math.pow(random.random(), 0.72) * 0.62
      );
      const tipY = baseY - bladeHeight;
      const lean = (random.random() - 0.5) * tileSize * 0.23;
      const alpha = 0.52 + random.random() * 0.46;
      context.beginPath();
      context.moveTo(baseX, baseY);
      context.quadraticCurveTo(
        baseX + lean * 0.38,
        tileY + tileSize * (0.50 + random.random() * 0.20),
        baseX + lean,
        tipY,
      );
      context.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      context.lineWidth = 0.65 + random.random() * 1.05;
      context.lineCap = 'round';
      context.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'ContinuousMeadowTuft';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createTerrainHeightTexture(terrain) {
  const samples = new Float32Array(HEIGHT_MAP_SIZE * HEIGHT_MAP_SIZE);
  const halfSize = terrain.size * 0.5;
  let minimum = Infinity;
  let maximum = -Infinity;

  for (let row = 0; row < HEIGHT_MAP_SIZE; row += 1) {
    const z = halfSize - (row / (HEIGHT_MAP_SIZE - 1)) * terrain.size;
    for (let column = 0; column < HEIGHT_MAP_SIZE; column += 1) {
      const x = -halfSize + (column / (HEIGHT_MAP_SIZE - 1)) * terrain.size;
      const height = terrain.heightAt(x, z);
      const index = row * HEIGHT_MAP_SIZE + column;
      samples[index] = height;
      minimum = Math.min(minimum, height);
      maximum = Math.max(maximum, height);
    }
  }

  const heightRange = Math.max(0.001, maximum - minimum);
  const data = new Uint8Array(HEIGHT_MAP_SIZE * HEIGHT_MAP_SIZE * 4);
  for (let index = 0; index < samples.length; index += 1) {
    const encoded = Math.round(
      THREE.MathUtils.clamp((samples[index] - minimum) / heightRange, 0, 1) * 65535,
    );
    const offset = index * 4;
    data[offset] = encoded >>> 8;
    data[offset + 1] = encoded & 255;
    data[offset + 2] = 0;
    data[offset + 3] = 255;
  }

  const texture = new THREE.DataTexture(
    data,
    HEIGHT_MAP_SIZE,
    HEIGHT_MAP_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'GrassTerrainHeight';
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return { texture, minimum, range: heightRange };
}

function createBaseDensityData(terrain, clearings) {
  const data = new Uint8Array(MASK_SIZE * MASK_SIZE);
  const normal = new THREE.Vector3();
  const halfSize = terrain.size * 0.5;

  for (let row = 0; row < MASK_SIZE; row += 1) {
    const z = halfSize - ((row + 0.5) / MASK_SIZE) * terrain.size;
    for (let column = 0; column < MASK_SIZE; column += 1) {
      const x = -halfSize + ((column + 0.5) / MASK_SIZE) * terrain.size;
      const pathDistance = terrain.path.nearest(x, z).distance;
      const vergeDensity = THREE.MathUtils.smoothstep(
        pathDistance,
        terrain.path.width * 1.03,
        terrain.path.shoulderWidth + 0.08,
      );
      const slopeDensity = THREE.MathUtils.smoothstep(
        terrain.normalAt(x, z, normal).y,
        0.53,
        0.68,
      );
      const coverage = THREE.MathUtils.clamp(terrain.densityAt?.(x, z) ?? 1, 0, 1);
      data[row * MASK_SIZE + column] = Math.round(
        255 * vergeDensity * slopeDensity * coverage,
      );
    }
  }

  clearings.forEach((region) => {
    paintRegionMask(
      data,
      MASK_SIZE,
      terrain.size,
      {
        ...region,
        hardness: region.hardness ?? 0.82,
        strength: region.strength ?? 1,
      },
      'erase',
    );
  });

  return data;
}

function createGrassMaterial(
  uniforms,
  { detail = false, ring = false, clustered = false } = {},
) {
  const detailCommon = detail
    ? `
        uniform vec2 uDetailCell, uDetailFocus;
        uniform float uDetailSpacing, uDetailHeightScale, uDetailWidthScale;
        uniform float uHeightMapSize, uHeightMinimum, uHeightRange;
        uniform sampler2D uTerrainHeightMap;
        float grassHash(vec2 value, float salt) {
          return fract(sin(dot(value + vec2(salt, salt * 0.371), vec2(127.1, 311.7)))
            * 43758.5453123);
        }
        float decodeGrassHeight(vec4 encodedHeight) {
          float normalizedHeight = (
            encodedHeight.r * 65280.0 + encodedHeight.g * 255.0
          ) / 65535.0;
          return uHeightMinimum + normalizedHeight * uHeightRange;
        }
        float sampleGrassTerrain(vec2 worldXZ) {
          vec2 terrainUv = clamp(
            vec2(worldXZ.x / uTerrainSize + 0.5, 0.5 - worldXZ.y / uTerrainSize),
            vec2(0.0),
            vec2(1.0)
          );
          vec2 samplePosition = terrainUv * (uHeightMapSize - 1.0);
          vec2 sampleBase = floor(samplePosition);
          vec2 sampleBlend = smoothstep(vec2(0.0), vec2(1.0), fract(samplePosition));
          vec2 inverseSize = vec2(1.0 / uHeightMapSize);
          float height00 = decodeGrassHeight(texture2D(
            uTerrainHeightMap, (sampleBase + vec2(0.5, 0.5)) * inverseSize
          ));
          float height10 = decodeGrassHeight(texture2D(
            uTerrainHeightMap, (sampleBase + vec2(1.5, 0.5)) * inverseSize
          ));
          float height01 = decodeGrassHeight(texture2D(
            uTerrainHeightMap, (sampleBase + vec2(0.5, 1.5)) * inverseSize
          ));
          float height11 = decodeGrassHeight(texture2D(
            uTerrainHeightMap, (sampleBase + vec2(1.5, 1.5)) * inverseSize
          ));
          return mix(
            mix(height00, height10, sampleBlend.x),
            mix(height01, height11, sampleBlend.x),
            sampleBlend.y
          );
        }`
    : '';

  const normalSetup = clustered
    ? 'float grassBladeAngle = bladeData.x + bladeClusterData.x;'
    : detail
      ? `vec2 grassNormalCell = bladeOrigin.xz + uDetailCell;
        float grassBladeAngle = grassHash(grassNormalCell, 3.17) * ${TAU.toFixed(8)};`
      : 'float grassBladeAngle = bladeData.x;';

  const originSetup = clustered
    ? `float clusterCosine = cos(bladeData.x);
        float clusterSine = sin(bladeData.x);
        vec2 clusterOffset = vec2(
          bladeClusterOffset.x * clusterCosine
            - bladeClusterOffset.y * clusterSine,
          bladeClusterOffset.x * clusterSine
            + bladeClusterOffset.y * clusterCosine
        );
        vec2 originXZ = bladeOrigin.xz + clusterOffset;
        float bladeAngle = bladeData.x + bladeClusterData.x;
        float bladeHeight = bladeData.y * bladeClusterData.y;
        float bladeWidth = bladeData.z * bladeClusterData.z;
        float bladeHash = fract(
          bladeData.w + sin(bladeClusterData.x * 2.31) * 0.371
        );
        vec3 resolvedBladeOrigin = vec3(
          originXZ.x,
          bladeOrigin.y,
          originXZ.y
        );`
    : detail
      ? `vec2 detailCell = bladeOrigin.xz + uDetailCell;
        vec2 detailJitter = vec2(
          grassHash(detailCell, 7.31),
          grassHash(detailCell, 19.73)
        ) - 0.5;
        vec2 originXZ = (detailCell + detailJitter * 0.76) * uDetailSpacing;
        float bladeAngle = grassHash(detailCell, 3.17) * ${TAU.toFixed(8)};
        float bladeHeight = mix(0.64, 1.12, grassHash(detailCell, 11.41));
        bladeHeight *= mix(0.92, 1.08, grassHash(floor(detailCell * 0.11), 4.9));
        bladeHeight *= uDetailHeightScale;
        float bladeWidth = mix(0.034, 0.061, grassHash(detailCell, 23.57));
        bladeWidth *= uDetailWidthScale;
        float bladeHash = grassHash(detailCell, 41.93);
        vec3 resolvedBladeOrigin = vec3(
          originXZ.x,
          sampleGrassTerrain(originXZ) + 0.025,
          originXZ.y
        );`
      : `vec2 originXZ = bladeOrigin.xz;
        float bladeAngle = bladeData.x;
        float bladeHeight = bladeData.y;
        float bladeWidth = bladeData.z;
        float bladeHash = bladeData.w;
        vec3 resolvedBladeOrigin = bladeOrigin;`;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
    dithering: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 bladeOrigin;
        ${detail ? '' : 'attribute vec4 bladeData;'}
        ${clustered
    ? 'attribute vec2 bladeClusterOffset; attribute vec3 bladeClusterData;'
    : ''}
        uniform float uTime, uTerrainSize;
        uniform sampler2D uWindNoise;
        uniform vec2 uWindDirection;
        uniform int uFlattenerCount;
        uniform vec4 uFlatteners[${MAX_FLATTENERS}];
        varying float vBladeHeight, vBladeHash, vBladeDistance, vDetailDistance;
        varying float vGustLight, vSoftLod;
        varying vec2 vDensityUv;
        varying vec3 vGrassWorld;
        ${detailCommon}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        ${normalSetup}
        vec2 grassNormalXZ = vec2(sin(grassBladeAngle), cos(grassBladeAngle));
        objectNormal = normalize(vec3(
          grassNormalXZ.x,
          objectNormal.y * 0.18,
          grassNormalXZ.y
        ));`,
      )
      .replace(
        '#include <begin_vertex>',
        `${originSetup}
        vec2 toCamera = cameraPosition.xz - originXZ;
        float cameraDistance = length(toCamera);
        float geometrySoftLod = ${clustered
    ? 'smoothstep(82.0, 150.0, cameraDistance)'
    : detail
      ? ring
        ? 'smoothstep(68.0, 81.0, length(originXZ - uDetailFocus))'
        : '0.0'
      : 'smoothstep(24.0, 48.0, cameraDistance)'};
        bladeHeight *= mix(1.0, ${clustered ? '0.48' : '0.12'}, geometrySoftLod);
        bladeWidth *= mix(1.0, ${clustered ? '1.78' : '2.15'}, geometrySoftLod);
        vec2 viewDirection = toCamera / max(cameraDistance, 0.001);
        float billboardLod = smoothstep(48.0, 72.0, cameraDistance);
        vec2 bladeSide = vec2(cos(bladeAngle), -sin(bladeAngle));
        vec2 cameraSide = vec2(viewDirection.y, -viewDirection.x);
        cameraSide *= mix(-1.0, 1.0, step(0.0, dot(bladeSide, cameraSide)));
        bladeSide = normalize(mix(bladeSide, cameraSide, billboardLod * 0.94));
        vec2 bladeNormal = vec2(-bladeSide.y, bladeSide.x);
        float grazing = 1.0 - abs(dot(bladeNormal, viewDirection));
        vec2 windUv = originXZ * 0.011
          - uWindDirection * uTime * 0.0396;
        float gustA = texture2D(uWindNoise, windUv).r;
        float gustB = texture2D(
          uWindNoise,
          originXZ * 0.027 - uWindDirection * uTime * 0.0972
        ).r;
        float gustFront = smoothstep(0.46, 0.69, gustA * 0.72 + gustB * 0.28);
        float globalSway = sin(
          uTime * 0.72 + dot(originXZ, vec2(0.031, 0.047))
        ) * 0.5 + 0.5;
        float turbulence = sin(
          uTime * 3.2 + bladeHash * 31.4 + originXZ.x * 0.83
        ) * 0.5 + 0.5;
        float windAmount = 0.19 + globalSway * 0.13
          + gustFront * 0.51 + turbulence * 0.10
          + gustFront * smoothstep(0.65, 1.50, length(uWindDirection)) * 0.18;
        vec2 interactionDirection = vec2(0.0);
        float flatten = 0.0;
        for (int i = 0; i < ${MAX_FLATTENERS}; i++) {
          if (i >= uFlattenerCount) break;
          vec2 delta = originXZ - uFlatteners[i].xy;
          float radius = uFlatteners[i].z;
          // Outside the circle smoothstep is exactly zero. Nearly all world
          // blades are outside the player's footprint and fading trail, so
          // avoid their per-vertex square roots and normalization entirely.
          if (dot(delta, delta) >= radius * radius) continue;
          float influence = smoothstep(
            radius,
            0.0,
            length(delta)
          ) * uFlatteners[i].w;
          interactionDirection += normalize(delta + vec2(0.0001)) * influence;
          flatten = max(flatten, influence);
        }
        vec2 staticLeanDirection = vec2(
          cos(bladeAngle + bladeHash * 4.7),
          sin(bladeAngle + bladeHash * 4.7)
        );
        vec2 staticLean = staticLeanDirection * bladeHeight
          * mix(0.07, 0.21, fract(bladeHash * 13.71));
        float responseAngle = (bladeHash - 0.5) * 0.58
          + (gustB - 0.5) * 0.16;
        float responseCosine = cos(responseAngle);
        float responseSine = sin(responseAngle);
        vec2 localWindDirection = vec2(
          uWindDirection.x * responseCosine
            - uWindDirection.y * responseSine,
          uWindDirection.x * responseSine
            + uWindDirection.y * responseCosine
        );
        float windResponse = mix(
          0.70,
          1.15,
          fract(bladeHash * 19.37 + 0.23)
        );
        vec2 windBend = localWindDirection * bladeHeight
          * windAmount * windResponse;
        vec2 interactionBend = normalize(
          interactionDirection + vec2(0.0001)
        ) * bladeHeight * flatten * 0.66;
        vec2 totalBend = staticLean + windBend + interactionBend;
        float bendRatio = min(length(totalBend) / bladeHeight, 1.0);
        float compressedHeight = bladeHeight * (
          1.0 - bendRatio * bendRatio * 0.20 - flatten * 0.19
        );
        float bladeT = position.y;
        vec3 p0 = vec3(0.0);
        vec3 p1 = vec3(
          totalBend.x * 0.18,
          compressedHeight * 0.56,
          totalBend.y * 0.18
        );
        vec3 p2 = vec3(totalBend.x, compressedHeight, totalBend.y);
        vec3 center = pow(1.0 - bladeT, 2.0) * p0
          + 2.0 * (1.0 - bladeT) * bladeT * p1
          + bladeT * bladeT * p2;
        center.xz += vec2(-uWindDirection.y, uWindDirection.x)
          * (bladeHash - 0.5) * bladeHeight * 0.09 * bladeT * bladeT;
        float viewWidth = mix(1.0, 1.32, grazing);
        float lodWidth = mix(1.0, 1.82, billboardLod);
        vec2 widthOffset = bladeSide * position.x * bladeWidth
          * viewWidth * lodWidth;
        vec3 transformed = resolvedBladeOrigin + vec3(
          center.x + widthOffset.x,
          center.y,
          center.z + widthOffset.y
        );
        vBladeHeight = bladeT;
        vBladeHash = bladeHash;
        vBladeDistance = cameraDistance;
        vDetailDistance = ${detail ? 'length(originXZ - uDetailFocus)' : '0.0'};
        vGustLight = clamp(
          gustA * 0.62 + gustB * 0.24 + globalSway * 0.14,
          0.0,
          1.0
        );
        vSoftLod = geometrySoftLod;
        vDensityUv = vec2(
          originXZ.x / uTerrainSize + 0.5,
          0.5 - originXZ.y / uTerrainSize
        );
        vGrassWorld = transformed;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uDensityMask;
        uniform vec3 uRootColor, uTipColor, uFarColor, uSunDirection;
        ${detail
    ? `uniform float uDetailInnerRadius, uDetailOuterRadius;
        ${ring ? 'uniform float uDetailCoreRadius, uDetailOuterFadeStart;' : ''}`
    : ''}
        varying float vBladeHeight, vBladeHash, vBladeDistance, vDetailDistance;
        varying float vGustLight, vSoftLod;
        varying vec2 vDensityUv;
        varying vec3 vGrassWorld;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (
          vDensityUv.x <= 0.001 || vDensityUv.x >= 0.999
          || vDensityUv.y <= 0.001 || vDensityUv.y >= 0.999
        ) discard;
        float density = texture2D(uDensityMask, vDensityUv).r;
        float distanceKeep = ${clustered
    ? 'mix(1.0, 0.18, smoothstep(78.0, 148.0, vBladeDistance))'
    : detail
      ? ring
        ? `smoothstep(uDetailCoreRadius, uDetailInnerRadius, vDetailDistance)
        * (1.0 - smoothstep(
          uDetailOuterFadeStart,
          uDetailOuterRadius,
          vDetailDistance
        ))`
        : '1.0 - smoothstep(uDetailInnerRadius, uDetailOuterRadius, vDetailDistance)'
      : '1.0 - smoothstep(27.0, 52.0, vBladeDistance)'};
        distanceKeep *= ${clustered
    ? '1.0'
    : '1.0 - smoothstep(0.42, 0.90, vSoftLod)'};
        // A zero-valued hash should not leave a stray opaque blade beyond a
        // fully faded ring. This also makes the CPU detail-cell cutoff exact.
        if (distanceKeep <= 0.0) discard;
        float fadeHash = fract(vBladeHash * 37.13 + 0.17);
        if (fadeHash > density * distanceKeep) discard;
        vec3 grassColor = mix(
          uRootColor,
          uTipColor,
          smoothstep(0.02, 0.94, vBladeHeight)
        );
        grassColor *= mix(0.94, 1.10, fract(vBladeHash * 17.31));
        grassColor *= mix(0.88, 1.11, vGustLight);
        grassColor = mix(grassColor, uFarColor, vSoftLod * 0.74);
        diffuseColor.rgb *= grassColor;`,
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        `vec3 grassView = normalize(cameraPosition - vGrassWorld);
        float grassBacklight = pow(
          saturate(dot(-grassView, normalize(uSunDirection))),
          4.0
        );
        vec3 transmissionGlow = uTipColor * grassBacklight
          * pow(vBladeHeight, 2.0) * 0.26;
        vec3 outgoingLight = totalDiffuse + totalSpecular
          + totalEmissiveRadiance + transmissionGlow;
        outgoingLight = mix(
          outgoingLight,
          uFarColor * mix(0.90, 1.08, vGustLight),
          vSoftLod * 0.82
        );`,
      );
  };

  material.customProgramCacheKey = () => `pastoral-grass-lod-v9-${
    clustered ? 'world-cluster' : detail ? (ring ? 'medium-ring' : 'detail') : 'far'
  }`;
  material.userData.uniforms = uniforms;
  return material;
}

function createFarClusterMaterial(sharedUniforms, clusterTexture) {
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: sharedUniforms.uTime,
    uTerrainSize: sharedUniforms.uTerrainSize,
    uWindNoise: sharedUniforms.uWindNoise,
    uWindDirection: sharedUniforms.uWindDirection,
    uDensityMask: sharedUniforms.uDensityMask,
    uRootColor: sharedUniforms.uRootColor,
    uTipColor: sharedUniforms.uTipColor,
    uFarColor: sharedUniforms.uFarColor,
    uClusterTexture: { value: clusterTexture },
  };

  const material = new THREE.ShaderMaterial({
    name: 'SoftDistantMeadowMaterial',
    uniforms,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>

      attribute vec3 clusterOrigin;
      attribute vec4 clusterData;
      attribute vec2 clusterSlope;
      uniform float uTime;
      uniform float uTerrainSize;
      uniform sampler2D uWindNoise;
      uniform vec2 uWindDirection;
      varying vec2 vCardUv;
      varying vec2 vDensityUv;
      varying float vCameraDistance;
      varying float vClusterHash;
      varying float vGustLight;

      void main() {
        vec2 toCamera = cameraPosition.xz - clusterOrigin.xz;
        float cameraDistance = length(toCamera);
        float cosine = cos(clusterData.z);
        float sine = sin(clusterData.z);
        vec2 localOffset = vec2(
          position.x * clusterData.x,
          position.y * clusterData.y
        );
        vec2 worldOffset = vec2(
          localOffset.x * cosine - localOffset.y * sine,
          localOffset.x * sine + localOffset.y * cosine
        );
        vec2 worldXZ = clusterOrigin.xz + worldOffset;
        float broadGust = texture2D(
          uWindNoise,
          clusterOrigin.xz * 0.011 - uWindDirection * uTime * 0.0396
        ).r;
        float detailGust = texture2D(
          uWindNoise,
          clusterOrigin.xz * 0.027 - uWindDirection * uTime * 0.0972
        ).r;
        vec3 worldPosition = vec3(
          worldXZ.x,
          clusterOrigin.y
            - clusterSlope.x * worldOffset.x
            - clusterSlope.y * worldOffset.y,
          worldXZ.y
        );
        vec4 mvPosition = viewMatrix * vec4(worldPosition, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vCardUv = uv;
        vDensityUv = vec2(
          worldXZ.x / uTerrainSize + 0.5,
          0.5 - worldXZ.y / uTerrainSize
        );
        vCameraDistance = cameraDistance;
        vClusterHash = clusterData.w;
        vGustLight = broadGust * 0.76 + detailGust * 0.24;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <dithering_pars_fragment>
      #include <fog_pars_fragment>

      uniform sampler2D uClusterTexture;
      uniform sampler2D uDensityMask;
      uniform vec3 uRootColor;
      uniform vec3 uTipColor;
      uniform vec3 uFarColor;
      varying vec2 vCardUv;
      varying vec2 vDensityUv;
      varying float vCameraDistance;
      varying float vClusterHash;
      varying float vGustLight;

      void main() {
        if (
          vDensityUv.x <= 0.001 || vDensityUv.x >= 0.999
          || vDensityUv.y <= 0.001 || vDensityUv.y >= 0.999
        ) discard;

        // Soft cards only start contributing beyond the detailed grass field.
        // Reject their near-field pixels before five filtered atlas reads;
        // the original alpha is exactly zero wherever farBlend is zero.
        float farBlend = smoothstep(34.0, 72.0, vCameraDistance);
        if (farBlend <= 0.0) discard;

        float blurRadius = mix(
          0.006,
          0.026,
          smoothstep(26.0, 105.0, vCameraDistance)
        );
        float clusterShape = texture2D(uClusterTexture, vCardUv).a * 0.36;
        clusterShape += texture2D(
          uClusterTexture, vCardUv + vec2(blurRadius, 0.0)
        ).a * 0.16;
        clusterShape += texture2D(
          uClusterTexture, vCardUv - vec2(blurRadius, 0.0)
        ).a * 0.16;
        clusterShape += texture2D(
          uClusterTexture, vCardUv + vec2(0.0, blurRadius)
        ).a * 0.16;
        clusterShape += texture2D(
          uClusterTexture, vCardUv - vec2(0.0, blurRadius)
        ).a * 0.16;
        float density = texture2D(uDensityMask, vDensityUv).r;
        float alpha = clusterShape * density * farBlend * 0.34;
        if (alpha < 0.004) discard;

        vec3 meadowColor = mix(uFarColor, uTipColor, 0.42);
        meadowColor *= mix(0.94, 1.08, fract(vClusterHash * 31.71));
        meadowColor *= mix(0.94, 1.08, vGustLight);
        gl_FragColor = vec4(meadowColor, alpha * 0.86);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
        #include <premultiplied_alpha_fragment>
        #include <dithering_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: true,
    dithering: true,
  });
  material.forceSinglePass = true;
  return material;
}

function createBladeClusterGeometry(bladesPerCluster = BLADES_PER_MEADOW_CLUSTER) {
  const dense = bladesPerCluster > BLADES_PER_MEADOW_CLUSTER;
  const bladePositions = dense ? [
    -0.50, 0, 0, 0.50, 0, 0, 0, 1, 0,
  ] : [
    -0.50, 0.00, 0, 0.50, 0.00, 0,
    -0.43, 0.36, 0, 0.43, 0.36, 0,
    -0.22, 0.72, 0, 0.22, 0.72, 0,
     0.00, 1.00, 0,
  ];
  const bladeUvs = dense ? [0, 0, 1, 0, 0.5, 1] : [
    0, 0, 1, 0, 0.07, 0.36, 0.93, 0.36, 0.28, 0.72, 0.72, 0.72, 0.5, 1,
  ];
  const bladeIndices = dense ? [0, 1, 2]
    : [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6];
  const profiles = [
    [-0.18, -0.12, 0.18, 1.00, 1.00],
    [0.17, -0.16, 1.73, 0.82, 0.92],
    [-0.12, 0.19, 3.16, 1.09, 0.84],
    [0.19, 0.16, 4.82, 0.94, 1.08],
  ];
  // Extra blades spiral away from the original four roots. Keeping the same
  // instanced origin count avoids a tenfold terrain-sampling and upload cost;
  // the wider fan fills the gaps between the original meadow clusters.
  for (let index = profiles.length; index < bladesPerCluster; index += 1) {
    const radius = 0.12 + Math.sqrt((index - 3) / Math.max(1, bladesPerCluster - 3)) * 1.02;
    const angle = index * 2.399963229728653;
    profiles.push([
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      angle,
      0.73 + hash(index, 42) * 0.36,
      0.73 + hash(index, 43) * 0.29,
    ]);
  }
  const positions = [];
  const uvs = [];
  const clusterOffsets = [];
  const clusterData = [];
  const indices = [];

  profiles.forEach((profile, profileIndex) => {
    const vertexOffset = profileIndex * (dense ? 3 : 7);
    positions.push(...bladePositions);
    uvs.push(...bladeUvs);
    for (let vertex = 0; vertex < (dense ? 3 : 7); vertex += 1) {
      clusterOffsets.push(profile[0], profile[1]);
      clusterData.push(profile[2], profile[3], profile[4]);
    }
    bladeIndices.forEach((index) => indices.push(index + vertexOffset));
  });

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    'bladeClusterOffset',
    new THREE.Float32BufferAttribute(clusterOffsets, 2),
  );
  geometry.setAttribute(
    'bladeClusterData',
    new THREE.Float32BufferAttribute(clusterData, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createMeadowTuftMaterial(sharedUniforms, tuftTexture) {
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: sharedUniforms.uTime,
    uTerrainSize: sharedUniforms.uTerrainSize,
    uWindNoise: sharedUniforms.uWindNoise,
    uWindDirection: sharedUniforms.uWindDirection,
    uDensityMask: sharedUniforms.uDensityMask,
    uRootColor: sharedUniforms.uRootColor,
    uTipColor: sharedUniforms.uTipColor,
    uFarColor: sharedUniforms.uFarColor,
    uDetailFocus: sharedUniforms.uDetailFocus,
    uDetailInnerRadius: sharedUniforms.uDetailInnerRadius,
    uDetailOuterRadius: sharedUniforms.uDetailOuterRadius,
    uFlattenerCount: sharedUniforms.uFlattenerCount,
    uFlatteners: sharedUniforms.uFlatteners,
    uTuftTexture: { value: tuftTexture },
  };

  const material = new THREE.ShaderMaterial({
    name: 'ContinuousWorldMeadowMaterial',
    uniforms,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>

      attribute vec3 tuftOrigin;
      attribute vec4 tuftData;
      uniform float uTime;
      uniform float uTerrainSize;
      uniform sampler2D uWindNoise;
      uniform vec2 uWindDirection;
      uniform vec2 uDetailFocus;
      uniform float uDetailInnerRadius;
      uniform float uDetailOuterRadius;
      uniform int uFlattenerCount;
      uniform vec4 uFlatteners[${MAX_FLATTENERS}];
      varying vec2 vTuftUv;
      varying vec2 vLocalTuftUv;
      varying vec2 vDensityUv;
      varying float vCameraDistance;
      varying float vDetailDistance;
      varying float vTuftHash;
      varying float vGustLight;

      void main() {
        float cosine = cos(tuftData.z);
        float sine = sin(tuftData.z);
        vec2 localOffset = position.xz * tuftData.x;
        vec2 rotatedOffset = vec2(
          localOffset.x * cosine - localOffset.y * sine,
          localOffset.x * sine + localOffset.y * cosine
        );
        float broadGust = texture2D(
          uWindNoise,
          tuftOrigin.xz * 0.011 - uWindDirection * uTime * 0.0396
        ).r;
        float detailGust = texture2D(
          uWindNoise,
          tuftOrigin.xz * 0.027 - uWindDirection * uTime * 0.0972
        ).r;
        float topWeight = position.y * position.y;
        vec2 interactionDirection = vec2(0.0);
        float flatten = 0.0;
        for (int i = 0; i < ${MAX_FLATTENERS}; i++) {
          if (i >= uFlattenerCount) break;
          vec2 delta = tuftOrigin.xz - uFlatteners[i].xy;
          float radius = uFlatteners[i].z;
          if (dot(delta, delta) >= radius * radius) continue;
          float influence = smoothstep(
            radius,
            0.0,
            length(delta)
          ) * uFlatteners[i].w;
          interactionDirection += normalize(delta + vec2(0.0001)) * influence;
          flatten = max(flatten, influence);
        }
        float tuftHeight = tuftData.y;
        vec2 windBend = uWindDirection * tuftHeight
          * (0.075 + broadGust * 0.18 + detailGust * 0.065) * topWeight;
        vec2 interactionBend = normalize(
          interactionDirection + vec2(0.0001)
        ) * tuftHeight * flatten * 0.72 * topWeight;
        vec2 worldXZ = tuftOrigin.xz + rotatedOffset
          + windBend + interactionBend;
        float worldY = tuftOrigin.y + position.y * tuftHeight
          * (1.0 - flatten * 0.48);
        vec3 worldPosition = vec3(worldXZ.x, worldY, worldXZ.y);
        vec4 mvPosition = viewMatrix * vec4(worldPosition, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float atlasVariant = floor(tuftData.w * 4.0);
        vec2 atlasCell = vec2(
          mod(atlasVariant, 2.0),
          floor(atlasVariant * 0.5)
        );
        vTuftUv = (atlasCell * 128.0 + vec2(6.0) + uv * 116.0) / 256.0;
        vLocalTuftUv = uv;
        vDensityUv = vec2(
          worldXZ.x / uTerrainSize + 0.5,
          0.5 - worldXZ.y / uTerrainSize
        );
        vCameraDistance = length(cameraPosition.xz - tuftOrigin.xz);
        vDetailDistance = length(tuftOrigin.xz - uDetailFocus);
        vTuftHash = tuftData.w;
        vGustLight = broadGust * 0.76 + detailGust * 0.24;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <dithering_pars_fragment>
      #include <fog_pars_fragment>

      uniform sampler2D uTuftTexture;
      uniform sampler2D uDensityMask;
      uniform vec3 uRootColor;
      uniform vec3 uTipColor;
      uniform vec3 uFarColor;
      uniform float uDetailInnerRadius;
      uniform float uDetailOuterRadius;
      varying vec2 vTuftUv;
      varying vec2 vLocalTuftUv;
      varying vec2 vDensityUv;
      varying float vCameraDistance;
      varying float vDetailDistance;
      varying float vTuftHash;
      varying float vGustLight;

      void main() {
        if (
          vDensityUv.x <= 0.001 || vDensityUv.x >= 0.999
          || vDensityUv.y <= 0.001 || vDensityUv.y >= 0.999
        ) discard;

        float farLod = smoothstep(32.0, 105.0, vCameraDistance);
        float blurRadius = mix(0.001, 0.007, farLod);
        float tuftShape = texture2D(uTuftTexture, vTuftUv).a * 0.52;
        tuftShape += texture2D(
          uTuftTexture, vTuftUv + vec2(blurRadius, 0.0)
        ).a * 0.12;
        tuftShape += texture2D(
          uTuftTexture, vTuftUv - vec2(blurRadius, 0.0)
        ).a * 0.12;
        tuftShape += texture2D(
          uTuftTexture, vTuftUv + vec2(0.0, blurRadius)
        ).a * 0.12;
        tuftShape += texture2D(
          uTuftTexture, vTuftUv - vec2(0.0, blurRadius)
        ).a * 0.12;
        float density = texture2D(uDensityMask, vDensityUv).r;
        float edgeFade = smoothstep(0.01, 0.10, vLocalTuftUv.x)
          * (1.0 - smoothstep(0.90, 0.99, vLocalTuftUv.x));
        float coverage = tuftShape * density * edgeFade;
        float threshold = mix(0.075, 0.032, farLod);
        float ditherNoise = fract(sin(dot(
          gl_FragCoord.xy + vec2(vTuftHash * 91.7),
          vec2(12.9898, 78.233)
        )) * 43758.5453);
        // The world meadow is the continuous long-range coverage layer. Where
        // the high-detail blade field is fully resident, stochastic thinning
        // lets those true blade silhouettes take over without exposing soil or
        // introducing a hard LOD ring.
        float detailBladeTakeover = smoothstep(
          uDetailInnerRadius,
          uDetailOuterRadius,
          vDetailDistance
        );
        float takeoverNoise = fract(sin(dot(
          floor(vLocalTuftUv * 64.0) + vec2(vTuftHash * 127.7),
          vec2(41.13, 289.71)
        )) * 43758.5453);
        if (takeoverNoise > detailBladeTakeover) discard;
        threshold += (ditherNoise - 0.5) * mix(0.034, 0.014, farLod);
        if (coverage < threshold) discard;

        vec3 meadowColor = mix(
          uRootColor,
          uFarColor,
          0.18 + smoothstep(0.05, 0.96, vTuftUv.y) * 0.24
        );
        meadowColor *= mix(0.91, 1.07, fract(vTuftHash * 29.17));
        meadowColor *= mix(0.92, 1.07, vGustLight);
        meadowColor = mix(meadowColor, uFarColor, farLod * 0.30);
        gl_FragColor = vec4(meadowColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
        #include <dithering_fragment>
      }
    `,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: true,
    dithering: true,
  });
  return material;
}

function setIdentityInstanceMatrices(mesh) {
  const matrices = mesh.instanceMatrix.array;
  for (let index = 0; index < mesh.count; index += 1) {
    const offset = index * 16;
    matrices[offset] = 1;
    matrices[offset + 5] = 1;
    matrices[offset + 10] = 1;
    matrices[offset + 15] = 1;
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
}

function densityAtWorld(data, terrainSize, x, z) {
  const column = THREE.MathUtils.clamp(
    Math.floor((x / terrainSize + 0.5) * MASK_SIZE),
    0,
    MASK_SIZE - 1,
  );
  const row = THREE.MathUtils.clamp(
    Math.floor((0.5 - z / terrainSize) * MASK_SIZE),
    0,
    MASK_SIZE - 1,
  );
  return data[row * MASK_SIZE + column] / 255;
}

function createFarField({
  terrain,
  farCount,
  chunkDivisions,
  densityData,
  material,
}) {
  const group = new THREE.Group();
  group.name = 'CulledFarGrass';
  const buckets = Array.from(
    { length: chunkDivisions * chunkDivisions },
    () => ({
      origins: [],
      bladeData: [],
      minimum: new THREE.Vector3(Infinity, Infinity, Infinity),
      maximum: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
    }),
  );
  const gridSize = Math.ceil(Math.sqrt(farCount * 1.22));
  const cellCount = gridSize * gridSize;
  const cellSize = terrain.size / gridSize;
  const halfSize = terrain.size * 0.5;
  const chunkSize = terrain.size / chunkDivisions;
  let accepted = 0;

  for (let step = 0; step < cellCount && accepted < farCount; step += 1) {
    const cell = (step * 104729) % cellCount;
    const column = cell % gridSize;
    const row = Math.floor(cell / gridSize);
    const x = -halfSize + (column + 0.16 + hash(cell, 1) * 0.68) * cellSize;
    const z = -halfSize + (row + 0.16 + hash(cell, 2) * 0.68) * cellSize;
    const density = densityAtWorld(densityData, terrain.size, x, z);
    if (hash(cell, 7) > density) continue;

    const y = terrain.heightAt(x, z) + 0.018;
    const chunkX = THREE.MathUtils.clamp(
      Math.floor((x + halfSize) / chunkSize),
      0,
      chunkDivisions - 1,
    );
    const chunkZ = THREE.MathUtils.clamp(
      Math.floor((z + halfSize) / chunkSize),
      0,
      chunkDivisions - 1,
    );
    const bucket = buckets[chunkZ * chunkDivisions + chunkX];
    bucket.origins.push(x, y, z);
    bucket.bladeData.push(
      hash(cell, 3) * TAU,
      THREE.MathUtils.lerp(0.40, 0.79, hash(cell, 4)),
      THREE.MathUtils.lerp(0.038, 0.067, hash(cell, 5)),
      hash(cell, 6),
    );
    bucket.minimum.x = Math.min(bucket.minimum.x, x);
    bucket.minimum.y = Math.min(bucket.minimum.y, y);
    bucket.minimum.z = Math.min(bucket.minimum.z, z);
    bucket.maximum.x = Math.max(bucket.maximum.x, x);
    bucket.maximum.y = Math.max(bucket.maximum.y, y);
    bucket.maximum.z = Math.max(bucket.maximum.z, z);
    accepted += 1;
  }

  const meshes = [];
  const geometries = [];
  buckets.forEach((bucket, index) => {
    const count = bucket.origins.length / 3;
    if (count === 0) return;

    const geometry = createBladeGeometry();
    geometry.setAttribute(
      'bladeOrigin',
      new THREE.InstancedBufferAttribute(new Float32Array(bucket.origins), 3),
    );
    geometry.setAttribute(
      'bladeData',
      new THREE.InstancedBufferAttribute(new Float32Array(bucket.bladeData), 4),
    );
    geometry.boundingBox = new THREE.Box3(
      bucket.minimum.clone().add(new THREE.Vector3(-1.4, -0.1, -1.4)),
      bucket.maximum.clone().add(new THREE.Vector3(1.4, 1.3, 1.4)),
    );
    geometry.boundingSphere = new THREE.Sphere();
    geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `FarGrassChunk-${index}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    setIdentityInstanceMatrices(mesh);
    group.add(mesh);
    meshes.push(mesh);
    geometries.push(geometry);
  });

  return { group, meshes, geometries, accepted };
}

function createContinuousMeadowField({
  terrain,
  tuftCount,
  bladesPerCluster,
  chunkDivisions,
  densityData,
  material,
}) {
  const group = new THREE.Group();
  group.name = 'ContinuousChunkedMeadow';
  const buckets = Array.from(
    { length: chunkDivisions * chunkDivisions },
    () => ({
      origins: [],
      bladeData: [],
      minimum: new THREE.Vector3(Infinity, Infinity, Infinity),
      maximum: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
    }),
  );
  // Sampling directly in world space avoids the subtle lattice that remains
  // visible when a jittered grid is viewed obliquely or while the camera moves.
  // The generous candidate pool accounts for roads and authored clearings.
  const candidateCount = Math.ceil(tuftCount * 2.4);
  const halfSize = terrain.size * 0.5;
  const chunkSize = terrain.size / chunkDivisions;
  let accepted = 0;

  for (let step = 0; step < candidateCount && accepted < tuftCount; step += 1) {
    const sample = step * 65537;
    const x = -halfSize + hash(sample, 71) * terrain.size;
    const z = -halfSize + hash(sample, 72) * terrain.size;
    const density = densityAtWorld(densityData, terrain.size, x, z);
    if (hash(sample, 73) > density) continue;

    const y = terrain.heightAt(x, z) + 0.018;
    const chunkX = THREE.MathUtils.clamp(
      Math.floor((x + halfSize) / chunkSize),
      0,
      chunkDivisions - 1,
    );
    const chunkZ = THREE.MathUtils.clamp(
      Math.floor((z + halfSize) / chunkSize),
      0,
      chunkDivisions - 1,
    );
    const bucket = buckets[chunkZ * chunkDivisions + chunkX];
    bucket.origins.push(x, y, z);
    bucket.bladeData.push(
      hash(sample, 76) * TAU,
      THREE.MathUtils.lerp(0.66, 1.06, hash(sample, 75)),
      THREE.MathUtils.lerp(0.039, 0.066, hash(sample, 74)),
      hash(sample, 77),
    );
    bucket.minimum.x = Math.min(bucket.minimum.x, x);
    bucket.minimum.y = Math.min(bucket.minimum.y, y);
    bucket.minimum.z = Math.min(bucket.minimum.z, z);
    bucket.maximum.x = Math.max(bucket.maximum.x, x);
    bucket.maximum.y = Math.max(bucket.maximum.y, y);
    bucket.maximum.z = Math.max(bucket.maximum.z, z);
    accepted += 1;
  }

  const meshes = [];
  const geometries = [];
  buckets.forEach((bucket, index) => {
    const count = bucket.origins.length / 3;
    if (count === 0) return;
    const geometry = createBladeClusterGeometry(bladesPerCluster);
    geometry.setAttribute(
      'bladeOrigin',
      new THREE.InstancedBufferAttribute(new Float32Array(bucket.origins), 3),
    );
    geometry.setAttribute(
      'bladeData',
      new THREE.InstancedBufferAttribute(new Float32Array(bucket.bladeData), 4),
    );
    geometry.boundingBox = new THREE.Box3(
      bucket.minimum.clone().add(new THREE.Vector3(-2.7, -0.1, -2.7)),
      bucket.maximum.clone().add(new THREE.Vector3(2.7, 1.3, 2.7)),
    );
    geometry.boundingSphere = new THREE.Sphere();
    geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);

    // bladeOrigin and bladeData already locate every cluster in world space.
    // A plain mesh with instanced geometry avoids uploading one redundant
    // 64-byte identity transform per authored cluster.
    geometry.instanceCount = count;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `WorldBladeClusterChunk-${index}`;
    mesh.userData.authoredGrassInstanceCount = count;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
    geometries.push(geometry);
  });

  return { group, meshes, geometries, accepted };
}

function createGrassDensityGovernor(meshes, qualityProfile, bladesPerCluster) {
  const steps = qualityProfile.densitySteps;
  let authoredClusterCount = 0;
  for (let index = 0; index < meshes.length; index += 1) {
    authoredClusterCount += meshes[index].userData.authoredGrassInstanceCount;
  }

  let densityStepIndex = 0;
  let closestStepDistance = Infinity;
  for (let index = 0; index < steps.length; index += 1) {
    const distance = Math.abs(
      steps[index] - qualityProfile.initialDensityScale,
    );
    if (distance < closestStepDistance) {
      densityStepIndex = index;
      closestStepDistance = distance;
    }
  }

  let renderedClusterCount = authoredClusterCount;
  let renderedDensityScale = 1;
  let frameTimeEma = 1 / 60;
  let warmupRemaining = GOVERNOR_WARMUP_SECONDS;
  let windowElapsed = 0;
  let windowFrameTimeTotal = 0;
  let windowFrameCount = 0;
  let slowWindowCount = 0;
  let fastWindowCount = 0;
  let settleWindowCount = 0;
  let ignoredFrameSamples = 0;
  let adaptationCount = 0;
  let state = 'warming';
  let lastAdjustment = 'initial';

  function applyDensityStep() {
    const targetScale = steps[densityStepIndex];
    let nextRenderedClusterCount = 0;

    for (let index = 0; index < meshes.length; index += 1) {
      const mesh = meshes[index];
      const authoredCount = mesh.userData.authoredGrassInstanceCount;
      const renderedCount = Math.max(
        1,
        Math.min(authoredCount, Math.round(authoredCount * targetScale)),
      );
      mesh.geometry.instanceCount = renderedCount;
      nextRenderedClusterCount += renderedCount;
    }

    renderedClusterCount = nextRenderedClusterCount;
    renderedDensityScale = authoredClusterCount > 0
      ? renderedClusterCount / authoredClusterCount
      : 0;
  }

  function resetWindow() {
    windowElapsed = 0;
    windowFrameTimeTotal = 0;
    windowFrameCount = 0;
  }

  function stepDown() {
    if (densityStepIndex <= 0) {
      state = 'minimum';
      return false;
    }
    densityStepIndex -= 1;
    applyDensityStep();
    adaptationCount += 1;
    lastAdjustment = 'down';
    settleWindowCount = 2;
    slowWindowCount = 0;
    fastWindowCount = 0;
    state = 'settling';
    return true;
  }

  function stepUp() {
    if (densityStepIndex >= steps.length - 1) {
      state = 'maximum';
      return false;
    }
    densityStepIndex += 1;
    applyDensityStep();
    adaptationCount += 1;
    lastAdjustment = 'up';
    settleWindowCount = 3;
    slowWindowCount = 0;
    fastWindowCount = 0;
    state = 'settling';
    return true;
  }

  function evaluateWindow() {
    if (windowFrameCount === 0) {
      resetWindow();
      return;
    }

    const averageFrameTime = windowFrameTimeTotal / windowFrameCount;
    resetWindow();

    if (settleWindowCount > 0) {
      settleWindowCount -= 1;
      slowWindowCount = 0;
      fastWindowCount = 0;
      state = 'settling';
      return;
    }

    if (averageFrameTime > GOVERNOR_SLOW_FRAME_SECONDS) {
      slowWindowCount += 1;
      fastWindowCount = 0;
      state = 'pressure';
      if (slowWindowCount >= GOVERNOR_SLOW_WINDOWS_TO_STEP_DOWN) stepDown();
      return;
    }

    if (averageFrameTime < GOVERNOR_FAST_FRAME_SECONDS) {
      fastWindowCount += 1;
      slowWindowCount = 0;
      state = densityStepIndex < steps.length - 1 ? 'stable' : 'maximum';
      if (fastWindowCount >= GOVERNOR_FAST_WINDOWS_TO_STEP_UP) stepUp();
      return;
    }

    slowWindowCount = Math.max(0, slowWindowCount - 1);
    fastWindowCount = 0;
    state = 'monitoring';
  }

  function sample(deltaSeconds) {
    if (
      !qualityProfile.adaptive
      || !Number.isFinite(deltaSeconds)
      || deltaSeconds <= 0
    ) return;

    // Hidden tabs and suspended pages can report seconds-long gaps that say
    // nothing about rendering pressure. A visible page stuck at a sustained
    // low frame rate must still reach the governor instead of being ignored
    // forever by the ordinary hitch filter.
    if (deltaSeconds > GOVERNOR_MAX_VALID_DELTA
      && typeof document !== 'undefined'
      && document.visibilityState === 'hidden') {
      ignoredFrameSamples += 1;
      return;
    }

    const slowFrame = deltaSeconds > GOVERNOR_MAX_VALID_DELTA;
    const sampledDelta = Math.min(deltaSeconds,
      slowFrame ? GOVERNOR_MAX_SLOW_DELTA : GOVERNOR_MAX_SAMPLED_DELTA);
    const emaBlend = Math.min(1, sampledDelta / 1.5);
    frameTimeEma += (sampledDelta - frameTimeEma) * emaBlend;

    if (warmupRemaining > 0) {
      warmupRemaining = Math.max(0, warmupRemaining - sampledDelta);
      if (warmupRemaining === 0) {
        state = 'monitoring';
        resetWindow();
      }
      return;
    }

    windowElapsed += sampledDelta;
    windowFrameTimeTotal += sampledDelta;
    windowFrameCount += 1;
    if (windowElapsed >= GOVERNOR_WINDOW_SECONDS
      && windowFrameCount >= GOVERNOR_MIN_SLOW_WINDOW_FRAMES) {
      evaluateWindow();
    }
  }

  applyDensityStep();

  const deviceHints = Object.freeze({
    mobile: qualityProfile.deviceHints.mobile,
    deviceMemory: qualityProfile.deviceHints.deviceMemory,
    hardwareConcurrency: qualityProfile.deviceHints.hardwareConcurrency,
  });
  const telemetry = {};
  Object.defineProperties(telemetry, {
    qualityTier: {
      enumerable: true,
      value: qualityProfile.tier,
    },
    adaptive: {
      enumerable: true,
      value: qualityProfile.adaptive,
    },
    deviceHints: {
      enumerable: true,
      value: deviceHints,
    },
    authoredClusterCount: {
      enumerable: true,
      value: authoredClusterCount,
    },
    authoredBladeCount: {
      enumerable: true,
      value: authoredClusterCount * bladesPerCluster,
    },
    densityScale: {
      enumerable: true,
      get: () => renderedDensityScale,
    },
    densityStep: {
      enumerable: true,
      get: () => densityStepIndex + 1,
    },
    densityStepCount: {
      enumerable: true,
      value: steps.length,
    },
    renderedClusterCount: {
      enumerable: true,
      get: () => renderedClusterCount,
    },
    renderedBladeCount: {
      enumerable: true,
      get: () => renderedClusterCount * bladesPerCluster,
    },
    frameTimeMs: {
      enumerable: true,
      get: () => frameTimeEma * 1000,
    },
    warmupRemaining: {
      enumerable: true,
      get: () => warmupRemaining,
    },
    state: {
      enumerable: true,
      get: () => state,
    },
    lastAdjustment: {
      enumerable: true,
      get: () => lastAdjustment,
    },
    adaptationCount: {
      enumerable: true,
      get: () => adaptationCount,
    },
    ignoredFrameSamples: {
      enumerable: true,
      get: () => ignoredFrameSamples,
    },
  });
  Object.freeze(telemetry);

  return {
    sample,
    telemetry,
  };
}

function createFarClusterField({
  terrain,
  clusterCount,
  densityData,
  material,
}) {
  const gridSize = Math.ceil(Math.sqrt(clusterCount * 1.22));
  const cellCount = gridSize * gridSize;
  const cellSize = terrain.size / gridSize;
  const halfSize = terrain.size * 0.5;
  const origins = new Float32Array(clusterCount * 3);
  const clusterData = new Float32Array(clusterCount * 4);
  const clusterSlopes = new Float32Array(clusterCount * 2);
  const normal = new THREE.Vector3();
  let accepted = 0;

  for (let step = 0; step < cellCount && accepted < clusterCount; step += 1) {
    const cell = (step * 7919) % cellCount;
    const column = cell % gridSize;
    const row = Math.floor(cell / gridSize);
    const x = -halfSize + (column + 0.1 + hash(cell, 51) * 0.8) * cellSize;
    const z = -halfSize + (row + 0.1 + hash(cell, 52) * 0.8) * cellSize;
    const density = densityAtWorld(densityData, terrain.size, x, z);
    if (hash(cell, 53) > density * 0.96) continue;

    const originOffset = accepted * 3;
    const dataOffset = accepted * 4;
    const slopeOffset = accepted * 2;
    origins[originOffset] = x;
    origins[originOffset + 1] = terrain.heightAt(x, z) + 0.055;
    origins[originOffset + 2] = z;
    clusterData[dataOffset] = THREE.MathUtils.lerp(3.8, 6.8, hash(cell, 54));
    clusterData[dataOffset + 1] = THREE.MathUtils.lerp(3.1, 5.7, hash(cell, 55));
    clusterData[dataOffset + 2] = hash(cell, 56) * TAU;
    clusterData[dataOffset + 3] = hash(cell, 57);
    terrain.normalAt(x, z, normal);
    clusterSlopes[slopeOffset] = normal.x / Math.max(0.45, normal.y);
    clusterSlopes[slopeOffset + 1] = normal.z / Math.max(0.45, normal.y);
    accepted += 1;
  }

  const geometry = new THREE.InstancedBufferGeometry().copy(
    new THREE.PlaneGeometry(1, 1, 1, 1),
  );
  geometry.setAttribute(
    'clusterOrigin',
    new THREE.InstancedBufferAttribute(origins.slice(0, accepted * 3), 3),
  );
  geometry.setAttribute(
    'clusterData',
    new THREE.InstancedBufferAttribute(clusterData.slice(0, accepted * 4), 4),
  );
  geometry.setAttribute(
    'clusterSlope',
    new THREE.InstancedBufferAttribute(clusterSlopes.slice(0, accepted * 2), 2),
  );
  geometry.instanceCount = accepted;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'SoftDistantMeadowClusters';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  return { mesh, geometry, accepted };
}

function createDetailField({
  gridSize,
  spacing,
  terrain,
  material,
  dense = false,
  name = 'WorldAnchoredNearGrass',
}) {
  const halfGrid = Math.floor(gridSize * 0.5);
  const outerRadius = Math.min(
    gridSize * spacing * 0.47,
    terrain.size * 0.45,
  );
  // The detail shader fades every blade to zero outside outerRadius, but a
  // square grid still sends all four invisible corners through its expensive
  // terrain, wind and interaction vertex work. Camera-cell rounding can move
  // an origin by 0.5 cell per axis and the shader's jitter by another 0.38.
  // Keep that full worst-case displacement (plus a float margin), so every
  // potentially visible blade retains its original world cell and hash.
  const eligibleRadius = outerRadius / spacing
    + Math.SQRT2 * (0.5 + 0.38) + 0.001;
  const eligibleRadiusSquared = eligibleRadius * eligibleRadius;
  const eligible = (x, z) => x * x + z * z <= eligibleRadiusSquared;
  let count = 0;
  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      if (eligible(column - halfGrid, row - halfGrid)) count += 1;
    }
  }
  const origins = new Float32Array(count * 3);
  let index = 0;

  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      const x = column - halfGrid;
      const z = row - halfGrid;
      if (!eligible(x, z)) continue;
      const offset = index * 3;
      origins[offset] = x;
      origins[offset + 1] = 0;
      origins[offset + 2] = z;
      index += 1;
    }
  }

  // Detail blades already carry their world cell in bladeOrigin. Rendering
  // them through InstancedMesh uploaded a second, entirely identity, 64-byte
  // transform for every blade. InstancedBufferGeometry draws the same shader
  // vertices and instance attributes without that unused transform stream.
  const geometry = new THREE.InstancedBufferGeometry().copy(createBladeGeometry(dense));
  geometry.setAttribute(
    'bladeOrigin',
    new THREE.InstancedBufferAttribute(origins, 3),
  );
  geometry.instanceCount = count;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  return {
    mesh,
    geometry,
    count,
    innerRadius: Math.max(6, outerRadius - 5.4),
    outerRadius,
  };
}

export function createGrass({
  terrain,
  quality = 'auto',
  densityMultiplier = 1,
  seed = 9237,
  clearings = [],
  windDirection = new THREE.Vector2(1, 0),
} = {}) {
  const terrainReady = terrain
    && Number.isFinite(terrain.size)
    && terrain.size > 0
    && typeof terrain.heightAt === 'function'
    && typeof terrain.normalAt === 'function'
    && typeof terrain.isPath === 'function'
    && typeof terrain.path?.nearest === 'function'
    && Number.isFinite(terrain.path.width)
    && Number.isFinite(terrain.path.shoulderWidth);
  if (!terrainReady) {
    throw new TypeError(
      'createGrass requires size, heightAt, normalAt, isPath, and a '
      + 'path { width, shoulderWidth, nearest } terrain interface.',
    );
  }
  if (
    !windDirection?.isVector2
    || !Number.isFinite(windDirection.x)
    || !Number.isFinite(windDirection.y)
    || windDirection.lengthSq() < 1e-8
  ) {
    throw new TypeError('windDirection must be a non-zero THREE.Vector2.');
  }
  if (!Number.isInteger(densityMultiplier) || densityMultiplier < 1 || densityMultiplier > 10) {
    throw new RangeError('densityMultiplier must be an integer from 1 to 10.');
  }

  const baseQuality = resolveGrassQuality(quality);
  // A larger meadow needs more authored cluster origins, but matching area
  // growth one-for-one would multiply GPU work by 2.25x at the new scale.
  // Chunk culling and soft distant LOD cover the expanded horizon while this
  // capped linear increase preserves thick nearby grass.
  const coverageScale = THREE.MathUtils.clamp(
    terrain.size / 200,
    1,
    1.35,
  );
  const resolvedQuality = {
    ...baseQuality,
    meadowTuftCount: Math.round(
      baseQuality.meadowTuftCount * coverageScale,
    ),
    detailGridSize: Math.round(baseQuality.detailGridSize * Math.sqrt(densityMultiplier)),
    detailSpacing: baseQuality.detailSpacing / Math.sqrt(densityMultiplier),
  };
  const bladesPerCluster = BLADES_PER_MEADOW_CLUSTER * densityMultiplier;
  const baseDensityData = createBaseDensityData(terrain, clearings);
  const densityData = baseDensityData.slice();
  const densityTexture = new THREE.DataTexture(
    densityData,
    MASK_SIZE,
    MASK_SIZE,
    THREE.RedFormat,
  );
  densityTexture.name = 'GrassDensityMask';
  densityTexture.wrapS = densityTexture.wrapT = THREE.ClampToEdgeWrapping;
  densityTexture.minFilter = densityTexture.magFilter = THREE.LinearFilter;
  densityTexture.generateMipmaps = false;
  densityTexture.needsUpdate = true;

  const windTexture = createWindTexture(seed);
  const terrainHeight = createTerrainHeightTexture(terrain);
  const flattenerUniforms = Array.from(
    { length: MAX_FLATTENERS },
    () => new THREE.Vector4(),
  );
  const sharedUniforms = {
    uTime: { value: 0 },
    uTerrainSize: { value: terrain.size },
    uWindNoise: { value: windTexture },
    uWindDirection: { value: windDirection.clone().normalize() },
    uDensityMask: { value: densityTexture },
    uDetailCell: { value: new THREE.Vector2() },
    uDetailFocus: { value: new THREE.Vector2() },
    uDetailSpacing: { value: resolvedQuality.detailSpacing },
    uDetailHeightScale: { value: 0.96 },
    uDetailWidthScale: { value: 0.90 },
    uDetailInnerRadius: { value: 20 },
    uDetailOuterRadius: { value: 26 },
    uHeightMapSize: { value: HEIGHT_MAP_SIZE },
    uHeightMinimum: { value: terrainHeight.minimum },
    uHeightRange: { value: terrainHeight.range },
    uTerrainHeightMap: { value: terrainHeight.texture },
    // Muted salt-tolerant meadow palette to match Greywake's storm light.
    uRootColor: { value: new THREE.Color('#5C6D53') },
    uTipColor: { value: new THREE.Color('#839570') },
    uFarColor: { value: new THREE.Color('#60745B') },
    uSunDirection: {
      value: new THREE.Vector3(-0.67, 0.31, -0.67).normalize(),
    },
    uFlattenerCount: { value: 0 },
    uFlatteners: { value: flattenerUniforms },
  };
  const meadowMaterial = createGrassMaterial(
    sharedUniforms,
    { clustered: true },
  );
  const detailMaterial = createGrassMaterial(
    sharedUniforms,
    { detail: true },
  );
  const detailField = createDetailField({
    gridSize: resolvedQuality.detailGridSize,
    spacing: resolvedQuality.detailSpacing,
    terrain,
    material: detailMaterial,
    dense: densityMultiplier > 1,
  });
  sharedUniforms.uDetailInnerRadius.value = detailField.innerRadius;
  sharedUniforms.uDetailOuterRadius.value = detailField.outerRadius;
  const farClusterTexture = createFarClusterTexture(seed ^ 0x5f3759df);
  const farClusterMaterial = createFarClusterMaterial(
    sharedUniforms,
    farClusterTexture,
  );
  const meadowField = createContinuousMeadowField({
    terrain,
    tuftCount: resolvedQuality.meadowTuftCount,
    bladesPerCluster,
    chunkDivisions: resolvedQuality.tuftChunkDivisions,
    densityData: baseDensityData,
    material: meadowMaterial,
  });
  const densityGovernor = createGrassDensityGovernor(
    meadowField.meshes,
    resolvedQuality,
    bladesPerCluster,
  );
  const farClusterCount = THREE.MathUtils.clamp(
    Math.round(resolvedQuality.meadowTuftCount * 0.035),
    5_000,
    11_000,
  );
  const farClusterField = createFarClusterField({
    terrain,
    clusterCount: farClusterCount,
    densityData: baseDensityData,
    material: farClusterMaterial,
  });

  const group = new THREE.Group();
  group.name = 'WorldSpaceGrassField';
  farClusterField.mesh.renderOrder = -1;
  detailField.mesh.renderOrder = 1;
  group.add(farClusterField.mesh, meadowField.group, detailField.mesh);

  const activeFlatteners = [];
  const trail = [];
  const previousPositions = new Map();
  let elapsed = 0;

  function refreshFlatteners() {
    let uniformIndex = 0;
    for (
      let index = 0;
      index < activeFlatteners.length && uniformIndex < MAX_FLATTENERS;
      index += 1
    ) {
      const item = activeFlatteners[index];
      const fade = item.life == null
        ? 1
        : THREE.MathUtils.clamp(item.life / item.duration, 0, 1);
      flattenerUniforms[uniformIndex].set(
        item.x,
        item.z,
        item.radius,
        item.strength * fade * fade,
      );
      uniformIndex += 1;
    }

    for (
      let index = trail.length - 1;
      index >= 0 && uniformIndex < MAX_FLATTENERS;
      index -= 1
    ) {
      const item = trail[index];
      const fade = THREE.MathUtils.clamp(
        item.life / item.duration,
        0,
        1,
      );
      flattenerUniforms[uniformIndex].set(
        item.x,
        item.z,
        item.radius,
        item.strength * fade * fade,
      );
      uniformIndex += 1;
    }

    sharedUniforms.uFlattenerCount.value = uniformIndex;
  }

  function setFlatteners(items = []) {
    activeFlatteners.length = 0;

    const focusPosition = items[0]?.position ?? items[0];
    if (
      Number.isFinite(focusPosition?.x)
      && Number.isFinite(focusPosition?.z)
    ) {
      sharedUniforms.uDetailFocus.value.set(
        focusPosition.x,
        focusPosition.z,
      );
      sharedUniforms.uDetailCell.value.set(
        Math.round(focusPosition.x / resolvedQuality.detailSpacing),
        Math.round(focusPosition.z / resolvedQuality.detailSpacing),
      );
    }

    items.forEach((item, index) => {
      const position = item.position ?? item;
      if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return;
      const actor = {
        id: item.id ?? index,
        x: position.x,
        z: position.z,
        radius: item.radius ?? 1.45,
        strength: item.strength ?? 1,
      };
      const previous = previousPositions.get(actor.id);
      if (
        item.trail !== false
        && previous
        && Math.hypot(actor.x - previous.x, actor.z - previous.z) > 0.55
      ) {
        trail.push({
          ...previous,
          radius: actor.radius,
          strength: actor.strength * 0.82,
          life: 1.35,
          duration: 1.35,
        });
        if (trail.length > 24) trail.shift();
        previousPositions.set(actor.id, { x: actor.x, z: actor.z });
      }
      if (!previous) previousPositions.set(actor.id, { x: actor.x, z: actor.z });
      activeFlatteners.push(actor);
    });

    refreshFlatteners();
  }

  function eraseRegion(region, upload = true) {
    paintRegionMask(densityData, MASK_SIZE, terrain.size, region, 'erase');
    if (upload) densityTexture.needsUpdate = true;
  }

  function setErasedRegions(regions = []) {
    densityData.set(baseDensityData);
    regions.forEach((region) => eraseRegion(region, false));
    densityTexture.needsUpdate = true;
  }

  return {
    mesh: group,
    group,
    material: meadowMaterial,
    bladeCount:
      meadowField.accepted * bladesPerCluster + detailField.count,
    farBladeCount: meadowField.accepted * bladesPerCluster,
    detailBladeCount: detailField.count,
    meadowTuftCount: meadowField.accepted,
    meadowBladeCount: meadowField.accepted * bladesPerCluster,
    farClusterCount: farClusterField.accepted,
    densityMultiplier,
    bladesPerCluster,
    telemetry: densityGovernor.telemetry,
    performance: densityGovernor.telemetry,
    get densityScale() {
      return densityGovernor.telemetry.densityScale;
    },
    get renderedBladeCount() {
      return densityGovernor.telemetry.renderedBladeCount + detailField.count;
    },
    get qualityTier() {
      return densityGovernor.telemetry.qualityTier;
    },
    densityMask: densityTexture,
    setFlatteners,
    // The island's weather already exposes a continuous wind intensity.
    // Scale the shared direction vector to apply it to all three grass LODs.
    setWindStrength(strength) {
      sharedUniforms.uWindDirection.value.copy(windDirection).normalize()
        .multiplyScalar(THREE.MathUtils.clamp(strength, 0.1, 1.7));
    },
    eraseRegion,
    setErasedRegions,
    setSunDirection(direction) {
      sharedUniforms.uSunDirection.value.copy(direction).normalize();
    },
    update(deltaSeconds, elapsedSeconds) {
      const frameDelta = Number.isFinite(deltaSeconds)
        ? Math.max(0, deltaSeconds)
        : 0;
      elapsed = Number.isFinite(elapsedSeconds)
        ? elapsedSeconds
        : elapsed + frameDelta;
      sharedUniforms.uTime.value = elapsed;
      densityGovernor.sample(frameDelta);
      for (let index = trail.length - 1; index >= 0; index -= 1) {
        trail[index].life -= Math.min(frameDelta, 0.1);
        if (trail[index].life <= 0) trail.splice(index, 1);
      }
      refreshFlatteners();
    },
    dispose() {
      previousPositions.clear();
      trail.length = 0;
      activeFlatteners.length = 0;
      meadowField.group.removeFromParent();
      meadowField.meshes.forEach((mesh) => mesh.dispose?.());
      meadowField.geometries.forEach((geometry) => geometry.dispose());
      detailField.mesh.removeFromParent();
      detailField.mesh.dispose?.();
      detailField.geometry.dispose();
      farClusterField.mesh.removeFromParent();
      farClusterField.geometry.dispose();
      meadowMaterial.dispose();
      detailMaterial.dispose();
      farClusterMaterial.dispose();
      farClusterTexture.dispose();
      terrainHeight.texture.dispose();
      densityTexture.dispose();
      windTexture.dispose();
      group.clear();
    },
  };
}

/**
 * Small lifecycle facade for applications that prefer a class. The underlying
 * implementation is identical to `createGrass`; this wrapper only supplies an
 * Object3D-style name and idempotent disposal.
 */
export class WindSweptGrass {
  #system;
  #disposed = false;

  constructor(options) {
    this.#system = createGrass(options);
  }

  get object3d() { return this.#system.group; }
  get group() { return this.#system.group; }
  get telemetry() { return this.#system.telemetry; }
  get qualityTier() { return this.#system.qualityTier; }
  get densityScale() { return this.#system.densityScale; }
  get renderedBladeCount() { return this.#system.renderedBladeCount; }
  get detailBladeCount() { return this.#system.detailBladeCount; }
  get bladesPerCluster() { return this.#system.bladesPerCluster; }

  setFlatteners(items) {
    if (!this.#disposed) this.#system.setFlatteners(items);
  }

  setWindStrength(strength) {
    if (!this.#disposed) this.#system.setWindStrength(strength);
  }

  eraseRegion(region) {
    if (!this.#disposed) this.#system.eraseRegion(region);
  }

  setErasedRegions(regions) {
    if (!this.#disposed) this.#system.setErasedRegions(regions);
  }

  setSunDirection(direction) {
    if (!this.#disposed) this.#system.setSunDirection(direction);
  }

  update(deltaSeconds, elapsedSeconds) {
    if (!this.#disposed) this.#system.update(deltaSeconds, elapsedSeconds);
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#system.dispose();
  }
}
