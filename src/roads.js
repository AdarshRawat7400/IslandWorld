import * as THREE from 'three';

// The island's older service roads follow the same graded corridors as its
// foot trails. The steep landing and north-inlet descents remain footpaths.
// Points are metres in the world coordinate system (+z toward the landing).
export const ROAD_ROUTES = Object.freeze([
  Object.freeze({ id: 'lodge-archive', name: 'Lodge and archive road', width: 5.8,
    points: Object.freeze([[-105, 188], [-105, 181], [-100, 174], [-100, 167],
      [-105, 156], [-127, 127], [-151, 94], [-169, 75]]) }),
  Object.freeze({ id: 'wagon-pull-in', name: 'Keeper’s wagon pull-in', width: 5.7,
    points: Object.freeze([[-105, 156], [-97, 156]]) }),
  Object.freeze({ id: 'prison-access', name: 'Detention access road', width: 6.0,
    points: Object.freeze([[-127, 127], [-97, 119], [-78, 113], [-58, 112], [-58, 105],
      [-58, 89], [-39, 87], [-22, 78]]) }),
  Object.freeze({ id: 'staff-apron', name: 'Staff vehicle apron', width: 5.6,
    points: Object.freeze([[-58, 112], [-45, 112], [-34, 117]]) }),
  Object.freeze({ id: 'west-coast', name: 'West coast service road', width: 5.6,
    points: Object.freeze([[-169, 75], [-185, 74], [-190, -28], [-210, -120],
      [-120, -176], [-24, -207], [30, -207]]) }),
  Object.freeze({ id: 'tower-radio', name: 'Tower to radio house', width: 5.6,
    points: Object.freeze([[30, -207], [31, -192], [68, -192], [112, -144],
      [150, -70], [166, -69], [166, -47]]) }),
  Object.freeze({ id: 'tower-spur', name: 'Signal tower access road', width: 5.2,
    points: Object.freeze([[30, -207], [45, -207], [59, -217], [59, -222]]) }),
  Object.freeze({ id: 'east-ridge', name: 'East ridge service road', width: 5.3,
    points: Object.freeze([[68, -192], [143, -188], [178, -161], [208, -138],
      [232, -120], [197, -81],
      [166, -69]]) }),
  Object.freeze({ id: 'pump-link', name: 'Pump house service road', width: 5.5,
    points: Object.freeze([[166, -47], [152, 41], [143, 113], [143, 135]]) }),
]);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function sampleRoute(route) {
  const curve = new THREE.CatmullRomCurve3(route.points.map(([x, z]) =>
    new THREE.Vector3(x, 0, z)), false, 'centripetal', 0.5);
  const length = curve.getLength();
  const divisions = Math.ceil(length / 1.8);
  const points = curve.getSpacedPoints(divisions);
  const samples = [];
  let distance = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i) distance += p.distanceTo(points[i - 1]);
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x, dz = next.z - prev.z;
    const inv = 1 / Math.max(0.001, Math.hypot(dx, dz));
    samples.push({ x: p.x, z: p.z, dx: dx * inv, dz: dz * inv, distance });
  }
  return { ...route, samples, length: distance };
}

const SAMPLED_ROUTES = ROAD_ROUTES.map(sampleRoute);
const GRID_SIZE = 24;
const roadGrid = new Map();
const allSegments = [];
const cellKey = (ix, iz) => (ix << 16) ^ (iz & 0xffff);
for (const route of SAMPLED_ROUTES) {
  for (let i = 1; i < route.samples.length; i++) {
    const a = route.samples[i - 1], b = route.samples[i];
    const vx = b.x - a.x, vz = b.z - a.z;
    const segment = { route, a, b, vx, vz, lengthSq: Math.max(0.001, vx * vx + vz * vz) };
    allSegments.push(segment);
    const minX = Math.floor(Math.min(a.x, b.x) / GRID_SIZE);
    const maxX = Math.floor(Math.max(a.x, b.x) / GRID_SIZE);
    const minZ = Math.floor(Math.min(a.z, b.z) / GRID_SIZE);
    const maxZ = Math.floor(Math.max(a.z, b.z) / GRID_SIZE);
    for (let ix = minX; ix <= maxX; ix++) for (let iz = minZ; iz <= maxZ; iz++) {
      const key = cellKey(ix, iz);
      if (!roadGrid.has(key)) roadGrid.set(key, []);
      roadGrid.get(key).push(segment);
    }
  }
}

