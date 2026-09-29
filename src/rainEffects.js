import * as THREE from 'three';

// Ground-contact rain effects only. The world draws falling streaks and the
// separate wet-window module handles droplets on glass.
const MAX_IMPACTS = 170;
const SEGMENTS = 14;
const FLECKS_PER_IMPACT = 3;
const TAU = Math.PI * 2;
const ringDirections = Array.from({ length: SEGMENTS }, (_, segment) => {
  const angle = TAU * segment / SEGMENTS;
  return [Math.cos(angle), Math.sin(angle)];
});
const fleckDirections = Array.from({ length: FLECKS_PER_IMPACT }, (_, fleck) => {
  const angle = TAU * fleck / FLECKS_PER_IMPACT;
  return [Math.cos(angle), Math.sin(angle)];
});

function rainTarget(weather) {
  if (typeof weather === 'number') return THREE.MathUtils.clamp(weather, 0, 1);
  if (weather && typeof weather === 'object') {
    const value = Number(weather.rain ?? weather.intensity ?? 0);
    return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
  }
  const mode = String(weather).toLowerCase();
  if (/storm|squall|downpour/.test(mode)) return 1;
  if (/rain|shower/.test(mode)) return 0.64;
  if (/mist|fog/.test(mode)) return 0;
  return 0;
}

function markActiveUpload(attribute, componentCount) {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, componentCount);
  attribute.needsUpdate = true;
}

function createRippleMesh() {
  const positions = new Float32Array(MAX_IMPACTS * SEGMENTS * 2 * 3);
  const alphas = new Float32Array(MAX_IMPACTS * SEGMENTS * 2);
  const indices = new Uint16Array(MAX_IMPACTS * SEGMENTS * 6);
  for (let impact = 0; impact < MAX_IMPACTS; impact += 1) {
    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      const a = (impact * SEGMENTS + segment) * 2;
      const b = (impact * SEGMENTS + ((segment + 1) % SEGMENTS)) * 2;
      const at = (impact * SEGMENTS + segment) * 6;
      indices.set([a, a + 1, b, a + 1, b + 1, b], at);
    }
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const alphaAttribute = new THREE.BufferAttribute(alphas, 1);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  alphaAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aAlpha', alphaAttribute);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(0.64, 0.79, 0.84, vAlpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Rain ground ripples';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, positions, alphas, positionAttribute, alphaAttribute, geometry, material };
}

function createSplashFlecks() {
  const count = MAX_IMPACTS * FLECKS_PER_IMPACT;
  const positions = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const sizes = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const alphaAttribute = new THREE.BufferAttribute(alphas, 1);
  const sizeAttribute = new THREE.BufferAttribute(sizes, 1);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  alphaAttribute.setUsage(THREE.DynamicDrawUsage);
  sizeAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aAlpha', alphaAttribute);
  geometry.setAttribute('aSize', sizeAttribute);
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute float aAlpha;
      attribute float aSize;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 eye = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * 125.0 / max(1.0, -eye.z), 1.0, 6.0);
        gl_Position = projectionMatrix * eye;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        float feather = 1.0 - smoothstep(0.24, 0.5, radius);
        gl_FragColor = vec4(0.75, 0.87, 0.90, vAlpha * feather);
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'Rain impact flecks';
  points.frustumCulled = false;
  points.renderOrder = 3;
  return { points, positions, alphas, sizes, positionAttribute, alphaAttribute, sizeAttribute, geometry, material };
}

