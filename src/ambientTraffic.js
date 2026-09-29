import * as THREE from 'three';
import { ROAD_ROUTES, isRoad } from './roads.js';

// Small, unnamed island staff journeys along the existing road network.
export const AMBIENT_TRAFFIC_ROUTES = Object.freeze([
  Object.freeze({ id: 'archive-staff', routeId: 'lodge-archive', sourceType: 'sedan',
    min: 0.43, max: 0.94, start: 0.64, cruise: 5.8, lane: 0.42 }),
  Object.freeze({ id: 'coast-maintenance', routeId: 'west-coast', sourceType: 'wagon',
    min: 0.04, max: 0.96, start: 0.31, cruise: 6.7, lane: 0.45 }),
  Object.freeze({ id: 'ridge-orderly', routeId: 'east-ridge', sourceType: 'sedan',
    min: 0.05, max: 0.95, start: 0.48, cruise: 6.2, lane: 0.4 }),
]);

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const approach = (value, goal, delta) => value < goal
  ? Math.min(goal, value + delta) : Math.max(goal, value - delta);

function sampleRoad(route) {
  const curve = new THREE.CatmullRomCurve3(route.points.map(([x, z]) =>
    new THREE.Vector3(x, 0, z)), false, 'centripetal', 0.5);
  const divisions = Math.ceil(curve.getLength() / 1.8);
  const points = curve.getSpacedPoints(divisions);
  let distance = 0;
  const samples = points.map((point, index) => {
    if (index) distance += point.distanceTo(points[index - 1]);
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const scale = 1 / Math.max(0.0001, Math.hypot(dx, dz));
    return { x: point.x, z: point.z, distance, dx: dx * scale, dz: dz * scale };
  });
  return { id: route.id, length: distance, samples };
}

function roadPose(path, progress, direction, lane) {
  const distance = clamp(progress, 0, path.length);
  let low = 0, high = path.samples.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (path.samples[middle].distance <= distance) low = middle;
    else high = middle;
  }
  const a = path.samples[low];
  const b = path.samples[high];
  const blend = clamp((distance - a.distance) / Math.max(0.0001, b.distance - a.distance), 0, 1);
  const dx = a.dx + (b.dx - a.dx) * blend;
  const dz = a.dz + (b.dz - a.dz) * blend;
  const inv = 1 / Math.max(0.0001, Math.hypot(dx, dz));
  const tangentX = dx * inv;
  const tangentZ = dz * inv;
  const offset = lane * direction;
  return {
    x: a.x + (b.x - a.x) * blend + tangentZ * offset,
    z: a.z + (b.z - a.z) * blend - tangentX * offset,
    heading: Math.atan2(tangentX * direction, tangentZ * direction),
  };
}

function addPiece(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeFallbackCar(ownedGeometries, ownedMaterials) {
  // Used only if createSetDressing() has not supplied a vintage car to clone.
  const car = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const wheel = new THREE.CylinderGeometry(0.43, 0.43, 0.17, 12);
  const paint = new THREE.MeshStandardMaterial({ color: 0x435a57, metalness: 0.3, roughness: 0.48 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151f21, roughness: 0.74 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb5b8ad, metalness: 0.7, roughness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x496269, transparent: true,
    opacity: 0.53, roughness: 0.16, metalness: 0.06, depthWrite: false });
  ownedGeometries.add(box); ownedGeometries.add(wheel);
  [paint, dark, chrome, glass].forEach((material) => ownedMaterials.add(material));
  addPiece(car, box, paint, 0, 0.79, 0, 2.06, 0.8, 4.85);
  addPiece(car, box, paint, 0, 1.82, -0.1, 1.52, 0.13, 2.32);
  addPiece(car, box, glass, 0, 1.5, 1.08, 1.43, 0.48, 0.035);
  for (const side of [-1, 1]) {
    addPiece(car, box, glass, side * 0.777, 1.5, -0.1, 0.025, 0.45, 1.88);
    for (const z of [-1.15, 0.95]) {
      addPiece(car, box, paint, side * 0.76, 1.52, z, 0.09, 0.62, 0.1);
    }
    for (const z of [-1.51, 1.48]) {
      const tyre = addPiece(car, wheel, dark, side * 1.05, 0.43, z);
      tyre.rotation.z = Math.PI / 2;
    }
    addPiece(car, box, chrome, side * 0.7, 0.91, 2.435, 0.24, 0.17, 0.04);
  }
  addPiece(car, box, chrome, 0, 0.52, 2.46, 1.9, 0.11, 0.12);
  addPiece(car, box, chrome, 0, 0.52, -2.46, 1.9, 0.11, 0.12);
  return car;
}

function addDriver(car, ownedGeometries, ownedMaterials, coatColor) {
  const skin = new THREE.MeshStandardMaterial({ color: 0x8b7665, roughness: 0.96 });
  const coat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.92 });
  const cap = new THREE.MeshStandardMaterial({ color: 0x292e2c, roughness: 0.94 });
  const sphere = new THREE.SphereGeometry(1, 9, 7);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const box = new THREE.BoxGeometry(1, 1, 1);
  [skin, coat, cap].forEach((material) => ownedMaterials.add(material));
  [sphere, cylinder, box].forEach((geometry) => ownedGeometries.add(geometry));
  // The original car's transparent glazing reveals a seated coat, face and cap.
  addPiece(car, cylinder, coat, -0.36, 1.17, 0.23, 0.25, 0.36, 0.23);
  addPiece(car, sphere, skin, -0.36, 1.52, 0.29, 0.13, 0.15, 0.12);
  addPiece(car, sphere, cap, -0.36, 1.64, 0.28, 0.14, 0.065, 0.13);
  addPiece(car, box, cap, -0.36, 1.65, 0.39, 0.3, 0.022, 0.12);
  for (const side of [-1, 1]) {
    const arm = addPiece(car, cylinder, coat, -0.36 + side * 0.21, 1.21, 0.46,
      0.07, 0.24, 0.07);
    arm.rotation.x = -0.36;
  }
}

