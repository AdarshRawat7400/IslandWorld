const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
export const HUMAN_COLLAPSE_SECONDS = 1.35;

// Visual state only. Health and death remain owned by the game/server.
// No timers or physics bodies: one bounded pose advances with the existing loop.
export function createHumanReaction(seed = 0) {
  return { dead: false, deathTime: 0, hitTime: Infinity, strength: 1,
    fallX: (seed % 3 - 1) * 0.28, fallZ: seed % 2 ? -1 : 1 };
}

export function resetHumanReaction(reaction) {
  reaction.dead = false;
  reaction.deathTime = 0;
  reaction.hitTime = Infinity;
}

export function triggerHumanHit(reaction, { direction, heading = 0, damage = 25 } = {}) {
  // A hit received after the authoritative death snapshot must not restart it.
  if (reaction.dead && reaction.deathTime > 0.18) return;
  reaction.hitTime = 0;
  reaction.strength = clamp((Number.isFinite(damage) ? damage : 25) / 40, 0.55, 1.2);
  if (Number.isFinite(direction?.x) && Number.isFinite(direction?.z)) {
    const length = Math.hypot(direction.x, direction.z);
    if (length > 0.001) {
      const c = Math.cos(heading), s = Math.sin(heading);
      reaction.fallX = (direction.x * c - direction.z * s) / length;
      reaction.fallZ = (direction.x * s + direction.z * c) / length;
    }
  }
}

export function advanceHumanReaction(reaction, dt, dead) {
  const step = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
  if (dead && !reaction.dead) {
    reaction.dead = true;
    reaction.deathTime = 0;
  } else if (!dead && reaction.dead) resetHumanReaction(reaction);
  reaction.hitTime += step;
  if (reaction.dead) reaction.deathTime = Math.min(HUMAN_COLLAPSE_SECONDS,
    reaction.deathTime + step);
  return humanReactionPose(reaction);
}

export function humanReactionPose(reaction) {
  const hit = reaction.hitTime < 0.42
    ? Math.sin(Math.PI * reaction.hitTime / 0.42) * reaction.strength : 0;
  const time = reaction.dead ? reaction.deathTime : 0;
  const collapse = reaction.dead ? smooth((time - 0.22) / 0.88) : 0;
  const knee = reaction.dead
    ? Math.sin(Math.PI * smooth(time / 1.08)) * 0.85 + collapse * 0.16 : hit * 0.08;
  const flail = reaction.dead
    ? Math.sin(Math.PI * smooth((time - 0.1) / 1.1)) : hit * 0.2;
  const settle = time > 1.1 && time < HUMAN_COLLAPSE_SECONDS
    ? Math.sin((time - 1.1) / 0.25 * Math.PI * 2) * 0.017
      * (1 - (time - 1.1) / 0.25) : 0;
  const angle = reaction.dead ? collapse * Math.PI / 2 : hit * 0.105;
  const length = Math.hypot(reaction.fallX, reaction.fallZ) || 1;
  return { dead: reaction.dead, collapse, angle,
    fallX: reaction.fallX / length, fallZ: reaction.fallZ / length,
    rootOffset: Math.max(0, Math.sin(angle) * 0.255 + settle),
    scaleY: reaction.dead ? 1 - knee * 0.18 * (1 - collapse) : 1,
    knee, flail, hit, settled: reaction.dead && time >= HUMAN_COLLAPSE_SECONDS };
}

export function humanBoneBend(name, pose) {
  const id = name.toLowerCase();
  const sign = id.endsWith('_l') ? -1 : 1;
  if (id.startsWith('thigh_')) return { x: -pose.knee * 0.58, z: sign * pose.collapse * 0.035 };
  if (id.startsWith('calf_')) return { x: pose.knee * 0.95 + pose.collapse * 0.13, z: 0 };
  if (id.startsWith('upperarm_')) return { x: pose.flail * -0.42 - pose.collapse * 0.12,
    z: sign * (pose.flail * 0.22 + pose.collapse * 0.055) };
  if (id.startsWith('lowerarm_')) return { x: pose.flail * 0.65 + pose.collapse * 0.3, z: 0 };
  if (id === 'spine_02' || id === 'spine_03') return { x: pose.hit * 0.055 + pose.knee * 0.12, z: 0 };
  if (id === 'head') return { x: pose.hit * 0.11 + pose.collapse * 0.08, z: pose.collapse * 0.06 * sign };
  return { x: 0, z: 0 };
}
