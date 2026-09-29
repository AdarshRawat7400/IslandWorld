import * as THREE from 'three';

// Blender's front (-Y) exports to glTF +Z. These measurements match the
// actual cut openings in build_assets.py; no wet plane floats on a solid wall.
const PANES = {
  lodge: [
    ...[-5.45, 5.45].map((x) => ({ x, y: 2.15, z: 5.62, w: 1.9, h: 1.9 })),
    ...[-5.45, 0, 5.45].map((x) => ({ x, y: 5.8, z: 5.62, w: 1.6, h: 2.0 })),
    ...[-3, 3].map((x) => ({ x, y: 5.8, z: 5.62, w: 1.4, h: 1.6 })),
    ...[-5.1, 0, 5.1].map((x) => ({ x, y: 2.3, z: -5.62, w: x ? 1.6 : 1.8, h: 1.8, back: true })),
    ...[-5.1, 0, 5.1].map((x) => ({ x, y: 5.85, z: -5.62, w: 1.6, h: 1.9, back: true })),
    ...[-1, 1].flatMap((side) => [-3, 0, 3].flatMap((offset) => [2.25, 5.8].map((y) => ({
      x: side * 8.12, y, z: -offset, w: offset ? 1.5 : 2.4,
      h: y < 3 ? 1.5 : 1.6, side,
    })))),
  ],
  archive: [
    ...[-4.65, 4.65].map((x) => ({ x, y: 2.4, z: 4.63, w: 1.7, h: 1.5 })),
    ...[-4.7, 0, 4.7].map((x) => ({ x, y: 2.35, z: -4.64, w: x ? 1.2 : 2, h: 1.3, back: true })),
    ...[-1, 1].flatMap((side) => [-2.2, 2.2].map((offset) => ({
      x: side * 7.12, y: 2.4, z: -offset, w: 1.6, h: 1.45, side,
    }))),
  ],
  radio: [
    ...[-3.7, 3.7].map((x) => ({ x, y: 2.25, z: 4.17, w: 1.6, h: 1.55 })),
    ...[-3.5, 0, 3.5].map((x) => ({ x, y: 2.25, z: -4.17, w: x ? 1.4 : 2.5, h: 1.4, back: true })),
    ...[-1, 1].flatMap((side) => [-2.4, 2.4].map((offset) => ({
      x: side * 5.64, y: 2.3, z: -offset, w: 1.4, h: 1.4, side,
    }))),
  ],
  pump: [
    ...[-3.25, 3.25].map((x) => ({ x, y: 2.25, z: 4.29, w: 1.5, h: 1.5 })),
    ...[-2.6, 2.6].map((x) => ({ x, y: 2.2, z: -4.29, w: 1.3, h: 1.4, back: true })),
    ...[-1, 1].flatMap((side) => [-2.2, 2.2].map((offset) => ({
      x: side * 5.14, y: 2.1, z: -offset, w: 1.4, h: 1.4, side,
    }))),
  ],
  tower: [
    { x: 0, y: 2.12, z: -4.03, w: 2.2, h: 1.15, back: true },
    ...[-1, 1].map((side) => ({ x: side * 4.03, y: 2.12, z: -1.5, w: 1.4, h: 1.15, side })),
  ],
};

