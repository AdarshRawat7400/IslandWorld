// Pure coastal movement and fall rules. World units are metres. The terrain's
// normalized coastal radius is provided by world.coastalRadius, which uses the
// same irregular shoreline as the visible rock face and ocean shader.
export const CLIFF_FALL = Object.freeze({
  lipRadius: 0.981,
  safeRadius: 0.94,
  minimumCliffHeight: 14,
  maximumStep: 1.2,
  eyeHeight: 1.88,
  outwardSpeed: 5.2,
  gravity: 19.6,
  impactSeconds: 0.55,
  maximumFallSeconds: 4,
});

const finitePoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.z);
const pointCopy = (point) => ({ x: point.x, z: point.z });
const at = (fn, point) => fn(point.x, point.z);

/**
 * Classify only the coastline. The caller must still apply building, prop,
 * vegetation and person collision to both ordinary ground and cliff ledges.
 * The high cap can be approached beyond the former .955 walk limit; stepping
 * outward over its lip begins a fall. Low coves keep the world's graded access.
 */
export function classifyCoastalStep(from, to, world) {
  if (!finitePoint(from) || !finitePoint(to)
    || typeof world?.isWalkable !== 'function'
    || typeof world?.terrainHeight !== 'function'
    || typeof world?.coastalRadius !== 'function') return { kind: 'blocked' };
  if (Math.hypot(to.x - from.x, to.z - from.z) > CLIFF_FALL.maximumStep) {
    return { kind: 'blocked' };
  }
  if (world.isPier?.(to.x, to.z) || at(world.isWalkable, to)) return { kind: 'ground' };

  const fromRadius = at(world.coastalRadius, from);
  const radius = at(world.coastalRadius, to);
  const fromHeight = at(world.terrainHeight, from);
  const height = at(world.terrainHeight, to);
  if (![fromRadius, radius, fromHeight, height].every(Number.isFinite)
    || fromRadius >= CLIFF_FALL.lipRadius
    || radius >= 1.005
    || fromHeight < CLIFF_FALL.minimumCliffHeight
    || height < CLIFF_FALL.minimumCliffHeight) return { kind: 'blocked' };
  if (radius < CLIFF_FALL.lipRadius) return { kind: 'ledge' };
  return radius > fromRadius ? { kind: 'fall' } : { kind: 'blocked' };
}

export function createCliffFallState(fallback = { x: 0, z: 270 }) {
  return {
    phase: 'grounded', phaseTime: 0,
    position: null, eyeY: null, downwardSpeed: 0,
    outwardX: 0, outwardZ: 0,
    lastSafe: null,
    fallback: finitePoint(fallback) ? pointCopy(fallback) : { x: 0, z: 270 },
  };
}

function safeGround(point, world, canStand = () => true) {
  if (!finitePoint(point) || typeof world?.isWalkable !== 'function'
    || typeof world?.coastalRadius !== 'function'
    || typeof world?.terrainHeight !== 'function') return false;
  const pier = world.isPier?.(point.x, point.z) === true;
  const radius = at(world.coastalRadius, point);
  const height = at(world.terrainHeight, point);
  return Number.isFinite(radius) && Number.isFinite(height)
    && (pier || (radius <= CLIFF_FALL.safeRadius && at(world.isWalkable, point)))
    && canStand(point.x, point.z) === true;
}

/** Cache an inland position for a local respawn. Cliff ledges are never cached. */
export function rememberSafeGround(state, point, world, canStand) {
  if (state.phase !== 'grounded' || !safeGround(point, world, canStand)) return state;
  if (state.lastSafe?.x === point.x && state.lastSafe?.z === point.z) return state;
  return { ...state, lastSafe: pointCopy(point) };
}

/** Validate the cached position again, since obstacles or saved state may change. */
export function resolveSafeRespawn(state, world, canStand) {
  for (const point of [state.lastSafe, state.fallback, { x: 0, z: 270 }, { x: 0, z: 0 }]) {
    if (safeGround(point, world, canStand)) return pointCopy(point);
  }
  return null;
}

