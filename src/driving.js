// Low-speed, kinematic driving for the island's three period vehicles.
// Coordinates are metres; a vehicle points along its local +z axis.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const approach = (value, target, step) => value < target
  ? Math.min(value + step, target) : Math.max(value - step, target);

const TUNING = Object.freeze({
  sedan: Object.freeze({ forward: 15, reverse: 4.5, acceleration: 4.6, wheelbase: 3.0 }),
  wagon: Object.freeze({ forward: 13, reverse: 4.1, acceleration: 4.1, wheelbase: 3.0 }),
  van: Object.freeze({ forward: 10.5, reverse: 3.5, acceleration: 3.3, wheelbase: 4.0 }),
});

function footprintFits(vehicle, x, z, heading, canPlace) {
  if (typeof canPlace !== 'function') return true;
  const side = Math.max(0.2, vehicle.width / 2 - 0.42);
  const end = Math.max(0.3, vehicle.length / 2 - 0.42);
  const sin = Math.sin(heading), cos = Math.cos(heading);
  for (const [localX, localZ] of [
    [0, 0], [-side, -end], [side, -end], [-side, end], [side, end],
    [0, -end], [0, end],
  ]) {
    const sampleX = x + localX * cos + localZ * sin;
    const sampleZ = z - localX * sin + localZ * cos;
    if (!canPlace(sampleX, sampleZ, vehicle, 0.42)) return false;
  }
  return true;
}

function gradeFits(vehicle, x, z, heading, terrainHeight) {
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const fore = vehicle.length * 0.34;
  const side = vehicle.width * 0.34;
  const heights = [
    terrainHeight(x, z),
    terrainHeight(x + sin * fore, z + cos * fore),
    terrainHeight(x - sin * fore, z - cos * fore),
    terrainHeight(x + cos * side, z - sin * side),
    terrainHeight(x - cos * side, z + sin * side),
  ];
  if (!heights.every(Number.isFinite)) return false;
  const along = Math.abs(heights[1] - heights[2]) / (fore * 2);
  const across = Math.abs(heights[3] - heights[4]) / (side * 2);
  return along <= 0.38 && across <= 0.42;
}

function placeVehicle(vehicle, terrainHeight) {
  const { x, z, heading, group, collider } = vehicle;
  const y = terrainHeight(x, z) + 0.045;
  vehicle.y = y;
  group.position.set(x, y, z);
  group.rotation.order = 'YXZ';
  group.rotation.y = heading;
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const length = vehicle.length * 0.38;
  const width = vehicle.width * 0.34;
  const front = terrainHeight(x + sin * length, z + cos * length);
  const rear = terrainHeight(x - sin * length, z - cos * length);
  const right = terrainHeight(x + cos * width, z - sin * width);
  const left = terrainHeight(x - cos * width, z + sin * width);
  group.rotation.x = clamp(-Math.atan2(front - rear, length * 2), -0.16, 0.16);
  group.rotation.z = clamp(Math.atan2(right - left, width * 2), -0.14, 0.14);
  collider.x = x;
  collider.z = z;
  collider.rotation = heading;
}

/**
 * `vehicles` are the live records returned by createSetDressing().
 * `canPlace(x,z,vehicle,radius)` tests terrain and obstacles, excluding
 * `vehicle.id` from the dressing's own collision query.
 */
