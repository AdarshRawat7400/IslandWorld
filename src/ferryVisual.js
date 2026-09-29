import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Greywake's passenger ferry is original geometry. The deck reuses bundled
// CC0 Poly Haven Brown Planks 03; painted metal uses the Rusty Metal 04 normal
// and roughness maps. No external boat model is used.
export const FERRY_BEAM = 4.44;
export const FERRY_LENGTH = 11.7;

const outline = [
  [0, 5.95], [0.98, 5.61], [1.72, 4.74], [2.18, 3.42],
  [2.22, -3.84], [1.91, -5.12], [1.05, -5.75],
  [-1.05, -5.75], [-1.91, -5.12], [-2.22, -3.84],
  [-2.18, 3.42], [-1.72, 4.74], [-0.98, 5.61],
];

let materials;
let nameMaterial;
let launchMaterials;
let launchNameMaterial;

function hash(x, y, seed) {
  let n = Math.imul(x + seed * 17, 374761393) + Math.imul(y + seed * 31, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967295;
}

function paintTexture(base, seed, weatheredSteel = false) {
  const size = 512;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fine = (hash(x, y, seed) - 0.5) * 24;
    const cloudy = (hash(Math.floor(x / 13), Math.floor(y / 19), seed + 7) - 0.5) * 13;
    const vertical = hash(Math.floor(x / 5), Math.floor(y / 28), seed + 11);
    const streak = vertical > 0.82 ? (vertical - 0.82) * 95 : 0;
    const wear = fine + cloudy - streak;
    // Sparse salt stains and corrosion collect along painted hull seams. The
    // variation lives in one small texture, so both sides share the same draw.
    const seam = Math.min(x % 71, 71 - x % 71);
    const seamRust = weatheredSteel && seam < 4
      ? (1 - seam / 4) * hash(Math.floor(x / 71), Math.floor(y / 21), seed + 29) * 19 : 0;
    const saltRust = weatheredSteel
      ? Math.max(0, hash(Math.floor(x / 11), Math.floor(y / 17), seed + 41) - 0.7) * 27 : 0;
    const tideStain = weatheredSteel
      ? Math.exp(-Math.pow((y / size - 0.28) / 0.12, 2))
        * (5 + hash(Math.floor(x / 19), Math.floor(y / 23), seed + 67) * 22) : 0;
    const rust = seamRust + saltRust + tideStain;
    const i = (y * size + x) * 4;
    bytes[i] = Math.max(0, Math.min(255, base[0] + wear + rust * 0.45));
    bytes[i + 1] = Math.max(0, Math.min(255, base[1] + wear - rust * 0.8));
    bytes[i + 2] = Math.max(0, Math.min(255, base[2] + wear - rust * 1.2));
    bytes[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function timberMap(file, color = false) {
  // Node tests have no DOM image loader. The runtime still has the same
  // geometry and the bundled CC0 timber maps load only in browser rendering.
  if (typeof document === 'undefined') return null;
  const map = new THREE.TextureLoader().load(`/assets/building-textures/${file}`);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2.2, 3.8);
  map.anisotropy = 4;
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function corrodedMetalMap(file, color = false) {
  if (typeof document === 'undefined') return null;
  const map = new THREE.TextureLoader().load(`/assets/building-textures/${file}`);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1.5, 1.2);
  map.anisotropy = 4;
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function getMaterials() {
  if (materials) return materials;
  const deckMap = timberMap('timber_diffuse.jpg', true);
  const deckNormal = timberMap('timber_nor_gl.jpg');
  const deckRough = timberMap('timber_rough.jpg');
  // The painted color remains authored for Greywake. Subtle CC0 pitting and
  // roughness break up its broad steel surfaces without making it a wreck.
  const steelNormal = corrodedMetalMap('rust_nor_gl.jpg');
  const steelRough = corrodedMetalMap('rust_rough.jpg');
  const bootPaint = corrodedMetalMap('rust_diffuse.jpg', true);
  materials = {
    hull: new THREE.MeshStandardMaterial({
      color: 0xe5e5df, map: paintTexture([198, 198, 184], 21, true),
      normalMap: steelNormal, normalScale: new THREE.Vector2(0.23, 0.23),
      roughnessMap: steelRough, roughness: 0.86, metalness: 0.18,
      side: THREE.DoubleSide,
    }),
    cream: new THREE.MeshStandardMaterial({
      color: 0xf0eddd, map: paintTexture([226, 220, 198], 37),
      normalMap: steelNormal, normalScale: new THREE.Vector2(0.12, 0.12),
      roughnessMap: steelRough, roughness: 0.82, metalness: 0.08,
      side: THREE.DoubleSide,
    }),
    deck: new THREE.MeshStandardMaterial({
      color: 0xb4a894, map: deckMap || paintTexture([142, 112, 78], 53),
      normalMap: deckNormal, roughnessMap: deckRough,
      roughness: 0.86, metalness: 0, side: THREE.DoubleSide,
    }),
    bottom: new THREE.MeshStandardMaterial({ color: 0x553d37,
      normalMap: steelNormal, normalScale: new THREE.Vector2(0.3, 0.3),
      roughnessMap: steelRough, roughness: 0.91, metalness: 0.08,
      side: THREE.DoubleSide }),
    navy: new THREE.MeshStandardMaterial({ color: 0x293e49, roughness: 0.67, metalness: 0.27 }),
    black: new THREE.MeshStandardMaterial({ color: 0x252b2d, roughness: 0.88, metalness: 0.09 }),
    brass: new THREE.MeshStandardMaterial({ color: 0x9c8461, roughness: 0.43, metalness: 0.72 }),
    window: new THREE.MeshStandardMaterial({
      color: 0x30434c, roughness: 0.18, metalness: 0.14,
      emissive: 0x0b1719, emissiveIntensity: 0.32, side: THREE.DoubleSide,
    }),
    red: new THREE.MeshStandardMaterial({ color: 0x9d4e38, roughness: 0.67, metalness: 0.12 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x947973, map: bootPaint,
      normalMap: steelNormal, normalScale: new THREE.Vector2(0.28, 0.28),
      roughnessMap: steelRough, roughness: 0.92, metalness: 0.09,
      side: THREE.DoubleSide }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffdda3, emissive: 0xb7894c,
      emissiveIntensity: 1.8, roughness: 0.34 }),
  };
  return materials;
}

function hullBand(group, material, bottomY, topY, name, rim = outline) {
  const positions = [], uvs = [];
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length];
    const scaleAt = (height) => height >= 0.57
      ? 1.012 : (0.83 + (height + 0.11) / 0.68 * 0.17) * 1.014;
    const lo = scaleAt(bottomY), hi = scaleAt(topY);
    for (const [point, scale, y, u, v] of [
      [a, lo, bottomY, i / rim.length * 5, 0],
      [b, lo, bottomY, (i + 1) / rim.length * 5, 0],
      [a, hi, topY, i / rim.length * 5, 1],
      [a, hi, topY, i / rim.length * 5, 1],
      [b, lo, bottomY, (i + 1) / rim.length * 5, 0],
      [b, hi, topY, (i + 1) / rim.length * 5, 1],
    ]) {
      positions.push(point[0] * scale, y, point[1] * scale);
      uvs.push(u, v);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const band = new THREE.Mesh(geometry, material);
  band.name = name;
  group.add(band);
}

function ferryNameMaterial() {
  if (nameMaterial) return nameMaterial;
  if (typeof document === 'undefined') {
    nameMaterial = new THREE.MeshStandardMaterial({
      color: 0x293e49, roughness: 0.83, metalness: 0.04, side: THREE.DoubleSide,
    });
    return nameMaterial;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(246, 239, 218, 0.94)';
  ctx.fillRect(4, 8, 504, 112);
  ctx.strokeStyle = '#344956';
  ctx.lineWidth = 6;
  ctx.strokeRect(11, 15, 490, 98);
  ctx.fillStyle = '#273d49';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 62px Georgia, serif';
  ctx.fillText('GREYWAKE', 256, 58);
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('ISLAND SERVICE', 256, 96);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  nameMaterial = new THREE.MeshStandardMaterial({
    map, roughness: 0.83, metalness: 0.04, side: THREE.DoubleSide,
  });
  return nameMaterial;
}

function ringHull(group, mats) {
  // Multiple waterline rings give the ferry a shallow working-boat draught.
  const rings = [
    { y: -0.46, scale: 0.56 }, { y: -0.11, scale: 0.83 },
    { y: 0.57, scale: 1.0 }, { y: 1.02, scale: 1.0 },
  ];
  const n = outline.length;
  const positions = [], uvs = [], indices = [];
  let total = 0;
  const distances = [0];
  for (let i = 1; i <= n; i++) {
    const a = outline[i - 1], b = outline[i % n];
    total += Math.hypot(a[0] - b[0], a[1] - b[1]);
    distances.push(total);
  }
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let i = 0; i <= n; i++) {
      const [x, z] = outline[i % n];
      positions.push(x * ring.scale, ring.y, z * ring.scale);
      uvs.push(distances[i] / total * 2.8, r / (rings.length - 1));
    }
  }
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) {
    const a = r * (n + 1) + i, b = a + n + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const hull = new THREE.Mesh(geometry, mats.hull);
  hull.name = 'Weathered steel displacement hull';
  group.add(hull);

  const bottom = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.31, 8.7), mats.bottom);
  bottom.position.y = -0.38;
  group.add(bottom);
  // Painted lines wrap the actual hull contour, including its tapered bow.
  hullBand(group, mats.navy, 0.76, 0.89, 'Continuous navy sheer stripe');
  hullBand(group, mats.boot, 0.14, 0.27, 'Weathered red boot stripe');
  for (const side of [-1, 1]) {
    const rub = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.2, 8.65), mats.black);
    rub.position.set(side * 2.22, 0.59, -0.36);
    group.add(rub);
  }

  // Triangulated inset deck follows the hull outline rather than a rectangle.
  const deckPositions = [], deckUvs = [];
  for (let i = 0; i < n; i++) {
    for (const p of [[0, 0], outline[i], outline[(i + 1) % n]]) {
      deckPositions.push(p[0] * 0.94, 1.025, p[1] * 0.94);
      deckUvs.push((p[0] + 2.25) / 4.5, (p[1] + 5.9) / 11.8);
    }
  }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckPositions, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(deckUvs, 2));
  deckGeo.computeVertexNormals();
  const deck = new THREE.Mesh(deckGeo, mats.deck);
  deck.name = 'CC0 timber passenger deck';
  group.add(deck);
}

