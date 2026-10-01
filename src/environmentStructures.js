import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { landingBoardwalkSections, landingBoardwalkTopAt } from './landingBoardwalk.js';
import { SITES, NAV_LIGHTS } from './worldSites.js';

// Physical structures extracted from the original island scene.
export function createEnvironmentStructures(scene, world) {
  const loader = new GLTFLoader();
  const assetBase = import.meta.env?.BASE_URL || '/';
  function addRect(group, width, height, depth, x, y, z, color, roughness = 0.85) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, roughness }),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function fallbackBuilding(site) {
    const group = new THREE.Group();
    const w = site.scale[0] * 0.85;
    const d = site.scale[1] * 0.8;
    const h = site.id === 'tower' ? 17 : site.id === 'lodge' ? 7.5 : 5;
    const wall = site.id === 'lodge' ? 0x625b50 : 0x636d6b;
    addRect(group, w, 0.28, d, 0, 0.14, 0, 0x303535);
    addRect(group, w, h, 0.4, 0, h / 2, -d / 2, wall);
    addRect(group, 0.4, h, d, -w / 2, h / 2, 0, wall);
    addRect(group, 0.4, h, d, w / 2, h / 2, 0, wall);
    addRect(group, (w - 2.4) / 2, h, 0.4, -(w + 2.4) / 4, h / 2, d / 2, wall);
    addRect(group, (w - 2.4) / 2, h, 0.4, (w + 2.4) / 4, h / 2, d / 2, wall);
    addRect(group, w + 0.8, 0.35, d + 0.9, 0, h, 0, 0x303b3e);
    const lamp = new THREE.PointLight(0xe3b87c, 2, 12);
    lamp.position.set(0, h - 1.2, d / 2 + 1.2);
    group.add(lamp);
    group.position.set(site.x, world.terrainHeight(site.x, site.z), site.z);
    return group;
  }

  function decorateSite(site) {
    const ground = world.terrainHeight(site.x, site.z);
    if (site.kind !== 'building') return;
    const fallback = fallbackBuilding(site);
    scene.add(fallback);
    loader.load(`${assetBase}assets/${site.model}`, (gltf) => {
      const model = gltf.scene;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material?.map) child.material.map.colorSpace = THREE.SRGBColorSpace;
        }
      });
      model.position.set(site.x, ground + 0.08, site.z);
      scene.add(model);
      scene.remove(fallback);
    }, undefined, () => { /* fallback stays visible */ });

    const porchLamp = new THREE.PointLight(0xf2cb88, site.id === 'lodge' ? 2.7 : 1.8, 20, 2);
    porchLamp.position.set(site.x, ground + 3.4, site.z + site.scale[1] * 0.45);
    scene.add(porchLamp);
    const interiorColor = site.id === 'lodge' || site.id === 'radio' ? 0xe8c18c : 0xb7ccca;
    const interiorLamp = new THREE.PointLight(interiorColor, site.id === 'lodge' ? 1.35 : 0.95, 18, 2);
    interiorLamp.position.set(site.x, ground + 2.8, site.z);
    scene.add(interiorLamp);
  }
  SITES.forEach(decorateSite);

  // The cove boardwalk follows the descent from the old landing to a low pier.
  const dock = new THREE.Group();
  const timberLoader = new THREE.TextureLoader();
  function timberMap(name, color = false) {
    const map = timberLoader.load(`${assetBase}assets/building-textures/timber_${name}.jpg`);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    if (color) map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }
  const dockDeckMaterial = new THREE.MeshStandardMaterial({
    name: 'Weathered dock timber',
    color: 0xb8b3a7,
    map: timberMap('diffuse', true),
    normalMap: timberMap('nor_gl'),
    roughnessMap: timberMap('rough'),
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.94,
  });
  const dockWalkMaterial = dockDeckMaterial.clone();
  dockWalkMaterial.name = 'Weathered ramp timber';
  dockWalkMaterial.color.setHex(0xa9aca3);
  const dockFrameMaterial = new THREE.MeshStandardMaterial({
    color: 0x403c35, roughness: 0.96, metalness: 0,
  });
  const dockIronMaterial = new THREE.MeshStandardMaterial({
    color: 0x333b3a, roughness: 0.72, metalness: 0.38,
  });
  const dockParts = { timber: [], iron: [] };
  // Tile the same three textures in geometry UV space. In particular, the
  // 22 m north jetty must not stretch one copy of the plank image end to end.
  // Keeping texture repeat at 1 also lets every deck share the GPU maps.
  function tileDockBox(mesh, width, height, depth) {
    const uv = mesh.geometry.attributes.uv;
    const faceDimensions = [
      [depth, height], [depth, height],
      [width, depth], [width, depth],
      [width, height], [width, height],
    ];
    for (let face = 0; face < faceDimensions.length; face++) {
      const [faceWidth, faceHeight] = faceDimensions[face];
      for (let vertex = face * 4; vertex < face * 4 + 4; vertex++) {
        uv.setXY(vertex,
          uv.getX(vertex) * faceWidth / 2,
          uv.getY(vertex) * faceHeight / 2);
      }
    }
    uv.needsUpdate = true;
  }
  function dockTimber(width, height, depth, x, y, z, material = dockFrameMaterial, pitch = 0) {
    dockParts[material === dockIronMaterial ? 'iron' : 'timber'].push({
      width, height, depth, x, y, z, pitch,
    });
  }
  function addDockInstances(parts, material, name) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, parts.length);
    const transform = new THREE.Object3D();
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      transform.position.set(part.x, part.y, part.z);
      transform.rotation.set(part.pitch, 0, 0);
      transform.scale.set(part.width, part.height, part.depth);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    dock.add(mesh);
  }
  const boardwalkSections = landingBoardwalkSections(world.terrainHeight);
  for (const { startZ: z, endZ: zNext, yStart, yEnd, span, pitch }
    of boardwalkSections) {
    const plank = addRect(dock, 6.6, 0.18, span + 0.06,
      0, (yStart + yEnd) / 2, (z + zNext) / 2, 0x584d3f);
    plank.material.dispose();
    plank.material = dockWalkMaterial;
    tileDockBox(plank, 6.6, 0.18, span + 0.06);
    plank.rotation.x = pitch;
    // The exposed side stringers keep the descending boardwalk from reading as
    // a thin floating texture when viewed head-on from the arriving ferry.
    for (const x of [-3.1, 3.1]) {
      dockTimber(0.31, 0.38, span + 0.08,
        x, (yStart + yEnd) / 2 - 0.17, (z + zNext) / 2,
        dockFrameMaterial, plank.rotation.x);
    }
    // The last metres down to the pier are steep. Narrow grip battens and iron
    // pegs read as a built gangway instead of one pale plane at a grazing angle.
    if (zNext > 332) {
      const count = Math.max(2, Math.floor((zNext - z) / 0.8));
      for (let i = 1; i <= count; i++) {
        const t = i / (count + 1);
        const battenZ = z + (zNext - z) * t;
        const battenY = yStart + (yEnd - yStart) * t + 0.105;
        dockTimber(6.15, 0.06, 0.105, 0, battenY, battenZ,
          dockFrameMaterial, plank.rotation.x);
        for (const x of [-2.8, 2.8]) {
          dockTimber(0.09, 0.012, 0.09, x, battenY + 0.037, battenZ,
            dockIronMaterial, plank.rotation.x);
        }
      }
    }
  }
  const pierY = 0.35;
  const pierDeck = addRect(dock, 8, 0.28, 14, 0, pierY, 350, 0x514b40);
  pierDeck.material.dispose();
  pierDeck.material = dockDeckMaterial;
  tileDockBox(pierDeck, 8, 0.28, 14);
  for (const x of [-3.6, 3.6]) for (const z of [344, 351, 356]) {
    dockTimber(0.5, 3.1, 0.5, x, pierY - 1.5, z);
    dockTimber(0.56, 0.12, 0.56, x, pierY + 0.22, z, dockIronMaterial);
  }
  // One guarded side leaves the east edge open for the ferry's boarding gap.
  for (const z of [344.5, 350, 355.5]) {
    dockTimber(0.16, 0.95, 0.16, -3.72, pierY + 0.62, z);
  }
  dockTimber(0.13, 0.13, 11.2, -3.72, pierY + 1.05, 350);
  for (const z of [345.5, 355]) {
    dockTimber(0.18, 0.47, 0.18, 3.68, pierY + 0.35, z, dockIronMaterial);
  }
  addDockInstances(dockParts.timber, dockFrameMaterial, 'South Landing timber framework');
  addDockInstances(dockParts.iron, dockIronMaterial, 'South Landing iron fittings');
  scene.add(dock);

  function onSouthPier(x, z) { return Math.abs(x) < 3.8 && z >= 342 && z <= 357; }
  function playerGroundHeight(x, z) {
    const analytic = world.terrainHeight(x, z);
    // At high cliffs the coarse island grid and the analytic terrain sampler
    // can differ by metres. Blend to the visible triangle height before the
    // newly walkable crest, keeping inland props and low landing coves stable.
    const cliffBlend = THREE.MathUtils.smoothstep(world.coastalRadius(x, z), 0.93, 0.955)
      * THREE.MathUtils.smoothstep(analytic, 10, 18);
    let ground = THREE.MathUtils.lerp(analytic,
      world.renderedTerrainHeight(x, z), cliffBlend);
    const boardwalkTop = Math.abs(x) <= 3.3
      ? landingBoardwalkTopAt(boardwalkSections, z) : null;
    if (boardwalkTop !== null) ground = Math.max(ground, boardwalkTop + 0.02);
    return onSouthPier(x, z) ? Math.max(pierY + 0.14, ground) : ground;
  }

  const beaconGlowCanvas = document.createElement('canvas');
  beaconGlowCanvas.width = beaconGlowCanvas.height = 64;
  const beaconGlowContext = beaconGlowCanvas.getContext('2d');
  const glowGradient = beaconGlowContext.createRadialGradient(32, 32, 1, 32, 32, 32);
  glowGradient.addColorStop(0, 'rgba(255,251,225,0.95)');
  glowGradient.addColorStop(0.2, 'rgba(255,238,189,0.6)');
  glowGradient.addColorStop(1, 'rgba(255,215,150,0)');
  beaconGlowContext.fillStyle = glowGradient;
  beaconGlowContext.fillRect(0, 0, 64, 64);
  const beaconGlowTexture = new THREE.CanvasTexture(beaconGlowCanvas);

  function makeBeacon(x, z, height, color, strength) {
    const group = new THREE.Group();
    const y = world.terrainHeight(x, z);
    if (height > 35) {
      const wide = true;
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(wide ? 0.95 : 0.75, wide ? 2.1 : 1.55, height, 12),
        new THREE.MeshStandardMaterial({ color: 0x697574, roughness: 0.92, metalness: 0.04 }),
      );
      shaft.position.y = height / 2;
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      group.add(shaft);
      for (const level of [0.18, 0.47, 0.76]) {
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry((wide ? 2.1 : 1.55) - level * (wide ? 1.15 : 0.8) + 0.07,
            (wide ? 2.1 : 1.55) - level * (wide ? 1.15 : 0.8) + 0.07, 0.16, 12),
          new THREE.MeshStandardMaterial({ color: 0x384449, roughness: 0.64, metalness: 0.58 }),
        );
        band.position.y = height * level;
        group.add(band);
      }
      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(1.65, 1.65, 0.24, 12),
        new THREE.MeshStandardMaterial({ color: 0x303a3f, roughness: 0.72, metalness: 0.44 }),
      );
      platform.position.y = height - 0.25;
      group.add(platform);
    } else {
      // The inland survey stakes look through the rear towers toward the far
      // front light. An open steel frame keeps that real sightline visible.
      const steel = new THREE.MeshStandardMaterial({ color: 0x4f5e60, roughness: 0.82, metalness: 0.42 });
      const addBeam = (start, end, radius = 0.075) => {
        const from = new THREE.Vector3(...start);
        const to = new THREE.Vector3(...end);
        const direction = to.clone().sub(from);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 6), steel);
        beam.position.copy(from).add(to).multiplyScalar(0.5);
        beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
        beam.castShadow = true;
        beam.receiveShadow = true;
        group.add(beam);
      };
      const footprint = height > 23 ? 0.86 : 0.71;
      const cap = height > 23 ? 0.46 : 0.39;
      const radiusAt = (level) => footprint + (cap - footprint) * level / height;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        addBeam([sx * footprint, 0, sz * footprint], [sx * cap, height - 0.4, sz * cap], 0.09);
      }
      for (let level = 3.6; level < height - 0.5; level += 3.6) {
        const r = radiusAt(level);
        for (const sz of [-1, 1]) addBeam([-r, level, sz * r], [r, level, sz * r], 0.055);
        for (const sx of [-1, 1]) addBeam([sx * r, level, -r], [sx * r, level, r], 0.055);
      }
      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(1.02, 1.02, 0.18, 12),
        new THREE.MeshStandardMaterial({ color: 0x303a3f, roughness: 0.72, metalness: 0.44 }),
      );
      platform.position.y = height - 0.26;
      group.add(platform);
    }
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.52, 16, 10), new THREE.MeshBasicMaterial({ color }));
    glass.position.y = height + 0.5;
    group.add(glass);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: beaconGlowTexture, color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.position.y = height + 0.5;
    halo.scale.setScalar(height > 35 ? 4.6 : 2.15);
    group.add(halo);
    const hood = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.95, 0.18, 12),
      new THREE.MeshStandardMaterial({ color: 0x26343a, roughness: 0.54, metalness: 0.62 }),
    );
    hood.position.y = height + 1.06;
    group.add(hood);
    const light = new THREE.PointLight(color, strength, 130, 1.2);
    light.position.y = height + 0.5;
    group.add(light);
    group.position.set(x, y, z);
    scene.add(group);
    return { group, glass, halo, light };
  }
  const lights = {
    front: makeBeacon(NAV_LIGHTS.front.x, NAV_LIGHTS.front.z, NAV_LIGHTS.front.height, 0xf8e6b4, 6),
    main: makeBeacon(NAV_LIGHTS.main.x, NAV_LIGHTS.main.z, NAV_LIGHTS.main.height, 0xffdf9c, 6),
    standby: makeBeacon(NAV_LIGHTS.standby.x, NAV_LIGHTS.standby.z, NAV_LIGHTS.standby.height, 0xf1c794, 5),
  };

  const surveyPosts = new Map();
  for (const point of [
    { id: 'headland_view', x: -186, z: -120 },
    { id: 'east_ridge_view', x: 232, z: -120 },
  ]) {
    const y = world.terrainHeight(point.x, point.z);
    const post = new THREE.Group();
    addRect(post, 0.16, 1.5, 0.16, 0, 0.75, 0, 0x777d78);
    addRect(post, 0.45, 0.08, 0.45, 0, 1.52, 0, 0xb6a782);
    post.position.set(point.x, y, point.z);
    scene.add(post);
    surveyPosts.set(point.id, post);
  }

  const northJetty = new THREE.Group();
  const northY = world.terrainHeight(-65, -315) + 0.08;
  const northDeck = addRect(northJetty, 6, 0.3, 22, -65, northY, -322, 0x514b40);
  northDeck.material.dispose();
  northDeck.material = dockDeckMaterial;
  tileDockBox(northDeck, 6, 0.3, 22);
  for (const x of [-67.6, -62.4]) for (const z of [-315, -323, -331]) {
    addRect(northJetty, 0.46, 3.4, 0.46, x, northY-1.7, z, 0x4d463a);
  }
  scene.add(northJetty);

  // Keep the navigation lights visually alive.
  function update(elapsed = 0) {
    lights.front.light.intensity = 4.5 + Math.sin(elapsed * 1.4) * 0.8;
    lights.main.light.intensity = 4.8 + Math.sin(elapsed * 1.32) * 0.8;
    lights.standby.light.intensity = 3.5 + Math.sin(elapsed * 1.19) * 0.45;
  }

  return {
    sites: SITES,
    navLights: NAV_LIGHTS,
    onSouthPier,
    playerGroundHeight,
    update,
    dock,
    northJetty,
    lights,
    surveyPosts,
  };
}
