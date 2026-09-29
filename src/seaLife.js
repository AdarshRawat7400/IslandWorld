import * as THREE from 'three';
import { boatTiltFromNormal } from './oceanWaveField.js';

// These lanes are well outside the landing cove and north inlet.
// They are atmosphere, not navigable vessels or collision geometry.
export const OFFSHORE_ROUTES = Object.freeze([
  // The supply coaster is visible beyond the east side of South Landing on
  // arrival, then spends nearly half its cycle out of sight.
  Object.freeze({ kind: 'coaster', start: [190, 465], end: [390, 515],
    cycle: 224, active: 124, phase: 34 }),
  Object.freeze({ kind: 'trawler', start: [-460, 180], end: [-500, -170],
    cycle: 269, active: 139, phase: 181 }),
  Object.freeze({ kind: 'cutter', start: [480, -180], end: [470, 180],
    cycle: 307, active: 145, phase: 91 }),
]);

export const OFFSHORE_SWELLS = Object.freeze([
  // Long axes follow the shoreline; the crest travels shoreward while its
  // opacity rises and falls. The whole 20 m wide footprint stays offshore.
  Object.freeze({ x: -480, z: 70, yaw: 1.45, length: 116, phase: 3.7,
    shorewardX: 1, shorewardZ: 0 }),
  Object.freeze({ x: 230, z: 480, yaw: -0.15, length: 150, phase: 1.42,
    shorewardX: 0, shorewardZ: -1 }),
  Object.freeze({ x: 470, z: -165, yaw: 1.4, length: 110, phase: 5.9,
    shorewardX: -1, shorewardZ: 0 }),
]);

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** The route has a long hidden interval so passing ships are occasional. */
export function offshoreRoutePose(route, elapsed, output = {}) {
  const time = ((Number.isFinite(elapsed) ? elapsed : 0) + route.phase) % route.cycle;
  const active = time < route.active;
  const progress = clamp01(time / route.active);
  const fade = active
    ? smooth(time / 14) * smooth((route.active - time) / 14) : 0;
  output.x = route.start[0] + (route.end[0] - route.start[0]) * progress;
  output.z = route.start[1] + (route.end[1] - route.start[1]) * progress;
  output.yaw = Math.atan2(route.end[0] - route.start[0],
    route.end[1] - route.start[1]);
  output.visible = active && fade > 0.005;
  output.fade = fade;
  return output;
}

function material(color, roughness = 0.82, metalness = 0.05) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness,
    transparent: true, opacity: 1, depthWrite: true });
}

function boatHull(length, beam) {
  const profile = [
    [-0.51, 0.20], [-0.44, 0.72], [-0.30, 0.96], [-0.07, 1.0],
    [0.21, 0.93], [0.39, 0.60], [0.49, 0.17], [0.515, 0.02],
  ];
  const sides = 10;
  const positions = [];
  const indices = [];
  for (const [z, breadth] of profile) {
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2;
      positions.push(Math.sin(angle) * beam * breadth * 0.5,
        0.63 + Math.cos(angle) * 0.73, z * length);
    }
  }
  for (let ring = 0; ring < profile.length - 1; ring++) for (let side = 0; side < sides; side++) {
    const a = ring * sides + side;
    const b = ring * sides + (side + 1) % sides;
    const c = (ring + 1) * sides + side;
    const d = (ring + 1) * sides + (side + 1) % sides;
    indices.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addBox(group, dimensions, position, surface) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), surface);
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

function addCylinder(group, radius, height, position, surface) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 8), surface);
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