/** Add short-lived ground rings and upward flecks around the first-person camera. */
export function createRainEffects(scene, camera, terrainHeight, waterHeight,
  isShelteredAt = () => false, inlandWaterHeight = () => null,
  { isRoadAt = () => false, renderedTerrainHeight = terrainHeight } = {}) {
  const ripples = createRippleMesh();
  const flecks = createSplashFlecks();
  scene.add(ripples.mesh, flecks.points);
  // The south boardwalk follows the cove slope and ends in a low, level pier.
  const northDeckY = terrainHeight(-65, -315) + 0.08 + 0.15;

  // Reused records avoid allocating dozens of objects each second in storms.
  const impacts = Array.from({ length: MAX_IMPACTS }, () => ({
    x: 0, y: 0, z: 0, age: 0, life: 0.5, size: 1,
    seed: 0, cosSeed: 1, sinSeed: 0, sea: false, lake: false,
  }));
  let active = 0;
  let spawnCredit = 0;
  let intensity = 0;
  let disposed = false;

  function spawn() {
    if (active >= MAX_IMPACTS) return;
    const yaw = camera.rotation.y || 0;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    // Drizzle has fewer impacts, so keep its small rings nearer the viewer.
    const rainSpread = Math.min(1, intensity / 0.65);
    const reach = 6 + 10 * rainSpread;
    const distance = 1.2 + Math.sqrt(Math.random()) * reach;
    const lateral = (Math.random() * 2 - 1)
      * (2 + rainSpread + distance * (0.34 + rainSpread * 0.24));
    const x = camera.position.x + forwardX * distance + rightX * lateral;
    const z = camera.position.z + forwardZ * distance + rightZ * lateral;
    if (isShelteredAt(x, z)) return;
    const groundY = terrainHeight(x, z);
    if (!Number.isFinite(groundY)) return;
    const onSouthBoardwalk = Math.abs(x) < 3.2 && z >= 268 && z < 343;
    const onSouthPier = Math.abs(x) < 4 && z >= 343 && z <= 357;
    const onNorthDeck = Math.abs(x + 65) < 3 && z > -333 && z < -311;
    const sea = !onSouthBoardwalk && !onSouthPier && !onNorthDeck && groundY < 0.2;
    const lakeY = inlandWaterHeight(x, z);
    const lake = Number.isFinite(lakeY);
    const road = !sea && !lake && !onSouthBoardwalk && !onSouthPier
      && !onNorthDeck && isRoadAt(x, z);
    const renderedY = road || sea || lake || onSouthBoardwalk || onSouthPier || onNorthDeck
      ? groundY : renderedTerrainHeight(x, z);
    const impact = impacts[active];
    impact.x = x;
    impact.y = onSouthBoardwalk ? terrainHeight(0, z) + 0.16 + 0.09 + 0.035
      : onSouthPier ? 0.35 + 0.14 + 0.035
      : onNorthDeck ? northDeckY + 0.035
        : lake ? lakeY + 0.04 : sea ? 0.092
          : road ? groundY + 0.225
            : Math.max(groundY, Number.isFinite(renderedY) ? renderedY : groundY) + 0.09;
    impact.z = z;
    impact.age = 0;
    impact.life = 0.38 + Math.random() * 0.31;
    impact.size = (sea || lake ? 1.25 : 0.75) + Math.random() * 0.55;
    impact.seed = Math.random() * TAU;
    impact.cosSeed = Math.cos(impact.seed);
    impact.sinSeed = Math.sin(impact.seed);
    impact.sea = sea;
    impact.lake = lake;
    active += 1;
  }

  function writeImpact(index, impact, visualRain) {
    const progress = Math.min(1, impact.age / impact.life);
    const outerRadius = (0.025 + progress * (impact.sea || impact.lake ? 0.36 : 0.24)) * impact.size;
    const lightRain = 1 - Math.min(1, intensity / 0.65);
    const innerRadius = outerRadius * (0.84 - lightRain * 0.14);
    // Sparse drizzle needs a ring that remains readable as it expands.
    const fadeExponent = 1.65 - lightRain * 0.7;
    const alpha = (1 - progress) ** fadeExponent
      * (impact.sea || impact.lake ? 0.24 : 0.3) * visualRain;
    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      const [baseCos, baseSin] = ringDirections[segment];
      const cos = baseCos * impact.cosSeed - baseSin * impact.sinSeed;
      const sin = baseSin * impact.cosSeed + baseCos * impact.sinSeed;
      const vertex = (index * SEGMENTS + segment) * 2;
      for (let edge = 0; edge < 2; edge += 1) {
        const radius = edge ? outerRadius : innerRadius;
        const position = (vertex + edge) * 3;
        ripples.positions[position] = impact.x + cos * radius;
        ripples.positions[position + 1] = impact.y;
        ripples.positions[position + 2] = impact.z + sin * radius;
        ripples.alphas[vertex + edge] = alpha;
      }
    }

    const sprayPhase = impact.age / 0.27;
    const sprayAlpha = sprayPhase < 1
      ? Math.sin(Math.PI * sprayPhase) * 0.46 * visualRain
      : 0;
    const sprayHeight = Math.max(0,
      Math.sin(Math.PI * Math.min(1, sprayPhase))) * 0.16 * impact.size;
    for (let fleck = 0; fleck < FLECKS_PER_IMPACT; fleck += 1) {
      const at = index * FLECKS_PER_IMPACT + fleck;
      const p = at * 3;
      const [baseCos, baseSin] = fleckDirections[fleck];
      const cos = baseCos * impact.cosSeed - baseSin * impact.sinSeed;
      const sin = baseSin * impact.cosSeed + baseCos * impact.sinSeed;
      const spread = 0.025 + Math.min(1, sprayPhase) * 0.10 * impact.size;
      flecks.positions[p] = impact.x + cos * spread;
      flecks.positions[p + 1] = impact.y + sprayHeight;
      flecks.positions[p + 2] = impact.z + sin * spread;
      flecks.alphas[at] = sprayAlpha;
      flecks.sizes[at] = (0.16 + impact.size * 0.08) * (1 + lightRain * 0.55);
    }
  }

  function update(dt, elapsed, weather, options = {}) {
    if (disposed) return;
    const step = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.08);
    const target = rainTarget(weather);
    intensity += (target - intensity) * Math.min(1, step * 0.65);
    const visible = intensity > 0.012;

    // Keep aging impacts while indoors so none reappear at a stale position.
    let index = 0;
    while (index < active) {
      impacts[index].age += step;
      if (impacts[index].age >= impacts[index].life) {
        // Recycle records by reference: storm rain can retire over a hundred
        // impacts a second, and copying every field serves no visual purpose.
        const last = active - 1;
        const expired = impacts[index];
        impacts[index] = impacts[last];
        impacts[last] = expired;
        active = last;
      } else index += 1;
    }

    if (visible) {
      spawnCredit = Math.min(8, spawnCredit + step * Math.pow(intensity, 0.7) * 112);
      while (spawnCredit >= 1 && active < MAX_IMPACTS) {
        spawn();
        spawnCredit -= 1;
      }
    } else spawnCredit = 0;

    const visualRain = THREE.MathUtils.smoothstep(intensity, 0.008, 0.025);
    for (let i = 0; i < active; i += 1) {
      if (impacts[i].sea && typeof waterHeight === 'function') {
        impacts[i].y = waterHeight(impacts[i].x, impacts[i].z, elapsed) + 0.04;
      } else if (impacts[i].lake) {
        const lakeY = inlandWaterHeight(impacts[i].x, impacts[i].z, elapsed);
        if (Number.isFinite(lakeY)) impacts[i].y = lakeY + 0.04;
      }
      writeImpact(i, impacts[i], visualRain);
    }
    ripples.geometry.setDrawRange(0, active * SEGMENTS * 6);
    flecks.geometry.setDrawRange(0, active * FLECKS_PER_IMPACT);
    ripples.mesh.visible = visible && active > 0;
    flecks.points.visible = visible && active > 0;
    if (active) {
      // Only live splash vertices change. Three's WebGLAttributes uploads
      // update ranges with bufferSubData; full-buffer writes would resend all
      // 170 reserved impacts even when only a few dozen are visible.
      markActiveUpload(ripples.positionAttribute, active * SEGMENTS * 2 * 3);
      markActiveUpload(ripples.alphaAttribute, active * SEGMENTS * 2);
      markActiveUpload(flecks.positionAttribute, active * FLECKS_PER_IMPACT * 3);
      markActiveUpload(flecks.alphaAttribute, active * FLECKS_PER_IMPACT);
      markActiveUpload(flecks.sizeAttribute, active * FLECKS_PER_IMPACT);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(ripples.mesh, flecks.points);
    ripples.geometry.dispose();
    ripples.material.dispose();
    flecks.geometry.dispose();
    flecks.material.dispose();
  }

  return { update, dispose };
}