export function createDriving(vehicles, terrainHeight, { onRoad = () => true } = {}) {
  if (!Array.isArray(vehicles) || typeof terrainHeight !== 'function') {
    throw new TypeError('createDriving requires vehicle records and terrainHeight(x,z)');
  }
  let active = null;
  for (const vehicle of vehicles) {
    if (!vehicle.group || !vehicle.collider || !TUNING[vehicle.type]) {
      throw new TypeError(`Vehicle ${vehicle.id || '?'} lacks a movable group, collider, or type`);
    }
    vehicle.speed = 0;
    vehicle.steering = 0;
    vehicle.setBrakeLights?.(false);
    placeVehicle(vehicle, terrainHeight);
  }

  function nearbyVehicle(x, z, range = 5.2) {
    if (active) return null;
    let closest = null;
    for (const vehicle of vehicles) {
      const distance = Math.hypot(x - vehicle.x, z - vehicle.z);
      if (distance <= range && (!closest || distance < closest.distance)) {
        closest = { vehicle, distance };
      }
    }
    return closest;
  }

  function enter(id) {
    if (active) return false;
    const vehicle = vehicles.find((candidate) => candidate.id === id);
    if (!vehicle) return false;
    vehicle.speed = 0;
    vehicle.steering = 0;
    vehicle.setBrakeLights?.(false);
    active = vehicle;
    return true;
  }

  function exit(canStandAt = () => true) {
    if (!active || Math.abs(active.speed) > 0.75) return null;
    const vehicle = active;
    const side = vehicle.width / 2 + 1.1;
    const rear = vehicle.length / 2 + 1.0;
    const sin = Math.sin(vehicle.heading), cos = Math.cos(vehicle.heading);
    for (const [localX, localZ] of [
      [-side, -0.55], [side, -0.55], [-side, 0.8], [side, 0.8],
      [0, -rear], [0, rear],
    ]) {
      const x = vehicle.x + localX * cos + localZ * sin;
      const z = vehicle.z - localX * sin + localZ * cos;
      if (!canStandAt(x, z)) continue;
      active = null;
      vehicle.speed = 0;
      vehicle.steering = 0;
      vehicle.setBrakeLights?.(false);
      return { x, z, yaw: vehicle.heading + Math.PI };
    }
    return null;
  }

  function update(dt, { throttle = 0, steer = 0, brake = false } = {}, canPlace) {
    if (!active || !Number.isFinite(dt) || dt <= 0) return active;
    const vehicle = active;
    const tuning = TUNING[vehicle.type];
    vehicle.setBrakeLights?.(brake || (throttle < -0.05 && vehicle.speed > 0.1));
    const steps = Math.max(1, Math.ceil(Math.min(dt, 0.08) / (1 / 60)));
    const h = Math.min(dt, 0.08) / steps;
    for (let i = 0; i < steps; i++) {
      const road = onRoad(vehicle.x, vehicle.z);
      const roadFactor = road ? 1 : 0.64;
      const grip = road ? 1 : 0.72;
      const pedal = clamp(Number(throttle) || 0, -1, 1);
      const turn = clamp(Number(steer) || 0, -1, 1);
      if (brake) vehicle.speed = approach(vehicle.speed, 0, 10 * grip * h);
      else if (Math.abs(pedal) > 0.05) {
        vehicle.speed += pedal * tuning.acceleration * (pedal < 0 ? 0.8 : 1) * grip * h;
      } else {
        vehicle.speed = approach(vehicle.speed, 0, (0.85 + Math.abs(vehicle.speed) * 0.16) * h);
      }
      vehicle.speed = clamp(vehicle.speed, -tuning.reverse * roadFactor,
        tuning.forward * roadFactor);
      const maxSteering = 0.5 / (1 + Math.abs(vehicle.speed) * 0.045);
      vehicle.steering = approach(vehicle.steering, turn * maxSteering,
        1.9 * grip * h);
      // The car faces local +Z. From its chase camera, a right turn rotates
      // toward local -X, which is negative Three.js yaw.
      const yawRate = -vehicle.speed / tuning.wheelbase * Math.tan(vehicle.steering);
      const nextHeading = vehicle.heading + yawRate * h;
      const midHeading = (vehicle.heading + nextHeading) / 2;
      const x = vehicle.x + Math.sin(midHeading) * vehicle.speed * h;
      const z = vehicle.z + Math.cos(midHeading) * vehicle.speed * h;
      if (gradeFits(vehicle, x, z, nextHeading, terrainHeight) &&
        footprintFits(vehicle, x, z, nextHeading, canPlace)) {
        vehicle.x = x;
        vehicle.z = z;
        vehicle.heading = nextHeading;
        placeVehicle(vehicle, terrainHeight);
      } else {
        vehicle.speed = 0;
        break;
      }
      vehicle.animateWheels?.(vehicle.speed, -vehicle.steering, h);
    }
    return vehicle;
  }

  function cameraPose() {
    if (!active) return null;
    const vehicle = active;
    const sin = Math.sin(vehicle.heading), cos = Math.cos(vehicle.heading);
    const back = vehicle.type === 'van' ? 9.5 : 7.5;
    return {
      position: { x: vehicle.x - sin * back, y: vehicle.y + 3.45,
        z: vehicle.z - cos * back },
      target: { x: vehicle.x + sin * 2, y: vehicle.y + 1.45,
        z: vehicle.z + cos * 2 },
    };
  }

  function snapshot() {
    return {
      vehicles: vehicles.map(({ id, x, z, heading }) => ({ id, x, z, heading })),
      activeId: active?.id ?? null,
    };
  }

  function restore(saved, canPlace) {
    const positions = Array.isArray(saved) ? saved : saved?.vehicles;
    if (!Array.isArray(positions)) return 0;
    const restoredIds = new Set();
    let count = 0;
    for (const item of positions) {
      const vehicle = vehicles.find((candidate) => candidate.id === item?.id);
      if (!vehicle || ![item.x, item.z, item.heading].every(Number.isFinite)) continue;
      if (!gradeFits(vehicle, item.x, item.z, item.heading, terrainHeight) ||
        !footprintFits(vehicle, item.x, item.z, item.heading, canPlace)) continue;
      vehicle.x = item.x;
      vehicle.z = item.z;
      vehicle.heading = item.heading;
      vehicle.speed = 0;
      vehicle.steering = 0;
      vehicle.setBrakeLights?.(false);
      placeVehicle(vehicle, terrainHeight);
      restoredIds.add(vehicle.id);
      count++;
    }
    if (saved?.activeId && restoredIds.has(saved.activeId)) {
      active = vehicles.find((vehicle) => vehicle.id === saved.activeId) || null;
    }
    return count;
  }

  return {
    vehicles,
    get active() { return active; },
    nearbyVehicle, enter, exit, update, cameraPose, snapshot, restore,
  };
}
