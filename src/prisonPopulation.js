import * as THREE from 'three';
import { PRISON_LAYOUT } from './setDressing.js';

// The former annex has a small staffed holding wing. These occupants are
// ambient island residents with no associated objectives or plot state.
export const PRISON_OCCUPANTS = Object.freeze([
  Object.freeze({ id: 'gate_guard_west', name: 'Gate guard', role: 'Guard', kind: 'guard',
    x: -62.7, z: 101, heading: Math.PI - 0.15,
    line: 'The holding wing is staffed tonight. Please keep the gate lane clear.' }),
  Object.freeze({ id: 'gate_guard_east', name: 'Gate guard', role: 'Guard', kind: 'guard',
    x: -52.5, z: 106.5, heading: Math.PI + 0.35,
    line: 'The sea road is exposed tonight. Take care crossing the yard.' }),
  Object.freeze({ id: 'yard_guard', name: 'Yard guard', role: 'Guard', kind: 'guard',
    x: -81, z: 69, heading: -0.8,
    line: 'The old wing was closed for years. This is a short holding shift.' }),
  Object.freeze({ id: 'wing_guard', name: 'Wing guard', role: 'Guard', kind: 'guard',
    x: -34.4, z: 32.2, heading: 0.45,
    line: 'You can pass through the corridor. The cells with shut bars stay shut.' }),
  Object.freeze({ id: 'detainee_n1', name: 'Detainee · N1', role: 'Holding wing detainee', kind: 'detainee',
    x: -68, z: 21.4, heading: Math.PI, line: 'Even in here, the salt gets into everything.' }),
  Object.freeze({ id: 'detainee_n2', name: 'Detainee · N2', role: 'Holding wing detainee', kind: 'detainee',
    x: -60, z: 21.4, heading: Math.PI, line: 'I can hear the wind coming through the roof vents.' }),
  Object.freeze({ id: 'detainee_n3', name: 'Detainee · N3', role: 'Holding wing detainee', kind: 'detainee',
    x: -52, z: 21.4, heading: Math.PI, line: 'They said the weather might hold the ferry overnight.' }),
  Object.freeze({ id: 'detainee_n5', name: 'Detainee · N5', role: 'Holding wing detainee', kind: 'detainee',
    x: -36, z: 21.4, heading: Math.PI, line: 'The lamps make a different sound when the power dips.' }),
  Object.freeze({ id: 'detainee_n7', name: 'Detainee · N7', role: 'Holding wing detainee', kind: 'detainee',
    x: -20, z: 21.4, heading: Math.PI, line: 'Some nights you can hear the buoy bell from this cell.' }),
  Object.freeze({ id: 'detainee_s1', name: 'Detainee · S1', role: 'Holding wing detainee', kind: 'detainee',
    x: -68, z: 30.6, heading: 0, line: 'The rain sounds louder against the cell-block roof.' }),
  Object.freeze({ id: 'detainee_s3', name: 'Detainee · S3', role: 'Holding wing detainee', kind: 'detainee',
    x: -52, z: 30.6, heading: 0, line: 'The corridor gets quiet after the last round.' }),
  Object.freeze({ id: 'detainee_s7', name: 'Detainee · S7', role: 'Holding wing detainee', kind: 'detainee',
    x: -20, z: 30.6, heading: 0, line: 'The sea is all I can see through that little window.' }),
]);

