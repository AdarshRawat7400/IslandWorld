import * as THREE from 'three';

// A small tileable density volume is generated locally at startup. Sampling it
// through a real height interval gives the clouds depth and changing parallax
// without requiring downloaded sky footage or a costly full-screen simulation.
const VOLUME_SIZE = 48;

function lattice(x, y, z) {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function makeNoiseOctave(period, size) {
  // The 48^3 volume revisits each periodic lattice point thousands of times.
  // Cache the exact hash values once; Float64 retains the original division's
  // precision, so the final uploaded Uint8 volume stays byte-for-byte equal.
  const grid = new Float64Array(period ** 3);
  for (let z = 0; z < period; z++) {
    for (let y = 0; y < period; y++) {
      for (let x = 0; x < period; x++) {
        grid[(z * period + y) * period + x] = lattice(x, y, z);
      }
    }
  }
  const low = new Uint8Array(size);
  const high = new Uint8Array(size);
  const smooth = new Float64Array(size);
  for (let index = 0; index < size; index++) {
    const coordinate = index * period / size;
    const cell = Math.floor(coordinate);
    const fraction = coordinate - cell;
    low[index] = cell;
    high[index] = (cell + 1) % period;
    smooth[index] = fraction * fraction * (3 - 2 * fraction);
  }
  return { grid, period, low, high, smooth };
}

function periodicNoise(octave, x, y, z) {
  const { grid, period, low, high, smooth } = octave;
  const x0 = low[x];
  const x1 = high[x];
  const y0 = low[y];
  const y1 = high[y];
  const z0 = low[z];
  const z1 = high[z];
  const plane = period * period;
  const base0 = z0 * plane;
  const base1 = z1 * plane;
  const a = THREE.MathUtils.lerp(grid[base0 + y0 * period + x0], grid[base0 + y0 * period + x1], smooth[x]);
  const b = THREE.MathUtils.lerp(grid[base0 + y1 * period + x0], grid[base0 + y1 * period + x1], smooth[x]);
  const c = THREE.MathUtils.lerp(grid[base1 + y0 * period + x0], grid[base1 + y0 * period + x1], smooth[x]);
  const d = THREE.MathUtils.lerp(grid[base1 + y1 * period + x0], grid[base1 + y1 * period + x1], smooth[x]);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, smooth[y]), THREE.MathUtils.lerp(c, d, smooth[y]), smooth[z]);
}

