import * as THREE from 'three';

// Original WebGL rain field informed by the shader-animated precipitation
// approach in CK42BB's MIT-licensed procedural-weather-threejs guide.
// Each drop carries one origin and one set of motion parameters. Its two line
// endpoints are supplied by a shared two-vertex geometry; gravity, gusts,
// wrapping, and edge fading happen in the vertex shader.
const DROP_COUNT = 16000;
const HALF_WIDTH = 38;
const HEIGHT = 39;
const MAX_NEARBY_ROOFS = 4;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

export function createGpuRain() {
  const random = seededRandom(0x69cb41);
  const origins = new Float32Array(DROP_COUNT * 3);
  const variation = new Float32Array(DROP_COUNT * 4);

  for (let i = 0; i < DROP_COUNT; i++) {
    const x = (random() * 2 - 1) * HALF_WIDTH;
    const z = (random() * 2 - 1) * HALF_WIDTH;
    const y = random() * HEIGHT;
    const seed = random();
    const speed = random();
    const length = random();
    const phase = random();
    origins.set([x, y, z], i * 3);
    variation.set([seed, speed, length, phase], i * 4);
  }

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  geometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
  geometry.setAttribute('aDrop', new THREE.InstancedBufferAttribute(variation, 4));
  geometry.setAttribute('aTip', new THREE.Float32BufferAttribute([0, 1], 1));
  geometry.instanceCount = 0;
  geometry.setDrawRange(0, 2);

  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uWind: { value: 0 },
    uWindDirection: { value: new THREE.Vector2(1, 0.27).normalize() },
    uFlash: { value: 0 },
    uCameraXZ: { value: new THREE.Vector2() },
    uRoofCount: { value: 0 },
    uRoofs: { value: Array.from({ length: MAX_NEARBY_ROOFS }, () => new THREE.Vector4()) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute vec3 aOrigin;
      attribute vec4 aDrop;
      attribute float aTip;
      uniform float uTime;
      uniform float uIntensity;
      uniform float uWind;
      uniform vec2 uWindDirection;
      uniform vec2 uCameraXZ;
      uniform float uRoofCount;
      uniform vec4 uRoofs[${MAX_NEARBY_ROOFS}];
      varying float vOpacity;
      varying float vLight;

      float wrapRain(float value, float halfSize) {
        return mod(value + halfSize, 2.0 * halfSize) - halfSize;
      }

      void main() {
        float speed = mix(17.0, 34.0, aDrop.y);
        float fall = mod(aOrigin.y + aDrop.w * ${HEIGHT.toFixed(1)} - uTime * speed, ${HEIGHT.toFixed(1)});
        float travel = 1.0 - fall / ${HEIGHT.toFixed(1)};
        float gust = uWind * (0.86 + 0.14 * sin(uTime * 0.7 + aDrop.x * 9.0));
        vec3 drop = vec3(
          wrapRain(aOrigin.x + uWindDirection.x * gust * travel * 0.95, ${HALF_WIDTH.toFixed(1)}),
          fall - 12.0,
          wrapRain(aOrigin.z + uWindDirection.y * gust * travel * 0.95, ${HALF_WIDTH.toFixed(1)})
        );
        if (aTip > 0.5) {
          drop.xz -= uWindDirection * gust * 0.045;
          drop.y += mix(0.55, 1.45, aDrop.z) * (0.8 + uIntensity * 0.7);
        }
        float rangeFade = 1.0 - smoothstep(23.0, 39.0, length(drop.xz));
        float heightFade = smoothstep(-12.0, -9.0, drop.y)
          * (1.0 - smoothstep(23.0, 27.0, drop.y));
        vec2 worldXZ = drop.xz + uCameraXZ;
        float underRoof = 0.0;
        for (int roofIndex = 0; roofIndex < ${MAX_NEARBY_ROOFS}; roofIndex++) {
          if (float(roofIndex) >= uRoofCount) break;
          vec4 roof = uRoofs[roofIndex];
          vec2 fromCenter = abs(worldXZ - roof.xy);
          if (fromCenter.x < roof.z && fromCenter.y < roof.w) underRoof = 1.0;
        }
        vOpacity = (1.0 - underRoof) * rangeFade * heightFade * mix(0.27, 0.51, aDrop.x);
        vLight = 0.88 + aDrop.z * 0.18;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(drop, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uIntensity;
      uniform float uFlash;
      varying float vOpacity;
      varying float vLight;
      void main() {
        float alpha = vOpacity * mix(0.63, 1.0, uIntensity);
        if (alpha < 0.008) discard;
        vec3 color = vec3(0.68, 0.77, 0.80) * vLight;
        color += vec3(0.29, 0.31, 0.34) * uFlash;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.name = 'Shader-driven coastal rain';
  mesh.frustumCulled = false;
  mesh.visible = false;
  let shelters = [];

  return {
    mesh,
    count: DROP_COUNT,
    setShelters(rectangles = []) {
      shelters = rectangles.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.z)
        && r.halfWidth > 0 && r.halfDepth > 0);
    },
    // Optional wind is { direction: { x, z }, strength: 0..1 }. A Vector2
    // direction also works through its x/y components. Older calls retain
    // the original north-east drift tied to rain intensity.
    update(camera, time, intensity, indoors, lightning = 0, wind = null) {
      const amount = THREE.MathUtils.clamp(intensity, 0, 1);
      const visibleDrops = Math.round(DROP_COUNT * amount);
      mesh.visible = visibleDrops > 0;
      if (!mesh.visible) return;
      mesh.position.copy(camera.position);
      uniforms.uCameraXZ.value.set(camera.position.x, camera.position.z);
      const nearby = shelters.filter((r) => Math.abs(r.x - camera.position.x) < HALF_WIDTH + r.halfWidth
        && Math.abs(r.z - camera.position.z) < HALF_WIDTH + r.halfDepth).slice(0, MAX_NEARBY_ROOFS);
      uniforms.uRoofCount.value = nearby.length;
      nearby.forEach((r, index) => uniforms.uRoofs.value[index].set(r.x, r.z, r.halfWidth, r.halfDepth));
      geometry.instanceCount = visibleDrops;
      uniforms.uTime.value = time;
      uniforms.uIntensity.value = amount;
      const direction = wind?.direction ?? wind;
      const windX = Number(direction?.x);
      const windZ = Number(direction?.z ?? direction?.y);
      if (Number.isFinite(windX) && Number.isFinite(windZ)
        && windX * windX + windZ * windZ > 1e-8) {
        uniforms.uWindDirection.value.set(windX, windZ).normalize();
      } else {
        uniforms.uWindDirection.value.set(1, 0.27).normalize();
      }
      const strength = Number(wind?.strength);
      uniforms.uWind.value = (wind && Number.isFinite(strength)
        ? THREE.MathUtils.clamp(strength, 0, 1.5) : amount) * 4.3;
      uniforms.uFlash.value = lightning;
    },
  };
}
