import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function randomGenerator(initialSeed) {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function coastFactor(spec, angle) {
  return 1 + 0.045 * Math.sin(3 * angle + spec.seed)
    + 0.026 * Math.sin(7 * angle - spec.seed * 1.4)
    + 0.014 * Math.cos(11 * angle + spec.seed * 2.3);
}

function coastPoint(spec, angle, radius = 1) {
  const coast = coastFactor(spec, angle) * radius;
  return [spec.radiusX * Math.cos(angle) * coast,
    spec.radiusZ * Math.sin(angle) * coast];
}

const COLORS = Object.freeze({
  seamLight: new THREE.Color(0x838c86),
  seamMid: new THREE.Color(0x68736f),
  seamDark: new THREE.Color(0x344149),
  cove: new THREE.Color(0x26343c),
  wetRock: new THREE.Color(0x46535a),
  ridgeRock: new THREE.Color(0x747a72),
  trunk: new THREE.Color(0x293a37),
  needles: new THREE.Color(0x2f5144),
  windLeaf: new THREE.Color(0x506c4f),
  dryLeaf: new THREE.Color(0x64714d),
  wall: new THREE.Color(0x8b9288),
  wallShade: new THREE.Color(0x646e6c),
  roof: new THREE.Color(0x303e43),
  window: new THREE.Color(0x1c2a30),
});

function createBuilder() {
  const positions = [], colors = [], weights = [], phases = [];
  function vertex(point, color, wind = 0, phase = 0) {
    positions.push(point[0], point[1], point[2]);
    colors.push(color.r, color.g, color.b);
    weights.push(wind);
    phases.push(phase);
  }
  function tri(a, b, c, color, wind = 0, phase = 0) {
    vertex(a, color, wind, phase);
    vertex(b, color, wind, phase);
    vertex(c, color, wind, phase);
  }
  function quad(a, b, c, d, color, wind = 0, phase = 0) {
    tri(a, b, c, color, wind, phase);
    tri(a, c, d, color, wind, phase);
  }
  function finish() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('windWeight', new THREE.Float32BufferAttribute(weights, 1));
    geometry.setAttribute('windPhase', new THREE.Float32BufferAttribute(phases, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
  return { tri, quad, finish };
}

function cliffPosition(spec, sampleHeight, angle, depth, radiusExtra = 0) {
  const [rimX, rimZ] = coastPoint(spec, angle);
  const top = sampleHeight(spec, rimX, rimZ);
  const bulge = 1 + 0.022 * depth
    + 0.006 * Math.sin(depth * 25 + angle * 13 + spec.seed)
    + radiusExtra;
  return [rimX * bulge, top * (1 - depth) - 2.2 * depth,
    rimZ * bulge];
}

function addCliffGeology(builder, spec, sampleHeight, random) {
  let seams = 0;
  // A few discontinuous horizontal beds read as strata from across the water.
  // Their heights and arc lengths deliberately differ instead of making rings.
  for (const layer of [0.16, 0.31, 0.48, 0.66, 0.83]) {
    const pieces = layer > 0.6 ? 9 : 7;
    for (let piece = 0; piece < pieces; piece++) {
      const start = (piece + random() * 0.62) * TAU / pieces;
      const length = (0.34 + random() * 0.56) * TAU / pieces;
      const segments = 4 + Math.floor(random() * 4);
      const depth = clamp(layer + (random() - 0.5) * 0.055, 0.06, 0.9);
      const thickness = 0.025 + random() * 0.035;
      const color = (piece + Math.round(layer * 100)) % 4 === 0
        ? COLORS.seamDark : piece % 3 === 0 ? COLORS.seamLight
          : COLORS.seamMid;
      for (let step = 0; step < segments; step++) {
        const a = start + length * step / segments;
        const b = start + length * (step + 1) / segments;
        const jitterA = Math.sin(a * 17 + spec.seed * 3) * 0.012;
        const jitterB = Math.sin(b * 17 + spec.seed * 3) * 0.012;
        const upperA = cliffPosition(spec, sampleHeight, a,
          depth + jitterA, 0.021);
        const upperB = cliffPosition(spec, sampleHeight, b,
          depth + jitterB, 0.021);
        const lowerA = cliffPosition(spec, sampleHeight, a,
          depth + thickness + jitterA, 0.023);
        const lowerB = cliffPosition(spec, sampleHeight, b,
          depth + thickness + jitterB, 0.023);
        builder.quad(upperA, upperB, lowerB, lowerA, color);
      }
      seams++;
    }
  }

  // Angular dark recesses suggest storm-carved coves in the lower cliff face.
  for (let cove = 0; cove < 5; cove++) {
    const angle = (cove + 0.28 + random() * 0.5) * TAU / 5;
    const spread = 0.045 + random() * 0.045;
    const top = cliffPosition(spec, sampleHeight, angle, 0.57, 0.026);
    const left = cliffPosition(spec, sampleHeight, angle - spread, 0.88, 0.027);
    const right = cliffPosition(spec, sampleHeight, angle + spread, 0.91, 0.027);
    const middle = cliffPosition(spec, sampleHeight, angle, 1.01, 0.027);
    builder.tri(top, left, middle, COLORS.cove);
    builder.tri(top, middle, right, COLORS.seamDark);
  }
  return seams;
}

function addJaggedRock(builder, x, y, z, width, height, color, random) {
  const radius = width * 0.5;
  const cornerCount = 5 + Math.floor(random() * 3);
  const base = [], upper = [];
  const slopeX = (random() - 0.5) * radius * 0.36;
  const slopeZ = (random() - 0.5) * radius * 0.36;
  for (let i = 0; i < cornerCount; i++) {
    const angle = i / cornerCount * TAU;
    const outline = 0.75 + random() * 0.42;
    base.push([x + Math.cos(angle) * radius * outline,
      y + random() * height * 0.13,
      z + Math.sin(angle) * radius * outline]);
    upper.push([x + slopeX + Math.cos(angle) * radius * outline * 0.44,
      y + height * (0.65 + random() * 0.25),
      z + slopeZ + Math.sin(angle) * radius * outline * 0.44]);
  }
  const peak = [x + slopeX * 1.5, y + height, z + slopeZ * 1.5];
  for (let i = 0; i < cornerCount; i++) {
    const next = (i + 1) % cornerCount;
    builder.quad(base[i], base[next], upper[next], upper[i],
      i % 3 === 0 ? COLORS.seamDark : color);
    builder.tri(upper[i], upper[next], peak,
      i % 2 ? COLORS.seamMid : color);
  }
}

function addRocks(builder, spec, sampleHeight, random) {
  let count = 0;
  // Stacks at the waterline and irregular rock teeth near the rim interrupt
  // the smooth ellipse without adding another terrain or collision field.
  for (let i = 0; i < 15; i++) {
    const angle = (i + random() * 0.62) * TAU / 15;
    const [x, z] = coastPoint(spec, angle, 1.045 + random() * 0.055);
    addJaggedRock(builder, x, -1.3, z, 7 + random() * 11,
      6 + random() * 15, COLORS.wetRock, random);
    count++;
  }
  for (let i = 0; i < 24; i++) {
    const angle = random() * TAU;
    const radius = 0.72 + random() * 0.28;
    const [x, z] = coastPoint(spec, angle, radius);
    if (spec.lighthouse && Math.hypot(x - spec.lighthouse.x,
      z - spec.lighthouse.z) < 50) continue;
    const y = sampleHeight(spec, x, z) - 0.9;
    addJaggedRock(builder, x, y, z, 7 + random() * 12,
      4 + random() * 9, COLORS.ridgeRock, random);
    count++;
  }
  return count;
}

function addTaperedTrunk(builder, x, y, z, height, leanX, leanZ, random) {
  const radius = height * (0.055 + random() * 0.015);
  const points = 5;
  const root = [], tip = [];
  for (let i = 0; i < points; i++) {
    const angle = i / points * TAU;
    root.push([x + Math.cos(angle) * radius,
      y, z + Math.sin(angle) * radius]);
    tip.push([x + leanX + Math.cos(angle) * radius * 0.37,
      y + height, z + leanZ + Math.sin(angle) * radius * 0.37]);
  }
  for (let i = 0; i < points; i++) builder.quad(root[i], root[(i + 1) % points],
    tip[(i + 1) % points], tip[i], COLORS.trunk, 0.14, x * 0.08 + z * 0.07);
}

function addCrown(builder, x, y, z, radiusX, radiusZ, height,
  leanX, leanZ, color, phase, random) {
  const sides = 7;
  const lower = [], waist = [];
  for (let i = 0; i < sides; i++) {
    const angle = i / sides * TAU;
    const scallop = 0.76 + random() * 0.39;
    const dx = Math.cos(angle) * radiusX * scallop;
    const dz = Math.sin(angle) * radiusZ * scallop;
    lower.push([x + dx * 0.82, y - height * 0.28, z + dz * 0.82]);
    waist.push([x + leanX + dx, y + height * 0.18, z + leanZ + dz]);
  }
  const crownTop = [x + leanX * 1.25, y + height * 0.54,
    z + leanZ * 1.25];
  const crownUnder = [x, y - height * 0.39, z];
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    builder.quad(lower[i], lower[next], waist[next], waist[i],
      i % 3 === 0 ? COLORS.needles : color, 0.8, phase);
    builder.tri(waist[i], waist[next], crownTop,
      i % 2 ? color : COLORS.windLeaf, 1, phase);
    builder.tri(lower[next], lower[i], crownUnder,
      COLORS.needles, 0.64, phase);
  }
}

function addWindTree(builder, x, y, z, height, windAngle, random) {
  const lean = height * (0.16 + random() * 0.13);
  const leanX = Math.cos(windAngle) * lean;
  const leanZ = Math.sin(windAngle) * lean;
  const trunkHeight = height * (0.58 + random() * 0.1);
  addTaperedTrunk(builder, x, y, z, trunkHeight,
    leanX * 0.52, leanZ * 0.52, random);
  const phase = x * 0.072 + z * 0.097;
  const foliageY = y + trunkHeight * 0.89;
  const muted = random() > 0.70;
  addCrown(builder, x + leanX * 0.39, foliageY,
    z + leanZ * 0.39, height * (0.24 + random() * 0.06),
    height * (0.22 + random() * 0.05), height * 0.46,
    leanX * 0.42, leanZ * 0.42,
    muted ? COLORS.dryLeaf : COLORS.windLeaf, phase, random);
}

function addTreeGroves(builder, spec, sampleHeight, random) {
  const target = spec.id === 'north-watch' ? 70 : 52;
  const groves = 7;
  let count = 0;
  const windAngle = -0.95 + spec.seed * 0.29;
  for (let grove = 0; grove < groves; grove++) {
    const bearing = (grove + random() * 0.6) * TAU / groves;
    const centerRadius = 0.42 + random() * 0.34;
    const [gx, gz] = coastPoint(spec, bearing, centerRadius);
    const quota = Math.ceil(target / groves);
    for (let i = 0; i < quota && count < target; i++) {
      const angle = random() * TAU;
      const spread = Math.sqrt(random()) * (22 + random() * 35);
      const x = gx + Math.cos(angle) * spread;
      const z = gz + Math.sin(angle) * spread;
      const normalizedRadius = Math.hypot(x / spec.radiusX, z / spec.radiusZ);
      if (normalizedRadius > 0.87 || normalizedRadius < 0.14) continue;
      if (spec.lighthouse && Math.hypot(x - spec.lighthouse.x,
        z - spec.lighthouse.z) < 69) continue;
      const y = sampleHeight(spec, x, z) - 0.8;
      const height = 10 + random() * 11;
      addWindTree(builder, x, y, z, height,
        windAngle + (random() - 0.5) * 0.22, random);
      count++;
    }
  }
  return count;
}

function addBuilding(builder, x, y, z, width, depth, wallHeight,
  roofHeight, abandoned) {
  const left = x - width / 2, right = x + width / 2;
  const near = z - depth / 2, far = z + depth / 2;
  const bottom = y, eave = y + wallHeight;
  const top = y + wallHeight + roofHeight;
  const wall = abandoned ? COLORS.wallShade : COLORS.wall;
  builder.quad([left, bottom, near], [right, bottom, near],
    [right, eave, near], [left, eave, near], wall);
  builder.quad([right, bottom, far], [left, bottom, far],
    [left, eave, far], [right, eave, far], COLORS.wallShade);
  builder.quad([left, bottom, far], [left, bottom, near],
    [left, eave, near], [left, eave, far], COLORS.wallShade);
  builder.quad([right, bottom, near], [right, bottom, far],
    [right, eave, far], [right, eave, near], wall);
  builder.tri([left, eave, near], [right, eave, near],
    [x, top, near], COLORS.wallShade);
  builder.tri([right, eave, far], [left, eave, far],
    [x, top, far], COLORS.wallShade);
  builder.quad([left - 0.7, eave - 0.2, near - 0.7],
    [x, top, near - 0.7], [x, top, far + 0.7],
    [left - 0.7, eave - 0.2, far + 0.7], COLORS.roof);
  builder.quad([x, top, near - 0.7],
    [right + 0.7, eave - 0.2, near - 0.7],
    [right + 0.7, eave - 0.2, far + 0.7],
    [x, top, far + 0.7], COLORS.roof);
  // At this distance these are broad dark openings, not modeled glass panes.
  const windowY = bottom + wallHeight * 0.50;
  builder.quad([x - width * 0.24, windowY - 1.4, near - 0.05],
    [x - width * 0.02, windowY - 1.4, near - 0.05],
    [x - width * 0.02, windowY + 1.4, near - 0.05],
    [x - width * 0.24, windowY + 1.4, near - 0.05], COLORS.window);
  builder.quad([x + width * 0.07, windowY - 1.4, near - 0.05],
    [x + width * 0.29, windowY - 1.4, near - 0.05],
    [x + width * 0.29, windowY + 1.4, near - 0.05],
    [x + width * 0.07, windowY + 1.4, near - 0.05], COLORS.window);
}

function addBuildings(builder, spec, sampleHeight) {
  const isNorth = spec.id === 'north-watch';
  const site = spec.lighthouse ?? { x: 0, z: 0 };
  const spots = isNorth
    ? [[site.x - 56, site.z + 45, 17, 12, 7],
      [site.x - 26, site.z + 72, 13, 10, 6]]
    : [[site.x + 54, site.z + 33, 21, 13, 8],
      [site.x + 23, site.z + 59, 14, 10, 6]];
  for (const [x, z, width, depth, height] of spots) {
    const y = sampleHeight(spec, x, z) - 0.6;
    addBuilding(builder, x, y, z, width, depth, height,
      height * 0.45, !isNorth);
  }
  return spots.length;
}

function makeMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: `
      uniform float uTime;
      uniform float uWind;
      attribute float windWeight;
      attribute float windPhase;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec3 local = position;
        float gust = sin(uTime * 1.7 + windPhase)
          + 0.35 * sin(uTime * 3.1 - windPhase * 0.71);
        local.x += windWeight * uWind * 0.68 * gust;
        local.z -= windWeight * uWind * 0.38 * gust;
        vColor = color;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(local, 1.0);
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
        vec3 detailColor = vColor * (ambient + diffuse * lit
          + uLightning * 0.38);
        float distanceToCamera = distance(cameraPosition, vWorld);
        float visibility = max(exp(-pow(distanceToCamera * uFogDensity * 0.56, 2.0)),
          uVisibilityFloor);
        visibility *= mix(0.81, 1.0, smoothstep(2.0, 60.0, vWorld.y));
        gl_FragColor = vec4(mix(uFogColor, detailColor, visibility), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Scenery-only detail; one draw call per remote island and no physics. */
export function createOffshoreIslandDetail(spec, { sampleHeight } = {}) {
  if (!spec || typeof sampleHeight !== 'function') {
    throw new TypeError('Offshore detail needs an island spec and height sampler');
  }
  const random = randomGenerator(Math.floor(spec.seed * 1_000_003) ^ 0x61a42c39);
  const builder = createBuilder();
  const cliffBeds = addCliffGeology(builder, spec, sampleHeight, random);
  const rockCount = addRocks(builder, spec, sampleHeight, random);
  const treeCount = addTreeGroves(builder, spec, sampleHeight, random);
  const structureCount = addBuildings(builder, spec, sampleHeight);
  const geometry = builder.finish();
  const uniforms = {
    uFogColor: { value: new THREE.Color(0x899b9b) },
    uFogDensity: { value: 0.0027 },
    uVisibilityFloor: { value: 0.30 },
    uNight: { value: 0 },
    uLightning: { value: 0 },
    uTime: { value: 0 },
    uWind: { value: 0.25 },
  };
  const material = makeMaterial(uniforms);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${spec.name} cliff strata, coastal trees and station`;
  const group = new THREE.Group();
  group.name = `${spec.name} offshore detail`;
  group.add(mesh);

  function update(elapsed = 0, { fogColor = null, fogDensity = 0.0027,
    weather = 'mist', night = 0, lightning = 0, windStrength = 0.35,
    visibilityFloor = null } = {}) {
    if (fogColor?.isColor) uniforms.uFogColor.value.copy(fogColor);
    uniforms.uFogDensity.value = Number.isFinite(fogDensity)
      ? Math.max(0, fogDensity) : 0.0027;
    const defaultFloor = weather === 'clear' ? 0.45
      : weather === 'dawn' ? 0.41 : weather === 'storm' ? 0.20
        : weather === 'rain' ? 0.25 : 0.30;
    uniforms.uVisibilityFloor.value = Number.isFinite(visibilityFloor)
      ? clamp(visibilityFloor, 0, 1) : defaultFloor;
    uniforms.uNight.value = clamp(Number(night) || 0, 0, 1);
    uniforms.uLightning.value = clamp(Number(lightning) || 0, 0, 1);
    uniforms.uTime.value = Number.isFinite(elapsed) ? elapsed : 0;
    uniforms.uWind.value = clamp(Number(windStrength) || 0,
      0, 2.5) * (weather === 'storm' ? 1.4 : 0.75);
  }
  update();

  return {
    group, mesh, update,
    stats: Object.freeze({ treeCount, rockCount, cliffBeds,
      structureCount, triangles: geometry.attributes.position.count / 3,
      drawCalls: 1 }),
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
