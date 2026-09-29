import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Island structure geometry. The only image maps referenced
// here are the already-distributed Poly Haven CC0 maps in building-textures.
// Distances are metres and +z points toward the landing cove.
export const PRISON_LAYOUT = Object.freeze({
  bounds: Object.freeze({ minX: -90, maxX: 30, minZ: 10, maxZ: 105 }),
  gate: Object.freeze({ x: -58, z: 105, width: 8 }),
  cellBlock: Object.freeze({ x: -40, z: 26, width: 64, depth: 22 }),
  clinic: Object.freeze({ x: -76, z: 64, width: 18, depth: 17 }),
  administration: Object.freeze({ x: 13, z: 62, width: 20, depth: 18 }),
  approach: Object.freeze([[-127, 127], [-97, 119], [-78, 113], [-58, 112], [-58, 105]]),
  vehicles: Object.freeze([
    Object.freeze({ id: 'staff_car', type: 'sedan', x: -34, z: 117, heading: -1.76 }),
    Object.freeze({ id: 'transport', type: 'van', x: -22, z: 78, heading: -1.08 }),
    // Keep the wagon on its own graded pull-in. Parking it on the single
    // lodge-to-archive carriageway blocks full-size cars and island traffic.
    Object.freeze({ id: 'service_wagon', type: 'wagon', x: -97, z: 156, heading: -Math.PI / 2 }),
  ]),
});

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function mapTexture(stem, kind, repeat = 1) {
  if (typeof document === 'undefined') return null;
  const texture = new THREE.TextureLoader().load(`/assets/building-textures/${stem}_${kind}.jpg`);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  if (kind === 'diffuse') texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function materialSet() {
  const mapped = (stem, tint, roughness = 0.9, metalness = 0) => new THREE.MeshStandardMaterial({
    color: tint,
    map: mapTexture(stem, 'diffuse', 1.4),
    normalMap: mapTexture(stem, 'nor_gl', 1.4),
    roughnessMap: mapTexture(stem, 'rough', 1.4),
    roughness,
    metalness,
    normalScale: new THREE.Vector2(0.45, 0.45),
  });
  return {
    concrete: mapped('concrete', 0xb5bbb7),
    darkStone: mapped('concrete', 0x7a8583),
    iron: new THREE.MeshStandardMaterial({ color: 0x303c40, roughness: 0.57, metalness: 0.7 }),
    rust: mapped('rust', 0xd0a188, 0.84, 0.3),
    timber: mapped('wood', 0xa5aaa5),
    slate: new THREE.MeshStandardMaterial({ color: 0x28343b, roughness: 0.91, metalness: 0.08 }),
    darkGlass: new THREE.MeshPhysicalMaterial({ color: 0x334b53, roughness: 0.19, metalness: 0.05,
      transparent: true, opacity: 0.67, side: THREE.DoubleSide, depthWrite: false }),
    black: new THREE.MeshStandardMaterial({ color: 0x121a1b, roughness: 0.89 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb5c0b9, roughness: 0.28, metalness: 0.83 }),
    cream: new THREE.MeshStandardMaterial({ color: 0xe1d7b5, roughness: 0.44 }),
    red: new THREE.MeshStandardMaterial({ color: 0x842d25, roughness: 0.48 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xc98545, roughness: 0.34 }),
    lampGlass: new THREE.MeshStandardMaterial({ color: 0xe8bc7d, roughness: 0.27,
      emissive: 0xb36a37, emissiveIntensity: 0.75 }),
    moss: new THREE.MeshStandardMaterial({ color: 0x536b55, roughness: 0.99 }),
    puddle: new THREE.MeshPhysicalMaterial({ color: 0x809da5, roughness: 0.08,
      metalness: 0.06, transparent: true, opacity: 0.31, depthWrite: false,
      side: THREE.DoubleSide }),
    carGreen: new THREE.MeshStandardMaterial({ color: 0x374b49, roughness: 0.39, metalness: 0.38 }),
    carBlue: new THREE.MeshStandardMaterial({ color: 0x45565b, roughness: 0.43, metalness: 0.31 }),
    carIvory: new THREE.MeshStandardMaterial({ color: 0xb7b5a1, roughness: 0.51, metalness: 0.21 }),
  };
}

function addBox(group, mat, x, y, z, width, height, depth, name = '') {
  const mesh = new THREE.Mesh(UNIT_BOX, mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(width, height, depth);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addCylinder(group, mat, x, y, z, radius, length, axis = 'y', sides = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, sides), mat);
  mesh.position.set(x, y, z);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addPlane(group, mat, vertices, uvs, name = '') {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = name;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function paintedSignMaterial(title, subtitle = '') {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#273536';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = '#52615d';
  ctx.fillRect(14, 14, 996, 228);
  ctx.fillStyle = '#303d3e';
  ctx.fillRect(21, 21, 982, 214);
  ctx.strokeStyle = 'rgba(233,221,187,.62)';
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 35, 952, 186);
  // Small deterministic chips and salt streaks sit around, never over, the
  // lettering. All lettering and distress are original Canvas artwork.
  for (let i = 0; i < 76; i++) {
    const x = 38 + ((i * 7193) % 945);
    const y = i % 2 ? 30 + ((i * 379) % 27) : 194 + ((i * 257) % 30);
    ctx.fillStyle = i % 3 ? 'rgba(221,215,185,.16)' : 'rgba(10,17,18,.24)';
    ctx.fillRect(x, y, 2 + i % 8, 2 + i % 3);
  }
  const mainSize = title.length > 21 ? 69 : title.length > 16 ? 78 : 91;
  ctx.fillStyle = '#e7dec6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${mainSize}px Georgia, serif`;
  ctx.fillText(title, 512, subtitle ? 111 : 130, 900);
  if (subtitle) {
    ctx.fillStyle = '#b7bda9';
    ctx.font = '600 29px Arial, sans-serif';
    ctx.fillText(subtitle, 512, 178, 900);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false,
    side: THREE.DoubleSide });
}

function addPaintedSign(group, mats, title, subtitle, x, y, z, width, height, name) {
  addBox(group, mats.iron, x, y, z - 0.08, width + 0.18, height + 0.18, 0.16,
    `${name} corroded frame`);
  const material = paintedSignMaterial(title, subtitle) || mats.cream;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  panel.position.set(x, y, z + 0.014);
  panel.name = name;
  panel.receiveShadow = true;
  group.add(panel);
  for (const side of [-1, 1]) {
    addCylinder(group, mats.rust, x + side * (width / 2 - 0.08), y,
      z + 0.035, 0.045, 0.045, 'z', 8);
  }
  return panel;
}

function groundPatch(group, heightAt, bounds, mat, step = 3, lift = 0.095, name = 'paving') {
  const vertices = [], uvs = [];
  for (let x = bounds.minX; x < bounds.maxX - 0.001; x += step) {
    const nx = Math.min(bounds.maxX, x + step);
    for (let z = bounds.minZ; z < bounds.maxZ - 0.001; z += step) {
      const nz = Math.min(bounds.maxZ, z + step);
      const p = [
        [x, heightAt(x, z) + lift, z], [nx, heightAt(nx, z) + lift, z],
        [nx, heightAt(nx, nz) + lift, nz], [x, heightAt(x, nz) + lift, nz],
      ];
      const ids = [0, 2, 1, 0, 3, 2];
      for (const i of ids) {
        vertices.push(...p[i]);
        uvs.push(p[i][0] * 0.18, p[i][2] * 0.18);
      }
    }
  }
  return addPlane(group, mat, vertices, uvs, name);
}

function trailStrip(group, heightAt, points, mat, width = 4.4) {
  const vertices = [], uvs = [];
  let running = 0;
  for (let edge = 1; edge < points.length; edge++) {
    const [ax, az] = points[edge - 1];
    const [bx, bz] = points[edge];
    const length = Math.hypot(bx - ax, bz - az);
    const nx = (bz - az) / length * width / 2;
    const nz = -(bx - ax) / length * width / 2;
    const segments = Math.max(2, Math.ceil(length / 2));
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments, t1 = (i + 1) / segments;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const v0 = running + length * t0, v1 = running + length * t1;
      const p = [
        [x0 - nx, heightAt(x0 - nx, z0 - nz) + 0.12, z0 - nz],
        [x0 + nx, heightAt(x0 + nx, z0 + nz) + 0.12, z0 + nz],
        [x1 - nx, heightAt(x1 - nx, z1 - nz) + 0.12, z1 - nz],
        [x1 + nx, heightAt(x1 + nx, z1 + nz) + 0.12, z1 + nz],
      ];
      for (const [index, u, v] of [[0, 0, v0], [2, 0, v1], [1, 1, v0], [1, 1, v0], [2, 0, v1], [3, 1, v1]]) {
        vertices.push(...p[index]);
        uvs.push(u, v * 0.2);
      }
    }
    running += length;
  }
  return addPlane(group, mat, vertices, uvs, 'Weathered prison access spur');
}

