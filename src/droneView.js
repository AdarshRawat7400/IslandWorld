// A camera-only exploration mode. Its position never becomes the player's
// position, so a flight cannot move the player's on-foot collision body.
export const DRONE_LIMITS = Object.freeze({
  horizontal: 560,
  minClearance: 16,
  launchClearance: 27,
  maxHeight: 220,
  cruiseSpeed: 29,
  boostSpeed: 62,
  maxStepSeconds: 0.05,
  maxPitch: 1.38,
  lookSensitivity: 0.0021,
});

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const axis = (value) => clamp(finiteOr(value, 0), -1, 1);

/**
 * Create a free-flying observer for the island and surrounding sea.
 * `terrainHeight` and `waterHeight` use the same x,z coordinates as the world.
 * Call `update` once per gameplay frame and `applyToCamera` after the normal
 * player-camera branch while active. The caller owns input and mode gating.
 */
export function createDroneView({ terrainHeight, waterHeight = () => 0 } = {}) {
  if (typeof terrainHeight !== 'function' || typeof waterHeight !== 'function') {
    throw new TypeError('Drone view requires terrain and water height functions');
  }

  let active = false;
  const position = { x: 0, y: 0, z: 0 };
  let yaw = 0;
  let pitch = -0.28;

  function floorAt(x, z) {
    return Math.max(finiteOr(terrainHeight(x, z), 0), finiteOr(waterHeight(x, z), 0));
  }

  function constrain() {
    position.x = clamp(position.x, -DRONE_LIMITS.horizontal, DRONE_LIMITS.horizontal);
    position.z = clamp(position.z, -DRONE_LIMITS.horizontal, DRONE_LIMITS.horizontal);
    position.y = clamp(position.y,
      floorAt(position.x, position.z) + DRONE_LIMITS.minClearance,
      DRONE_LIMITS.maxHeight);
  }

  return {
    get active() { return active; },
    pose() { return { ...position, yaw, pitch }; },

    /** Launch above the current location. The input object is never mutated. */
    enter({ x, z, y, yaw: heading = 0, pitch: aim = -0.28 } = {}) {
      if (active || !Number.isFinite(x) || !Number.isFinite(z)) return false;
      position.x = x;
      position.z = z;
      position.y = Math.max(floorAt(x, z) + DRONE_LIMITS.launchClearance,
        finiteOr(y, -Infinity) + DRONE_LIMITS.minClearance);
      yaw = finiteOr(heading, 0);
      pitch = clamp(finiteOr(aim, -0.28), -DRONE_LIMITS.maxPitch, DRONE_LIMITS.maxPitch);
      constrain();
      active = true;
      return true;
    },

    exit() {
      if (!active) return false;
      active = false;
      return true;
    },

    /** Use browser mouse/touch movement deltas, with the walking look convention. */
    look(dx, dy) {
      if (!active || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
      yaw -= dx * DRONE_LIMITS.lookSensitivity;
      pitch = clamp(pitch - dy * DRONE_LIMITS.lookSensitivity,
        -DRONE_LIMITS.maxPitch, DRONE_LIMITS.maxPitch);
      return true;
    },

    /**
     * WASD moves in the viewed direction, including climb/dive from camera
     * pitch. Space and Ctrl provide independent vertical ascent/descent.
     * Shift boosts speed. Diagonal input is normalized before applying speed.
     */
    update(dt, { forward = 0, sideways = 0, ascend = 0, descend = 0, boost = false } = {}) {
      if (!active) return false;
      const seconds = clamp(finiteOr(dt, 0), 0, DRONE_LIMITS.maxStepSeconds);
      const fw = axis(forward);
      const side = axis(sideways);
      const vertical = axis(ascend) - axis(descend);
      const cosPitch = Math.cos(pitch);
      let vx = -Math.sin(yaw) * cosPitch * fw + Math.cos(yaw) * side;
      let vy = Math.sin(pitch) * fw + vertical;
      let vz = -Math.cos(yaw) * cosPitch * fw - Math.sin(yaw) * side;
      const magnitude = Math.hypot(vx, vy, vz);
      if (magnitude > 1) {
        vx /= magnitude;
        vy /= magnitude;
        vz /= magnitude;
      }
      const distance = seconds * (boost ? DRONE_LIMITS.boostSpeed : DRONE_LIMITS.cruiseSpeed);
      position.x += vx * distance;
      position.y += vy * distance;
      position.z += vz * distance;
      constrain();
      return true;
    },

    /** Apply the isolated observer pose after the gameplay camera is set. */
    applyToCamera(camera) {
      if (!active) return false;
      camera.position.set(position.x, position.y, position.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
      return true;
    },
  };
}
