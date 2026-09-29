// Physical room envelopes are measured from the authored Blender buildings.
// +z is the side with their open front doors after glTF export.
export const BUILDING_SHAPES = Object.freeze({
  lodge: Object.freeze({ halfWidth: 8, halfDepth: 5.5, doorHalfWidth: 1.2, roofHalfWidth: 8.4, roofHalfDepth: 5.9 }),
  archive: Object.freeze({ halfWidth: 7, halfDepth: 4.5, doorHalfWidth: 1.2, roofHalfWidth: 7.4, roofHalfDepth: 4.9 }),
  tower: Object.freeze({ halfWidth: 3.75, halfDepth: 3.75, doorHalfWidth: 1.25, roofHalfWidth: 4.5, roofHalfDepth: 4.5 }),
  radio: Object.freeze({ halfWidth: 5.5, halfDepth: 4, doorHalfWidth: 1, roofHalfWidth: 5.75, roofHalfDepth: 4.25 }),
  pump: Object.freeze({ halfWidth: 5, halfDepth: 4, doorHalfWidth: 1.05, roofHalfWidth: 5.4, roofHalfDepth: 4.4 }),
});

export const PLAYER_RADIUS = 0.32;

const CIRCLE_CELL_SIZE = 24;
const staticCircleIndexes = new WeakMap();

/**
 * Snapshot authored, stationary tree and stone footprints once. Dynamic callers
 * can keep passing ordinary arrays to circlesBlock and retain linear semantics.
 */
export function createStaticCircleObstacles(obstacles) {
  const snapshot = Object.freeze(obstacles.map((obstacle) =>
    obstacle && typeof obstacle === 'object'
      ? Object.freeze({ ...obstacle }) : obstacle));
  const columns = new Map();
  let largestAbsoluteRadius = 0;
  for (const obstacle of snapshot) {
    if (!Number.isFinite(obstacle?.x) || !Number.isFinite(obstacle?.z)
      || !Number.isFinite(obstacle?.radius)) continue;
    largestAbsoluteRadius = Math.max(largestAbsoluteRadius, Math.abs(obstacle.radius));
    const column = Math.floor(obstacle.x / CIRCLE_CELL_SIZE);
    const row = Math.floor(obstacle.z / CIRCLE_CELL_SIZE);
    let rows = columns.get(column);
    if (!rows) {
      rows = new Map();
      columns.set(column, rows);
    }
    let bucket = rows.get(row);
    if (!bucket) {
      bucket = [];
      rows.set(row, bucket);
    }
    bucket.push(obstacle);
  }
  staticCircleIndexes.set(snapshot, { columns, largestAbsoluteRadius });
  return snapshot;
}

/** The west rail runs beside the south ferry berth; its east side stays open. */
export function southPierRailBlocks(x, z, radius = PLAYER_RADIUS) {
  if (![x, z, radius].every(Number.isFinite) || radius < 0) return false;
  const closestZ = Math.max(344.5, Math.min(355.5, z));
  const dx = x + 3.72;
  const dz = z - closestZ;
  const clearance = radius + 0.09;
  return dx * dx + dz * dz < clearance * clearance;
}

// Measured from archive() in tools/build_assets.py after Blender -Y becomes
// glTF +Z. Five shelf banks fill the back of the room; the table is in the
// front half. These are body footprints, not a wall across the open aisle.
export const ARCHIVE_FURNITURE = Object.freeze([
  ...[-5.8, -2.8, 0.2, 3.2, 5.9].map((x) => Object.freeze({
    id: `shelves_${x}`, x, z: -2.5, halfWidth: 0.9, halfDepth: 1.75,
  })),
  Object.freeze({ id: 'central_table', x: 0, z: 1, halfWidth: 1.2, halfDepth: 0.6 }),
]);