function createShip(kind) {
  const group = new THREE.Group();
  const length = kind === 'coaster' ? 29 : kind === 'trawler' ? 17 : 14;
  const beam = kind === 'coaster' ? 5.7 : kind === 'trawler' ? 3.7 : 3.1;
  const steel = material(kind === 'coaster' ? 0x3c4c51 : 0x43545a, 0.77, 0.16);
  const deck = material(0x747368, 0.93);
  const painted = material(kind === 'coaster' ? 0x9c9c91 : 0x9badae, 0.85);
  const windows = material(0x233d49, 0.42, 0.12);
  const dark = material(0x343b3d, 0.88, 0.14);
  const foam = new THREE.MeshBasicMaterial({ color: 0xaac0c0,
    transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const materials = [steel, deck, painted, windows, dark, foam];
  for (const surface of materials) surface.userData.baseOpacity = surface.opacity;
  const hull = new THREE.Mesh(boatHull(length, beam), steel);
  group.add(hull);
  addBox(group, [beam * 0.84, 0.12, length * 0.78], [0, 1.32, -length * 0.03], deck);
  if (kind === 'coaster') {
    // A modest island supply coaster: aft bridge, separate cargo hatches,
    // low stack, and two cargo derricks break up the distant silhouette.
    addBox(group, [beam * 0.73, 2.25, 5.0], [0, 2.47, -length * 0.30], painted);
    addBox(group, [beam * 0.82, 0.80, 3.5], [0, 3.97, -length * 0.30], windows);
    addBox(group, [beam * 0.95, 0.17, 4.2], [0, 4.48, -length * 0.30], deck);
    for (const z of [-0.06, 0.22]) {
      addBox(group, [beam * 0.67, 0.42, 5.2], [0, 1.61, length * z], dark);
    }
    addCylinder(group, 0.52, 1.68, [0, 5.18, -length * 0.35], dark);
    for (const z of [0.04, 0.34]) {
      addCylinder(group, 0.085, 5.2, [0, 4.0, length * z], dark);
    }
  } else {
    const bridgeZ = kind === 'trawler' ? length * 0.17 : -length * 0.05;
    addBox(group, [beam * 0.70, 1.42, length * 0.30], [0, 2.08, bridgeZ], painted);
    addBox(group, [beam * 0.76, 0.62, length * 0.22], [0, 3.12, bridgeZ], windows);
    addBox(group, [beam * 0.86, 0.12, length * 0.34], [0, 3.47, bridgeZ], deck);
    addCylinder(group, 0.10, kind === 'trawler' ? 4.0 : 3.2,
      [0, kind === 'trawler' ? 5.3 : 4.8, -length * 0.20], dark);
    if (kind === 'trawler') {
      // Winch and A-frame hint at a working fishing vessel.
      addBox(group, [beam * 0.64, 0.6, 1.0], [0, 1.72, -length * 0.23], dark);
    }
  }
  // A thin broken wake reads at a distance without a light or particle draw.
  const wakeGeometry = new THREE.BufferGeometry();
  wakeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -beam * 0.32, 0.09, -length * 0.47,
    beam * 0.32, 0.09, -length * 0.47,
    -beam * 2.1, 0.055, -length * 1.65,
    beam * 0.32, 0.09, -length * 0.47,
    beam * 2.1, 0.055, -length * 1.65,
    -beam * 2.1, 0.055, -length * 1.65,
  ], 3));
  const wake = new THREE.Mesh(wakeGeometry, foam);
  group.add(wake);
  group.name = `Distant ${kind} silhouette`;
  return { group, materials };
}

function createSwell(spec, scene) {
  const uniforms = {
    uTime: { value: 0 }, uWind: { value: 0.25 },
    uPhase: { value: spec.phase }, uOpacity: { value: 0 },
    uFog: { value: new THREE.Color(0x899b9b) },
    uFogDensity: { value: 0.0027 },
  };
  const wave = new THREE.Mesh(new THREE.PlaneGeometry(spec.length, 20, 40, 8),
    new THREE.ShaderMaterial({
      uniforms, side: THREE.DoubleSide, transparent: true, depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorld;
        varying float vLift;
        uniform float uTime;
        uniform float uWind;
        uniform float uPhase;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          float edge = smoothstep(0.0, 0.1, uv.x) * (1.0 - smoothstep(0.90, 1.0, uv.x));
          float crest = pow(max(0.0, sin(uv.y * 3.14159265)), 2.6);
          float chop = 1.0 + 0.13 * sin(uv.x * 39.0 + uTime * 0.7 + uPhase)
            + 0.07 * sin(uv.x * 71.0 - uTime * 0.5 + uPhase);
          vLift = crest * edge * chop;
          world.y += vLift * (1.9 + uWind * 3.4);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vWorld;
        varying float vLift;
        uniform float uTime;
        uniform float uWind;
        uniform float uOpacity;
        uniform float uFogDensity;
        uniform vec3 uFog;
        void main() {
          float edge = smoothstep(0.0, 0.1, vUv.x)
            * (1.0 - smoothstep(0.90, 1.0, vUv.x));
          float fleck = sin(vUv.x * 137.0 + uTime * 0.8)
            * sin(vUv.x * 89.0 - uTime * 1.1);
          float white = smoothstep(0.62, 0.91, vLift + fleck * 0.10)
            * (0.48 + uWind * 0.45);
          vec3 color = mix(vec3(0.18, 0.31, 0.34), vec3(0.70, 0.82, 0.81), white);
          float distanceToEye = distance(cameraPosition, vWorld);
          float visibility = exp(-pow(distanceToEye * uFogDensity, 2.0));
          color = mix(uFog, color, visibility);
          float alpha = uOpacity * edge * smoothstep(0.04, 0.34, vLift)
            * (0.53 + 0.24 * white) * visibility;
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.78));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }));
  wave.rotation.x = -Math.PI / 2;
  wave.rotation.z = spec.yaw;
  wave.position.set(spec.x, 0.065, spec.z);
  wave.name = 'Offshore rolling breaker';
  scene.add(wave);
  return { mesh: wave, uniforms };
}

