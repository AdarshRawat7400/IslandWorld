import { blastDamageAt } from './multiplayerRules.js';

// State is copied, so health changes remain owned by the solo game or server.
export function applyHealthDamage(state, damage) {
  const health = Math.max(0, Number(state.health) || 0);
  const armor = Math.max(0, Number(state.armor) || 0);
  if (!Number.isFinite(damage) || damage <= 0 || health === 0 || state.dead) {
    return { health, armor, damage: 0, healthDamage: 0, armorDamage: 0, dead: health === 0 };
  }
  const armorDamage = Math.min(armor, damage);
  const healthDamage = Math.min(health, damage - armorDamage);
  return { health: health - healthDamage, armor: armor - armorDamage,
    damage: armorDamage + healthDamage, armorDamage, healthDamage,
    dead: healthDamage === health };
}

export function blastDamageForTarget(origin, target, explosive, {
  enabled = true, now = 0, visible = () => true,
} = {}) {
  if (!enabled || target.dead || target.connected === false || target.mode === 'drone'
    || (target.spawnProtectedUntil ?? 0) > now
    || ![origin.x, origin.y, origin.z, target.x, target.y, target.z].every(Number.isFinite)) return 0;
  const distance = Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z);
  const damage = blastDamageAt(distance, explosive);
  return damage && visible(origin, target) ? damage : 0;
}

// A held view of the body falling onto the ground, independent of frame rate.
export function playerDownedPose(seconds, eyeHeight = 2.05) {
  const t = Math.max(0, Number(seconds) || 0);
  const smooth = (a, b) => {
    const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const buckle = smooth(0.08, 0.48);
  const collapse = smooth(0.42, 1.25);
  return { drop: Math.max(0, eyeHeight - 0.26) * (buckle * 0.32 + collapse * 0.68),
    pitch: 0.13 * buckle - 0.24 * collapse,
    roll: 0.1 * buckle + 0.58 * collapse,
    settled: t >= 1.25 };
}