function box(group, mats, material, size, at, name) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mats[material]);
  mesh.position.set(...at);
  if (name) mesh.name = name;
  group.add(mesh);
  return mesh;
}

function rod(group, material, a, b, radius = 0.025) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const length = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 7);
  const position = from.clone().add(to).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
  geometry.applyMatrix4(new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1)));
  const batches = group.userData.rods || (group.userData.rods = new Map());
  if (!batches.has(material)) batches.set(material, []);
  batches.get(material).push(geometry);
}

function flushRods(group) {
  const batches = group.userData.rods;
  if (!batches) return;
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (merged) group.add(new THREE.Mesh(merged, material));
  }
  delete group.userData.rods;
}

function superstructure(group, mats) {
  // A low aft saloon and raised wheelhouse leave the player's forward view open.
  box(group, mats, 'cream', [3.54, 1.08, 3.32], [0, 1.62, -3.62], 'Aft passenger saloon');
  box(group, mats, 'navy', [3.75, 0.13, 3.57], [0, 2.23, -3.62], 'Saloon roof');
  box(group, mats, 'cream', [3.04, 1.27, 2.06], [0, 2.65, -1.97], 'Raised wheelhouse');
  box(group, mats, 'navy', [3.46, 0.14, 2.49], [0, 3.34, -1.98], 'Wheelhouse roof');
  box(group, mats, 'brass', [3.5, 0.045, 2.51], [0, 3.45, -1.98]);
  // Three broad angled-looking windscreen panes and an upper dark trim.
  for (const x of [-0.99, 0, 0.99]) {
    box(group, mats, 'navy', [0.91, 0.73, 0.045], [x, 2.73, -0.913]);
    box(group, mats, 'window', [0.79, 0.61, 0.06], [x, 2.73, -0.877]);
  }
  for (const side of [-1, 1]) {
    for (const z of [-1.52, -2.36]) {
      box(group, mats, 'navy', [0.05, 0.68, 0.62], [side * 1.54, 2.75, z]);
      box(group, mats, 'window', [0.06, 0.55, 0.52], [side * 1.575, 2.75, z]);
    }
    for (const z of [-3.1, -4.04]) {
      box(group, mats, 'navy', [0.04, 0.48, 0.65], [side * 1.79, 1.72, z]);
      box(group, mats, 'window', [0.055, 0.38, 0.57], [side * 1.82, 1.72, z]);
    }
    box(group, mats, 'black', [0.075, 1.1, 0.1], [side * 1.81, 1.57, -4.75]);
  }
  // A small curved-looking smokestack on the aft roof identifies its era.
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.44, 1.05, 12), mats.red);
  stack.position.set(0, 2.78, -4.45);
  group.add(stack);
  const stackLip = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.14, 12), mats.black);
  stackLip.position.set(0, 3.34, -4.45);
  group.add(stackLip);
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.26, 10), mats.navy);
  vent.position.set(0, 3.62, -1.8);
  group.add(vent);
  rod(group, mats.black, [0, 3.43, -1.87], [0, 4.25, -1.87], 0.035);
  const mastLamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mats.lamp);
  mastLamp.position.set(0, 4.28, -1.87);
  group.add(mastLamp);
}