function makeCar(source, id, ownedGeometries, ownedMaterials) {
  const car = source?.group?.isGroup ? source.group.clone(true)
    : makeFallbackCar(ownedGeometries, ownedMaterials);
  car.name = `ambient-traffic:${id}`;
  car.position.set(0, 0, 0);
  car.rotation.set(0, 0, 0);
  car.userData.ambientTraffic = true;
  const solidCabin = car.children.find((part) => part.userData?.ambientRemovable);
  if (solidCabin) {
    solidCabin.visible = false;
    const roofGeometry = new THREE.BoxGeometry(1, 1, 1);
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: source?.type === 'wagon' ? 0xb7b5a1 : 0x374b49,
      roughness: 0.43, metalness: 0.28,
    });
    ownedGeometries.add(roofGeometry);
    ownedMaterials.add(roofMaterial);
    const rear = source?.type === 'wagon' ? -1.78 : -0.94;
    const cabinLength = 0.85 - rear;
    addPiece(car, roofGeometry, roofMaterial, 0, 1.88,
      (rear + 0.85) / 2, 1.13, 0.085, cabinLength);
    for (const side of [-1, 1]) for (const z of [rear, 0.83]) {
      const pillar = addPiece(car, roofGeometry, roofMaterial,
        side * 0.66, 1.55, z, 0.075, 0.72, 0.085);
      pillar.rotation.x = z > 0 ? -0.22 : 0.17;
    }
  }
  // The parked cars' dark glazing reads well at rest, but moving drivers need
  // a clearer windshield. Give each clone its own glass material so this does
  // not change the player-owned cars or any building windows.
  car.traverse((part) => {
    const material = part.material;
    if (!part.isMesh || !material?.isMeshPhysicalMaterial || !material.transparent
      || material.opacity < 0.5 || material.opacity > 0.8) return;
    const glazing = material.clone();
    glazing.color.setHex(0x829696);
    glazing.opacity = 0.39;
    part.material = glazing;
    ownedMaterials.add(glazing);
  });
  addDriver(car, ownedGeometries, ownedMaterials, id === 'ridge-orderly' ? 0x303942 : 0x4d4e43);

  const lampGeometry = new THREE.SphereGeometry(0.15, 9, 7);
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xf9e6ba,
    emissive: 0xffd77b, emissiveIntensity: 0.4, roughness: 0.23 });
  const brakeMaterial = new THREE.MeshStandardMaterial({ color: 0x8c2924,
    emissive: 0xf94a35, emissiveIntensity: 0.05, roughness: 0.32 });
  ownedGeometries.add(lampGeometry);
  ownedMaterials.add(lampMaterial);
  ownedMaterials.add(brakeMaterial);
  for (const side of [-1, 1]) {
    addPiece(car, lampGeometry, lampMaterial, side * 0.68, 0.91, 2.48, 1, 0.72, 0.32);
    addPiece(car, lampGeometry, brakeMaterial, side * 0.7, 0.84, -2.49, 0.8, 0.66, 0.25);
  }
  return { car, lampMaterial, brakeMaterial };
}

