import { PRISON_LAYOUT } from '../src/setDressing.js';
import { MAIN_LIGHTHOUSE_SITE, SITES } from '../src/worldSites.js';
export { shotBlockedByTerrain } from '../src/world.js';

// Coarse server-side solid footprints for buildings. The rendered structures
// have more detailed doors and windows; conservative occlusion only rejects a
// shot crossing a full footprint with both players outside it.
const BASE_Y = Object.freeze({ lodge: 31, archive: 37, tower: 48, radio: 39, pump: 33 });
const SOLIDS = SITES.filter((site) => site.kind === 'building' && BASE_Y[site.id] !== undefined)
  .map((site) => ({ minX: site.x - site.scale[0] * 0.52,
    maxX: site.x + site.scale[0] * 0.52,
    minZ: site.z - site.scale[1] * 0.52,
    maxZ: site.z + site.scale[1] * 0.52,
    lowY: BASE_Y[site.id] - 0.5, highY: BASE_Y[site.id] + 13 }));

const wall = (x0, z0, x1, z1, thickness, lowY, highY) => ({
  minX: Math.min(x0, x1) - thickness / 2,
  maxX: Math.max(x0, x1) + thickness / 2,
  minZ: Math.min(z0, z1) - thickness / 2,
  maxZ: Math.max(z0, z1) + thickness / 2,
  lowY, highY,
});

const prison = PRISON_LAYOUT;
const prisonGround = (z) => 43.2 + (105 - z) * (3.8 / 95);
function fence(x0, z0, x1, z1) {
  const low = Math.min(prisonGround(z0), prisonGround(z1));
  const high = Math.max(prisonGround(z0), prisonGround(z1));
  return wall(x0, z0, x1, z1, 0.7, low - 0.45, high + 4.85);
}

function prisonBuildingWalls(spec, floorY, roofY, openingHalfWidth, openingHeadY) {
  const x0 = spec.x - spec.width / 2, x1 = spec.x + spec.width / 2;
  const z0 = spec.z - spec.depth / 2, z1 = spec.z + spec.depth / 2;
  const gap0 = spec.x - openingHalfWidth, gap1 = spec.x + openingHalfWidth;
  return [
    wall(x0, z0, x1, z0, 0.5, floorY, roofY),
    wall(x0, z0, x0, z1, 0.5, floorY, roofY),
    wall(x1, z0, x1, z1, 0.5, floorY, roofY),
    wall(x0, z1, gap0, z1, 0.5, floorY, roofY),
    wall(gap1, z1, x1, z1, 0.5, floorY, roofY),
    // The front opening is usable at body height; masonry above it is solid.
    wall(gap0, z1, gap1, z1, 0.5, openingHeadY, roofY),
  ];
}

const { minX, maxX, minZ, maxZ } = prison.bounds;
const gateLeft = prison.gate.x - prison.gate.width / 2;
const gateRight = prison.gate.x + prison.gate.width / 2;
const PRISON_SOLIDS = [
  fence(minX, minZ, maxX, minZ),
  fence(minX, minZ, minX, maxZ),
  fence(maxX, minZ, maxX, maxZ),
  fence(minX, maxZ, gateLeft, maxZ),
  fence(gateRight, maxZ, maxX, maxZ),
  wall(gateLeft - 0.34, maxZ, gateLeft - 0.34, maxZ, 1.1, 42.7, 48.3),
  wall(gateRight + 0.34, maxZ, gateRight + 0.34, maxZ, 1.1, 42.7, 48.3),
  ...prisonBuildingWalls(prison.cellBlock, 45.5, 55, 4, 49.7),
  ...prisonBuildingWalls(prison.clinic, 43.8, 51.5, 1.6, 48.1),
  ...prisonBuildingWalls(prison.administration, 43.8, 51.5, 1.6, 48.1),
];

const LIGHTHOUSE_GROUND_Y = 36.46; // sampled from the authored headland site
const LIGHTHOUSE = { x: MAIN_LIGHTHOUSE_SITE.x, z: MAIN_LIGHTHOUSE_SITE.z };
const LIGHTHOUSE_PARTS = [
  { radius: MAIN_LIGHTHOUSE_SITE.radius, lowY: LIGHTHOUSE_GROUND_Y,
    highY: LIGHTHOUSE_GROUND_Y + 2.4 },
  { radius: 5.4, lowY: LIGHTHOUSE_GROUND_Y + 2.4,
    highY: LIGHTHOUSE_GROUND_Y + 27.5 },
];

const inside = (point, box) => point.x >= box.minX && point.x <= box.maxX
  && point.z >= box.minZ && point.z <= box.maxZ;

function segmentRectInterval(a, b, box) {
  let enter = 0, leave = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [p, q] of [
    [-dx, a.x - box.minX], [dx, box.maxX - a.x],
    [-dz, a.z - box.minZ], [dz, box.maxZ - a.z],
  ]) {
    if (Math.abs(p) < 1e-8) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) enter = Math.max(enter, r);
    else leave = Math.min(leave, r);
    if (enter > leave) return null;
  }
  return [enter, leave];
}

function segmentCylinderIntersects(origin, target, center, part) {
  const ox = origin.x - center.x, oz = origin.z - center.z;
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const a = dx * dx + dz * dz;
  const c = ox * ox + oz * oz - part.radius * part.radius;
  let enter = 0, leave = 1;
  if (a < 1e-8) {
    if (c > 0) return false;
  } else {
    const b = 2 * (ox * dx + oz * dz);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return false;
    const root = Math.sqrt(discriminant);
    enter = Math.max(0, (-b - root) / (2 * a));
    leave = Math.min(1, (-b + root) / (2 * a));
    if (enter > leave) return false;
  }
  const dy = target.y - origin.y;
  if (Math.abs(dy) < 1e-8) {
    return origin.y >= part.lowY && origin.y <= part.highY;
  }
  const low = (part.lowY - origin.y) / dy;
  const high = (part.highY - origin.y) / dy;
  return Math.max(enter, Math.min(low, high))
    <= Math.min(leave, Math.max(low, high));
}

export function shotBlockedByStructures(origin, target) {
  for (const solid of SOLIDS) {
    if (inside(origin, solid) || inside(target, solid)) continue;
    const interval = segmentRectInterval(origin, target, solid);
    if (!interval) continue;
    const mid = (interval[0] + interval[1]) / 2;
    const y = origin.y + (target.y - origin.y) * mid;
    if (y >= solid.lowY && y <= solid.highY) return true;
  }
  for (const solid of PRISON_SOLIDS) {
    const interval = segmentRectInterval(origin, target, solid);
    if (!interval) continue;
    const mid = (interval[0] + interval[1]) / 2;
    const y = origin.y + (target.y - origin.y) * mid;
    if (y >= solid.lowY && y <= solid.highY) return true;
  }
  if (LIGHTHOUSE_PARTS.some((part) =>
    segmentCylinderIntersects(origin, target, LIGHTHOUSE, part))) return true;
  return false;
}