function pushCollider(colliders, id, x, z, width, depth, rotation = 0) {
  colliders.push({ id, x, z, width, depth, rotation });
}

function blockWithin(collider, x, z, radius) {
  const dx = x - collider.x, dz = z - collider.z;
  const s = Math.sin(collider.rotation || 0), c = Math.cos(collider.rotation || 0);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = clamp(lx, -collider.width / 2, collider.width / 2);
  const qz = clamp(lz, -collider.depth / 2, collider.depth / 2);
  return (lx - qx) ** 2 + (lz - qz) ** 2 < radius ** 2;
}

function addFence(group, heightAt, mats, colliders) {
  const { minX, maxX, minZ, maxZ } = PRISON_LAYOUT.bounds;
  const segments = [];
  const run = (x0, z0, x1, z1, gapStart = Infinity, gapEnd = Infinity) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round(length / 4);
    for (let i = 0; i < n; i++) {
      const along0 = i / n * length, along1 = (i + 1) / n * length;
      if (along0 >= gapStart - 0.01 && along1 <= gapEnd + 0.01) continue;
      const t0 = i / n, t1 = (i + 1) / n;
      segments.push({ x0: x0 + (x1 - x0) * t0, z0: z0 + (z1 - z0) * t0,
        x1: x0 + (x1 - x0) * t1, z1: z0 + (z1 - z0) * t1 });
    }
  };
  run(minX, minZ, maxX, minZ);
  run(minX, maxZ, PRISON_LAYOUT.gate.x - PRISON_LAYOUT.gate.width / 2, maxZ);
  run(PRISON_LAYOUT.gate.x + PRISON_LAYOUT.gate.width / 2, maxZ, maxX, maxZ);
  run(minX, minZ, minX, maxZ);
  run(maxX, minZ, maxX, maxZ);

  const barTransforms = [];
  for (const { x0, z0, x1, z1 } of segments) {
    const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const y = (heightAt(x0, z0) + heightAt(x1, z1)) / 2;
    const section = new THREE.Group();
    section.position.set(x, y, z);
    section.rotation.y = yaw;
    group.add(section);
    addBox(section, mats.darkStone, 0, 0.67, 0, 0.52, 1.4, len + 0.08, 'Prison stone perimeter');
    addBox(section, mats.concrete, 0, 1.43, 0, 0.66, 0.16, len + 0.08);
    for (const side of [-1, 1]) addBox(section, mats.iron, 0, side === -1 ? 2.0 : 4.45, 0,
      0.09, 0.105, len + 0.04);
    for (let t = -len / 2 + 0.31; t <= len / 2 - 0.15; t += 0.48) {
      const wx = x + Math.sin(yaw) * t, wz = z + Math.cos(yaw) * t;
      barTransforms.push([wx, y + 3.2, wz, yaw]);
    }
    pushCollider(colliders, 'prison_perimeter', x, z, 0.7, len + 0.2, yaw);
  }
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 2.96, 0.075), mats.iron, barTransforms.length);
  const dummy = new THREE.Object3D();
  barTransforms.forEach(([x, y, z, rotation], i) => {
    dummy.position.set(x, y, z); dummy.rotation.y = rotation; dummy.updateMatrix();
    bars.setMatrixAt(i, dummy.matrix);
  });
  bars.instanceMatrix.needsUpdate = true;
  bars.castShadow = true;
  group.add(bars);

  // The gate is physically open, with two worn leafs folded back against the
  // adjacent wall. A player can enter along the access spur without a trigger.
  const gate = PRISON_LAYOUT.gate;
  for (const side of [-1, 1]) {
    const x = gate.x + side * (gate.width / 2 + 0.34);
    const y = heightAt(x, gate.z);
    addBox(group, mats.darkStone, x, y + 2.35, gate.z, 1.1, 4.7, 1.1, 'Prison gate pier');
    addBox(group, mats.concrete, x, y + 4.75, gate.z, 1.34, 0.19, 1.34,
      'Chipped gate pier cap');
    for (const h of [0.42, 0.76]) addBox(group, mats.moss, x,
      y + h, gate.z + 0.56, 0.74, 0.05, 0.012, 'Salt-darkened gate masonry');
    const leaf = new THREE.Group();
    leaf.position.set(x, y + 2.7, gate.z - 0.6);
    leaf.rotation.y = side * 1.28;
    group.add(leaf);
    addBox(leaf, mats.iron, side * 1.5, 0, 0, 3, 0.15, 0.11);
    for (let k = 0; k < 7; k++) addBox(leaf, mats.iron, side * (0.3 + k * 0.43), 0, 0, 0.09, 3.35, 0.1);
    pushCollider(colliders, 'prison_gate_pier', x, gate.z, 1.1, 1.1);
    // The open iron leaf is folded inward along the pier, not invisible to
    // movement. Rotate its actual 3 m rail footprint with the rendered leaf.
    const angle = side * 1.28;
    pushCollider(colliders, 'prison_gate_leaf',
      x + side * 1.5 * Math.cos(angle), gate.z - 0.6 - side * 1.5 * Math.sin(angle),
      3, 0.15, angle);
  }
  // An unlit warning lamp makes the opening legible in fog and rain.
  const lintelY = Math.max(heightAt(gate.x - 4, gate.z), heightAt(gate.x + 4, gate.z)) + 5.1;
  addBox(group, mats.iron, gate.x, lintelY, gate.z, gate.width + 1.7, 0.38, 0.32, 'Prison entry lintel');
  addPaintedSign(group, mats, 'GREYWAKE PRISON', 'DETENTION ANNEX  ·  STAFF ENTRANCE',
    gate.x, lintelY - 0.28, gate.z + 0.37, 7.15, 0.92, 'Greywake prison gate sign');
  const gateLamp = new THREE.PointLight(0xe9c389, 0.7, 13, 2);
  gateLamp.position.set(gate.x, lintelY - 0.92, gate.z + 0.65);
  group.add(gateLamp);
}

