import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Two original, deliberately small service buildings fit inside the existing
// grass/tree clearings. They are closed buildings: the footprint is solid to
// players and vehicles, while the larger buildings retain open doorways.
export const ANCILLARY_BUILDINGS = Object.freeze([
  Object.freeze({ id: 'lodge_shed', near: 'lodge', offsetX: 13.2, offsetZ: 1.8,
    width: 5.0, depth: 4.1, height: 3.05, roofRise: 1.05, label: 'KEEPER STORES' }),
  Object.freeze({ id: 'radio_generator', near: 'radio', offsetX: -12.6, offsetZ: .8,
    width: 5.3, depth: 4.3, height: 3.2, roofRise: .86, label: 'GENERATOR' }),
]);

export function ancillaryFootprints(sites) {
  const byId = new Map(sites.map((site) => [site.id, site]));
  return ANCILLARY_BUILDINGS.flatMap((plan) => {
    const site = byId.get(plan.near);
    if (!site) return [];
    return [{ ...plan, x: site.x + plan.offsetX, z: site.z + plan.offsetZ,
      halfWidth: plan.width / 2, halfDepth: plan.depth / 2,
      roofHalfWidth: plan.width / 2 + .27, roofHalfDepth: plan.depth / 2 + .24 }];
  });
}

export function ancillaryBlocksMove(footprints, x, z, radius = .32) {
  return footprints.some((house) => Math.abs(x - house.x) < house.halfWidth + radius
    && Math.abs(z - house.z) < house.halfDepth + radius);
}

function signTexture(label) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#98998c';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#323c3d';
  ctx.fillRect(10, 9, 492, 110);
  ctx.fillStyle = '#b8b6a6';
  ctx.font = 'bold 48px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 65);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function buildHouse(plan, ground, foundationDrop) {
  const { width: w, depth: d, height: h } = plan;
  const isShed = plan.id === 'lodge_shed';
  const palette = {
    foundation: new THREE.MeshStandardMaterial({ color: 0x525657, roughness: .96 }),
    wall: new THREE.MeshStandardMaterial({ color: isShed ? 0x64716f : 0x575e5d, roughness: .9 }),
    trim: new THREE.MeshStandardMaterial({ color: isShed ? 0x999482 : 0x777f7d, roughness: .87 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x202b31, roughness: .64, metalness: .1 }),
    roofVariation: new THREE.MeshStandardMaterial({ color: 0x354146, roughness: .75 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x614837, roughness: .85, metalness: .38 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x263d43, roughness: .19, metalness: .16 }),
    detail: new THREE.MeshStandardMaterial({ color: 0x252e31, roughness: .73, metalness: .51 }),
  };
  const bucket = new Map(Object.keys(palette).map((key) => [key, []]));
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const add = (material, x, y, z, bw, bh, bd, tilt = 0) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt);
    p.set(x, y, z);
    s.set(bw, bh, bd);
    m.compose(p, q, s);
    bucket.get(material).push(unitBox.clone().applyMatrix4(m));
  };
  const group = new THREE.Group();
  group.name = `${plan.id} original ancillary building`;
  group.position.set(plan.x, ground, plan.z);

  add('foundation', 0, .18-foundationDrop/2, 0,
    w+.38, .36+foundationDrop, d+.38);
  add('wall', 0, (h+.26)/2, 0, w, h-.26, d);
  for (const x of [-w/2+.09, w/2-.09]) {
    for (const z of [-d/2+.09, d/2-.09]) {
      add('trim', x, h/2+.13, z, .18, h-.26, .18);
    }
  }
  add('trim', 0, .62, d/2+.025, w-.1, .11, .075);
  add('trim', 0, h-.22, d/2+.025, w-.1, .15, .08);
  // Outward facing service door and a raised threshold. Its entire building
  // remains a solid AABB in ancillaryBlocksMove.
  add(isShed ? 'trim' : 'rust', 0, 1.20, d/2+.075, 1.65, 2.34, .14);
  add('detail', .62, 1.16, d/2+.17, .10, .14, .08);
  add('foundation', 0, .35, d/2+.17, 2.02, .14, .39);
  add('rust', 0, 2.28, d/2+.16, 1.58, .07, .09);
  for (const side of [-1, 1]) {
    const x = side * (w/2+.065);
    add('glass', x, 1.91, -.65, .07, .76, 1.02);
    add('trim', x+side*.03, 1.91, -.65, .095, .82, .075);
    add('trim', x+side*.03, 1.91, -.65, .095, .07, 1.16);
    add('trim', x+side*.03, 1.46, -.65, .12, .09, 1.16);
  }
  const angle = Math.atan2(plan.roofRise, w/2+.28);
  const slopeWidth = Math.hypot(w/2+.28, plan.roofRise)+.12;
  for (const side of [-1, 1]) {
    add('roof', side*(w/4+.14), h+plan.roofRise/2, 0,
      slopeWidth, .13, d+.48, -side*angle);
    // Individual storm-darkened sheet joints visible from the path, merged
    // into the same material draws as the roof.
    for (let i = -2; i <= 2; i++) {
      add(i%2 ? 'roofVariation' : 'detail', side*(w/4+.14),
        h+plan.roofRise/2+.07, i*(d+.34)/5,
        slopeWidth, .035, .055, -side*angle);
    }
    add('detail', side*(w/2+.22), h-.13, 0, .10, .13, d+.50);
  }
  add('detail', 0, h+plan.roofRise+.05, 0, .15, .16, d+.52);
  // Closed back-face service vents and downspouts add scale without props
  // leaking into the existing footpaths.
  for (const x of [-1.34, 1.34]) {
    add('detail', x, 1.93, -d/2-.08, .88, .57, .08);
    for (let j = 0; j < 3; j++) {
      add('trim', x, 1.73+j*.18, -d/2-.14, .77, .055, .05);
    }
  }
  add('rust', w/2-.26, 1.63, -d/2-.07, .12, 2.72, .12);
  if (!isShed) {
    add('rust', w/2-.58, h+1.02, -d/2+.57, .34, 2.31, .34);
    add('detail', w/2-.58, h+2.19, -d/2+.57, .60, .14, .60);
    for (let i=0; i<4; i++) {
      add('rust', -w/2+.12+i*.21, 1.10, d/2+.08, .12, 1.11, .09);
    }
  } else {
    for (const x of [-.59,.59]) {
      add('rust', x, 1.12, d/2+.18, .07, 1.89, .06);
    }
  }

  for (const [name, geometries] of bucket) {
    if (!geometries.length) continue;
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((piece) => piece.dispose());
    const mesh = new THREE.Mesh(geometry, palette[name]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  unitBox.dispose();
  const texture = signTexture(plan.label);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.35, .59),
    new THREE.MeshStandardMaterial({ map: texture, roughness: .9, metalness: .05,
      side: THREE.DoubleSide }));
  sign.position.set(0, h-.52, d/2+.12);
  group.add(sign);
  return { group, materials: palette, texture };
}

