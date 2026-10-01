import { playerStance } from './playerStance.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const ACCELERATION = 12;
const BRAKING = 18;
const STAMINA_DRAIN = 5.5;
const STAMINA_RECOVERY = 10;
const RECOVERY_DELAY = 0.9;
const EXHAUSTION_RECOVERY = 28;

/**
 * Input-to-velocity controller. The caller retains ownership of collision,
 * cliff falls, position and camera: move returns its collision-resolved delta.
 * Stamina follows actual movement, so pushing against a wall never drains it.
 */
export function createPlayerLocomotion() {
  let vx = 0;
  let vz = 0;
  let speed = 0;
  let sprintFactor = 0;
  let stamina = 100;
  let exhausted = false;
  let sprinting = false;
  let idleFor = RECOVERY_DELAY;

  const readState = () => ({ speed, sprintFactor, stamina, exhausted, sprinting, vx, vz });

  function reset({ refill = false } = {}) {
    vx = vz = speed = sprintFactor = 0;
    sprinting = false;
    if (refill) {
      stamina = 100;
      exhausted = false;
      idleFor = RECOVERY_DELAY;
    }
    return readState();
  }

  function recover(dt) {
    const previousIdle = idleFor;
    idleFor += dt;
    // Only the part of this step after the recovery delay contributes.
    const recoveryTime = Math.max(0, idleFor - RECOVERY_DELAY)
      - Math.max(0, previousIdle - RECOVERY_DELAY);
    stamina = Math.min(100, stamina + recoveryTime * STAMINA_RECOVERY);
    if (exhausted && stamina >= EXHAUSTION_RECOVERY) exhausted = false;
  }

  function step(dt, input = {}, move = () => ({ dx: 0, dz: 0 })) {
    const elapsed = clamp(finite(dt), 0, 0.05);
    if (input.active === false) {
      reset();
      recover(elapsed);
      return readState();
    }
    if (elapsed === 0) return readState();

    const posture = playerStance(input.stance);
    let forward = clamp(finite(input.forward), -1, 1);
    let side = clamp(finite(input.side), -1, 1);
    const inputLength = Math.hypot(forward, side);
    if (inputLength > 1) { forward /= inputLength; side /= inputLength; }
    const analog = Math.hypot(forward, side);
    const runEligible = Boolean(input.sprint) && forward > 0.1
      && (input.stance ?? 'stand') === 'stand' && !input.aiming
      && !input.reloading && !input.firing && !exhausted && stamina > 0;
    const directionalScale = analog === 0 ? 1 : 1 - 0.14 * Math.abs(side) / analog
      - 0.22 * Math.max(0, -forward) / analog;
    const weaponScale = clamp(finite(input.weaponMultiplier, 1), 0.35, 1);
    const baseSpeed = runEligible ? posture.runSpeed : posture.walkSpeed;
    const yaw = finite(input.yaw);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const dx = -sin * forward + cos * side;
    const dz = -cos * forward - sin * side;
    let slopeScale = 1;
    if (analog > 0 && typeof input.groundHeight === 'function') {
      const x = finite(input.x);
      const z = finite(input.z);
      try {
        const here = input.groundHeight(x, z);
        const ahead = input.groundHeight(x + dx / analog, z + dz / analog);
        if (Number.isFinite(here) && Number.isFinite(ahead)) {
          slopeScale = clamp(1 / (1 + Math.max(0, ahead - here) * 1.5), 0.45, 1);
        }
      } catch { /* Missing terrain samples keep the established speed limit. */ }
    }
    const targetSpeed = baseSpeed * directionalScale * weaponScale * slopeScale;
    const targetX = dx * targetSpeed;
    const targetZ = dz * targetSpeed;
    const differenceX = targetX - vx;
    const differenceZ = targetZ - vz;
    const difference = Math.hypot(differenceX, differenceZ);
    const targetMagnitude = Math.hypot(targetX, targetZ);
    const rate = targetMagnitude < Math.hypot(vx, vz) ? BRAKING : ACCELERATION;
    const increment = difference > 0 ? Math.min(1, rate * elapsed / difference) : 0;
    vx += differenceX * increment;
    vz += differenceZ * increment;
    const result = move(vx * elapsed, vz * elapsed) ?? {};
    // Resolve blocked components immediately, including both axes at a wall.
    vx = finite(result.dx) / elapsed;
    vz = finite(result.dz) / elapsed;
    speed = Math.hypot(vx, vz);
    const movingRun = runEligible && analog > 0
      && speed > Math.min(posture.walkSpeed * weaponScale * 0.98,
        targetMagnitude * 0.7);
    if (movingRun) {
      idleFor = 0;
      stamina = Math.max(0, stamina - STAMINA_DRAIN * elapsed);
      if (stamina === 0) exhausted = true;
    } else recover(elapsed);
    sprinting = movingRun && !exhausted;
    const sprintTarget = sprinting ? clamp(speed / Math.max(0.1, targetMagnitude), 0, 1) : 0;
    sprintFactor += (sprintTarget - sprintFactor) * (1 - Math.exp(-elapsed * 9));
    if (Math.abs(sprintFactor) < 1e-6) sprintFactor = 0;
    return readState();
  }

  return { step, reset, readState };
}