function deckFittings(group, mats) {
  const nameMaterial = ferryNameMaterial();
  // Beam-width gunwales and thin iron rails show scale without hiding the cove.
  for (const side of [-1, 1]) {
    const nameplate = new THREE.Mesh(new THREE.PlaneGeometry(1.78, 0.38), nameMaterial);
    nameplate.name = 'Greywake ferry hull nameplate';
    nameplate.position.set(side * 2.235, 0.81, 1.98);
    nameplate.rotation.y = side * Math.PI / 2;
    group.add(nameplate);
    box(group, mats, 'cream', [0.11, 0.25, 7.7], [side * 2.09, 1.09, -0.18], 'Painted gunwale');
    const zValues = [-4.65, -3.25, -1.85, -0.45, 0.95, 2.35, 3.48];
    for (const z of zValues) rod(group, mats.navy,
      [side * 2.05, 1.19, z], [side * 2.05, 1.77, z], 0.024);
    for (let i = 0; i < zValues.length - 1; i++) rod(group, mats.navy,
      [side * 2.05, 1.76, zValues[i]], [side * 2.05, 1.76, zValues[i + 1]], 0.024);
    // Bow rails follow the narrowing bow instead of cutting across the view.
    rod(group, mats.navy, [side * 2.05, 1.76, 3.48], [side * 1.55, 1.76, 4.72], 0.024);
    rod(group, mats.navy, [side * 1.55, 1.76, 4.72], [side * 0.86, 1.66, 5.48], 0.024);
    rod(group, mats.navy, [side * 1.55, 1.19, 4.72], [side * 1.55, 1.76, 4.72], 0.024);
    // Dark rubber tires are customary working-ferry fenders.
    for (const z of [-3.55, 1.2]) {
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.11, 7, 12), mats.black);
      tire.rotation.y = Math.PI / 2;
      tire.position.set(side * 2.33, 0.91, z);
      group.add(tire);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.075, 8, 16), mats.red);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(side * 2.25, 1.65, -0.68);
    ring.name = 'Port or starboard life ring';
    group.add(ring);
  }
  // Forward mooring bitts and a short cargo hatch sit outside the camera path.
  for (const x of [-0.82, 0.82]) {
    box(group, mats, 'black', [0.17, 0.3, 0.18], [x, 1.18, 4.34]);
    box(group, mats, 'brass', [0.4, 0.08, 0.1], [x, 1.34, 4.34]);
  }
  box(group, mats, 'navy', [1.16, 0.1, 0.82], [0, 1.09, 3.82], 'Forward cargo hatch');
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), mats.lamp);
    lamp.position.set(side * 1.85, 2.08, -4.85);
    group.add(lamp);
  }
}