function addWatchtower(group, heightAt, mats, colliders, x, z) {
  const y = heightAt(x, z);
  const tower = new THREE.Group();
  tower.position.set(x, y, z);
  group.add(tower);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addBox(tower, mats.rust, sx * 1.6, 3.65, sz * 1.6, 0.2, 7.3, 0.2);
  }
  addBox(tower, mats.darkStone, 0, 0.35, 0, 4.2, 0.7, 4.2);
  // The raised stone plinth reaches ground level. Without this footprint a
  // player could walk through its exposed inner corner beside the perimeter.
  pushCollider(colliders, 'prison_watchtower_base', x, z, 4.2, 4.2);
  addBox(tower, mats.timber, 0, 7.2, 0, 4.4, 0.25, 4.4);
  for (const level of [2.1, 4.5, 6.5]) {
    for (const side of [-1, 1]) {
      addBox(tower, mats.iron, side * 1.6, level, 0, 0.09, 0.1, 3.35);
      addBox(tower, mats.iron, 0, level, side * 1.6, 3.35, 0.1, 0.09);
    }
  }
  addBox(tower, mats.darkGlass, 0, 8.1, 1.78, 3.4, 1.1, 0.05);
  addBox(tower, mats.slate, 0, 8.95, 0, 5.5, 0.28, 5.5);
  addCylinder(tower, mats.rust, 0, 9.28, 0, 0.28, 0.35, 'y', 8);
}

function addRoof(group, mats, x, z, width, depth, eave, rise = 2.15) {
  const x0 = x - width / 2 - 0.6, x1 = x + width / 2 + 0.6;
  const z0 = z - depth / 2 - 0.7, z1 = z + depth / 2 + 0.7;
  const ridge = z;
  for (const [a, b] of [[z0, ridge], [ridge, z1]]) {
    const yyA = a === z0 ? eave : eave + rise;
    const yyB = b === z1 ? eave : eave + rise;
    addPlane(group, mats.slate,
      [x0, yyA, a, x0, yyB, b, x1, yyA, a, x1, yyA, a, x0, yyB, b, x1, yyB, b],
      [0, 0, 0, 2.5, width / 5, 0, width / 5, 0, 0, 2.5, width / 5, 2.5], 'Prison slate roof');
  }
  addBox(group, mats.iron, x, eave + rise + 0.07, z, width + 1.3, 0.13, 0.19);
  for (const xx of [x0 + 0.1, x1 - 0.1]) addBox(group, mats.rust, xx, eave - 0.03, z, 0.11, 0.11, depth + 1.7);
}

function addInteriorCeiling(group, mats, x, z, width, depth, roofY, panelSpan = 8) {
  // The pitched slate is an outward-facing surface. An actual underside is
  // needed here: otherwise its back faces are culled and the sky shows from
  // every cell. A continuous dark backing also closes the narrow panel seams.
  addBox(group, mats.darkStone, x, roofY - 0.18, z,
    width + 0.16, 0.26, depth + 0.16, 'Solid interior roof deck');

  const columns = Math.ceil(width / panelSpan);
  const rows = Math.ceil(depth / 5.8);
  const cellWidth = width / columns;
  const cellDepth = depth / rows;
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      addBox(group, mats.concrete,
        x - width / 2 + (column + 0.5) * cellWidth,
        roofY - 0.39,
        z - depth / 2 + (row + 0.5) * cellDepth,
        cellWidth - 0.09, 0.13, cellDepth - 0.09,
        'Salt-stained interior ceiling panel');
    }
  }
  for (let column = 1; column < columns; column++) {
    addBox(group, mats.iron, x - width / 2 + column * cellWidth,
      roofY - 0.43, z, 0.1, 0.18, depth - 0.45,
      'Exposed prison ceiling beam');
  }
}

function addCeilingLamp(group, mats, x, y, z) {
  addBox(group, mats.iron, x, y, z, 1.25, 0.16, 0.63,
    'Prison ceiling light casing');
  addBox(group, mats.lampGlass, x, y - 0.105, z, 1.04, 0.055, 0.48,
    'Warm frosted prison ceiling light');
  const light = new THREE.PointLight(0xe4bd82, 0.9, 14, 2);
  light.position.set(x, y - 0.3, z);
  group.add(light);
}

function addWallRun(group, mats, colliders, heightAt, id, x0, z0, x1, z1, roofY, opening = null) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.round(len / 2);
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, mid = (t0 + t1) / 2;
    const x = x0 + (x1 - x0) * mid, z = z0 + (z1 - z0) * mid;
    if (opening && ((opening.axis === 'x' ? x : z) > opening.low) &&
        ((opening.axis === 'x' ? x : z) < opening.high)) continue;
    const span = len / n + 0.05;
    const floor = Math.min(heightAt(x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0),
      heightAt(x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1)) - 0.35;
    const mesh = addBox(group, mats.concrete, x, (roofY + floor) / 2, z,
      0.38, roofY - floor, span, id);
    mesh.rotation.y = yaw;
    pushCollider(colliders, id, x, z, 0.5, span, yaw);
  }
}