/**
 * Add two closed service buildings beside the authored Blender landmarks.
 * Call ancillaryBlocksMove(result.footprints, x, z, playerRadius) during movement.
 * result.shelters use the same world-space rectangle shape as roofRectangles().
 */
export function createAncillaryBuildings(scene, terrainHeight, sites) {
  const footprints = ancillaryFootprints(sites);
  const root = new THREE.Group();
  root.name = 'Lodge stores and radio generator';
  const resources = [];
  for (const plan of footprints) {
    const ground = terrainHeight(plan.x, plan.z);
    const cornerHeights = [-1,1].flatMap((sx) => [-1,1].map((sz) =>
      terrainHeight(plan.x+sx*plan.halfWidth, plan.z+sz*plan.halfDepth)));
    const lowestCorner = Math.min(...cornerHeights);
    const foundationDrop = Math.max(.12, ground-lowestCorner+.22);
    const made = buildHouse(plan, ground, foundationDrop);
    root.add(made.group);
    resources.push(made);
  }
  scene.add(root);
  const shelters = footprints.map((house) => ({
    x: house.x, z: house.z,
    width: house.roofHalfWidth * 2, depth: house.roofHalfDepth * 2,
    halfWidth: house.roofHalfWidth, halfDepth: house.roofHalfDepth,
  }));
  const obstacles = footprints.map((house) => ({
    x: house.x, z: house.z,
    radius: Math.hypot(house.halfWidth, house.halfDepth),
  }));
  return {
    group: root, footprints, obstacles, shelters,
    blocksMove: (x, z, radius = .32) => ancillaryBlocksMove(footprints, x, z, radius),
    dispose() {
      root.parent?.remove(root);
      root.traverse((child) => {
        if (child.isMesh) child.geometry.dispose();
      });
      for (const resource of resources) {
        Object.values(resource.materials).forEach((material) => material.dispose());
        resource.texture.dispose();
      }
    },
  };
}
