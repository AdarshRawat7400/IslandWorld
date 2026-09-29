import * as THREE from 'three';

// Two tended fires, not a burning island. The lodge shell already has a
// cast-iron stove centred at local (5.4, -3.2), with its firebox facing +z.
// The intake brazier sits below the existing 4 x 3.2 m gatehouse canopy,
// clear of the open x=-58 entrance lane and the guards.
export const FIRE_SOURCE_LAYOUT = Object.freeze([
  Object.freeze({
    id: 'lodge_stove', kind: 'stove', x: -84.6, z: 181.8,
    groundX: -90, groundZ: 185, sheltered: true,
  }),
  Object.freeze({
    id: 'gatehouse_brazier', kind: 'brazier', x: -55.8, z: 98.2,
    groundX: -55.8, groundZ: 98.2, sheltered: true,
  }),
]);

const MAX_FIRE_STEPS = 14;
const MAX_SMOKE_STEPS = 10;
const OBJECT_VISIBILITY_METRES = 95;
const VOLUME_VISIBILITY_METRES = 38;
const LIGHT_VISIBILITY_METRES = 27;
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_SPHERE = new THREE.SphereGeometry(1, 6, 4);
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function hash(x, y, z) {
  let h = Math.imul(x + 17, 73856093)
    ^ Math.imul(y + 29, 19349663)
    ^ Math.imul(z + 43, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function lattice(x, y, z, period) {
  return hash(((x % period) + period) % period,
    ((y % period) + period) % period,
    ((z % period) + period) % period) / 4294967295;
}

function periodicNoise(x, y, z, period) {
  const sx = x * period;
  const sy = y * period;
  const sz = z * period;
  const ix = Math.floor(sx), iy = Math.floor(sy), iz = Math.floor(sz);
  const fx = sx - ix, fy = sy - iy, fz = sz - iz;
  const tx = fx * fx * (3 - 2 * fx);
  const ty = fy * fy * (3 - 2 * fy);
  const tz = fz * fz * (3 - 2 * fz);
  const mix = (a, b, t) => a + (b - a) * t;
  const low = mix(
    mix(lattice(ix, iy, iz, period), lattice(ix + 1, iy, iz, period), tx),
    mix(lattice(ix, iy + 1, iz, period), lattice(ix + 1, iy + 1, iz, period), tx), ty);
  const high = mix(
    mix(lattice(ix, iy, iz + 1, period), lattice(ix + 1, iy, iz + 1, period), tx),
    mix(lattice(ix, iy + 1, iz + 1, period), lattice(ix + 1, iy + 1, iz + 1, period), tx), ty);
  return mix(low, high, tz);
}

/** A tiny repeatable 3D volume. It is generated here and has no asset license. */
export function makeFireNoiseVolume(size = 32) {
  if (!Number.isInteger(size) || size < 8 || size > 64) {
    throw new RangeError('Fire noise volume size must be an integer from 8 to 64');
  }
  const voxels = new Uint8Array(size ** 3);
  let offset = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size, pz = z / size;
    const value = periodicNoise(px, py, pz, 4) * 0.55
      + periodicNoise(px, py, pz, 8) * 0.31
      + periodicNoise(px, py, pz, 16) * 0.14;
    voxels[offset++] = Math.round(clamp(value, 0, 1) * 255);
  }
  const texture = new THREE.Data3DTexture(voxels, size, size, size);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// Each volume is an actual finite 3D density field. A front-face fragment
// marches through the box from the eye and accumulates depth-dependent colour
// and opacity. No camera-facing quads or alpha-card smoke are involved.
const VOLUME_VERTEX = `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOLUME_FRAGMENT = `
  varying vec3 vLocal;
  out vec4 volumeFragment;
  #define gl_FragColor volumeFragment
  uniform sampler3D uNoise;
  uniform vec3 uCameraLocal;
  uniform vec2 uWind;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSmoke;
  uniform float uSteps;

  float sampleDensity(vec3 p) {
    float h = p.y + 0.5;
    vec3 smokeSample = p * vec3(1.7, 1.2, 1.7)
      + vec3(uTime * 0.018, -uTime * 0.085, uTime * 0.011);
    vec3 flameSample = p * vec3(2.2, 1.5, 2.2)
      + vec3(uTime * 0.12, -uTime * 0.34, uTime * 0.07);
    // Keep the 3D lookup outside the material branch. Some WebGL shader
    // compilers otherwise warn that the derivative LOD may be undefined.
    float turbulence = texture(uNoise,
      mix(flameSample, smokeSample, step(0.5, uSmoke))).r;
    if (uSmoke > 0.5) {
      vec2 shear = uWind * h * 0.19;
      vec2 planar = p.xz - shear;
      float radius = mix(0.22, 0.47, h);
      float edge = 1.0 - smoothstep(0.58, 1.14,
        length(planar / radius));
      return edge * smoothstep(0.0, 0.14, h)
        * (1.0 - smoothstep(0.84, 1.0, h))
        * smoothstep(0.27, 0.66, turbulence);
    }
    float swing = sin(h * 9.0 + uTime * 3.9) * 0.045
      + (turbulence - 0.5) * 0.13;
    float width = mix(0.40, 0.025, pow(h, 0.84));
    float radius = length(vec2((p.x - swing) / width,
      p.z / (width * 0.74)));
    return (1.0 - smoothstep(0.54, 1.08, radius))
      * smoothstep(0.0, 0.10, h)
      * (1.0 - smoothstep(0.86, 1.0, h))
      * (0.60 + 0.40 * turbulence);
  }

  void main() {
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocal - ro);
    // The small epsilon keeps an axis-aligned view finite.
    vec3 safeRay = rd + vec3(0.000001);
    vec3 t0 = (vec3(-0.5) - ro) / safeRay;
    vec3 t1 = (vec3(0.5) - ro) / safeRay;
    vec3 nearSide = min(t0, t1);
    vec3 farSide = max(t0, t1);
    float entry = max(max(nearSide.x, nearSide.y), nearSide.z);
    float exit = min(min(farSide.x, farSide.y), farSide.z);
    entry = max(entry, 0.0);
    if (exit <= entry) discard;
    float transmittance = 1.0;
    vec3 scattered = vec3(0.0);
    float stride = (exit - entry) / uSteps;
    float jitter = fract(sin(dot(gl_FragCoord.xy,
      vec2(12.9898, 78.233))) * 43758.5453);
    for (int i = 0; i < 14; i++) {
      if (float(i) >= uSteps) break;
      vec3 p = ro + rd * (entry + (float(i) + 0.25
        + jitter * 0.50) * stride);
      float density = sampleDensity(p);
      float alpha = uSmoke > 0.5
        ? 1.0 - exp(-density * stride * 1.65)
        : 1.0 - exp(-density * stride * 9.2);
      float h = clamp(p.y + 0.5, 0.0, 1.0);
      vec3 tint = uSmoke > 0.5
        ? mix(vec3(0.24, 0.26, 0.27), vec3(0.43, 0.45, 0.44), h)
        : mix(vec3(1.65, 0.77, 0.22), vec3(1.12, 0.24, 0.045), h);
      if (uSmoke < 0.5) tint += vec3(0.28, 0.18, 0.035)
        * (1.0 - smoothstep(0.0, 0.42, abs(p.x)))
        * (1.0 - smoothstep(0.0, 0.62, h));
      scattered += transmittance * alpha * tint;
      transmittance *= 1.0 - alpha;
    }
    float opacity = (1.0 - transmittance) * uOpacity;
    if (opacity < 0.009) discard;
    gl_FragColor = vec4(scattered / max(1.0 - transmittance, 0.001),
      opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function volumeMaterial(texture, smoke, steps) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: texture },
      uCameraLocal: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(-0.7, 0.2) },
      uTime: { value: 0 },
      uOpacity: { value: smoke ? 0.56 : 0.96 },
      uSmoke: { value: smoke ? 1 : 0 },
      uSteps: { value: steps },
    },
    glslVersion: THREE.GLSL3,
    vertexShader: VOLUME_VERTEX,
    fragmentShader: VOLUME_FRAGMENT,
    side: THREE.FrontSide,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    fog: false,
  });
}