function fallDirection(from, to, world) {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const stepX = (to.x - from.x) / length;
  const stepZ = (to.z - from.z) / length;
  // A mostly tangential step can just cross the lip. Carrying that movement
  // unchanged would drop the camera into the rock face. A radial direction
  // always points beyond this island's star-shaped shoreline; when available,
  // the radius gradient follows the local irregular coast more closely.
  const radialLength = Math.hypot(to.x, to.z);
  let outwardX = radialLength > 1 ? to.x / radialLength : stepX;
  let outwardZ = radialLength > 1 ? to.z / radialLength : stepZ;
  if (typeof world?.coastalRadius === 'function') {
    const delta = 0.5;
    const gx = (world.coastalRadius(to.x + delta, to.z)
      - world.coastalRadius(to.x - delta, to.z)) / (2 * delta);
    const gz = (world.coastalRadius(to.x, to.z + delta)
      - world.coastalRadius(to.x, to.z - delta)) / (2 * delta);
    const gradientLength = Math.hypot(gx, gz);
    if (Number.isFinite(gradientLength) && gradientLength > 1e-7) {
      outwardX = gx / gradientLength;
      outwardZ = gz / gradientLength;
    }
  }
  const blendedX = outwardX * 0.9 + stepX * 0.1;
  const blendedZ = outwardZ * 0.9 + stepZ * 0.1;
  const blendedLength = Math.hypot(blendedX, blendedZ);
  return { x: blendedX / blendedLength, z: blendedZ / blendedLength };
}

/** Begin a camera fall from the height of the last supported foot position. */
export function beginCliffFall(state, from, to, groundHeight, world) {
  if (state.phase !== 'grounded' || !finitePoint(from) || !finitePoint(to)
    || !Number.isFinite(groundHeight)) return state;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  if (length < 1e-6) return state;
  const direction = fallDirection(from, to, world);
  return {
    ...state, phase: 'falling', phaseTime: 0,
    position: pointCopy(to), eyeY: groundHeight + CLIFF_FALL.eyeHeight,
    downwardSpeed: 0,
    outwardX: direction.x,
    outwardZ: direction.z,
  };
}

/**
 * Tick the fall independently of terrain snapping and player input. Returns
 * `impact` once at the water and `respawn` once after the short splash hold.
 * If no safe position exists, it holds the impact instead of teleporting into
 * sea or solid geometry. The world sampler can use its live swell height.
 */
export function advanceCliffFall(state, dt, world, canStand) {
  if (!state || state.phase === 'grounded') return { state, event: null, respawn: null };
  const step = Number.isFinite(dt) ? Math.min(0.05, Math.max(0, dt)) : 0;
  if (state.phase === 'falling') {
    if (step === 0) return { state, event: null, respawn: null };
    const position = {
      x: state.position.x + state.outwardX * CLIFF_FALL.outwardSpeed * step,
      z: state.position.z + state.outwardZ * CLIFF_FALL.outwardSpeed * step,
    };
    const eyeY = state.eyeY - state.downwardSpeed * step
      - 0.5 * CLIFF_FALL.gravity * step * step;
    const downwardSpeed = state.downwardSpeed + CLIFF_FALL.gravity * step;
    const phaseTime = state.phaseTime + step;
    const sampledWater = typeof world?.waterHeight === 'function'
      ? at(world.waterHeight, position) : 0;
    const water = Number.isFinite(sampledWater) ? sampledWater : 0;
    if (eyeY <= water + CLIFF_FALL.eyeHeight
      || phaseTime >= CLIFF_FALL.maximumFallSeconds) {
      return {
        state: { ...state, phase: 'impact', phaseTime: 0,
          position, eyeY: water + CLIFF_FALL.eyeHeight, downwardSpeed },
        event: 'impact', respawn: null,
      };
    }
    return { state: { ...state, position, eyeY, downwardSpeed, phaseTime },
      event: null, respawn: null };
  }
  if (state.phase === 'impact') {
    const phaseTime = Math.min(CLIFF_FALL.impactSeconds, state.phaseTime + step);
    if (phaseTime < CLIFF_FALL.impactSeconds) {
      return { state: { ...state, phaseTime }, event: null, respawn: null };
    }
    const respawn = resolveSafeRespawn(state, world, canStand);
    if (!respawn) return { state: { ...state, phaseTime }, event: null, respawn: null };
    return {
      state: { ...state, phase: 'grounded', phaseTime: 0,
        position: null, eyeY: null, downwardSpeed: 0, outwardX: 0, outwardZ: 0 },
      event: 'respawn', respawn,
    };
  }
  return { state, event: null, respawn: null };
}

/** Optional camera tilt and splash fade for the first-person presentation. */
export function cliffFallPresentation(state) {
  if (state?.phase === 'falling') {
    const t = state.phaseTime;
    return {
      x: state.position.x, y: state.eyeY, z: state.position.z,
      roll: Math.min(0.25, t * 0.14) * Math.sin(t * 4.2),
      pitchOffset: Math.min(0.32, t * 0.17),
      darkness: 0,
    };
  }
  if (state?.phase === 'impact') {
    return {
      x: state.position.x, y: state.eyeY, z: state.position.z,
      roll: 0.12, pitchOffset: 0.28,
      darkness: Math.min(1, 0.3 + state.phaseTime / CLIFF_FALL.impactSeconds),
    };
  }
  return null;
}
