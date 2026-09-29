import * as THREE from 'three';
import { createOffshoreIslandDetail } from './offshoreIslandDetail.js';
import { createOffshoreLighthouse } from './offshoreLighthouse.js';

// Scenery only. These islands deliberately have no terrain sampler, collision,
// vegetation simulation, or shadow maps. Positions and dimensions are metres.
export const DISTANT_ISLANDS = Object.freeze([
  Object.freeze({
    id: 'north-watch', name: 'North Watch', x: 340, z: -1700,
    radiusX: 365, radiusZ: 290, cliffHeight: 47, hillHeight: 24,
    seed: 0.7, lighthouse: Object.freeze({ x: -105, z: 15, period: 11, phase: 0.35 }),
  }),
  Object.freeze({
    id: 'southwest-warden', name: 'Southwest Warden', x: -1450, z: 1150,
    radiusX: 355, radiusZ: 310, cliffHeight: 54, hillHeight: 19,
    seed: 4.6, lighthouse: Object.freeze({ x: 85, z: -72, period: 12.5, phase: 2.6 }),
  }),
]);

const TWO_PI = Math.PI * 2;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function coastFactor(spec, angle) {
  return 1 + 0.045 * Math.sin(3 * angle + spec.seed)
    + 0.026 * Math.sin(7 * angle - spec.seed * 1.4)
    + 0.014 * Math.cos(11 * angle + spec.seed * 2.3);
}

function coastPoint(spec, angle, radius) {
  const irregular = coastFactor(spec, angle) * radius;
  return [spec.radiusX * Math.cos(angle) * irregular,
    spec.radiusZ * Math.sin(angle) * irregular];
}

/** Height of the distant grass cap in island-local coordinates. */
export function sampleDistantIslandHeight(spec, x, z) {
  const angle = Math.atan2(z / spec.radiusZ, x / spec.radiusX);
  const radius = Math.hypot(x / spec.radiusX, z / spec.radiusZ)
    / coastFactor(spec, angle);
  const inner = clamp(1 - radius, 0, 1);
  const rim = (5.6 * Math.sin(angle * 2 + spec.seed)
    + 3.1 * Math.sin(angle * 5 - spec.seed * 0.8)) * radius * radius;
  const ridgeX = spec.radiusX * (-0.20 + 0.26 * Math.sin(spec.seed));
  const ridgeZ = spec.radiusZ * (0.08 + 0.20 * Math.cos(spec.seed));
  const dx = (x - ridgeX) / (spec.radiusX * 0.40);
  const dz = (z - ridgeZ) / (spec.radiusZ * 0.34);
  const ridge = Math.exp(-(dx * dx + dz * dz) * 1.6) * 13 * inner;
  // Southwest Warden rises into an off-centre, weathered headland. Its higher
  // shoulder gives the second island a recognisably different skyline from
  // North Watch's long, even plateau without adding geometry or draw calls.
  const shoulderX = (x + 155) / (spec.radiusX * 0.48);
  const shoulderZ = (z - 35) / (spec.radiusZ * 0.43);
  const headland = spec.id === 'southwest-warden'
    ? 66 * Math.exp(-(shoulderX * shoulderX + shoulderZ * shoulderZ * 1.3) * 1.25)
      * Math.pow(inner, 0.48)
    : 0;
  return spec.cliffHeight + spec.hillHeight * Math.pow(inner, 0.85)
    + rim + ridge + headland;
}

function setVertex(vertices, colors, x, y, z, color) {
  vertices.push(x, y, z);
  colors.push(color.r, color.g, color.b);
}

function makeGeometry(vertices, colors, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Low-cost high grass cap and stratified cliff wall for a single offshore island. */
export function buildDistantIslandGeometry(spec, segments = 96) {
  const rings = 10;
  const topVertices = [], topColors = [], topIndices = [];
  const grass = new THREE.Color(0x537253);
  const heather = new THREE.Color(0x73835b);
  const rimStone = new THREE.Color(0x6a746b);
  const tint = new THREE.Color();
  for (let ring = 0; ring <= rings; ring++) {
    const radius = ring / rings;
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * TWO_PI;
      const [x, z] = coastPoint(spec, angle, radius);
      const y = sampleDistantIslandHeight(spec, x, z);
      const dryPatch = smooth(-0.3, 0.5,
        Math.sin(x * 0.017 + spec.seed) * Math.cos(z * 0.021 - spec.seed));
      tint.copy(grass).lerp(heather, dryPatch * 0.46);
      tint.lerp(rimStone, smooth(0.79, 1, radius) * 0.61);
      setVertex(topVertices, topColors, x, y, z, tint);
    }
  }
  const stride = segments + 1;
  for (let ring = 0; ring < rings; ring++) {
    for (let i = 0; i < segments; i++) {
      const a = ring * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      topIndices.push(a, b, c, b, d, c);
    }
  }

  const cliffVertices = [], cliffColors = [], cliffIndices = [];
  const deepRock = new THREE.Color(0x3c484b);
  const paleRock = new THREE.Color(0x89908a);
  const wetRock = new THREE.Color(0x323f46);
  const cliffRows = 8;
  for (let row = 0; row <= cliffRows; row++) {
    const depth = row / cliffRows;
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * TWO_PI;
      const [rimX, rimZ] = coastPoint(spec, angle, 1);
      const topY = sampleDistantIslandHeight(spec, rimX, rimZ);
      const stepped = 1 + 0.022 * depth + 0.006 * Math.sin(depth * 25 + angle * 13 + spec.seed);
      const x = rimX * stepped;
      const z = rimZ * stepped;
      const y = topY * (1 - depth) - 2.2 * depth;
      const stratum = 0.5 + 0.5 * Math.sin(y * 0.23 + angle * 4 + spec.seed);
      tint.copy(deepRock).lerp(paleRock, 0.15 + stratum * 0.42);
      tint.lerp(wetRock, smooth(0.64, 0.98, depth) * 0.7);
      tint.lerp(rimStone, (1 - smooth(0.0, 0.18, depth)) * 0.4);
      setVertex(cliffVertices, cliffColors, x, y, z, tint);
    }
  }
  for (let row = 0; row < cliffRows; row++) {
    for (let i = 0; i < segments; i++) {
      const a = row * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      cliffIndices.push(a, b, c, b, d, c);
    }
  }
  return {
    cap: makeGeometry(topVertices, topColors, topIndices),
    cliff: makeGeometry(cliffVertices, cliffColors, cliffIndices),
  };
}

function makeAtmosphericMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexColors: true,
    fog: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vColor = color;
        vNormal = normalize(normalMatrix * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uVisibilityFloor;
      uniform float uNight;
      uniform float uLightning;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec3 lightDirection = normalize(vec3(-0.42, 0.84, 0.32));
        float lit = max(dot(normalize(vNormal), lightDirection), 0.0);
        float ambient = mix(0.61, 0.30, uNight);
        float diffuse = mix(0.35, 0.09, uNight);
        vec3 land = vColor * (ambient + diffuse * lit + uLightning * 0.38);
        float distanceToCamera = distance(cameraPosition, vWorld);
        // Remote land uses a separate fog floor: in storms it remains a faint
        // silhouette while the shared sea and nearby terrain keep dense fog.
        float visibility = max(exp(-pow(distanceToCamera * uFogDensity * 0.56, 2.0)),
          uVisibilityFloor);
        visibility *= mix(0.81, 1.0, smoothstep(2.0, 60.0, vWorld.y));
        gl_FragColor = vec4(mix(uFogColor, land, visibility), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Decorative remote archipelago; call update with the current weather state. */
export function createDistantIslands(scene) {
  if (!scene?.add) throw new TypeError('createDistantIslands requires a Three.js scene');
  const root = new THREE.Group();
  root.name = 'Distant offshore islands';
  const uniforms = {
    uFogColor: { value: new THREE.Color(0x899b9b) },
    uFogDensity: { value: 0.0027 },
    uVisibilityFloor: { value: 0.23 },
    uNight: { value: 0 },
    uLightning: { value: 0 },
  };
  const terrainMaterial = makeAtmosphericMaterial(uniforms);
  const islands = [];
  const beacons = [];
  for (const spec of DISTANT_ISLANDS) {
    const group = new THREE.Group();
    group.name = `Distant island: ${spec.name}`;
    group.position.set(spec.x, 0, spec.z);
    const geometry = buildDistantIslandGeometry(spec);
    const cap = new THREE.Mesh(geometry.cap, terrainMaterial);
    cap.name = `${spec.name} grass cap`;
    const cliff = new THREE.Mesh(geometry.cliff, terrainMaterial);
    cliff.name = `${spec.name} sea cliffs`;
    const detail = createOffshoreIslandDetail(spec, {
      sampleHeight: sampleDistantIslandHeight,
    });
    group.add(cap, cliff, detail.group);
    if (spec.lighthouse) {
      const beacon = createOffshoreLighthouse(spec, {
        groundY: sampleDistantIslandHeight(spec, spec.lighthouse.x, spec.lighthouse.z),
      });
      group.add(beacon.group);
      beacons.push(beacon);
    }
    root.add(group);
    islands.push({ spec, group, cap, cliff, detail });
  }
  scene.add(root);

  const fallbackFog = new THREE.Color(0x899b9b);
  function update(elapsed = 0, { night = 0, weather = 'mist', fogColor = null,
    fogDensity = 0.0027, lightning = 0, cameraPosition = null } = {}) {
    const time = Number.isFinite(elapsed) ? elapsed : 0;
    const nightLevel = clamp(Number(night) || 0, 0, 1);
    const storm = weather === 'storm';
    const rainy = weather === 'rain';
    const fog = fogColor?.isColor ? fogColor : fallbackFog;
    const floor = weather === 'clear' ? 0.50 : weather === 'dawn' ? 0.45
      : storm ? 0.23 : rainy ? 0.28 : 0.34;
    uniforms.uFogColor.value.copy(fog);
    uniforms.uFogDensity.value = Number.isFinite(fogDensity)
      ? Math.max(0, fogDensity) : 0.0027;
    uniforms.uVisibilityFloor.value = floor;
    uniforms.uNight.value = nightLevel;
    uniforms.uLightning.value = clamp(Number(lightning) || 0, 0, 1);
    for (const island of islands) {
      island.detail.update(time, { weather, fogColor: fog, fogDensity,
        night: nightLevel, lightning, visibilityFloor: floor,
        windStrength: storm ? 1.2 : rainy ? 0.75 : 0.35 });
    }
    for (const beacon of beacons) {
      beacon.update(time, { night: nightLevel, weather, fogColor: fog,
        fogDensity, lightning, cameraPosition });
    }
  }
  update();

  return {
    root, islands, beacons, update,
    dispose() {
      scene.remove(root);
      for (const island of islands) {
        island.cap.geometry.dispose();
        island.cliff.geometry.dispose();
        island.detail.dispose();
      }
      for (const beacon of beacons) beacon.dispose();
      terrainMaterial.dispose();
    },
  };
}