/** Original small coastal passenger ferry, bow toward local +Z. */
export function createFerryVisual() {
  const group = new THREE.Group();
  group.name = 'Greywake weathered passenger ferry';
  const mats = getMaterials();
  ringHull(group, mats);
  superstructure(group, mats);
  deckFittings(group, mats);
  flushRods(group);
  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = child.material !== mats.window;
      child.receiveShadow = true;
    }
  });
  return group;
}

// The north-inlet rescue launch is a separate, narrower working craft. It
// shares the ferry's CC0 planks and metal detail but has its own dark paint,
// low wheelhouse, open working foredeck, fenders and rescue fittings.
const launchOutline = [
  [0, 3.86], [0.62, 3.48], [1.02, 2.72], [1.22, 1.42],
  [1.24, -2.48], [0.87, -3.28], [0.46, -3.47],
  [-0.46, -3.47], [-0.87, -3.28], [-1.24, -2.48],
  [-1.22, 1.42], [-1.02, 2.72], [-0.62, 3.48],
];

function getLaunchMaterials() {
  if (launchMaterials) return launchMaterials;
  const ferry = getMaterials();
  launchMaterials = {
    ...ferry,
    hull: new THREE.MeshStandardMaterial({
      color: 0xced8d1, map: paintTexture([61, 91, 96], 79, true),
      normalMap: ferry.hull.normalMap, normalScale: new THREE.Vector2(0.19, 0.19),
      roughnessMap: ferry.hull.roughnessMap, roughness: 0.83, metalness: 0.17,
      side: THREE.DoubleSide,
    }),
    safety: new THREE.MeshStandardMaterial({
      color: 0xb46a47, roughness: 0.73, metalness: 0.12,
    }),
  };
  return launchMaterials;
}