const GUARD_RADIUS = 0.47;
const TALK_RADIUS = 4.0;
// Each garment/detail is shared by all twelve people in one instanced batch.
// The small variations in material and pose keep the wing readable without
// adding a mesh tree (and draw calls) for every stationary character.
const parts = [
  { id: 'torso', geometry: 'coat', material: 'cloth', multiplicity: 1 },
  { id: 'shoulders', geometry: 'sphere', material: 'cloth', multiplicity: 1 },
  { id: 'belt', geometry: 'band', material: 'leather', multiplicity: 1 },
  { id: 'legs', geometry: 'cylinder', material: 'cloth', multiplicity: 2 },
  { id: 'boots', geometry: 'sphere', material: 'leather', multiplicity: 2 },
  { id: 'arms', geometry: 'cylinder', material: 'cloth', multiplicity: 2 },
  { id: 'sleeveSeams', geometry: 'sphere', material: 'cloth', multiplicity: 2 },
  { id: 'hands', geometry: 'sphere', material: 'skin', multiplicity: 2 },
  { id: 'neck', geometry: 'cylinder', material: 'skin', multiplicity: 1 },
  { id: 'head', geometry: 'sphere', material: 'skin', multiplicity: 1 },
  { id: 'ears', geometry: 'sphere', material: 'skin', multiplicity: 2 },
  { id: 'hair', geometry: 'hair', material: 'hair', multiplicity: 1 },
  { id: 'nose', geometry: 'sphere', material: 'skin', multiplicity: 1 },
  { id: 'eyes', geometry: 'sphere', material: 'leather', multiplicity: 2 },
  { id: 'cap', geometry: 'cylinder', material: 'cloth', multiplicity: 1 },
  { id: 'brim', geometry: 'sphere', material: 'cloth', multiplicity: 1 },
  { id: 'capBand', geometry: 'band', material: 'leather', multiplicity: 1 },
  { id: 'badge', geometry: 'sphere', material: 'metal', multiplicity: 1 },
  { id: 'lapels', geometry: 'lapel', material: 'trim', multiplicity: 2 },
  { id: 'pockets', geometry: 'sphere', material: 'cloth', multiplicity: 2 },
  { id: 'buttons', geometry: 'sphere', material: 'metal', multiplicity: 3 },
  { id: 'cuffs', geometry: 'cylinder', material: 'cloth', multiplicity: 2 },
];

function colorFor(part, person, index) {
  const guard = person.kind === 'guard';
  const coat = guard ? (index % 2 ? 0x465958 : 0x394c4c)
    : [0x797e7a, 0x687478, 0x86867b, 0x777d83][index % 4];
  const skin = [0xb58b6e, 0xd0ab8d, 0x96705f, 0xc49a7b][index % 4];
  if (['torso', 'shoulders', 'arms', 'sleeveSeams', 'cap', 'brim'].includes(part)) return coat;
  if (part === 'legs') return guard ? 0x343e3f : 0x4a5152;
  if (part === 'lapels') return guard ? 0x60716c : 0x878d85;
  if (part === 'pockets' || part === 'cuffs') return guard ? 0x566a64 : 0x858c86;
  if (['head', 'hands', 'neck', 'ears', 'nose'].includes(part)) return skin;
  if (part === 'hair') return [0x292a2a, 0x58483b, 0x77716b, 0x353732][index % 4];
  if (part === 'badge') return 0xb9a474;
  if (part === 'buttons') return guard ? 0x9e9578 : 0x5b5c55;
  if (part === 'eyes') return 0x332c27;
  return 0x292f30;
}

function posePart(id, side, guard, walk, breath) {
  const swing = Math.sin(walk) * (guard ? 0.018 : 0.035);
  switch (id) {
    case 'torso': return [0, breath, 0, 1, 1, 0.82, 0];
    case 'shoulders': return [0, 1.415 + breath, 0, 0.285, 0.095, 0.225, 0];
    case 'belt': return [0, 0.82 + breath, 0, 0.285, 0.07, 0.25, 0];
    case 'legs': return [side * 0.14, 0.47, 0, 0.112, 0.75, 0.111, side * swing];
    case 'boots': return [side * 0.14, 0.105, -0.055, 0.128, 0.105, 0.205, 0];
    case 'arms': return [side * 0.34, 1.115 + breath, 0, 0.093, 0.515, 0.093, side * (0.12 + swing)];
    case 'sleeveSeams': return [side * 0.287, 1.385 + breath, 0, 0.095, 0.072, 0.105, side * 0.1];
    case 'hands': return [side * 0.39, 0.795 + breath, -0.025, 0.071, 0.093, 0.065, 0];
    case 'neck': return [0, 1.555 + breath, 0, 0.075, 0.15, 0.072, 0];
    case 'head': return [0, 1.708 + breath, 0, 0.158, 0.186, 0.144, 0];
    case 'ears': return [side * 0.153, 1.697 + breath, 0, 0.025, 0.044, 0.026, 0];
    case 'hair': return [0, 1.767 + breath, 0.013, 0.165, 0.148, 0.151, 0];
    case 'nose': return [0, 1.685 + breath, -0.15, 0.025, 0.035, 0.026, 0];
    case 'eyes': return [side * 0.056, 1.73 + breath, -0.149, 0.014, 0.009, 0.005, 0];
    case 'cap': return [0, 1.897 + breath, 0.015, guard ? 0.167 : 0, guard ? 0.102 : 0, guard ? 0.166 : 0, 0];
    case 'brim': return [0, 1.853 + breath, -0.103, guard ? 0.18 : 0, guard ? 0.021 : 0, guard ? 0.135 : 0, 0];
    case 'capBand': return [0, 1.858 + breath, 0.015, guard ? 0.168 : 0, guard ? 0.028 : 0, guard ? 0.167 : 0, 0];
    case 'badge': return [-0.16, 1.34 + breath, -0.232, guard ? 0.032 : 0, guard ? 0.037 : 0, guard ? 0.015 : 0, 0];
    case 'lapels': return [side * 0.106, 1.345 + breath, -0.249, 0.087, 0.158, 1, side * 0.18];
    case 'pockets': return [side * 0.16, 0.87 + breath, -0.268, 0.078, 0.025, 0.012, 0];
    case 'buttons': return [0.025, 1.31 - (side + 1) * 0.117 + breath, -0.247,
      0.014, 0.014, 0.008, 0];
    case 'cuffs': return [side * 0.385, 0.87 + breath, -0.01, 0.103, 0.045, 0.104, 0];
    default: throw new Error(`Unknown prison population part: ${id}`);
  }
}