function addCellBlock(group, heightAt, mats, colliders, shelters) {
  const { x, z, width, depth } = PRISON_LAYOUT.cellBlock;
  const x0 = x - width / 2, x1 = x + width / 2;
  const z0 = z - depth / 2, z1 = z + depth / 2;
  const roofY = Math.max(...[-72, -40, -8].flatMap(xx => [z0, z, z1].map(zz => heightAt(xx, zz)))) + 7.35;
  groundPatch(group, heightAt, { minX: x0 + 0.4, maxX: x1 - 0.4, minZ: z0 + 0.4, maxZ: z1 - 0.4 }, mats.darkStone, 2.5, 0.1, 'Cell block floor');
  addWallRun(group, mats, colliders, heightAt, 'cell_block_back', x0, z0, x1, z0, roofY);
  addWallRun(group, mats, colliders, heightAt, 'cell_block_front', x0, z1, x1, z1, roofY,
    { axis: 'x', low: x - 4, high: x + 4 });
  addWallRun(group, mats, colliders, heightAt, 'cell_block_west', x0, z0, x0, z1, roofY);
  addWallRun(group, mats, colliders, heightAt, 'cell_block_east', x1, z0, x1, z1, roofY);
  addRoof(group, mats, x, z, width, depth, roofY, 2.4);
  addInteriorCeiling(group, mats, x, z, width, depth, roofY);
  for (const xx of [x - 20, x, x + 20]) {
    addCeilingLamp(group, mats, xx, roofY - 0.57, z);
  }
  const entryFloor = heightAt(x, z1);
  const entryHead = entryFloor + 3.7;
  addBox(group, mats.concrete, x, (entryHead + roofY) / 2, z1,
    8.2, roofY - entryHead, 0.38, 'Stone header above cell block entrance');
  addBox(group, mats.darkStone, x, entryHead + 0.12, z1 + 0.24,
    8.55, 0.22, 0.25, 'Cell block entry lintel');
  // Battered piers, a low damp course and exposed rainwater fittings break up
  // the long institutional wall without creating hidden new obstacles.
  for (let bx = x0 + 4; bx <= x1 - 4; bx += 8) {
    if (Math.abs(bx - x) < 5) continue;
    const floor = heightAt(bx, z1);
    addBox(group, mats.darkStone, bx, floor + 2.05, z1 + 0.12,
      0.62, 4.1, 0.22, 'Salt-stained cell block pier');
    addBox(group, mats.concrete, bx, floor + 4.12, z1 + 0.16,
      0.8, 0.16, 0.33, 'Worn pier cap');
  }
  for (const side of [-1, 1]) {
    const xx = x + side * 8.6;
    const yy = heightAt(xx, z1);
    addCylinder(group, mats.rust, xx, yy + 3.25, z1 + 0.16,
      0.075, 6.5, 'y', 8);
    addBox(group, mats.rust, xx, yy + 6.53, z1 + 0.19,
      0.22, 0.12, 0.3, 'Rainwater downpipe elbow');
  }
  addBox(group, mats.darkStone, x - 21.5, roofY - 4.35, z1 + 0.17,
    20.1, 0.14, 0.12, 'Cell block horizontal stone course');
  addBox(group, mats.darkStone, x + 21.5, roofY - 4.35, z1 + 0.17,
    20.1, 0.14, 0.12, 'Cell block horizontal stone course');
  addPaintedSign(group, mats, 'CELL BLOCK B', 'GREYWAKE ISLAND  ·  EST. 1958',
    x, entryFloor + 4.48, z1 + 0.44, 6.5, 0.98, 'Prison cell block sign');
  shelters.push({ id: 'cell_block', x, z, width: width - 0.5, depth: depth - 0.5 });

  // This lengthwise corridor links an exterior vestibule to ten cells.
  // Most cells remain barred; one gate is left open to create a genuine
  // navigable prison interior rather than a facade behind the perimeter.
  const corridorN = z - 2.1, corridorS = z + 2.1;
  const barMatrices = [];
  for (let row = 0; row < 2; row++) {
    const faceZ = row === 0 ? corridorN : corridorS;
    const cellBackZ = row === 0 ? z0 + 0.35 : z1 - 0.35;
    for (let bay = 0; bay < 8; bay++) {
      const xa = x0 + bay * 8, xb = xa + 8;
      const isVestibule = row === 1 && (bay === 3 || bay === 4);
      const isOpenCell = row === 1 && bay === 1;
      const midpoint = (xa + xb) / 2;
      // Full-height dividers between bays, except the central entrance bay.
      // The two south-center bays form one shared entrance vestibule. Its
      // dividing wall must be absent so the doorway opens onto the corridor.
      if (bay > 0 && !(row === 1 && bay === 4)) {
        const partitionZ = (cellBackZ + faceZ) / 2;
        const partitionLen = Math.abs(faceZ - cellBackZ);
        const y = heightAt(xa, partitionZ);
        addBox(group, mats.darkStone, xa, y + 2.7, partitionZ,
          0.24, 5.4, partitionLen, 'Prison cell divider');
        pushCollider(colliders, 'cell_divider', xa, partitionZ, 0.32, partitionLen);
      }
      if (isVestibule) continue;
      const openingLow = isOpenCell ? midpoint - 1.05 : Infinity;
      const openingHigh = isOpenCell ? midpoint + 1.05 : Infinity;
      for (let k = 0; k <= 20; k++) {
        const xx = xa + k * 0.4;
        if (xx > openingLow && xx < openingHigh) continue;
        barMatrices.push([xx, heightAt(xx, faceZ) + 2.55, faceZ]);
      }
      addBox(group, mats.iron, midpoint, heightAt(midpoint, faceZ) + 4.95, faceZ,
        7.7, 0.11, 0.12);
      addBox(group, mats.iron, midpoint, heightAt(midpoint, faceZ) + 0.45, faceZ,
        7.7, 0.12, 0.12);
      if (isOpenCell) {
        // The open gate is pushed against the divider, so the gap reads clearly.
        addBox(group, mats.rust, openingLow - 0.06, heightAt(openingLow, faceZ) + 2.5,
          faceZ + 0.85, 0.12, 4.2, 1.7, 'Open prison cell gate');
        pushCollider(colliders, 'open_cell_gate', openingLow - 0.06, faceZ + 0.85, 0.12, 1.7);
        pushCollider(colliders, 'cell_bars', (xa + openingLow) / 2, faceZ,
          openingLow - xa, 0.18);
        pushCollider(colliders, 'cell_bars', (openingHigh + xb) / 2, faceZ,
          xb - openingHigh, 0.18);
      } else pushCollider(colliders, 'cell_bars', midpoint, faceZ, 7.85, 0.18);
      // Rusted cot, wash basin and small frosted upper window inside each bay.
      const cotZ = row === 0 ? z0 + 2.1 : z1 - 2.1;
      addBox(group, mats.iron, midpoint - 0.55, heightAt(midpoint - 0.55, cotZ) + 0.38,
        cotZ, 2.2, 0.13, 0.75);
      addBox(group, mats.timber, midpoint - 0.55, heightAt(midpoint - 0.55, cotZ) + 0.49,
        cotZ, 2.04, 0.12, 0.67);
      addCylinder(group, mats.concrete, midpoint + 2.2, heightAt(midpoint + 2.2, cotZ) + 0.55,
        cotZ, 0.31, 0.22, 'y', 10);
      const facing = row === 0 ? -1 : 1;
      const outerZ = row === 0 ? z0 - 0.23 : z1 + 0.23;
      const localFloor = heightAt(midpoint, outerZ);
      for (const windowY of [localFloor + 3.28, roofY - 2.0]) {
        if (windowY > roofY - 1.4 || windowY < localFloor + 1.8) continue;
        addBox(group, mats.black, midpoint, windowY, outerZ, 1.4, 1.05, 0.07);
        addBox(group, mats.darkGlass, midpoint, windowY, outerZ + facing * 0.04,
          1.3, 0.92, 0.02);
        for (const shift of [-0.38, 0, 0.38]) addBox(group, mats.iron, midpoint + shift,
          windowY, outerZ + facing * 0.09, 0.075, 1.15, 0.1);
        addBox(group, mats.concrete, midpoint, windowY - 0.67,
          outerZ + facing * 0.055, 1.62, 0.12, 0.22,
          'Worn barred-window stone sill');
      }
    }
  }
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 4.6, 0.08), mats.iron,
    barMatrices.length);
  const dummy = new THREE.Object3D();
  barMatrices.forEach(([bx, by, bz], i) => {
    dummy.position.set(bx, by, bz); dummy.updateMatrix(); bars.setMatrixAt(i, dummy.matrix);
  });
  bars.instanceMatrix.needsUpdate = true;
  bars.castShadow = true;
  group.add(bars);

  for (const side of [-1, 1]) {
    const xx = x + side * 4.2;
    addBox(group, mats.rust, xx, heightAt(xx, z1 + 0.3) + 1.85,
      z1 + 0.3, 0.17, 3.7, 0.24, 'Cell block doorway jamb');
  }
  return { x, z, width, depth, roofY, entrance: { x, z: z1 } };
}