function animateWheels(vehicle, travelledMetres) {
  const wheels = vehicle.group.userData.wheels;
  if (!Array.isArray(wheels) || !wheels.length) return;
  const layers = vehicle.wheelLayers;
  if (layers.length !== 3) return;
  const dummy = vehicle.wheelDummy;
  for (const [index, wheel] of wheels.entries()) {
    wheel.angle = (wheel.angle || 0) + travelledMetres / wheel.radius;
    dummy.rotation.set(wheel.angle, 0, Math.PI / 2, 'YXZ');
    for (const [layerIndex, layer] of [
      { radiusScale: 1, thickness: 0.2, offset: 0 },
      { radiusScale: 0.59, thickness: 0.012, offset: 0.111 },
      { radiusScale: 0.18, thickness: 0.018, offset: 0.121 },
    ].entries()) {
      dummy.position.set(wheel.x + Math.sign(wheel.x) * layer.offset,
        wheel.radius, wheel.z);
      dummy.scale.set(wheel.radius * layer.radiusScale, layer.thickness,
        wheel.radius * layer.radiusScale);
      dummy.updateMatrix();
      layers[layerIndex].setMatrixAt(index, dummy.matrix);
    }
  }
  for (const layer of layers) layer.instanceMatrix.needsUpdate = true;
}

function bodyFits(vehicle, pose, canPlace) {
  if (typeof canPlace !== 'function') return true;
  const sin = Math.sin(pose.heading), cos = Math.cos(pose.heading);
  for (const [localX, localZ] of [
    [0, 0], [-0.68, -1.6], [0.68, -1.6], [-0.68, 1.6], [0.68, 1.6],
  ]) {
    const x = pose.x + localX * cos + localZ * sin;
    const z = pose.z - localX * sin + localZ * cos;
    if (!canPlace(x, z, vehicle, 0.43)) return false;
  }
  return true;
}

function poseVehicle(vehicle, pose, terrainHeight) {
  vehicle.x = pose.x;
  vehicle.z = pose.z;
  vehicle.heading = pose.heading;
  const y = terrainHeight(pose.x, pose.z) + 0.11;
  vehicle.y = y;
  vehicle.group.position.set(pose.x, y, pose.z);
  vehicle.group.rotation.order = 'YXZ';
  vehicle.group.rotation.y = pose.heading;
  const sin = Math.sin(pose.heading), cos = Math.cos(pose.heading);
  const front = terrainHeight(pose.x + sin * 1.6, pose.z + cos * 1.6);
  const rear = terrainHeight(pose.x - sin * 1.6, pose.z - cos * 1.6);
  const sideR = terrainHeight(pose.x + cos * 0.75, pose.z - sin * 0.75);
  const sideL = terrainHeight(pose.x - cos * 0.75, pose.z + sin * 0.75);
  vehicle.group.rotation.x = clamp(-Math.atan2(front - rear, 3.2), -0.16, 0.16);
  vehicle.group.rotation.z = clamp(Math.atan2(sideR - sideL, 1.5), -0.14, 0.14);
}

function carCircleHit(vehicle, x, z, radius) {
  const dx = x - vehicle.x, dz = z - vehicle.z;
  const sin = Math.sin(vehicle.heading), cos = Math.cos(vehicle.heading);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const closestX = clamp(localX, -vehicle.width / 2, vehicle.width / 2);
  const closestZ = clamp(localZ, -vehicle.length / 2, vehicle.length / 2);
  return (localX - closestX) ** 2 + (localZ - closestZ) ** 2 <= radius ** 2;
}

function actorDistance(pose, actor) {
  if (!Number.isFinite(actor?.x) || !Number.isFinite(actor?.z)) return Infinity;
  return Math.hypot(pose.x - actor.x, pose.z - actor.z);
}

/** Sparse autonomous cars following the very same curves used to draw roads.
 * `canPlace(x,z,vehicle,radius)` should check static island occupancy and the
 * three player-owned cars, but should not call this traffic object's collides.
 * Passing 0 for dt freezes traffic during menus or paused gameplay.
 */