function nearSegments(x, z, radius) {
  const ix = Math.floor(x / GRID_SIZE), iz = Math.floor(z / GRID_SIZE);
  const cells = Math.ceil(Math.max(0, radius) / GRID_SIZE);
  const result = [];
  for (let dx = -cells; dx <= cells; dx++) for (let dz = -cells; dz <= cells; dz++) {
    const bucket = roadGrid.get(cellKey(ix + dx, iz + dz));
    if (bucket) result.push(...bucket);
  }
  return result;
}

function segmentDistanceSq(segment, x, z) {
  const { a, vx, vz, lengthSq } = segment;
  const u = clamp(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0, 1);
  const cx = a.x + vx * u, cz = a.z + vz * u;
  const ox = x - cx, oz = z - cz;
  return { d2: ox * ox + oz * oz, u, cx, cz, ox, oz };
}

function quickDistanceSq(segment, x, z) {
  const u = clamp(((x - segment.a.x) * segment.vx +
    (z - segment.a.z) * segment.vz) / segment.lengthSq, 0, 1);
  const ox = x - segment.a.x - segment.vx * u;
  const oz = z - segment.a.z - segment.vz * u;
  return ox * ox + oz * oz;
}

/** Signed side offset and horizontal distance to the nearest road centreline. */
export function nearestRoad(x, z) {
  let bestDistanceSq = Infinity, best = null;
  const nearby = nearSegments(x, z, GRID_SIZE);
  // If the local answer is closer than one whole grid cell, no segment beyond
  // its neighbouring cells can win. Distant editor queries keep exact answers.
  function inspect(segments) {
    for (const segment of segments) {
      const { d2, u, cx, cz, ox, oz } = segmentDistanceSq(segment, x, z);
      if (d2 >= bestDistanceSq) continue;
      const { a, b, vx, vz, route } = segment;
      const inv = 1 / Math.sqrt(segment.lengthSq);
      bestDistanceSq = d2;
      best = { routeId: route.id, width: route.width, centerX: cx, centerZ: cz,
        directionX: vx * inv, directionZ: vz * inv,
        offset: ox * vz * inv - oz * vx * inv,
        distance: Math.sqrt(d2), progress: a.distance + (b.distance - a.distance) * u };
    }
  }
  inspect(nearby);
  if (bestDistanceSq >= GRID_SIZE * GRID_SIZE) inspect(allSegments);
  return best;
}

export function isRoad(x, z, margin = 0) {
  // Hot path for grass placement and each driving frame. An empty cell avoids
  // scanning the island's ~1.5 km of road geometry.
  const ix = Math.floor(x / GRID_SIZE), iz = Math.floor(z / GRID_SIZE);
  const cells = Math.ceil(Math.max(0, 3 + margin) / GRID_SIZE);
  for (let dx = -cells; dx <= cells; dx++) for (let dz = -cells; dz <= cells; dz++) {
    const bucket = roadGrid.get(cellKey(ix + dx, iz + dz));
    if (!bucket) continue;
    for (const segment of bucket) {
      const limit = segment.route.width * 0.5 + margin;
      if (limit > 0 && quickDistanceSq(segment, x, z) <= limit * limit) return true;
    }
  }
  return false;
}

export function roadDistance(x, z) {
  return nearestRoad(x, z)?.distance ?? Infinity;
}