const vertexShader = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vSeed;
  attribute float aSeed;

  void main() {
    vUv = uv;
    vSeed = aSeed;
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */`
  uniform float uTime;
  uniform float uWetness;
  uniform float uMist;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vSeed;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv;
    float edgeDistance = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float frosting = 1.0 - smoothstep(0.018, 0.21, edgeDistance);

    // Broad, slowly sliding rain beads. Each cell gets its own offset and
    // speed; the tiny bend keeps the trail from reading as a ruler-straight line.
    vec2 flowUv = vec2(uv.x * 13.0 + vSeed * 1.71,
                       uv.y * 26.0 + uTime * (0.55 + vSeed * 0.06));
    vec2 cell = floor(flowUv);
    vec2 local = fract(flowUv);
    float beadX = mix(0.16, 0.84, hash21(cell + 4.3));
    float beadY = mix(0.15, 0.8, hash21(cell + 9.7));
    float size = mix(0.035, 0.11, hash21(cell + 13.4));
    float drift = sin(uv.y * 32.0 + vSeed * 8.0) * 0.018;
    float bead = 1.0 - smoothstep(size * 0.34, size, length((local - vec2(beadX, beadY)) * vec2(1.0, 1.9)));
    float tail = (1.0 - smoothstep(0.015, 0.049, abs(local.x - beadX - drift)))
               * smoothstep(0.03, 0.35, local.y)
               * (1.0 - smoothstep(0.7, 0.98, local.y));

    // Small condensation beads are fixed to the pane while the long trails move.
    vec2 fine = uv * vec2(31.0, 49.0) + vec2(vSeed * 3.7, vSeed * 2.3);
    vec2 fineCell = floor(fine);
    vec2 fineLocal = fract(fine) - vec2(hash21(fineCell + 2.1), hash21(fineCell + 7.8));
    float speck = 1.0 - smoothstep(0.035, 0.13, length(fineLocal));
    speck *= step(0.58, hash21(fineCell + 23.0));

    vec3 eye = normalize(cameraPosition - vWorldPosition);
    float grazing = pow(1.0 - abs(dot(normalize(vWorldNormal), eye)), 2.2);
    float film = uWetness * (0.075 * frosting + 0.12 * tail + 0.26 * bead + 0.07 * speck)
               + uMist * 0.065 * frosting + 0.10 * grazing;
    float alpha = clamp(film, 0.0, 0.32);
    vec3 slate = vec3(0.34, 0.47, 0.52);
    vec3 highlight = vec3(0.79, 0.87, 0.85);
    vec3 color = mix(slate, highlight, clamp(bead * 0.85 + speck * 0.45 + grazing * 0.5, 0.0, 1.0));
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Add transparent rain and condensation over the Blender building panes.
 *
 * @param {THREE.Scene} scene
 * @param {Array<{id:string,x:number,z:number}>} sites Physical world sites
 * @param {(x:number,z:number)=>number} terrainHeight World terrain sampler
 * @returns {{update:(dt:number,weather:string)=>void, group:THREE.Group, dispose:()=>void}}
 */
export function addWetWindows(scene, sites, terrainHeight) {
  const group = new THREE.Group();
  group.name = 'Animated rain on windows';
  const panes = [];

  for (const site of sites) {
    const buildingPanes = PANES[site.id];
    if (!buildingPanes) continue;
    const ground = terrainHeight(site.x, site.z) + 0.08;
    for (const pane of buildingPanes) {
      panes.push({ pane, site, ground });
    }
  }

  // One instanced draw for every pane on the island keeps the extra glass
  // affordable while giving each pane its own droplet seed and dimensions.
  const geometry = new THREE.PlaneGeometry(1, 1);
  const seeds = new Float32Array(panes.length);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uWetness: { value: 0.26 },
      uMist: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, panes.length);
  mesh.name = `${panes.length} rain-streaked panes`;
  mesh.renderOrder = 3;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);
  panes.forEach(({ pane, site, ground }, index) => {
    position.set(site.x + pane.x, ground + pane.y, site.z + pane.z);
    quaternion.setFromAxisAngle(axis, pane.side ? pane.side * Math.PI / 2 : pane.back ? Math.PI : 0);
    scale.set(pane.w * 0.82, pane.h * 0.82, 1);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    seeds[index] = (index * 0.713 + 0.21) % 7;
  });
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);

  scene.add(group);
  let elapsed = 0;
  let wetness = 0.26;
  let mist = 1;

  function update(dt, weather = 'mist') {
    const seconds = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    elapsed += seconds;
    const mode = typeof weather === 'object' && weather ? weather.mode : weather;
    const targetWetness = typeof weather === 'object' && weather
      ? THREE.MathUtils.clamp(0.08 + Number(weather.rain ?? 0) * 0.92, 0, 1)
      : ({ clear: 0.07, mist: 0.22, rain: 0.78, storm: 1, dawn: 0.07 })[weather] ?? 0.22;
    const targetMist = mode === 'mist' ? 1 : mode === 'clear' || mode === 'dawn' ? 0.08 : 0.55;
    // Glass beads quickly in rain but dries over several minutes after a front.
    const blend = 1 - Math.exp(-seconds * (targetWetness > wetness ? 1.8 : 0.028));
    wetness += (targetWetness - wetness) * blend;
    mist += (targetMist - mist) * (1 - Math.exp(-seconds * 0.22));
    material.uniforms.uTime.value = elapsed;
    material.uniforms.uWetness.value = wetness;
    material.uniforms.uMist.value = mist;
  }

  function dispose() {
    scene.remove(group);
    material.dispose();
    geometry.dispose();
  }

  return { update, group, dispose };
}