/** Distant procedural maritime life. No route crosses a docked boat. */
export function createSeaLife(scene, { waterHeight = () => 0.045 } = {}) {
  const ships = OFFSHORE_ROUTES.map((route) => {
    const vessel = createShip(route.kind);
    vessel.group.visible = false;
    scene.add(vessel.group);
    return { ...vessel, route, pose: {} };
  });
  const swells = OFFSHORE_SWELLS.map((spec) => createSwell(spec, scene));

  function update(elapsed = 0, weather = 'mist') {
    const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    const wind = weather === 'storm' ? 1 : weather === 'rain' ? 0.64 : 0.22;
    for (const ship of ships) {
      const pose = offshoreRoutePose(ship.route, time, ship.pose);
      ship.group.visible = pose.visible;
      if (!pose.visible) continue;
      const sea = waterHeight(pose.x, pose.z, time);
      const tilt = boatTiltFromNormal(waterHeight.normalAt?.(
        pose.x, pose.z, time), pose.yaw, 0.09, 0.11);
      // Outside the moving nearshore patch the far sea is deliberately flat.
      // Keep distant vessels gently alive there instead of freezing their hulls.
      const flatWater = !tilt || Math.abs(tilt.pitch) + Math.abs(tilt.roll) < 0.0001;
      ship.group.position.set(pose.x,
        (Number.isFinite(sea) ? sea : 0.045) + 0.14
          + Math.sin(time * 0.73 + ship.route.phase)
            * (flatWater ? 0.04 + wind * 0.08 : 0.015),
        pose.z);
      ship.group.rotation.set(
        (tilt?.pitch ?? 0) + Math.sin(time * 0.57 + ship.route.phase)
          * (flatWater ? 0.01 + wind * 0.025 : 0.005),
        pose.yaw,
        (tilt?.roll ?? 0) + Math.sin(time * 0.49 + ship.route.phase * 0.3)
          * (flatWater ? 0.01 + wind * 0.03 : 0.005));
      for (const surface of ship.materials) {
        surface.opacity = surface.userData.baseOpacity * pose.fade;
      }
    }
    for (let index = 0; index < swells.length; index++) {
      const swell = swells[index];
      const phase = OFFSHORE_SWELLS[index].phase;
      // A bank of larger breakers travels past in irregular, separated sets.
      const pulse = Math.pow(Math.max(0, Math.sin(time * 0.085 + phase)), 5);
      const opacity = (0.23 + wind * 0.57) * pulse;
      swell.mesh.visible = opacity > 0.012;
      swell.uniforms.uOpacity.value = opacity;
      swell.uniforms.uTime.value = time;
      swell.uniforms.uWind.value = wind;
      if (scene.fog) {
        swell.uniforms.uFog.value.copy(scene.fog.color);
        swell.uniforms.uFogDensity.value = scene.fog.density;
      }
      // A crest rolls 0–12 m toward shore during its visible half-cycle, then
      // resets only after it has faded away.
      const travel = (1 - Math.cos(time * 0.085 + phase)) * 6;
      const spec = OFFSHORE_SWELLS[index];
      swell.mesh.position.x = spec.x + spec.shorewardX * travel;
      swell.mesh.position.z = spec.z + spec.shorewardZ * travel;
    }
    return { vesselsVisible: ships.filter((ship) => ship.group.visible).length,
      swellSetsVisible: swells.filter((swell) => swell.mesh.visible).length };
  }

  function dispose() {
    for (const ship of ships) {
      scene.remove(ship.group);
      ship.group.traverse((object) => { if (object.isMesh) object.geometry.dispose(); });
      for (const surface of ship.materials) surface.dispose();
    }
    for (const swell of swells) {
      scene.remove(swell.mesh);
      swell.mesh.geometry.dispose();
      swell.mesh.material.dispose();
    }
  }
  return { update, dispose, ships, swells };
}