function map(name, color = false) {
  if (typeof document === 'undefined') return null;
  const texture = new THREE.TextureLoader().load(`/assets/textures/${name}`);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function appendTriangle(indices, a, b, c) {
  indices.push(a, b, c);
}

function makeRoadSurface(routes, terrainHeight) {
  const vertices = [], colors = [], uvs = [], indices = [];
  const offsets = [-0.75, -0.57, -0.37, -0.23, -0.14, 0, 0.14, 0.23, 0.37, 0.57, 0.75];
  const shoulder = new THREE.Color(0xb4b6a3);
  const gravel = new THREE.Color(0xe2ddd1);
  const wet = new THREE.Color(0xb3c0bc);
  const rut = new THREE.Color(0xa2a8a1);
  const color = new THREE.Color();
  for (const route of routes) {
    const base = vertices.length / 3;
    const half = route.width * 0.5;
    const row = offsets.length;
    for (const sample of route.samples) {
      // Roadbed has a modest crown, damp wheel channels, and sloping verges.
      // Edge heights sample the actual terrain so the mesh lies on the graded
      // ground even when the road rounds a bend.
      for (const fraction of offsets) {
        const lateral = fraction * half * 2;
        const nx = sample.dz, nz = -sample.dx;
        const x = sample.x + nx * lateral;
        const z = sample.z + nz * lateral;
        const edge = Math.abs(fraction);
        const wheel = Math.exp(-Math.pow((edge - 0.225) / 0.055, 2));
        const crown = 0.085 * (1 - edge * edge);
        const verge = Math.max(0, (edge - 0.5) / 0.25);
        const y = terrainHeight(x, z) + 0.115 + crown - verge * 0.058 - wheel * 0.022;
        vertices.push(x, y, z);
        uvs.push((lateral + half * 1.5) * 0.36, sample.distance * 0.36);
        const variation = 0.05 * Math.sin(sample.distance * 0.21 + fraction * 14)
          + 0.03 * Math.sin(sample.distance * 1.43 + fraction * 19);
        color.copy(gravel).lerp(wet, clamp(0.26 + variation + wheel * 0.18, 0, 0.75));
        color.lerp(rut, wheel * 0.52);
        color.lerp(shoulder, clamp(verge * 0.62, 0, 1));
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let i = 0; i < route.samples.length - 1; i++) {
      for (let j = 0; j < row - 1; j++) {
        const a = base + i * row + j;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        appendTriangle(indices, a, c, b);
        appendTriangle(indices, b, c, d);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makePuddles(routes, terrainHeight) {
  const vertices = [], uvs = [], indices = [];
  let puddles = 0;
  for (const route of routes) {
    // Deterministic shallow, narrow puddles: avoid steep road sections.
    for (let i = 9; i < route.samples.length - 9; i += 21) {
      const p = route.samples[i];
      const slope = Math.abs(terrainHeight(p.x + p.dx * 2, p.z + p.dz * 2)
        - terrainHeight(p.x - p.dx * 2, p.z - p.dz * 2)) / 4;
      if (slope > 0.12) continue;
      const side = ((i + route.id.length) % 2 ? 1 : -1) * route.width * 0.21;
      const cx = p.x + p.dz * side, cz = p.z - p.dx * side;
      const length = 0.95 + (i % 5) * 0.22;
      const width = 0.27 + (i % 4) * 0.07;
      const start = vertices.length / 3;
      for (let k = 0; k < 8; k++) {
        const theta = k * Math.PI / 4;
        const along = Math.cos(theta) * length;
        const across = Math.sin(theta) * width;
        const x = cx + p.dx * along + p.dz * across;
        const z = cz + p.dz * along - p.dx * across;
        vertices.push(x, terrainHeight(x, z) + 0.205, z);
        uvs.push(0.5 + Math.cos(theta) * 0.5, 0.5 + Math.sin(theta) * 0.5);
      }
      for (let k = 1; k < 7; k++) indices.push(start, start + k, start + k + 1);
      puddles++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, count: puddles };
}

/** Add the drivable gravel roads; driving code can query the same centerlines. */
export function createRoads(scene, terrainHeight) {
  if (!scene?.add || typeof terrainHeight !== 'function') {
    throw new TypeError('createRoads requires a scene and terrainHeight(x, z)');
  }
  const group = new THREE.Group();
  group.name = 'Greywake wet gravel roads';
  const road = new THREE.Mesh(makeRoadSurface(SAMPLED_ROUTES, terrainHeight),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true,
      map: map('rock_ground_diff_1k.jpg', true),
      normalMap: map('rock_ground_nor_gl_1k.jpg'),
      roughnessMap: map('rock_ground_rough_1k.jpg'),
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 0.88, metalness: 0,
      side: THREE.DoubleSide,
    }));
  road.name = 'Compacted wet aggregate, ruts and soft verges';
  road.receiveShadow = true;
  group.add(road);
  const puddles = makePuddles(SAMPLED_ROUTES, terrainHeight);
  if (puddles.count) {
    const water = new THREE.Mesh(puddles.geometry, new THREE.MeshPhysicalMaterial({
      color: 0x657f83, roughness: 0.18, metalness: 0.14,
      clearcoat: 0.9, clearcoatRoughness: 0.11,
      transparent: true, opacity: 0.42, depthWrite: false,
      side: THREE.DoubleSide,
    }));
    water.name = `${puddles.count} shallow road puddles`;
    water.renderOrder = 1;
    group.add(water);
  }
  scene.add(group);
  return {
    group, routes: ROAD_ROUTES, length: SAMPLED_ROUTES.reduce((sum, r) => sum + r.length, 0),
    puddleCount: puddles.count,
    nearestRoad, isRoad, roadDistance,
    roadHeight: (x, z) => terrainHeight(x, z) + 0.15,
    isRoadCorridor: (x, z) => isRoad(x, z, 2.5),
  };
}