function makeCloudVolume() {
  const size = VOLUME_SIZE;
  const octaves = [4, 8, 16, 24].map((period) => makeNoiseOctave(period, size));
  const data = new Uint8Array(size ** 3);
  let index = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const density = periodicNoise(octaves[0], x, y, z) * 0.52
          + periodicNoise(octaves[1], x, y, z) * 0.27
          + periodicNoise(octaves[2], x, y, z) * 0.14
          + periodicNoise(octaves[3], x, y, z) * 0.07;
        data[index++] = Math.round(THREE.MathUtils.clamp(density, 0, 1) * 255);
      }
    }
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function makeBoltGeometry(seed, width) {
  const vertices = [];
  const positions = [];
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  // The descending trunk has short, asymmetric offshoots. Positions are local
  // to a strike group which is placed over the sea in the player's view.
  let x = 0;
  for (let i = 0; i <= 13; i++) {
    if (i) x += (random() - 0.53) * (i < 8 ? 16 : 10);
    vertices.push({ x, y: 335 - i * 24 });
  }
  const addSegment = (a, b, taper = 1) => {
    const half = width * taper * 0.5;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length * half;
    const ny = dx / length * half;
    positions.push(
      a.x + nx, a.y + ny, 0, a.x - nx, a.y - ny, 0, b.x + nx, b.y + ny, 0,
      b.x + nx, b.y + ny, 0, a.x - nx, a.y - ny, 0, b.x - nx, b.y - ny, 0,
    );
  };
  for (let i = 1; i < vertices.length; i++) {
    addSegment(vertices[i - 1], vertices[i], 1 - i / 19);
    if ((i === 3 || i === 6 || i === 9) && random() > 0.2) {
      const origin = vertices[i];
      const direction = random() > 0.5 ? 1 : -1;
      const mid = { x: origin.x + direction * (20 + random() * 15), y: origin.y - 18 };
      const tip = { x: mid.x + direction * (14 + random() * 15), y: mid.y - 23 };
      addSegment(origin, mid, 0.53);
      addSegment(mid, tip, 0.35);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b);
  state ^= state >>> 16;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function offshoreDistance(camera, direction, preferred, random) {
  // The island and its buildings occupy the central ~400 m. Place bolts past
  // that shoreline even when the camera looks across the full island.
  const radius = 470;
  const along = camera.position.x * direction.x + camera.position.z * direction.z;
  const radialSquared = camera.position.x ** 2 + camera.position.z ** 2;
  const crossing = along * along + radius * radius - radialSquared;
  const farShore = crossing >= 0 ? -along + Math.sqrt(crossing) : 0;
  return Math.max(preferred, farShore + 32 + random * 42);
}

export function createStormSky(scene) {
  const uniforms = {
    uTime: { value: 0 },
    uCameraHeight: { value: 0 },
    uCameraXZ: { value: new THREE.Vector2() },
    uSteps: { value: 8 },
    uHorizon: { value: new THREE.Color(0x899b9b) },
    uZenith: { value: new THREE.Color(0x879797) },
    uCloud: { value: new THREE.Color(0x718184) },
    uCover: { value: 0.52 },
    uStorm: { value: 0 },
    // Direction vectors point from the island toward the celestial bodies.
    // The weather controller accumulates wind displacement in world-space X/Z
    // so changing wind speed or direction does not jump the cloud pattern.
    uSunDirection: { value: new THREE.Vector3(-0.4, 0.65, -0.3).normalize() },
    uMoonDirection: { value: new THREE.Vector3(0.36, -0.5, 0.42).normalize() },
    uDaylight: { value: 1 },
    uTwilight: { value: 0 },
    uNight: { value: 0 },
    uMoonPhase: { value: 0.8 },
    uWindVector: { value: new THREE.Vector2(-3.2, 2.0) },
    uWindOffset: { value: new THREE.Vector2() },
    uFlash: { value: 0 },
    uBoltDirection: { value: new THREE.Vector3(-0.4, 0.35, -0.8).normalize() },
    uDensityVolume: { value: makeCloudVolume() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    glslVersion: THREE.GLSL3,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      out vec4 cloudFragment;
      #define gl_FragColor cloudFragment
      uniform sampler3D uDensityVolume;
      uniform float uTime;
      uniform float uCameraHeight;
      uniform vec2 uCameraXZ;
      uniform float uSteps;
      uniform float uCover;
      uniform float uStorm;
      uniform float uFlash;
      uniform float uDaylight;
      uniform float uTwilight;
      uniform float uNight;
      uniform float uMoonPhase;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uCloud;
      uniform vec3 uBoltDirection;
      uniform vec3 uSunDirection;
      uniform vec3 uMoonDirection;
      uniform vec2 uWindOffset;

      float densityAt(vec3 p, float layer) {
        // Shift the sampled field opposite accumulated wind displacement.
        vec3 drifted = vec3(p.x - uWindOffset.x,
          p.y, p.z - uWindOffset.y);
        // The uploaded volume already contains four spatial octaves, so one
        // trilinear 3D lookup per march step retains its billowy detail.
        float billow = texture(uDensityVolume, drifted * 0.0019).r;
        float threshold = mix(0.61, 0.39, uCover);
        float ceiling = 0.83 + (billow - 0.5) * 0.24;
        float vertical = smoothstep(0.01, 0.13, layer)
          * (1.0 - smoothstep(ceiling - 0.18, ceiling, layer));
        return smoothstep(threshold - 0.075, threshold + 0.105, billow) * vertical;
      }

      void main() {
        vec3 ray = normalize(vDirection);
        float height = clamp((ray.y + 0.05) * 1.2, 0.0, 1.0);
        vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.9, height));
        vec3 sunDirection = normalize(uSunDirection);
        vec3 moonDirection = normalize(uMoonDirection);
        float sunFacing = max(dot(ray, sunDirection), 0.0);
        float moonFacing = max(dot(ray, moonDirection), 0.0);
        float daylight = clamp(uDaylight, 0.0, 1.0);
        float twilight = clamp(uTwilight, 0.0, 1.0);
        float night = clamp(uNight, 0.0, 1.0);

        // Both discs and the sparse star field belong to the clear sky. The
        // cloud march below naturally obscures them through transmission.
        float warmHorizon = twilight * pow(sunFacing, 5.0)
          * (1.0 - smoothstep(0.0, 0.55, ray.y));
        sky += vec3(0.74, 0.31, 0.12) * warmHorizon * 0.42;
        float sunDisc = smoothstep(0.99987, 0.999975, sunFacing)
          * smoothstep(-0.015, 0.025, sunDirection.y);
        float sunHalo = pow(sunFacing, 80.0);
        sky += vec3(1.0, 0.78, 0.52) * (sunDisc * 0.75 + sunHalo * 0.12)
          * (daylight + twilight * 0.65) * (1.0 - uStorm * 0.6);

        if (night > 0.002 && ray.y > 0.025) {
          vec3 starCoord = ray * 220.0;
          vec3 cell = floor(starCoord);
          float seed = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
          float star = step(0.9965, seed)
            * (1.0 - smoothstep(0.035, 0.18, length(fract(starCoord) - 0.5)));
          float twinkle = 0.87 + 0.13 * sin(uTime * (0.8 + seed) + seed * 31.0);
          sky += vec3(0.76, 0.86, 1.0) * star * night * twinkle * (0.45 + seed * 0.45);
          float moonDisc = smoothstep(0.99983, 0.99996, moonFacing)
            * smoothstep(-0.015, 0.025, moonDirection.y);
          float moonHalo = pow(moonFacing, 110.0);
          sky += vec3(0.62, 0.72, 0.91) * (moonDisc * 0.68 + moonHalo * 0.11)
            * night * clamp(uMoonPhase, 0.0, 1.0);
        }

        // The cloud layer occupies physical height above the island. A short
        // ray march through its 3D density gives distinct near and far banks.
        if (ray.y > 0.025) {
          float rise = max(ray.y, 0.055);
          float entry = max(0.0, (145.0 - uCameraHeight) / rise);
          float exit = min(3900.0, (435.0 - uCameraHeight) / rise);
          float distanceThrough = max(0.0, exit - entry);
          float stride = distanceThrough / uSteps;
          float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          float transmission = 1.0;
          vec3 scattered = vec3(0.0);
          float cloudLight = 0.28 + daylight * 0.72 + twilight * 0.24
            + night * clamp(uMoonPhase, 0.0, 1.0) * 0.09;
          float sunScatter = pow(sunFacing, 9.0) * (daylight * 0.12 + twilight * 0.34);
          float moonScatter = pow(moonFacing, 12.0) * night * uMoonPhase * 0.14;
          for (int i = 0; i < 8; i++) {
            if (float(i) >= uSteps) break;
            float along = entry + (float(i) + 0.24 + jitter * 0.52) * stride;
            vec3 point = vec3(uCameraXZ.x + ray.x * along,
              uCameraHeight + ray.y * along, uCameraXZ.y + ray.z * along);
            float layer = clamp((point.y - 145.0) / 290.0, 0.0, 1.0);
            float density = densityAt(point, layer);
            float opacity = 1.0 - exp(-density * stride * 0.0085);
            float lit = 0.67 + layer * 0.27 + (1.0 - density) * 0.19;
            vec3 edgeScatter = (vec3(0.82, 0.48, 0.23) * sunScatter
              + vec3(0.32, 0.43, 0.63) * moonScatter)
              * (1.0 - density * 0.55) * (0.45 + layer * 0.55);
            vec3 shade = mix(uCloud * lit * cloudLight + edgeScatter,
              uHorizon * cloudLight, 0.10 + layer * 0.09);
            scattered += transmission * opacity * shade;
            transmission *= 1.0 - opacity;
          }
          // A soft fog bank covers the low sky where the finite volume ends.
          float horizonBank = exp(-pow((ray.y - 0.055) * 8.0, 2.0)) * uCover * 0.33;
          sky = sky * transmission + scattered;
          sky = mix(sky, uCloud, horizonBank * transmission);
        }
        float strikeAlignment = max(dot(ray, normalize(uBoltDirection)), 0.0);
        float localFlash = uFlash * (0.12 + 0.88 * pow(strikeAlignment, 5.0));
        sky += vec3(0.72, 0.84, 1.0) * localFlash * (0.65 + uStorm * 0.35);
        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), material);
  mesh.name = 'Procedural volumetric storm clouds';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Reuse a tiny fixed pool so a storm front can show several distant forks
  // without adding draw calls or geometry allocations during calm weather.
  const boltPairs = Array.from({ length: 3 }, (_, index) => {
    const core = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0xe4f5ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    }));
    const glow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0x82b8ef, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    }));
    core.name = `Forked lightning ${index + 1}`;
    glow.name = `Lightning glow ${index + 1}`;
    core.renderOrder = 6;
    glow.renderOrder = 5;
    core.visible = false;
    glow.visible = false;
    scene.add(glow, core);
    return { core, glow };
  });
  let activeBolts = 0;

  function strike(camera, elapsed, boltCount = 1) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.01) forward.set(0, 0, -1);
    forward.normalize();
    const side = new THREE.Vector3(-forward.z, 0, forward.x);
    const seed = (Math.floor(elapsed * 1000) ^ 0x71c7) >>> 0;
    const random = seededRandom(seed);
    activeBolts = Math.max(1, Math.min(boltPairs.length, Math.floor(boltCount)));
    const verticalFov = THREE.MathUtils.degToRad(camera.fov || 72);
    const horizontalHalfView = Math.atan(Math.tan(verticalFov * 0.5) * (camera.aspect || 16 / 9));
    const viewLimit = Math.min(0.63, Math.max(0.16, horizontalHalfView - 0.11));
    const angles = [];
    if (activeBolts === 1) {
      angles.push((random() - 0.5) * viewLimit * 1.8);
    } else {
      const center = (random() - 0.5) * viewLimit * 0.42;
      const spacing = viewLimit * (0.68 + random() * 0.13);
      for (let index = 0; index < activeBolts; index++) {
        angles.push(center + (index - (activeBolts - 1) * 0.5) * spacing);
      }
      // Do not make the primary strike consistently the leftmost one. This
      // also lets its thunder pan follow either side of a multi-bolt front.
      for (let index = angles.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [angles[index], angles[other]] = [angles[other], angles[index]];
      }
    }
    let primaryPan = 0;
    boltPairs.forEach(({ core, glow }, index) => {
      if (index >= activeBolts) {
        core.visible = false;
        glow.visible = false;
        return;
      }
      const angle = angles[index];
      const direction = forward.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(side, Math.sin(angle));
      const distance = offshoreDistance(camera, direction, 520 + random() * 300, random());
      const heightScale = 0.82 + random() * 0.24;
      const widthScale = Math.min(1.35, Math.max(0.95, distance / 700));
      const center = camera.position.clone()
        .addScaledVector(direction, distance);
      // The final branch lands near sea level behind the island silhouette.
      center.y = -23 * heightScale + random() * 7;
      const boltSeed = seed ^ Math.imul(index + 1, 0x45d9f3b);
      core.geometry.dispose();
      glow.geometry.dispose();
      core.geometry = makeBoltGeometry(boltSeed, 2.1);
      glow.geometry = makeBoltGeometry(boltSeed, 10);
      core.position.copy(center);
      glow.position.copy(center);
      core.scale.set(widthScale, heightScale, 1);
      glow.scale.copy(core.scale);
      // Keep the ribbon vertical while rotating its width to face the player.
      core.rotation.set(0, Math.atan2(camera.position.x - center.x, camera.position.z - center.z), 0);
      glow.rotation.copy(core.rotation);
      if (index === 0) {
        uniforms.uBoltDirection.value.copy(center).sub(camera.position)
          .add(new THREE.Vector3(0, 170, 0)).normalize();
        primaryPan = THREE.MathUtils.clamp(Math.sin(angle) / Math.sin(viewLimit), -1, 1);
      }
    });
    return primaryPan;
  }

  function updateLightning(strength) {
    uniforms.uFlash.value = strength;
    boltPairs.forEach(({ core, glow }, index) => {
      core.visible = index < activeBolts && strength > 0.035;
      glow.visible = index < activeBolts && strength > 0.06;
      const falloff = index === 0 ? 1 : 0.8;
      core.material.opacity = Math.min(1, strength * 1.35 * falloff);
      glow.material.opacity = Math.min(0.25, strength * 0.23 * falloff);
    });
  }

  return { mesh, uniforms, strike, updateLightning };
}
