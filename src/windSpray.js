import * as THREE from 'three';

// A few thin, camera-near salt-mist streaks make the gale visible on exposed
// paths. Motion and wrapping run on the GPU; only one draw call is needed.
const FIELD_HALF_WIDTH = 24;
const WIND_X = 0.984;
const WIND_Z = 0.177;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (lo, hi, value) => {
  const fraction = clamp01((value - lo) / (hi - lo));
  return fraction * fraction * (3 - 2 * fraction);
};

export function windSprayTarget(weather, coastalRadius, indoors = false) {
  if (indoors || weather === 'dawn') return 0;
  const exposure = smooth(0.49, 0.93, Number.isFinite(coastalRadius) ? coastalRadius : 0);
  if (weather === 'storm') return 0.35 + exposure * 0.65;
  if (weather === 'rain') return 0.07 + exposure * 0.31;
  return exposure * 0.075;
}

export function createWindSpray(scene, camera, coastalRadiusAt, { quality = 'desktop' } = {}) {
  const count = quality === 'desktop' ? 224 : 96;
  const random = seededRandom(0x42ad17);
  const origins = new Float32Array(count * 3);
  const shapes = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    origins[offset] = (random() * 2 - 1) * FIELD_HALF_WIDTH;
    origins[offset + 1] = -1.7 + random() * 7.5;
    origins[offset + 2] = (random() * 2 - 1) * FIELD_HALF_WIDTH;
    shapes[offset] = 5.5 + random() * 8.5; // metres per second
    shapes[offset + 1] = 0.22 + random() * 0.62; // streak length
    shapes[offset + 2] = random(); // opacity variation
  }

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  geometry.setAttribute('aTip', new THREE.Float32BufferAttribute([0, 1], 1));
  geometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
  geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes, 3));
  geometry.setDrawRange(0, 2);
  geometry.instanceCount = 0;

  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uDirection: { value: new THREE.Vector2(WIND_X, WIND_Z) },
    uWindStrength: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    vertexShader: `
      attribute float aTip;
      attribute vec3 aOrigin;
      attribute vec3 aShape;
      uniform float uTime;
      uniform float uIntensity;
      uniform vec2 uDirection;
      uniform float uWindStrength;
      varying float vAlpha;
      void main() {
        vec2 direction = uDirection;
        float speed = aShape.x * (0.55 + uWindStrength * 0.85);
        vec2 positionXZ = mod(aOrigin.xz + direction * uTime * speed
          + ${FIELD_HALF_WIDTH.toFixed(1)}, ${(FIELD_HALF_WIDTH * 2).toFixed(1)})
          - ${FIELD_HALF_WIDTH.toFixed(1)};
        float range = length(positionXZ);
        float nearFade = smoothstep(2.0, 5.0, range);
        float farFade = 1.0 - smoothstep(16.0, 25.0, range);
        float phase = sin(uTime * 0.89 + aOrigin.x * 0.13 + aOrigin.z * 0.09);
        vAlpha = uIntensity * (0.10 + aShape.z * 0.13)
          * nearFade * farFade * (0.72 + phase * 0.28);
        positionXZ -= direction * aTip * aShape.y;
        vec3 point = vec3(positionXZ.x, aOrigin.y, positionXZ.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(0.72, 0.81, 0.84, vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.name = 'Windblown coastal salt mist';
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  let intensity = 0;
  return {
    mesh,
    count,
    // Optional direction is { x, z } or THREE.Vector2; strength is 0..1.
    // Both may also be passed together as wind: { direction, strength }.
    update(dt, elapsed, weather, { indoors = false, wind = null,
      windDirection = null, windStrength = null } = {}) {
      const radius = typeof coastalRadiusAt === 'function'
        ? coastalRadiusAt(camera.position.x, camera.position.z) : 0;
      const rawStrength = windStrength ?? wind?.strength;
      const normalizedStrength = Number.isFinite(Number(rawStrength)) && rawStrength != null
        ? THREE.MathUtils.clamp(Number(rawStrength), 0, 1.5) : null;
      const target = windSprayTarget(weather, radius, indoors)
        * (normalizedStrength == null ? 1 : 0.2 + 0.8 * Math.min(normalizedStrength, 1));
      // Crossing a roof must immediately clear weather from the interior.
      intensity = indoors ? 0 : intensity + (target - intensity)
        * Math.min(1, Math.max(0, Number.isFinite(dt) ? dt : 0) * 2.8);
      mesh.visible = intensity > 0.025;
      geometry.instanceCount = mesh.visible ? Math.min(count, Math.ceil(count * intensity)) : 0;
      if (!mesh.visible) return;
      mesh.position.copy(camera.position);
      const direction = windDirection ?? wind?.direction ?? wind;
      const windX = Number(direction?.x);
      const windZ = Number(direction?.z ?? direction?.y);
      if (Number.isFinite(windX) && Number.isFinite(windZ)
        && windX * windX + windZ * windZ > 1e-8) {
        uniforms.uDirection.value.set(windX, windZ).normalize();
      } else {
        uniforms.uDirection.value.set(WIND_X, WIND_Z);
      }
      uniforms.uTime.value = Number.isFinite(elapsed) ? elapsed : 0;
      uniforms.uIntensity.value = intensity;
      uniforms.uWindStrength.value = normalizedStrength == null ? intensity : normalizedStrength;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