function addOutbuilding(group, heightAt, mats, colliders, shelters, spec, label, tint) {
  const { x, z, width, depth } = spec;
  const x0 = x - width / 2, x1 = x + width / 2;
  const z0 = z - depth / 2, z1 = z + depth / 2;
  const roofY = Math.max(...[x0, x, x1].flatMap(xx => [z0, z1].map(zz => heightAt(xx, zz)))) + 5.1;
  groundPatch(group, heightAt, { minX: x0 + 0.35, maxX: x1 - 0.35, minZ: z0 + 0.35,
    maxZ: z1 - 0.35 }, mats.concrete, 2.5, 0.1, `${label} floor`);
  addWallRun(group, mats, colliders, heightAt, `${label}_rear`, x0, z0, x1, z0, roofY);
  addWallRun(group, mats, colliders, heightAt, `${label}_front`, x0, z1, x1, z1, roofY,
    { axis: 'x', low: x - 1.6, high: x + 1.6 });
  addWallRun(group, mats, colliders, heightAt, `${label}_west`, x0, z0, x0, z1, roofY);
  addWallRun(group, mats, colliders, heightAt, `${label}_east`, x1, z0, x1, z1, roofY);
  addRoof(group, mats, x, z, width, depth, roofY, 1.7);
  addInteriorCeiling(group, mats, x, z, width, depth, roofY, 6);
  addCeilingLamp(group, mats, x, roofY - 0.57, z);
  const entryFloor = heightAt(x, z1);
  const entryHead = entryFloor + 2.85;
  addBox(group, mats.concrete, x, (entryHead + roofY) / 2, z1,
    3.2, roofY - entryHead, 0.38, `${label} doorway header`);
  addBox(group, mats.rust, x, entryHead + 0.08, z1 + 0.24,
    3.42, 0.14, 0.24, `${label} entrance lintel`);
  for (const wx of [x0 + 2.1, x1 - 2.1]) {
    const floor = heightAt(wx, z1);
    addBox(group, mats.darkStone, wx, floor + 1.75, z1 + 0.1,
      0.43, 3.5, 0.2, `${label} weathered front pier`);
  }
  addBox(group, mats.darkStone, x, roofY - 0.88, z1 + 0.2,
    width - 1, 0.16, 0.14, `${label} worn stone course`);
  shelters.push({ id: label, x, z, width: width - 0.4, depth: depth - 0.4 });
  for (const sx of [-1, 1]) {
    const wx = x + sx * width * 0.29;
    const windowY = heightAt(wx, z1) + 2.48;
    addBox(group, mats.black, wx, windowY, z1 + 0.23, 1.8, 1.3, 0.07);
    addBox(group, mats.darkGlass, wx, windowY, z1 + 0.27, 1.65, 1.16, 0.04);
    for (const v of [-0.5, 0, 0.5]) addBox(group, mats.rust, wx + v,
      windowY, z1 + 0.32, 0.065, 1.35, 0.1);
    addBox(group, mats.concrete, wx, windowY - 0.73, z1 + 0.28,
      2.05, 0.13, 0.25, `${label} window sill`);
  }
  addBox(group, tint, x, entryFloor + 3.58, z1 + 0.25, width * 0.58, 0.39, 0.1,
    `${label} nameplate`);
  addPaintedSign(group, mats,
    label === 'prison_clinic' ? 'INFIRMARY' : 'ADMINISTRATION',
    label === 'prison_clinic' ? 'WARD DISPENSARY' : 'REGISTRY AND RECORDS',
    x, entryFloor + 3.58, z1 + 0.38, width * 0.58, 0.52, `${label} painted sign`);
  // Vents explain why the roofs look maintained despite the abandoned yard.
  for (const side of [-1, 1]) {
    const xx = x + side * (width * 0.26);
    addCylinder(group, mats.rust, xx, roofY + 1.5, z - 1.2,
      0.14, 1.0, 'y', 8);
    addBox(group, mats.iron, xx, roofY + 2.03, z - 1.2, 0.44, 0.1, 0.44);
  }
  return { ...spec, roofY, entrance: { x, z: z1 } };
}

