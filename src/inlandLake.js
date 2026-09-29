import * as THREE from 'three';

// A highland tarn in the open ground between the prison and west coast road.
// Its entire graded bank stays clear of the authored trails and structures.
export const INLAND_LAKE = Object.freeze({
  x: -70, z: -75, radiusX: 60, radiusZ: 48,
  waterLevel: 49, bankWidth: 16,
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (lo, hi, value) => {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
const averageRadius = Math.sqrt(INLAND_LAKE.radiusX * INLAND_LAKE.radiusZ);

function shoreRadius(angle) {
  return 1 + 0.024 * Math.sin(angle * 3 + 0.52)
    + 0.018 * Math.sin(angle * 7 - 0.7)
    + 0.013 * Math.sin(angle * 11 + 1.1)
    + 0.007 * Math.sin(angle * 17 - 0.36)
    + 0.004 * Math.sin(angle * 29 + 0.82);
}

/** Approximate metres from the irregular waterline; negative is in the lake. */
export function lakeSignedDistance(x, z) {
  const dx = (x - INLAND_LAKE.x) / INLAND_LAKE.radiusX;
  const dz = (z - INLAND_LAKE.z) / INLAND_LAKE.radiusZ;
  const angle = Math.atan2(dz, dx);
  return (Math.hypot(dx, dz) - shoreRadius(angle)) * averageRadius;
}

export function isLake(x, z, margin = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const reach = Math.max(0, margin);
  if (x < INLAND_LAKE.x - INLAND_LAKE.radiusX - reach - 5
    || x > INLAND_LAKE.x + INLAND_LAKE.radiusX + reach + 5
    || z < INLAND_LAKE.z - INLAND_LAKE.radiusZ - reach - 5
    || z > INLAND_LAKE.z + INLAND_LAKE.radiusZ + reach + 5) return false;
  return lakeSignedDistance(x, z) <= margin;
}

/** Carve a shallow basin with a narrow, raised bank; preserve distant terrain. */
export function sculptLakeTerrain(originalHeight, x, z) {
  // The coarse 790 m island grid and dense vegetation both query this often.
  if (x < -160 || x > 20 || z < -150 || z > 5) return originalHeight;
  const distance = lakeSignedDistance(x, z);
  if (distance <= 0) {
    // Floor rises from 44.6 m to the 49 m waterline. All water remains above
    // ground; the outermost shallow edge is readable from foot level.
    const floor = 44.6 + 4.4 * smooth(-20, 0, distance);
    return Math.min(originalHeight, floor);
  }
  if (distance >= INLAND_LAKE.bankWidth + 8) return originalHeight;
  const bank = 49 + (Math.max(originalHeight, 50.1) - 49)
    * smooth(0, INLAND_LAKE.bankWidth, distance);
  if (distance <= INLAND_LAKE.bankWidth) return bank;
  return bank + (originalHeight - bank)
    * smooth(INLAND_LAKE.bankWidth, INLAND_LAKE.bankWidth + 8, distance);
}

export function lakeWaterHeight(x, z, time = 0, wind = 0) {
  if (!isLake(x, z)) return null;
  const amplitude = 0.021 + clamp(wind, 0, 1) * 0.028;
  return INLAND_LAKE.waterLevel + 0.04 + amplitude * (
    Math.sin(x * 0.21 + z * 0.08 + time * 0.64) * 0.55
    + Math.sin(z * 0.31 - x * 0.05 - time * 0.72) * 0.29
    + Math.sin((x + z) * 0.47 + time * 1.13) * 0.16
  );
}

function lakeGeometry() {
  // The shoreline needs sub-metre angular spacing when viewed from the drone.
  const segments = 384;
  const rings = 22;
  const positions = new Float32Array((segments + 1) * (rings + 1) * 3);
  const shoreDistances = new Float32Array((segments + 1) * (rings + 1));
  const indices = [];
  const stride = rings + 1;
  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2;
    const maxRadius = shoreRadius(angle) + (INLAND_LAKE.bankWidth + 1) / averageRadius;
    for (let j = 0; j <= rings; j++) {
      const radial = j / rings * maxRadius;
      const x = INLAND_LAKE.x + Math.cos(angle) * radial * INLAND_LAKE.radiusX;
      const z = INLAND_LAKE.z + Math.sin(angle) * radial * INLAND_LAKE.radiusZ;
      const index = i * stride + j;
      positions.set([x, INLAND_LAKE.waterLevel + 0.04, z], index * 3);
      shoreDistances[index] = (radial - shoreRadius(angle)) * averageRadius;
      if (i < segments && j < rings) {
        const a = i * stride + j;
        indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aShoreDistance', new THREE.BufferAttribute(shoreDistances, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A small, inexpensive lake surface with wind ripples, glints, and fog. */
export function createInlandLake() {
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: 0 },
    uFog: { value: new THREE.Color(0x899b9b) },
    uFogDensity: { value: 0.0027 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `
      attribute float aShoreDistance;
      varying vec3 vWorld;
      varying float vShoreDistance;
      uniform float uTime;
      uniform float uWind;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float amplitude = 0.021 + clamp(uWind, 0.0, 1.0) * 0.028;
        world.y += amplitude * (
          sin(world.x * 0.21 + world.z * 0.08 + uTime * 0.64) * 0.55
          + sin(world.z * 0.31 - world.x * 0.05 - uTime * 0.72) * 0.29
          + sin((world.x + world.z) * 0.47 + uTime * 1.13) * 0.16);
        vWorld = world.xyz;
        vShoreDistance = aShoreDistance;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vWorld;
      varying float vShoreDistance;
      uniform float uTime;
      uniform float uWind;
      uniform vec3 uFog;
      uniform float uFogDensity;
      void main() {
        float rippleA = sin(vWorld.x * 0.34 + vWorld.z * 0.09 + uTime * (0.48 + uWind * 0.27));
        float rippleB = sin(vWorld.z * 0.46 - vWorld.x * 0.11 - uTime * (0.56 + uWind * 0.34));
        float fine = sin((vWorld.x - vWorld.z) * 0.83 + uTime * 0.87);
        float ripple = clamp(0.5 + 0.32 * rippleA * rippleB + 0.10 * fine, 0.0, 1.0);
        // Shader colours are linear. Keep the tarn dark under ACES exposure;
        // broad, low-contrast highlights reveal movement without a white sheet.
        vec3 deep = mix(vec3(0.018, 0.044, 0.052), vec3(0.010, 0.025, 0.034), clamp(uWind, 0.0, 1.0));
        vec3 color = deep + vec3(0.040, 0.064, 0.059) * ripple;
        float fresnel = pow(1.0 - clamp(dot(normalize(cameraPosition - vWorld), vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 2.6);
        color = mix(color, vec3(0.075, 0.115, 0.119), fresnel * 0.30);
        float glint = pow(max(0.0, rippleA * rippleB * 0.70 + fine * 0.30), 22.0);
        color += vec3(0.025, 0.039, 0.036) * glint;
        float shallow = smoothstep(-9.0, -1.0, vShoreDistance);
        color = mix(color, vec3(0.049, 0.077, 0.071), shallow * 0.34);
        float visibility = exp(-pow(distance(cameraPosition, vWorld) * uFogDensity, 2.0));
        float shoreFade = 1.0 - smoothstep(-3.5, 1.2, vShoreDistance);
        gl_FragColor = vec4(mix(uFog, color, visibility), shoreFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(lakeGeometry(), material);
  mesh.name = 'Wind-rippled highland lake';
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