function instancedBoxes(parent, specs, material, name) {
  const mesh = new THREE.InstancedMesh(UNIT_BOX, material, specs.length);
  mesh.name = name;
  for (let i = 0; i < specs.length; i++) {
    const [x, y, z, width, height, depth] = specs[i];
    _position.set(x, y, z);
    _scale.set(width, height, depth);
    _matrix.compose(_position, new THREE.Quaternion(), _scale);
    mesh.setMatrixAt(i, _matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCoalBed(group, material, x, y, z) {
  const coal = new THREE.InstancedMesh(UNIT_SPHERE, material, 9);
  coal.name = 'Small glowing coals';
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996;
    const r = Math.sqrt(i / 9) * 0.32;
    _position.set(x + Math.cos(a) * r, y + (i % 3) * 0.018,
      z + Math.sin(a) * r * 0.55);
    _scale.setScalar(0.044 + (i % 3) * 0.014);
    _matrix.compose(_position, new THREE.Quaternion(), _scale);
    coal.setMatrixAt(i, _matrix);
  }
  coal.instanceMatrix.needsUpdate = true;
  group.add(coal);
  return coal;
}

function makeStoveFixture(group, iron, coal) {
  // The authored shell supplies the stove body and pipe. Its inward-facing
  // iron panel is at local z=-2.75. A 20 cm projecting firebox makes the
  // flame visible from the room without cutting a hole into that model.
  instancedBoxes(group, [
    [-0.56, 0.86, 0.54, 0.10, 0.72, 0.21],
    [0.56, 0.86, 0.54, 0.10, 0.72, 0.21],
    [0, 1.23, 0.54, 1.18, 0.09, 0.21],
    [0, 0.49, 0.54, 1.18, 0.10, 0.21],
    [-0.32, 0.86, 0.68, 0.035, 0.70, 0.035],
    [0.32, 0.86, 0.68, 0.035, 0.70, 0.035],
  ], iron, 'Keeper stove firebox iron surround');
  addCoalBed(group, coal, 0, 0.61, 0.58);
}

function makeBrazierFixture(group, iron, coal) {
  instancedBoxes(group, [
    [0, 0.42, 0, 0.10, 0.72, 0.10],
    [0, 0.11, 0, 0.70, 0.13, 0.70],
    [-0.31, 0.82, 0, 0.08, 0.27, 0.57],
    [0.31, 0.82, 0, 0.08, 0.27, 0.57],
    [0, 0.82, -0.27, 0.61, 0.27, 0.07],
    [0, 0.74, 0.27, 0.61, 0.10, 0.07],
  ], iron, 'Covered gatehouse brazier iron');
  addCoalBed(group, coal, 0, 0.81, 0);
}

/** Create two modest, collision-free fires with depth-shaded 3D flames.
 * update() accepts absolute seconds, weather and the camera world position.
 * The source meshes are shader-cullable independently of their static ironwork.
 */
export function createFireAtmosphere(scene, terrainHeight, { quality = 'desktop' } = {}) {
  if (!scene?.add || typeof terrainHeight !== 'function') {
    throw new TypeError('createFireAtmosphere requires a scene and terrainHeight(x, z)');
  }
  const mobile = String(quality).startsWith('mobile');
  const noise = makeFireNoiseVolume(mobile ? 24 : 32);
  const fireSteps = mobile ? 8 : MAX_FIRE_STEPS;
  const smokeSteps = mobile ? 5 : MAX_SMOKE_STEPS;
  const iron = new THREE.MeshStandardMaterial({
    color: 0x242b2c, roughness: 0.66, metalness: 0.65,
  });
  const coal = new THREE.MeshStandardMaterial({
    color: 0x39261d, emissive: 0xd54816, emissiveIntensity: 0.72,
    roughness: 0.9,
  });
  const group = new THREE.Group();
  group.name = 'Contained island fires and volumetric smoke';
  scene.add(group);
  const sources = FIRE_SOURCE_LAYOUT.map((layout, index) => {
    const root = new THREE.Group();
    root.name = layout.id;
    root.position.set(layout.x,
      terrainHeight(layout.groundX, layout.groundZ) + 0.08, layout.z);
    group.add(root);
    if (layout.kind === 'stove') makeStoveFixture(root, iron, coal);
    else makeBrazierFixture(root, iron, coal);

    const flameMaterial = volumeMaterial(noise, false, fireSteps);
    const flame = new THREE.Mesh(UNIT_BOX, flameMaterial);
    flame.name = `${layout.id} bounded volumetric flame`;
    if (layout.kind === 'stove') {
      flame.position.set(0, 0.88, 0.57);
      flame.scale.set(0.84, 0.69, 0.28);
    } else {
      flame.position.set(0, 1.14, 0);
      flame.scale.set(0.68, 0.69, 0.62);
    }
    flame.renderOrder = 8;
    root.add(flame);

    let smoke = null;
    if (layout.kind === 'brazier') {
      const smokeMaterial = volumeMaterial(noise, true, smokeSteps);
      smoke = new THREE.Mesh(UNIT_BOX, smokeMaterial);
      smoke.name = `${layout.id} bounded volumetric smoke`;
      smoke.position.set(0.18, 1.87, 0.0);
      smoke.scale.set(1.18, 1.15, 1.05);
      smoke.renderOrder = 9;
      root.add(smoke);
    }
    const light = new THREE.PointLight(0xff7833,
      layout.kind === 'stove' ? 1.45 : 1.15, 8, 2);
    light.position.copy(flame.position);
    light.name = `${layout.id} firelight`;
    light.castShadow = false;
    root.add(light);
    return { ...layout, root, flame, smoke, light, phase: index * 2.17 };
  });

  const localCamera = new THREE.Vector3();
  function update(elapsed = 0, { weather = 'mist', cameraPosition = null } = {}) {
    const time = Number.isFinite(elapsed) ? elapsed : 0;
    const camera = cameraPosition && [cameraPosition.x, cameraPosition.y,
      cameraPosition.z].every(Number.isFinite) ? cameraPosition : null;
    const storm = weather === 'storm';
    const rain = weather === 'rain' || storm;
    for (const source of sources) {
      const distance = camera ? source.root.position.distanceTo(camera) : 0;
      source.root.visible = distance <= OBJECT_VISIBILITY_METRES;
      if (!source.root.visible) continue;
      const visibleVolume = distance <= VOLUME_VISIBILITY_METRES;
      source.flame.visible = visibleVolume;
      if (source.smoke) source.smoke.visible = visibleVolume && distance < 30;
      source.light.intensity = distance <= LIGHT_VISIBILITY_METRES
        ? (source.kind === 'stove' ? 1.45 : 1.15)
          * (0.90 + 0.10 * Math.sin(time * 8.4 + source.phase)
            + 0.045 * Math.sin(time * 13.1 + source.phase))
        : 0;
      source.flame.material.uniforms.uTime.value = time + source.phase;
      source.flame.material.uniforms.uOpacity.value = source.kind === 'stove'
        ? 0.85 : rain ? 0.81 : 0.94;
      if (source.smoke) {
        source.smoke.material.uniforms.uTime.value = time + source.phase;
        source.smoke.material.uniforms.uOpacity.value = storm ? 0.42 : rain ? 0.49 : 0.56;
        source.smoke.material.uniforms.uWind.value.set(storm ? -1.0 : -0.62,
          storm ? 0.46 : 0.22);
      }
      if (camera && visibleVolume) {
        for (const mesh of [source.flame, source.smoke]) {
          if (!mesh?.visible) continue;
          mesh.updateWorldMatrix(true, false);
          mesh.worldToLocal(localCamera.copy(camera));
          mesh.material.uniforms.uCameraLocal.value.copy(localCamera);
        }
      }
    }
  }
  update(0);

  return {
    group, sources, noise, quality: mobile ? 'mobile' : 'desktop',
    update,
    dispose() {
      group.parent?.remove(group);
      for (const source of sources) {
        source.flame.material.dispose();
        source.smoke?.material.dispose();
      }
      iron.dispose();
      coal.dispose();
      noise.dispose();
    },
  };
}