function addCourtyardDetail(group, heightAt, mats, colliders, shelters) {
  // A small roof keeps the historic intake book legible in heavy weather.
  const intakeX = -57, intakeZ = 98;
  const intakeY = heightAt(intakeX, intakeZ);
  addBox(group, mats.darkStone, intakeX, intakeY + 2.7, intakeZ,
    4.2, 0.24, 3.4, 'Gatehouse intake canopy');
  for (const px of [intakeX - 1.9, intakeX + 1.9]) {
    for (const pz of [intakeZ - 1.45, intakeZ + 1.45]) {
      addBox(group, mats.iron, px, heightAt(px, pz) + 1.3, pz,
        0.13, 2.6, 0.13, 'Gatehouse canopy post');
      pushCollider(colliders, 'gatehouse_canopy_post', px, pz, 0.13, 0.13);
    }
  }
  addPaintedSign(group, mats, 'INTAKE', 'ADMIN RECORDS', intakeX,
    intakeY + 2.25, intakeZ + 1.76, 2.5, 0.34, 'Gatehouse intake label');
  shelters.push({ id: 'gatehouse_intake', x: intakeX, z: intakeZ,
    width: 4.0, depth: 3.2 });
  // Steel exercise frames and drains give the yard scale at player height.
  for (const [x, z, rotation] of [[-41, 61, 0.17], [-32, 66, -0.25]]) {
    const y = heightAt(x, z);
    const frame = new THREE.Group();
    frame.position.set(x, y, z);
    frame.rotation.y = rotation;
    group.add(frame);
    for (const sx of [-1.8, 1.8]) addCylinder(frame, mats.rust, sx, 1.5, 0,
      0.085, 3.0, 'y', 8);
    addCylinder(frame, mats.rust, 0, 2.9, 0, 0.075, 3.7, 'x', 8);
  }
  for (const [x, z] of [[-48, 80], [-11, 50], [2, 83]]) {
    const y = heightAt(x, z);
    addBox(group, mats.concrete, x, y + 0.35, z, 4.5, 0.7, 1.1, 'Yard storm drain');
    for (let i = -4; i <= 4; i++) addBox(group, mats.iron, x + i * 0.48,
      y + 0.73, z, 0.08, 0.08, 1.2);
  }
  // Two unguarded lamps suggest the former night shift without making the
  // occupied island read as a fantasy castle. Their bollards are collidable.
  for (const [x, z] of [[-77, 86], [15, 86]]) {
    const y = heightAt(x, z);
    addCylinder(group, mats.iron, x, y + 1.88, z, 0.105, 3.76, 'y', 10);
    addBox(group, mats.iron, x, y + 3.84, z + 0.38, 0.1, 0.1, 0.81);
    addBox(group, mats.iron, x, y + 3.55, z + 0.73, 0.58, 0.72, 0.54,
      '1950s prison yard lantern frame');
    addBox(group, mats.lampGlass, x, y + 3.55, z + 1.02, 0.41, 0.53, 0.025,
      'Dim amber prison yard lantern');
    const lamp = new THREE.PointLight(0xe7b779, 0.65, 13, 2);
    lamp.position.set(x, y + 3.56, z + 1.0);
    group.add(lamp);
    pushCollider(colliders, 'yard_lamp_post', x, z, 0.3, 0.3);
  }

  // A handcart, supply crates, and an empty bench tell of mundane daily use.
  // They sit against the perimeter, away from the gate-to-cell-block walk.
  const cartX = -78, cartZ = 92, cartY = heightAt(cartX, cartZ);
  addBox(group, mats.timber, cartX, cartY + 0.78, cartZ, 1.9, 0.16, 1.05,
    'Prison supply handcart deck');
  addBox(group, mats.rust, cartX, cartY + 0.51, cartZ, 1.95, 0.08, 0.87,
    'Handcart undercarriage');
  for (const sx of [-0.7, 0.7]) for (const sz of [-0.39, 0.39]) {
    addCylinder(group, mats.black, cartX + sx, cartY + 0.36, cartZ + sz,
      0.23, 0.12, 'x', 12);
  }
  for (const sx of [-0.78, 0.78]) addBox(group, mats.rust, cartX + sx,
    cartY + 1.1, cartZ - 0.71, 0.09, 0.78, 0.1, 'Handcart push bar');
  addBox(group, mats.rust, cartX, cartY + 1.48, cartZ - 0.71,
    1.58, 0.08, 0.1, 'Handcart push bar');
  pushCollider(colliders, 'prison_handcart', cartX, cartZ, 2.1, 1.5);

  for (const [x, z, size] of [[20, 93, 1.16], [21.4, 92.3, 1.04], [20, 92.4, 0.9]]) {
    const y = heightAt(x, z);
    addBox(group, mats.timber, x, y + size / 2, z, size, size, size,
      'Weathered prison stores crate');
    for (const off of [-0.3, 0.3]) addBox(group, mats.rust,
      x + off * size, y + size * 0.55, z + size / 2 + 0.015,
      0.055, size * 0.86, 0.04, 'Crate retaining strap');
    pushCollider(colliders, 'prison_supply_crate', x, z, size + 0.04, size + 0.04);
  }

  const benchX = -78, benchZ = 44, benchY = heightAt(benchX, benchZ);
  addBox(group, mats.timber, benchX, benchY + 0.78, benchZ, 2.55, 0.14, 0.56,
    'Worn yard bench seat');
  addBox(group, mats.timber, benchX, benchY + 1.13, benchZ - 0.28,
    2.55, 0.52, 0.13, 'Worn yard bench back');
  for (const sx of [-1.02, 1.02]) addBox(group, mats.iron, benchX + sx,
    benchY + 0.39, benchZ, 0.11, 0.78, 0.55, 'Yard bench steel support');
  pushCollider(colliders, 'prison_yard_bench', benchX, benchZ, 2.7, 0.75);

  for (const [x, z, sx, sz] of [[-6, 89, 1.5, 2.2], [-52, 74, 1.1, 1.6],
    [8, 40, 1.0, 1.55], [-69, 95, 0.76, 1.13]]) {
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 20), mats.puddle);
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, heightAt(x, z) + 0.14, z);
    water.scale.set(sx, sz, 1);
    water.name = 'Rainwater in uneven prison yard stone';
    water.receiveShadow = true;
    group.add(water);
  }

  // The intake plinth is to the side of the passage. Keep its exact visible
  // footprint and collider together so neither the sign nor the gate lies.
  const signX = -72, signZ = 100.2, signY = heightAt(signX, signZ);
  addBox(group, mats.darkStone, signX, signY + 1.55, signZ, 2.4, 3.1, 0.35,
    'Prison intake marker plinth');
  pushCollider(colliders, 'gatehouse_intake_sign', signX, signZ, 2.4, 0.35);
  addPaintedSign(group, mats, 'INTAKE', 'REGISTRY  ·  VISITORS',
    signX, signY + 2.32, signZ + 0.26, 2.05, 0.68, 'Gatehouse intake sign');
  addBox(group, mats.red, signX, signY + 1.36, signZ + 0.21,
    1.69, 0.08, 0.04, 'Faded intake warning stripe');
}