function rescueNameMaterial() {
  if (launchNameMaterial) return launchNameMaterial;
  if (typeof document === 'undefined') {
    launchNameMaterial = getMaterials().cream;
    return launchNameMaterial;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e3dbc6';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#30464b';
  ctx.lineWidth = 7;
  ctx.strokeRect(9, 9, 494, 110);
  ctx.fillStyle = '#243d44';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 54px Georgia, serif';
  ctx.fillText('GREYWAKE', 256, 55);
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText('UTILITY LAUNCH', 256, 95);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  launchNameMaterial = new THREE.MeshStandardMaterial({
    map, roughness: 0.82, metalness: 0.04, side: THREE.DoubleSide,
  });
  return launchNameMaterial;
}

function rescueHull(group, mats) {
  const rings = [
    { y: -0.43, scale: 0.52 }, { y: -0.1, scale: 0.78 },
    { y: 0.6, scale: 0.98 }, { y: 1.04, scale: 1 },
  ];
  const n = launchOutline.length;
  const positions = [], uvs = [], indices = [];
  for (let r = 0; r < rings.length; r++) {
    for (let i = 0; i <= n; i++) {
      const [x, z] = launchOutline[i % n];
      positions.push(x * rings[r].scale, rings[r].y, z * rings[r].scale);
      uvs.push(i / n * 2.5, r / (rings.length - 1));
    }
  }
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) {
    const a = r * (n + 1) + i, b = a + n + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const hull = new THREE.Mesh(geometry, mats.hull);
  hull.name = 'Weathered rescue-launch steel hull';
  group.add(hull);
  hullBand(group, mats.cream, 0.76, 0.88, 'Rescue launch painted sheer stripe', launchOutline);
  hullBand(group, mats.boot, 0.1, 0.24, 'Rescue launch rusted boot stripe', launchOutline);

  const deckPositions = [], deckUvs = [];
  for (let i = 0; i < n; i++) {
    for (const [x, z] of [[0, 0], launchOutline[i], launchOutline[(i + 1) % n]]) {
      deckPositions.push(x * 0.94, 1.045, z * 0.94);
      deckUvs.push((x + 1.25) / 2.5, (z + 3.5) / 7.4);
    }
  }
  const deckGeometry = new THREE.BufferGeometry();
  deckGeometry.setAttribute('position', new THREE.Float32BufferAttribute(deckPositions, 3));
  deckGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(deckUvs, 2));
  deckGeometry.computeVertexNormals();
  const deck = new THREE.Mesh(deckGeometry, mats.deck);
  deck.name = 'CC0 timber rescue working deck';
  group.add(deck);
}

