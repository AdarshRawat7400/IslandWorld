import { playerStance } from './playerStance.js';

// Shared room and combat constants. World units are metres.
export const MAX_ROOM_PLAYERS = 10;
export const MAX_HEALTH = 100;
export const RESPAWN_DELAY_MS = 3000;
export const SPAWN_PROTECTION_MS = 5000;
export const RECONNECT_GRACE_MS = 120000;

export const WEAPONS = Object.freeze({
  revolver: Object.freeze({ label: 'Service Revolver', magazine: 6, reserve: 36,
    reloadMs: 1800, fireIntervalMs: 320, damage: 34, range: 65,
    automatic: false, recoil: 1, movementMultiplier: 1, spread: 0.005 }),
  rifle: Object.freeze({ label: 'Hunting Rifle', magazine: 5, reserve: 25,
    reloadMs: 2400, fireIntervalMs: 850, damage: 60, range: 130,
    automatic: false, recoil: 1.4, movementMultiplier: 1, spread: 0.003 }),
  shotgun: Object.freeze({ label: 'Pump Shotgun', magazine: 5, reserve: 25,
    reloadMs: 2600, fireIntervalMs: 900, damage: 78, range: 32,
    automatic: false, recoil: 1.7, movementMultiplier: 0.96, spread: 0.02 }),
  smg: Object.freeze({ label: 'Patrol SMG', magazine: 30, reserve: 150,
    reloadMs: 2250, fireIntervalMs: 100, damage: 18, range: 70,
    automatic: true, recoil: 0.55, movementMultiplier: 0.98, spread: 0.012 }),
  lmg: Object.freeze({ label: 'Support LMG', magazine: 60, reserve: 180,
    reloadMs: 3600, fireIntervalMs: 125, damage: 24, range: 110,
    automatic: true, recoil: 0.85, movementMultiplier: 0.84, spread: 0.018 }),
});

export const EXPLOSIVES = Object.freeze({
  grenade: Object.freeze({ maxRange: 24, fuseMs: 2200, radius: 7,
    damage: 90, minDamage: 18 }),
  mine: Object.freeze({ maxPlacement: 3, armMs: 900, triggerRadius: 2,
    radius: 5, damage: 85, minDamage: 18, ttlMs: 120000 }),
});

export function blastDamageAt(distance, explosive) {
  if (!Number.isFinite(distance) || distance < 0 || distance > explosive.radius) return 0;
  return Math.round(explosive.damage
    - (explosive.damage - explosive.minDamage) * distance / explosive.radius);
}

// Established flat or graded paths, away from the cliff lip and lake.
export const SAFE_SPAWNS = Object.freeze([
  Object.freeze({ x: 0, z: 270 }), // South Landing
  Object.freeze({ x: -110, z: 167 }), // Keeper's road shoulder
  Object.freeze({ x: -151, z: 89 }), // Archive road shoulder
  Object.freeze({ x: -185, z: -28 }), // West coast road shoulder
  Object.freeze({ x: 30, z: -212 }), // Signal tower road shoulder
  Object.freeze({ x: 166, z: -74 }), // Radio approach shoulder
  Object.freeze({ x: 148, z: 113 }), // Pump approach shoulder
]);

// Online arrivals gather around the established South Landing start instead
// of appearing on opposite sides of the island. All ten clearings are on the
// authored footpath's graded ground and keep players at least 3 m apart.
export const ARRIVAL_SPAWNS = Object.freeze([
  Object.freeze({ x: 0, z: 270 }),
  Object.freeze({ x: 6, z: 270 }),
  Object.freeze({ x: -6, z: 270 }),
  Object.freeze({ x: 0, z: 266 }),
  Object.freeze({ x: 3, z: 266 }),
  Object.freeze({ x: -3, z: 266 }),
  Object.freeze({ x: 0, z: 274 }),
  Object.freeze({ x: 3, z: 274 }),
  Object.freeze({ x: -3, z: 274 }),
  Object.freeze({ x: 3, z: 270 }),
]);

export const WORLD_LIMIT = 380;
export const VALID_WEATHER = Object.freeze(['auto', 'clear', 'mist', 'rain', 'storm']);
export const VALID_TIME = Object.freeze(['auto', 'dawn', 'noon', 'dusk', 'night']);

export function cleanPlayerName(value) {
  return typeof value === 'string'
    ? value.replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, 24) || 'Explorer'
    : 'Explorer';
}

export function validWorldPosition(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.z)
    && Number.isFinite(point.y) && Math.abs(point.x) <= WORLD_LIMIT
    && Math.abs(point.z) <= WORLD_LIMIT && point.y >= -12 && point.y <= 180;
}

export function normalizedDirection(direction) {
  if (!direction || ![direction.x, direction.y, direction.z].every(Number.isFinite)) return null;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 0.95 || length > 1.05) return null;
  return { x: direction.x / length, y: direction.y / length, z: direction.z / length };
}

// Hitscan against a human-sized upright capsule. Returns the distance along
// the shot ray, or null. The server chooses the first qualifying player.
export function rayPlayerHit(origin, direction, target, range, radius = 0.48) {
  if (!validWorldPosition(origin) || !normalizedDirection(direction)
    || !validWorldPosition(target) || !Number.isFinite(range)) return null;
  // Aiming at a vertical cylinder gives a generous, consistent multiplayer hitbox.
  const rx = target.x - origin.x;
  const rz = target.z - origin.z;
  const horizontalSq = direction.x ** 2 + direction.z ** 2;
  if (horizontalSq < 1e-6) return null;
  const projected = (rx * direction.x + rz * direction.z) / horizontalSq;
  if (projected < 0 || projected > range) return null;
  const dx = origin.x + projected * direction.x - target.x;
  const dz = origin.z + projected * direction.z - target.z;
  const hitbox = playerStance(target.stance);
  const effectiveRadius = Math.max(radius, hitbox.hitRadius);
  if (dx * dx + dz * dz > effectiveRadius * effectiveRadius) return null;
  const hitY = origin.y + projected * direction.y;
  // Network positions use eye height; the collision volume extends below it.
  if (hitY < target.y - hitbox.hitHeight || hitY > target.y + 0.3) return null;
  return projected;
}

// Wildlife target centers and radii are generated by fauna.js for both the
// room server and the client. Return the first ray/sphere intersection, so a
// bird in flight and a smaller rabbit have appropriately different hitboxes.
export function rayWildlifeHit(origin, direction, target, range) {
  const ray = normalizedDirection(direction);
  if (!validWorldPosition(origin) || !ray || !target
    || ![target.x, target.y, target.z, target.radius, range].every(Number.isFinite)
    || target.radius <= 0 || range < 0) return null;
  const ox = origin.x - target.x;
  const oy = origin.y - target.y;
  const oz = origin.z - target.z;
  const projection = ox * ray.x + oy * ray.y + oz * ray.z;
  const distanceSquared = ox * ox + oy * oy + oz * oz;
  const discriminant = projection * projection
    - (distanceSquared - target.radius * target.radius);
  if (discriminant < 0) return null;
  const first = -projection - Math.sqrt(discriminant);
  const distance = first >= 0 ? first : distanceSquared <= target.radius ** 2 ? 0 : null;
  return distance !== null && distance <= range ? distance : null;
}