function coatGeometry() {
  // A weighted hem, narrowed waist, and shaped shoulders read as coastal
  // workwear at middle distance. The radial profile is reused for all coats.
  const profile = [
    [0.315, 0.54], [0.328, 0.575], [0.308, 0.72], [0.278, 0.94],
    [0.285, 1.16], [0.29, 1.34], [0.25, 1.435], [0.14, 1.49],
  ];
  return new THREE.LatheGeometry(profile.map(([radius, y]) => new THREE.Vector2(radius, y)), 12);
}

function lapelGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.36, 1);
  shape.lineTo(0.64, 0.82);
  shape.lineTo(1, -0.88);
  shape.lineTo(-0.05, -0.28);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function clothWeave() {
  // Procedural weave: no external asset or license dependency. Mild enough to
  // avoid tiling at normal viewing distance, but it breaks up flat uniforms.
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hash = ((x * 53 + y * 97) ^ (x * y * 13)) & 15;
    const thread = (x % 4 === 0 || y % 4 === 0) ? -7 : 0;
    const shade = 240 + hash / 2 + thread;
    const offset = (y * size + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = shade;
    pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 4);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function addCellFixtures(root, terrainHeight) {
  // The block shell supplies the walls, bars, and original cot frames. These
  // small, instanced details stay at the back of each bay, leaving the central
  // 4.2 m passage and the one open cell clear.
  const soft = [];
  const hard = [];
  const pillows = [];
  const metal = [];
  const colliders = [];
  const { x, z, width, depth } = PRISON_LAYOUT.cellBlock;
  const x0 = x - width / 2;
  const z0 = z - depth / 2;
  const z1 = z + depth / 2;
  const box = (items, xPos, yPos, zPos, sx, sy, sz, color) => {
    items.push({ x: xPos, y: yPos, z: zPos, sx, sy, sz, color });
  };
  for (let row = 0; row < 2; row++) {
    const backZ = row === 0 ? z0 + 2.1 : z1 - 2.1;
    const towardPassage = row === 0 ? 1 : -1;
    for (let bay = 0; bay < 8; bay++) {
      if (row === 1 && (bay === 3 || bay === 4)) continue;
      const midpoint = x0 + bay * 8 + 4;
      const cotX = midpoint - 0.55;
      const floor = terrainHeight(cotX, backZ);
      colliders.push({ x: cotX, z: backZ, halfWidth: 1.12, halfDepth: 0.45 });
      const palette = (bay + row * 3) % 3;
      const blanket = [0x687a78, 0x737973, 0x65727a][palette];
      // Textile sits on the existing narrow timber cot.
      box(soft, cotX, floor + 0.63, backZ, 1.94, 0.16, 0.65, 0x6a7979);
      box(soft, cotX + 0.44, floor + 0.744, backZ, 0.99, 0.07, 0.66, blanket);
      pillows.push({ x: cotX - 0.65, y: floor + 0.76, z: backZ,
        sx: 0.28, sy: 0.085, sz: 0.25, color: 0xb7b5a8 });

      // Alternate cells retain a compact upper bunk from the annex's former
      // peak use. It is below the outer windows and well behind each gate.
      if ((bay + row) % 2 === 0) {
        const upper = floor + 2.11;
        box(hard, cotX, upper - 0.13, backZ, 2.22, 0.11, 0.79, 0x3b4442);
        for (const end of [-1, 1]) {
          box(hard, cotX + end * 1.01, floor + 1.24, backZ - 0.3,
            0.075, 1.88, 0.075, 0x323c3b);
          box(hard, cotX + end * 1.01, floor + 1.24, backZ + 0.3,
            0.075, 1.88, 0.075, 0x323c3b);
        }
        box(hard, cotX, upper + 0.17, backZ + towardPassage * 0.38,
          2.02, 0.12, 0.055, 0x404b49);
        box(soft, cotX, upper + 0.03, backZ, 1.98, 0.16, 0.64, 0x697878);
        box(soft, cotX + 0.46, upper + 0.145, backZ, 0.94, 0.07, 0.64, blanket);
        pillows.push({ x: cotX - 0.65, y: upper + 0.17, z: backZ,
          sx: 0.28, sy: 0.085, sz: 0.25, color: 0xa9aca0 });
      }

      // A small enamel cup and shelf give each existing wash pedestal a
      // readable use. No fixture reaches the prisoner pacing zone.
      const shelfX = midpoint + 2.16;
      const shelfZ = backZ + towardPassage * 0.27;
      colliders.push({ x: shelfX, z: shelfZ, halfWidth: 0.63, halfDepth: 0.28 });
      const shelfFloor = terrainHeight(shelfX, shelfZ);
      box(hard, shelfX, shelfFloor + 1.35, shelfZ, 1.26, 0.09, 0.47, 0x514a3f);
      for (const side of [-1, 1]) box(hard, shelfX + side * 0.48,
        shelfFloor + 1.18, shelfZ, 0.065, 0.31, 0.36, 0x414b49);
      metal.push({ x: shelfX + 0.34, y: shelfFloor + 1.52, z: shelfZ,
        sx: 0.13, sy: 0.22, sz: 0.13, color: 0xadb2a4 });
      metal.push({ x: shelfX, y: shelfFloor + 0.92, z: shelfZ,
        sx: 0.045, sy: 0.56, sz: 0.045, color: 0x606a68 });
    }
  }

  // An unmarked duty desk makes the reopened holding wing feel staffed while
  // keeping the central entrance lane clear of furniture.
  const deskX = x - 6;
  const deskZ = z + 7.8;
  const deskFloor = terrainHeight(deskX, deskZ);
  box(hard, deskX, deskFloor + 0.91, deskZ, 2.32, 0.12, 1.04, 0x625447);
  for (const sideX of [-1, 1]) {
    for (const sideZ of [-1, 1]) box(hard, deskX + sideX * 1.03,
      deskFloor + 0.43, deskZ + sideZ * 0.42, 0.1, 0.84, 0.1, 0x424846);
  }
  box(hard, deskX, deskFloor + 0.76, deskZ + 0.49, 1.82, 0.19, 0.07, 0x51473d);
  const chairZ = deskZ - 1.85;
  const chairFloor = terrainHeight(deskX, chairZ);
  box(hard, deskX, chairFloor + 0.47, chairZ, 0.76, 0.1, 0.68, 0x564b3f);
  box(hard, deskX, chairFloor + 0.96, chairZ - 0.29, 0.76, 0.91, 0.09, 0x514840);
  for (const sideX of [-1, 1]) {
    for (const sideZ of [-1, 1]) box(hard, deskX + sideX * 0.3,
      chairFloor + 0.22, chairZ + sideZ * 0.27, 0.075, 0.44, 0.075, 0x343d3c);
  }
  metal.push({ x: deskX + 0.73, y: deskFloor + 1.09, z: deskZ + 0.12,
    sx: 0.12, sy: 0.23, sz: 0.12, color: 0x9da69a });
  colliders.push({ x: deskX, z: deskZ, halfWidth: 1.16, halfDepth: 0.52 });
  colliders.push({ x: deskX, z: chairZ, halfWidth: 0.38, halfDepth: 0.34 });

  const dummy = new THREE.Object3D();
  const batches = [
    ['soft furnishings', soft, new THREE.BoxGeometry(1, 1, 1), 0.97, 0],
    ['bunk frames and shelves', hard, new THREE.BoxGeometry(1, 1, 1), 0.8, 0.15],
    ['linen pillows', pillows, new THREE.SphereGeometry(1, 8, 6), 0.96, 0],
    ['wash fittings', metal, new THREE.CylinderGeometry(1, 1, 1, 8), 0.72, 0.42],
  ];
  const meshes = batches.map(([label, items, geometry, roughness, metalness]) => {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness });
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mesh.name = `Prison cell ${label}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    items.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.scale.set(item.sx, item.sy, item.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, new THREE.Color(item.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
    return mesh;
  });
  return { meshes, colliders };
}

function fixtureDistance(x, z, rectangle) {
  return Math.hypot(Math.max(Math.abs(x - rectangle.x) - rectangle.halfWidth, 0),
    Math.max(Math.abs(z - rectangle.z) - rectangle.halfDepth, 0));
}

export function createPrisonPopulation(scene, terrainHeight) {
  const root = new THREE.Group();
  root.name = 'Prison holding wing population';
  scene.add(root);
  const geometry = {
    coat: coatGeometry(),
    lapel: lapelGeometry(),
    sphere: new THREE.SphereGeometry(1, 12, 9),
    hair: new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.53),
    cylinder: new THREE.CylinderGeometry(0.88, 1, 1, 10),
    band: new THREE.TorusGeometry(1, 0.052, 5, 18).rotateX(Math.PI / 2),
  };
  const weave = clothWeave();
  const partMaterials = {
    cloth: new THREE.MeshStandardMaterial({ color: 0xffffff, map: weave, roughness: 0.93 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xffffff, map: weave,
      roughness: 0.95, side: THREE.DoubleSide }),
    leather: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    hair: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.91 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.58, metalness: 0.45 }),
  };
  const people = PRISON_OCCUPANTS.map((person, index) => ({
    ...person, baseY: terrainHeight(person.x, person.z) + 0.15,
    xNow: person.x, zNow: person.z, index,
  }));
  const fixtures = addCellFixtures(root, terrainHeight);
  const meshes = parts.map((part) => {
    const mesh = new THREE.InstancedMesh(geometry[part.geometry], partMaterials[part.material],
      people.length * part.multiplicity);
    mesh.name = `Prison people ${part.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    for (let i = 0; i < people.length; i++) {
      for (let side = 0; side < part.multiplicity; side++) {
        mesh.setColorAt(i * part.multiplicity + side,
          new THREE.Color(colorFor(part.id, people[i], i)));
      }
    }
    mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
    return { part, mesh };
  });
  const dummy = new THREE.Object3D();
  const spatial = new THREE.Sphere(new THREE.Vector3(
    (PRISON_LAYOUT.bounds.minX + PRISON_LAYOUT.bounds.maxX) / 2,
    48,
    (PRISON_LAYOUT.bounds.minZ + PRISON_LAYOUT.bounds.maxZ) / 2,
  ), 90);
  // A single generous bound avoids stale instance culling when a person paces.
  for (const { mesh } of meshes) mesh.boundingSphere = spatial;
  const viewProjection = new THREE.Matrix4();
  const viewFrustum = new THREE.Frustum();

  function posesMayRender(camera, shadowLight) {
    // Without both views, retain the original full update. The sun is the
    // only shadow-casting light in the game, so a camera-only test could freeze
    // a visible shadow cast by an otherwise off-screen person.
    if (!camera?.isCamera || !shadowLight?.isDirectionalLight
      || !shadowLight.castShadow || !shadowLight.shadow?.camera) return true;
    camera.updateWorldMatrix(true, false);
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    viewFrustum.setFromProjectionMatrix(viewProjection,
      camera.coordinateSystem, camera.reversedDepth);
    if (viewFrustum.intersectsSphere(spatial)) return true;

    // Match the shadow camera that WebGLShadowMap will use later this frame.
    shadowLight.updateWorldMatrix(true, false);
    shadowLight.target.updateWorldMatrix(true, false);
    shadowLight.shadow.camera.updateProjectionMatrix();
    shadowLight.shadow.updateMatrices(shadowLight);
    return shadowLight.shadow.getFrustum().intersectsSphere(spatial);
  }

  function update(elapsed = 0, context = {}) {
    const storm = context.weather === 'storm' || context.storm === true;
    for (const person of people) {
      const guard = person.kind === 'guard';
      const phase = elapsed * (guard ? 0.47 : 0.62) + person.index * 1.73;
      // Detainees remain in their own barred bays. Guards shift weight but
      // never drift into the open gate, old ledger, or traversal corridor.
      const pace = guard ? 0 : Math.sin(phase) * (person.index % 3 === 0 ? 0.48 : 0.24);
      person.xNow = person.x + pace;
      person.zNow = person.z;
    }
    if (!posesMayRender(context.camera, context.shadowLight)) return;
    for (const { part, mesh } of meshes) {
      for (const person of people) {
        const guard = person.kind === 'guard';
        const phase = elapsed * 0.7 + person.index * 1.11;
        const breath = Math.sin(phase) * (storm && guard ? 0.009 : 0.006);
        const looking = ['head', 'hair', 'ears', 'nose', 'eyes', 'cap', 'brim', 'capBand'].includes(part.id);
        const yaw = person.heading + Math.sin(phase * 0.4) * (guard ? 0.035 : 0.075)
          + (looking ? Math.sin(phase * 0.55) * (guard ? 0.14 : 0.21) : 0);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        for (let side = 0; side < part.multiplicity; side++) {
          const sign = part.id === 'buttons' ? side - 1 : side === 0 ? -1 : 1;
          const [lx, ly, lz, sx, sy, sz, lean] = posePart(part.id, sign, guard, phase, breath);
          dummy.position.set(person.xNow + lx * c + lz * s, person.baseY + ly,
            person.zNow - lx * s + lz * c);
          dummy.rotation.set(0, yaw, lean);
          dummy.scale.set(part.id === 'torso' ? sx * (0.93 + (person.index % 4) * 0.045)
            : part.id === 'lapels' ? sx * sign : sx,
            sy, sz);
          dummy.updateMatrix();
          mesh.setMatrixAt(person.index * part.multiplicity + side, dummy.matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function nearestPerson(x, z, maxDistance = TALK_RADIUS) {
    let best = null;
    let bestDistance = maxDistance;
    for (const person of people) {
      const distance = Math.hypot(x - person.xNow, z - person.zNow);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { id: person.id, name: person.name, role: person.role,
          line: person.line, kind: person.kind,
          world: [person.xNow, person.zNow], distance };
      }
    }
    return best;
  }

  function collides(x, z, radius = 0.35) {
    return people.some((person) => person.kind === 'guard'
      && Math.hypot(x - person.xNow, z - person.zNow) < GUARD_RADIUS + radius)
      || fixtures.colliders.some((rectangle) => fixtureDistance(x, z, rectangle) < radius);
  }

  function blocksMove(fromX, fromZ, toX, toZ, radius = 0.35) {
    const blocksGuard = people.some((person) => {
      if (person.kind !== 'guard') return false;
      const before = Math.hypot(fromX - person.xNow, fromZ - person.zNow);
      const after = Math.hypot(toX - person.xNow, toZ - person.zNow);
      return after < GUARD_RADIUS + radius && after < before - 0.00001;
    });
    return blocksGuard || fixtures.colliders.some((rectangle) => {
      const before = fixtureDistance(fromX, fromZ, rectangle);
      const after = fixtureDistance(toX, toZ, rectangle);
      return after < radius && after < before - 0.00001;
    });
  }

  function dispose() {
    scene.remove(root);
    for (const { mesh } of meshes) mesh.dispose();
    for (const item of Object.values(geometry)) item.dispose();
    for (const material of Object.values(partMaterials)) material.dispose();
    weave.dispose();
    for (const mesh of fixtures.meshes) {
      mesh.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }

  update(0);
  return { group: root, occupants: people, update, nearestPerson, collides, blocksMove, dispose };
}