export function createAmbientTraffic(scene, terrainHeight, {
  parkedVehicles = [], canPlace, routes = ROAD_ROUTES,
  specs = AMBIENT_TRAFFIC_ROUTES,
} = {}) {
  if (!scene?.add || typeof terrainHeight !== 'function') {
    throw new TypeError('createAmbientTraffic requires a scene and terrainHeight(x,z)');
  }
  const routePaths = new Map(routes.map((route) => [route.id, sampleRoad(route)]));
  const sourceByType = new Map(parkedVehicles.filter((vehicle) => vehicle?.group)
    .map((vehicle) => [vehicle.type, vehicle]));
  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  const group = new THREE.Group();
  group.name = 'Island staff road traffic';
  scene.add(group);
  const vehicles = [];
  for (const spec of specs) {
    const path = routePaths.get(spec.routeId);
    if (!path) throw new Error(`Unknown ambient traffic road ${spec.routeId}`);
    const visual = makeCar(sourceByType.get(spec.sourceType), spec.id,
      ownedGeometries, ownedMaterials);
    group.add(visual.car);
    const vehicle = {
      id: spec.id, driver: 'Island staff', routeId: spec.routeId,
      width: 2.18, length: 5.15, group: visual.car,
      lampMaterial: visual.lampMaterial, brakeMaterial: visual.brakeMaterial,
      wheelLayers: visual.car.children.filter((part) => part.isInstancedMesh &&
        part.name.startsWith('Moving vehicle wheel layer'))
        .sort((a, b) => a.name.localeCompare(b.name)),
      wheelDummy: new THREE.Object3D(),
      path, spec, direction: 1, progress: path.length * spec.start,
      speed: 0, x: 0, y: 0, z: 0, heading: 0,
      visible: false, turnaroundWait: 0,
    };
    poseVehicle(vehicle, roadPose(path, vehicle.progress, vehicle.direction, spec.lane), terrainHeight);
    vehicle.group.visible = false;
    vehicles.push(vehicle);
  }

  function collides(x, z, radius = 0.35) {
    return vehicles.some((vehicle) => vehicle.visible &&
      carCircleHit(vehicle, x, z, Math.max(0, radius)));
  }

  function nearbyVehicle(x, z, range = 20) {
    let nearest = null;
    for (const vehicle of vehicles) {
      if (!vehicle.visible) continue;
      const distance = Math.hypot(x - vehicle.x, z - vehicle.z);
      if (distance <= range && (!nearest || distance < nearest.distance)) {
        nearest = { vehicle, distance, speed: vehicle.speed };
      }
    }
    return nearest;
  }

  function blocksMove(fromX, fromZ, toX, toZ, radius = 0.35) {
    const length = Math.hypot(toX - fromX, toZ - fromZ);
    const steps = Math.max(1, Math.ceil(length / 0.6));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (collides(fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t, radius)) return true;
    }
    return false;
  }

  function clearanceAhead(vehicle, player, playerVehicle) {
    const end = vehicle.direction > 0 ? vehicle.path.length * vehicle.spec.max
      : vehicle.path.length * vehicle.spec.min;
    const available = Math.max(0, (end - vehicle.progress) * vehicle.direction);
    const others = vehicles.filter((other) => other !== vehicle && other.visible);
    for (const ahead of [4, 8, 13, 18]) {
      if (ahead >= available) break;
      const pose = roadPose(vehicle.path, vehicle.progress + vehicle.direction * ahead,
        vehicle.direction, vehicle.spec.lane);
      if (actorDistance(pose, player) < (playerVehicle ? 8.0 : 5.8)) return ahead;
      if (parkedVehicles.some((parked) => actorDistance(pose, parked) <
        (parked.length || 5.15) * 0.5 + vehicle.length * 0.5 + 1.5)) return ahead;
      if (others.some((other) => actorDistance(pose, other) < 7.5)) return ahead;
      if (!isRoad(pose.x, pose.z, 0.3)) return ahead;
      if (typeof canPlace === 'function' &&
        !(ahead === 4 ? bodyFits(vehicle, pose, canPlace)
          : canPlace(pose.x, pose.z, vehicle, 0.55))) return ahead;
    }
    return Infinity;
  }

  function update(dt, {
    playerX, playerZ, playerVehicle = null,
    weather = 'mist', started = true,
  } = {}) {
    if (!Number.isFinite(dt) || dt < 0) return vehicles;
    if (!started) {
      for (const vehicle of vehicles) {
        vehicle.visible = false;
        vehicle.group.visible = false;
      }
      return vehicles;
    }
    const player = Number.isFinite(playerX) && Number.isFinite(playerZ)
      ? { x: playerX, z: playerZ } : null;
    const storm = weather === 'storm';
    const preferred = storm ? new Set() : new Set(vehicles.map((vehicle) => vehicle.id));
    const steps = Math.max(1, Math.ceil(Math.min(dt, 0.2) / 0.04));
    const h = Math.min(dt, 0.2) / steps;
    for (const vehicle of vehicles) {
      const permitted = preferred.has(vehicle.id);
      const farFromPlayer = actorDistance(vehicle, player) > 95 &&
        actorDistance(vehicle, playerVehicle) > 95;
      const firstStart = vehicle.neverActivated !== false;
      const safeToFirstAppear = actorDistance(vehicle, player) > 12 &&
        actorDistance(vehicle, playerVehicle) > 12;
      vehicle.neverActivated = false;
      if (!permitted && farFromPlayer) {
        vehicle.visible = false;
        vehicle.group.visible = false;
        vehicle.speed = 0;
        continue;
      }
      if (!vehicle.visible && permitted &&
        (firstStart ? safeToFirstAppear : farFromPlayer) &&
        bodyFits(vehicle, roadPose(vehicle.path, vehicle.progress,
          vehicle.direction, vehicle.spec.lane), canPlace) &&
        vehicles.filter((candidate) => candidate.visible).length < 2) {
        vehicle.visible = true;
        vehicle.group.visible = true;
      }
      if (!vehicle.visible) continue;
      if (storm) {
        vehicle.speed = 0;
        vehicle.brakeMaterial.emissiveIntensity = 0.85;
        vehicle.lampMaterial.emissiveIntensity = 1.4;
        continue;
      }
      const weatherFactor = weather === 'rain' ? 0.78 : 1;
      vehicle.lampMaterial.emissiveIntensity = storm ? 1.4 : weather === 'rain' ? 0.85 : 0.42;
      for (let i = 0; i < steps; i++) {
        if (vehicle.turnaroundWait > 0) {
          vehicle.turnaroundWait = Math.max(0, vehicle.turnaroundWait - h);
          vehicle.speed = 0;
          if (vehicle.turnaroundWait === 0 && farFromPlayer) {
            // Turn at a road terminus only when neither the player nor their
            // car is close enough to see the change in heading/lane.
            vehicle.direction *= -1;
            poseVehicle(vehicle, roadPose(vehicle.path, vehicle.progress,
              vehicle.direction, vehicle.spec.lane), terrainHeight);
          } else if (vehicle.turnaroundWait === 0) {
            vehicle.turnaroundWait = 0.2;
          }
          continue;
        }
        const clear = clearanceAhead(vehicle, player, playerVehicle);
        const end = vehicle.direction > 0 ? vehicle.path.length * vehicle.spec.max
          : vehicle.path.length * vehicle.spec.min;
        const distanceToEnd = Math.max(0, (end - vehicle.progress) * vehicle.direction);
        const target = permitted ? Math.min(vehicle.spec.cruise * weatherFactor,
          Math.max(0, clear - 5) * 0.82,
          Math.sqrt(2 * 3.4 * distanceToEnd)) : 0;
        vehicle.speed = approach(vehicle.speed, target, (target < vehicle.speed ? 4.5 : 2.1) * h);
        if (vehicle.speed < 0.03) { vehicle.speed = 0; continue; }
        const nextProgress = vehicle.progress + vehicle.direction * vehicle.speed * h;
        const pose = roadPose(vehicle.path, nextProgress, vehicle.direction, vehicle.spec.lane);
        if (!bodyFits(vehicle, pose, canPlace)) {
          vehicle.speed = 0;
          continue;
        }
        vehicle.progress = nextProgress;
        poseVehicle(vehicle, pose, terrainHeight);
        animateWheels(vehicle, vehicle.speed * h);
        const remainingAfterMove = vehicle.direction > 0
          ? vehicle.path.length * vehicle.spec.max - vehicle.progress
          : vehicle.progress - vehicle.path.length * vehicle.spec.min;
        if (remainingAfterMove < 1.0) {
          vehicle.progress = vehicle.path.length *
            (vehicle.direction > 0 ? vehicle.spec.max : vehicle.spec.min);
          poseVehicle(vehicle, roadPose(vehicle.path, vehicle.progress,
            vehicle.direction, vehicle.spec.lane), terrainHeight);
          vehicle.speed = 0;
          vehicle.turnaroundWait = 2.5;
        }
      }
      vehicle.brakeMaterial.emissiveIntensity = vehicle.speed < 1.5 ? 0.85 : 0.04;
    }
    return vehicles;
  }

  function dispose() {
    scene.remove(group);
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
  }

  return { group, vehicles, update, collides, blocksMove, nearbyVehicle, dispose };
}