function loft(group, rings, mat, name = '') {
  const vertices = [];
  const section = (ring) => {
    const { z, width, low, high, shoulder = 0.16 } = ring;
    return [
      [-width * 0.72, low, z], [width * 0.72, low, z],
      [width, low + shoulder, z], [width, high - shoulder, z],
      [width * 0.78, high, z], [-width * 0.78, high, z],
      [-width, high - shoulder, z], [-width, low + shoulder, z],
    ];
  };
  for (let i = 0; i < rings.length - 1; i++) {
    const a = section(rings[i]), b = section(rings[i + 1]);
    for (let side = 0; side < 8; side++) {
      const n = (side + 1) % 8;
      vertices.push(...a[side], ...a[n], ...b[side], ...a[n], ...b[n], ...b[side]);
    }
  }
  const rear = section(rings[0]), front = section(rings.at(-1));
  for (let i = 1; i < 7; i++) {
    vertices.push(...rear[0], ...rear[i + 1], ...rear[i]);
    vertices.push(...front[0], ...front[i], ...front[i + 1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function carGlass(group, mats, x0, x1, z0, z1, lowerY, upperY) {
  // A real sloped greenhouse: the windshield and backlight reflect the sky.
  const p = (x, y, z) => [x, y, z];
  const surfaces = [
    [p(x0, lowerY, z1), p(x1, lowerY, z1), p(x0 * 0.76, upperY, z1 - 0.42),
      p(x1, lowerY, z1), p(x1 * 0.76, upperY, z1 - 0.42), p(x0 * 0.76, upperY, z1 - 0.42)],
    [p(x0, lowerY, z0), p(x0 * 0.76, upperY, z0 + 0.4), p(x1, lowerY, z0),
      p(x1, lowerY, z0), p(x0 * 0.76, upperY, z0 + 0.4), p(x1 * 0.76, upperY, z0 + 0.4)],
    [p(x0, lowerY, z0), p(x0, lowerY, z1), p(x0 * 0.76, upperY, z0 + 0.4),
      p(x0, lowerY, z1), p(x0 * 0.76, upperY, z1 - 0.42), p(x0 * 0.76, upperY, z0 + 0.4)],
    [p(x1, lowerY, z0), p(x1 * 0.76, upperY, z0 + 0.4), p(x1, lowerY, z1),
      p(x1, lowerY, z1), p(x1 * 0.76, upperY, z0 + 0.4), p(x1 * 0.76, upperY, z1 - 0.42)],
  ];
  const verts = surfaces.flat(2);
  const uv = Array.from({ length: verts.length / 3 }, (_, i) => [i % 3 === 1 ? 1 : 0,
    i % 3 === 2 ? 1 : 0]).flat();
  addPlane(group, mats.darkGlass, verts, uv, 'Vintage vehicle glazing');
  for (const side of [-1, 1]) {
    addBox(group, mats.chrome, side * 0.76, lowerY + 0.32,
      (z0 + z1) / 2, 0.035, 0.65, 0.04);
    addBox(group, mats.chrome, side * 0.77, lowerY + 0.29,
      (z0 + z1) / 2, 0.04, 0.04, z1 - z0 - 0.3);
  }
}

function addWheel(group, mats, x, z, radius = 0.43) {
  group.userData.wheels.push({ x, z, front: z > 0, radius, angle: 0 });
}

function addInstancedWheels(vehicle, mats) {
  const wheels = vehicle.userData.wheels;
  const layers = [
    { material: mats.black, radiusScale: 1, thickness: 0.2, offset: 0, sides: 16 },
    { material: mats.chrome, radiusScale: 0.59, thickness: 0.012, offset: 0.111, sides: 14 },
    { material: mats.darkStone, radiusScale: 0.18, thickness: 0.018, offset: 0.121, sides: 12 },
  ];
  const meshes = layers.map(({ material, sides }, layer) => {
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, sides),
      material, wheels.length);
    mesh.name = `Moving vehicle wheel layer ${layer}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    vehicle.add(mesh);
    return mesh;
  });
  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';
  const refresh = (speed = 0, steering = 0, dt = 0) => {
    wheels.forEach((wheel, i) => {
      wheel.angle += speed / wheel.radius * dt;
      const turn = wheel.front ? steering : 0;
      dummy.rotation.set(wheel.angle, turn, Math.PI / 2, 'YXZ');
      layers.forEach((layer, index) => {
        const offset = Math.sign(wheel.x) * layer.offset;
        dummy.position.set(wheel.x + Math.cos(turn) * offset, wheel.radius,
          wheel.z - Math.sin(turn) * offset);
        dummy.scale.set(wheel.radius * layer.radiusScale, layer.thickness,
          wheel.radius * layer.radiusScale);
        dummy.updateMatrix();
        meshes[index].setMatrixAt(i, dummy.matrix);
      });
    });
    meshes.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  };
  refresh();
  return refresh;
}

function addBrakeLamps(vehicle, type) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x7b231c, roughness: 0.28, emissive: 0xff3b24,
    emissiveIntensity: 0.025,
  });
  const lamps = new THREE.InstancedMesh(UNIT_BOX, material, 2);
  lamps.name = 'Vintage vehicle brake lamps';
  lamps.castShadow = false;
  const dummy = new THREE.Object3D();
  const van = type === 'van';
  for (const [i, side] of [-1, 1].entries()) {
    dummy.position.set(side * (van ? 0.87 : 0.69), van ? 1.1 : 0.84,
      van ? -3.176 : -2.484);
    dummy.scale.set(0.23, van ? 0.21 : 0.18, 0.025);
    dummy.updateMatrix();
    lamps.setMatrixAt(i, dummy.matrix);
  }
  lamps.instanceMatrix.needsUpdate = true;
  vehicle.add(lamps);
  return (braking) => { material.emissiveIntensity = braking ? 1.15 : 0.025; };
}

function addSedan(group, mats, type = 'sedan') {
  const paint = type === 'wagon' ? mats.carIvory : mats.carGreen;
  loft(group, [
    { z: -2.42, width: 0.74, low: 0.42, high: 0.9 },
    { z: -2.17, width: 0.94, low: 0.4, high: 1.15 },
    { z: -0.7, width: 1.00, low: 0.38, high: 1.24 },
    { z: 0.95, width: 1.00, low: 0.38, high: 1.21 },
    { z: 2.18, width: 0.92, low: 0.4, high: 1.11 },
    { z: 2.47, width: 0.73, low: 0.43, high: 0.91 },
  ], paint, '1950s island service car body');
  const cabinRear = type === 'wagon' ? -2.1 : -1.22;
  const cabinShell = loft(group, [
    { z: cabinRear, width: 0.64, low: 1.10, high: 1.20 },
    { z: cabinRear + 0.44, width: 0.77, low: 1.1, high: 1.89 },
    { z: 0.72, width: 0.77, low: 1.1, high: 1.89 },
    { z: 1.24, width: 0.65, low: 1.1, high: 1.2 },
  ], paint, 'Curved vintage roof');
  // Ambient road cars replace the sealed shell with an open cabin so their
  // occupants are visible through the glazing. Keep it separate from the
  // batched body, while parked/player cars retain the original shell.
  cabinShell.userData.ambientRemovable = true;
  carGlass(group, mats, -0.77, 0.77, cabinRear + 0.05, 1.23, 1.23, 1.78);
  if (type === 'wagon') for (const side of [-1, 1]) {
    addBox(group, mats.timber, side * 0.992, 0.84, -1.2,
      0.032, 0.43, 1.52, 'Timber wagon side rail');
  }
  for (const sx of [-1, 1]) {
    for (const z of [-1.51, 1.48]) addWheel(group, mats, sx * 1.02, z);
    for (const z of [-0.47, 0.74]) {
      addBox(group, mats.chrome, sx * 1.015, 1.12, z, 0.09, 0.035, 0.34, 'Door handle');
      addBox(group, mats.iron, sx * 0.997, 0.88, z + 0.59, 0.015, 0.59, 0.02,
        'Period car door seam');
    }
    addCylinder(group, mats.cream, sx * 0.66, 0.92, 2.43, 0.18, 0.09, 'z', 16);
    addBox(group, mats.red, sx * 0.69, 0.84, -2.44, 0.24, 0.2, 0.06);
    addBox(group, mats.chrome, sx * 0.83, 0.5, 2.52, 0.28, 0.16, 0.11);
    addBox(group, mats.chrome, sx * 0.83, 0.5, -2.5, 0.28, 0.16, 0.11);
  }
  for (let i = -4; i <= 4; i++) addBox(group, mats.chrome, i * 0.12, 0.82,
    2.46, 0.04, 0.34, 0.06, 'Vintage chrome grille');
  addBox(group, mats.chrome, 0, 0.48, 2.52, 1.95, 0.12, 0.12);
  addBox(group, mats.chrome, 0, 0.48, -2.52, 1.88, 0.12, 0.12);
  addBox(group, mats.black, 0, 0.69, 2.545, 0.54, 0.19, 0.025);
  for (const side of [-1, 1]) {
    const wiper = addBox(group, mats.black, side * 0.35, 1.26, 1.255,
      0.62, 0.025, 0.025, 'Windshield wiper');
    wiper.rotation.z = side * 0.13;
  }
}

function addTransportVan(group, mats) {
  loft(group, [
    { z: -3.12, width: 1.06, low: 0.46, high: 2.36 },
    { z: -2.86, width: 1.18, low: 0.42, high: 2.69 },
    { z: 1.39, width: 1.18, low: 0.42, high: 2.7 },
    { z: 2.47, width: 1.05, low: 0.42, high: 1.85 },
    { z: 3.08, width: 0.85, low: 0.45, high: 1.66 },
  ], mats.carBlue, '1960s barred island transport truck');
  addBox(group, mats.slate, 0, 2.75, -0.65, 2.38, 0.14, 4.8,
    'Transport rain gutter roof');
  for (const sx of [-1, 1]) {
    for (const z of [-2.02, 1.9]) addWheel(group, mats, sx * 1.19, z, 0.51);
    for (const z of [-2.24, -1.18, -0.12, 0.94]) {
      addBox(group, mats.black, sx * 1.185, 1.78, z, 0.04, 0.54, 0.74,
        'Transport van dark window');
      for (const dx of [-0.23, 0, 0.23]) addBox(group, mats.rust,
        sx * 1.225, 1.78, z + dx, 0.08, 0.62, 0.065,
        'Barred prisoner transport window');
    }
    addBox(group, mats.rust, sx * 1.19, 1.39, -0.65, 0.025, 1.8, 0.05,
      'Transport compartment seam');
    addCylinder(group, mats.cream, sx * 0.8, 1.1, 3.05, 0.22, 0.09, 'z', 16);
    addBox(group, mats.red, sx * 0.87, 1.1, -3.13, 0.24, 0.23, 0.06);
  }
  addBox(group, mats.black, 0, 1.89, 2.24, 1.64, 0.72, 0.07,
    'Transport windshield');
  addBox(group, mats.chrome, 0, 0.76, 3.12, 2.15, 0.16, 0.15);
  addBox(group, mats.chrome, 0, 0.76, -3.17, 2.22, 0.16, 0.15);
  for (let i = -5; i <= 5; i++) addBox(group, mats.chrome, i * 0.14, 1.12,
    3.085, 0.035, 0.38, 0.08, 'Transport grille');
  addBox(group, mats.rust, 0, 2.05, -3.13, 0.07, 1.2, 0.11,
    'Rear cargo doors');
  addBox(group, mats.chrome, 0.14, 1.34, -3.21, 0.23, 0.06, 0.05);
}

function addVehicles(group, heightAt, mats, colliders) {
  const placed = [];
  for (const spec of PRISON_LAYOUT.vehicles) {
    const vehicle = new THREE.Group();
    const y = heightAt(spec.x, spec.z) + 0.045;
    vehicle.position.set(spec.x, y, spec.z);
    vehicle.rotation.y = spec.heading;
    vehicle.name = spec.id;
    vehicle.userData.dynamicVehicle = true;
    vehicle.userData.wheels = [];
    group.add(vehicle);
    if (spec.type === 'van') addTransportVan(vehicle, mats);
    else addSedan(vehicle, mats, spec.type);
    const animateWheels = addInstancedWheels(vehicle, mats);
    const setBrakeLights = addBrakeLamps(vehicle, spec.type);
    const width = spec.type === 'van' ? 2.52 : 2.18;
    const length = spec.type === 'van' ? 6.45 : 5.15;
    pushCollider(colliders, spec.id, spec.x, spec.z, width, length, spec.heading);
    const collider = colliders.at(-1);
    // The body is still batched by material within its own movable root. Wheel
    // pivots remain separate so the axle rotation and front steering are live.
    batchStaticMeshes(vehicle, 'dynamicWheel');
    placed.push({ ...spec, width, length, y, group: vehicle, collider,
      wheels: vehicle.userData.wheels, animateWheels, setBrakeLights });
  }
  return placed;
}

function nestedInFlag(mesh, root, flag) {
  for (let parent = mesh.parent; parent && parent !== root; parent = parent.parent) {
    if (parent.userData?.[flag]) return true;
  }
  return false;
}

function batchStaticMeshes(root, skipFlag = null) {
  // Buildings consist of many small, static architectural pieces. Welding
  // those pieces by material keeps the silhouettes/details but avoids making
  // a draw call for every rail, window frame and wall stone.
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const groups = new Map();
  const remove = [];
  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.userData.ambientRemovable ||
      (skipFlag && nestedInFlag(mesh, root, skipFlag))) return;
    let geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    if (!geometry.getAttribute('uv')) {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(
        new Float32Array(geometry.getAttribute('position').count * 2), 2));
    }
    const key = mesh.material.uuid;
    if (!groups.has(key)) groups.set(key, { material: mesh.material, geometries: [] });
    groups.get(key).geometries.push(geometry);
    remove.push(mesh);
  });
  for (const mesh of remove) mesh.parent.remove(mesh);
  for (const { material, geometries } of groups.values()) {
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error(`Could not merge prison geometry for ${material.name}`);
    for (const source of geometries) source.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `Batched island dressing · ${material.name || material.uuid.slice(0, 8)}`;
    root.add(mesh);
  }
  return groups.size;
}

/** Add a traversable decommissioned prison complex and three original cars. */
export function createSetDressing(scene, terrainHeight) {
  if (!scene?.add || typeof terrainHeight !== 'function') {
    throw new TypeError('createSetDressing requires a Three.js scene and terrainHeight(x, z)');
  }
  const materials = materialSet();
  const root = new THREE.Group();
  root.name = 'Greywake prison and period vehicles';
  scene.add(root);
  const colliders = [];
  const shelters = [];

  groundPatch(root, terrainHeight,
    { minX: -88.5, maxX: 28.5, minZ: 11.5, maxZ: 103.5 },
    materials.darkStone, 4, 0.085, 'Prison yard stone and aggregate');
  trailStrip(root, terrainHeight, PRISON_LAYOUT.approach, materials.concrete);
  addFence(root, terrainHeight, materials, colliders);
  for (const [x, z] of [[-90, 10], [30, 10], [-90, 105], [30, 105]]) {
    addWatchtower(root, terrainHeight, materials, colliders, x, z);
  }
  const prison = addCellBlock(root, terrainHeight, materials, colliders, shelters);
  const clinic = addOutbuilding(root, terrainHeight, materials, colliders, shelters,
    PRISON_LAYOUT.clinic, 'prison_clinic', materials.cream);
  const administration = addOutbuilding(root, terrainHeight, materials, colliders, shelters,
    PRISON_LAYOUT.administration, 'prison_administration', materials.rust);
  addCourtyardDetail(root, terrainHeight, materials, colliders, shelters);
  const vehicles = addVehicles(root, terrainHeight, materials, colliders);
  const materialBatches = batchStaticMeshes(root, 'dynamicVehicle');
  return {
    group: root, colliders, shelters, prison, clinic, administration, vehicles, materialBatches,
    approach: PRISON_LAYOUT.approach,
    entrance: PRISON_LAYOUT.gate,
    collides: (x, z, radius = 0.32, excludeId = null) =>
      colliders.some(c => c.id !== excludeId && blockWithin(c, x, z, radius)),
    isSheltered: (x, z) => shelters.some(s => Math.abs(x - s.x) < s.width / 2 &&
      Math.abs(z - s.z) < s.depth / 2),
  };
}