function rescueWheelhouse(group, mats) {
  box(group, mats, 'cream', [1.78, 1.22, 2.38], [0, 1.7, -1.02],
    'Rescue launch low wheelhouse');
  box(group, mats, 'navy', [2.05, 0.14, 2.67], [0, 2.39, -1.02],
    'Rescue launch overhanging roof');
  box(group, mats, 'brass', [2.07, 0.04, 2.69], [0, 2.49, -1.02]);
  for (const x of [-0.49, 0.49]) {
    box(group, mats, 'navy', [0.85, 0.73, 0.045], [x, 1.77, 0.2]);
    box(group, mats, 'window', [0.76, 0.64, 0.055], [x, 1.77, 0.235]);
  }
  for (const side of [-1, 1]) {
    for (const z of [-1.57, -0.61]) {
      box(group, mats, 'navy', [0.045, 0.66, 0.68], [side * 0.9, 1.77, z]);
      box(group, mats, 'window', [0.05, 0.57, 0.58], [side * 0.932, 1.77, z]);
    }
  }
  box(group, mats, 'navy', [0.83, 1.09, 0.08], [0, 1.67, -2.23],
    'Rescue launch aft door');
  box(group, mats, 'window', [0.49, 0.42, 0.09], [0, 1.94, -2.285]);
  box(group, mats, 'brass', [0.07, 0.11, 0.07], [0.31, 1.42, -2.29]);

  // The mast meets the navigation-light position supplied by boats.js.
  rod(group, mats.navy, [0, 2.5, -0.85], [0, 4.03, -0.85], 0.045);
  rod(group, mats.navy, [-0.42, 3.44, -0.85], [0.42, 3.44, -0.85], 0.026);
  box(group, mats, 'safety', [0.65, 0.13, 0.31], [0, 2.58, -1.49],
    'Roof searchlight housing');
  const searchlight = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.24, 10),
    mats.brass);
  searchlight.rotation.x = Math.PI / 2;
  searchlight.position.set(0, 2.62, -1.3);
  group.add(searchlight);
}

function rescueDeckFittings(group, mats) {
  const sign = rescueNameMaterial();
  for (const side of [-1, 1]) {
    const nameplate = new THREE.Mesh(new THREE.PlaneGeometry(1.38, 0.35), sign);
    nameplate.name = 'Rescue launch hull nameplate';
    nameplate.position.set(side * 1.32, 0.96, -0.82);
    nameplate.rotation.y = side * Math.PI / 2;
    group.add(nameplate);
    box(group, mats, 'black', [0.11, 0.2, 4.7], [side * 1.22, 0.78, -0.2],
      'Rescue launch rubber rubrail');
    box(group, mats, 'cream', [0.075, 0.2, 3.05], [side * 1.08, 1.12, 1.35],
      'Rescue launch forward gunwale');
    for (const z of [0.56, 1.57, 2.48]) {
      rod(group, mats.navy, [side * 1.09, 1.18, z],
        [side * 1.09, 1.64, z], 0.025);
    }
    rod(group, mats.navy, [side * 1.09, 1.64, 0.56],
      [side * 1.09, 1.64, 2.48], 0.025);
    rod(group, mats.navy, [side * 1.09, 1.64, 2.48],
      [side * 0.49, 1.55, 3.44], 0.025);
    for (const z of [-2.45, 1.24]) {
      const fender = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.09, 7, 12),
        mats.black);
      fender.rotation.y = Math.PI / 2;
      fender.position.set(side * 1.35, 0.93, z);
      group.add(fender);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 7, 14),
      mats.safety);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(side * 0.99, 1.55, -1.09);
    ring.name = 'Rescue launch life ring';
    group.add(ring);
  }
  box(group, mats, 'navy', [1.3, 0.14, 1.02], [0, 1.13, 2.13],
    'Forward rescue equipment locker');
  for (const x of [-0.64, 0.64]) {
    box(group, mats, 'black', [0.14, 0.27, 0.17], [x, 1.17, 3.01],
      'Rescue launch bow mooring bitt');
    box(group, mats, 'brass', [0.34, 0.08, 0.12], [x, 1.32, 3.01]);
  }
  box(group, mats, 'safety', [0.72, 0.22, 0.34], [0, 1.16, 0.73],
    'Rescue launch emergency float case');
}

/** Original textured rescue craft for the north berth, bow toward local +Z. */
export function createRescueLaunchVisual() {
  const group = new THREE.Group();
  group.name = 'Greywake weathered rescue launch';
  const mats = getLaunchMaterials();
  rescueHull(group, mats);
  rescueWheelhouse(group, mats);
  rescueDeckFittings(group, mats);
  flushRods(group);
  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = child.material !== mats.window;
      child.receiveShadow = true;
    }
  });
  return group;
}