function archiveFootprintAt(site, x, z, radius = PLAYER_RADIUS) {
  if (site?.id !== 'archive' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  return ARCHIVE_FURNITURE.find((piece) =>
    Math.abs(x - site.x - piece.x) < piece.halfWidth + radius
    && Math.abs(z - site.z - piece.z) < piece.halfDepth + radius) ?? null;
}

export function archiveFurnitureBlocks(site, x, z, radius = PLAYER_RADIUS) {
  return archiveFootprintAt(site, x, z, radius) !== null;
}

/** A legacy save inside newly solid furniture can step toward clear floor.
 * Integrators should exempt archiveFurnitureBlocks from destination checks
 * only when this helper returns false for that same from/to step. */
export function archiveFurnitureBlocksMoveFrom(site, fromX, fromZ, toX, toZ,
  radius = PLAYER_RADIUS) {
  const destination = archiveFootprintAt(site, toX, toZ, radius);
  if (!destination) return false;
  const source = archiveFootprintAt(site, fromX, fromZ, radius);
  if (source !== destination) return true;
  const normalizedDistance = (x, z) => {
    const dx = (x - site.x - source.x) / (source.halfWidth + radius);
    const dz = (z - site.z - source.z) / (source.halfDepth + radius);
    return dx * dx + dz * dz;
  };
  return normalizedDistance(toX, toZ) <= normalizedDistance(fromX, fromZ) + 1e-8;
}

// Radio House local coordinates after the Blender -Y to glTF +Z conversion.
// The original receiver console is 5.6 x 1.15 m at (0, -1.5). The later
// witness worktable has a 1.55 x .88 m top at (-1.8, .1). Their raised tops
// are solid for the player's body, while both ends of the console stay open.
export const RADIO_FURNITURE = Object.freeze([
  Object.freeze({ id: 'receiver_console', x: 0, z: -1.5, halfWidth: 2.8, halfDepth: .575 }),
  Object.freeze({ id: 'witness_worktable', x: -1.8, z: .1, halfWidth: .775, halfDepth: .44 }),
]);

function radioFootprintAt(site, x, z, radius = PLAYER_RADIUS) {
  if (site?.id !== 'radio' || !Number.isFinite(x) || !Number.isFinite(z)) return [];
  return RADIO_FURNITURE.filter((piece) =>
    Math.abs(x - site.x - piece.x) < piece.halfWidth + radius
    && Math.abs(z - site.z - piece.z) < piece.halfDepth + radius);
}

export function radioFurnitureBlocks(site, x, z, radius = PLAYER_RADIUS) {
  return radioFootprintAt(site, x, z, radius).length > 0;
}

/** Old saves inside a new footprint can slide toward an edge and exit. */
export function radioFurnitureBlocksMoveFrom(site, fromX, fromZ, toX, toZ,
  radius = PLAYER_RADIUS) {
  const destination = radioFootprintAt(site, toX, toZ, radius);
  if (!destination.length) return false;
  const source = new Set(radioFootprintAt(site, fromX, fromZ, radius));
  for (const piece of destination) {
    if (!source.has(piece)) return true;
    const halfWidth = piece.halfWidth + radius;
    const halfDepth = piece.halfDepth + radius;
    const clearance = (x, z) => Math.max(
      Math.abs(x - site.x - piece.x) / halfWidth,
      Math.abs(z - site.z - piece.z) / halfDepth);
    if (clearance(toX, toZ) + 1e-6 < clearance(fromX, fromZ)) return true;
  }
  return false;
}

export function isInsideBuilding(site, x, z, inset = PLAYER_RADIUS) {
  const shape = BUILDING_SHAPES[site?.id];
  if (!shape) return false;
  return Math.abs(x - site.x) < shape.halfWidth - inset
    && Math.abs(z - site.z) < shape.halfDepth - inset;
}

export function isUnderBuildingRoof(site, x, z) {
  const shape = BUILDING_SHAPES[site?.id];
  if (!shape) return false;
  return Math.abs(x - site.x) < shape.roofHalfWidth
    && Math.abs(z - site.z) < shape.roofHalfDepth;
}

export function buildingWallBlocks(site, x, z, radius = PLAYER_RADIUS) {
  const shape = BUILDING_SHAPES[site?.id];
  if (!shape) return false;
  const dx = Math.abs(x - site.x);
  const dz = z - site.z;
  const adz = Math.abs(dz);
  // The space between the exterior envelope and the inner room represents
  // a solid wall. The only gap is the actual front doorway.
  const inOuter = dx < shape.halfWidth + radius && adz < shape.halfDepth + radius;
  const inInner = dx < shape.halfWidth - radius && adz < shape.halfDepth - radius;
  if (!inOuter || inInner) return false;
  const inDoorway = dz > shape.halfDepth - radius
    && dx < Math.max(0, shape.doorHalfWidth - radius);
  return !inDoorway;
}

export function circlesBlock(x, z, radius, obstacles = []) {
  const index = staticCircleIndexes.get(obstacles);
  if (index && Number.isFinite(x) && Number.isFinite(z)
    && Number.isFinite(radius) && radius >= 0) {
    // For a positive query radius, every possible hit lies within the query
    // radius plus the greatest absolute obstacle radius. Large/odd queries
    // use the original scan instead of walking an unbounded number of cells.
    const reach = radius + index.largestAbsoluteRadius;
    if (reach <= CIRCLE_CELL_SIZE * 8) {
      const minColumn = Math.floor((x - reach) / CIRCLE_CELL_SIZE);
      const maxColumn = Math.floor((x + reach) / CIRCLE_CELL_SIZE);
      const minRow = Math.floor((z - reach) / CIRCLE_CELL_SIZE);
      const maxRow = Math.floor((z + reach) / CIRCLE_CELL_SIZE);
      for (let column = minColumn; column <= maxColumn; column++) {
        const rows = index.columns.get(column);
        if (!rows) continue;
        for (let row = minRow; row <= maxRow; row++) {
          const bucket = rows.get(row);
          if (!bucket) continue;
          for (const obstacle of bucket) {
            const combined = radius + obstacle.radius;
            const dx = x - obstacle.x;
            const dz = z - obstacle.z;
            if (dx * dx + dz * dz < combined * combined) return true;
          }
        }
      }
      return false;
    }
  }
  for (const obstacle of obstacles) {
    if (!Number.isFinite(obstacle.x) || !Number.isFinite(obstacle.z)
      || !Number.isFinite(obstacle.radius)) continue;
    const combined = radius + obstacle.radius;
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    if (dx * dx + dz * dz < combined * combined) return true;
  }
  return false;
}

export function roofRectangles(sites) {
  return sites.flatMap((site) => {
    const shape = BUILDING_SHAPES[site.id];
    return shape ? [{ x: site.x, z: site.z, halfWidth: shape.roofHalfWidth, halfDepth: shape.roofHalfDepth }] : [];
  });
}
