import { normalizedDirection, rayPlayerHit, validWorldPosition }
  from './multiplayerRules.js';
import { playerStance } from './playerStance.js';

// Human NPC combat rules shared by single-player and the authoritative room
// server. Positions use terrain-ground Y; players use eye-height Y.
export const NPC_COMBAT = Object.freeze({
  // Each faction has a restrained island-era firearm and a separate cadence.
  // Detainees retain a short-range concealed pistol so their shots remain
  // meaningful only when the holding wing has a clear line of sight.
  resident: Object.freeze({ maxHealth: 90, attackKind: 'resident_shot',
    weapon: 'revolver', damage: 10, attackRange: 30, attackIntervalMs: 2500 }),
  guard: Object.freeze({ maxHealth: 110, attackKind: 'guard_shot',
    weapon: 'rifle', damage: 14, attackRange: 42, attackIntervalMs: 1900 }),
  detainee: Object.freeze({ maxHealth: 90, attackKind: 'detainee_shot',
    weapon: 'revolver', damage: 7, attackRange: 15, attackIntervalMs: 3200 }),
});

export function createNpcCombatant(site, kind, groundHeight) {
  const config = NPC_COMBAT[kind];
  if (!site?.id || !config || !Number.isFinite(site.x) || !Number.isFinite(site.z)
    || !Number.isFinite(groundHeight)) throw new TypeError('Invalid NPC combat site');
  return { id: site.id, name: site.name || site.id, kind,
    x: site.x, y: groundHeight, z: site.z,
    heading: Number.isFinite(site.heading) ? site.heading : 0,
    weapon: config.weapon,
    health: config.maxHealth, maxHealth: config.maxHealth,
    dead: false, alerted: false, targetId: null, lastAttackAt: -Infinity };
}

export function rayNpcHit(origin, direction, npc, range, radius = 0.65) {
  if (!npc || npc.dead || !Number.isFinite(npc.y) || !Number.isFinite(radius)
    || radius <= 0) return null;
  return rayPlayerHit(origin, direction,
    { x: npc.x, y: npc.y + 1.8, z: npc.z }, range, radius);
}

// A short, clear shot passing within 3.4 m of a person plausibly alarms them.
// The server still checks structure and terrain occlusion before applying it.
export function npcThreatenedByShot(origin, direction, npc, range) {
  const ray = normalizedDirection(direction);
  if (!validWorldPosition(origin) || !ray || !npc || npc.dead
    || ![npc.x, npc.y, npc.z, range].every(Number.isFinite)) return false;
  const center = { x: npc.x, y: npc.y + 1.1, z: npc.z };
  const dx = center.x - origin.x, dy = center.y - origin.y, dz = center.z - origin.z;
  const projection = dx * ray.x + dy * ray.y + dz * ray.z;
  if (projection <= 0 || projection > Math.min(range, 48)) return false;
  const miss = Math.hypot(dx - ray.x * projection, dy - ray.y * projection,
    dz - ray.z * projection);
  return miss <= 3.4;
}

export function alertNpc(npc, targetId) {
  if (!npc || npc.dead) return npc;
  return { ...npc, alerted: true, targetId: targetId || npc.targetId || null };
}

export function applyNpcDamage(npc, damage, targetId) {
  if (!npc || npc.dead || !Number.isFinite(damage) || damage <= 0) return npc;
  const health = Math.max(0, npc.health - Math.round(damage));
  return { ...npc, health, dead: health === 0, alerted: health > 0,
    targetId: health > 0 ? targetId || npc.targetId || null : null };
}

// `visible(origin, impact)` is supplied by the caller so the same selection
// logic uses the server's coarse occluders or the rendered world's colliders.
export function npcAttackDecision(npc, players, now, visible = () => true) {
  const config = NPC_COMBAT[npc?.kind];
  if (!config || !npc.alerted || npc.dead || !Number.isFinite(now)
    || now - npc.lastAttackAt < config.attackIntervalMs) return null;
  const origin = { x: npc.x, y: npc.y + 1.55, z: npc.z };
  let chosen = null;
  for (const player of players) {
    if (player.dead || player.connected === false || player.mode !== 'walk'
      || player.spawnProtectedUntil > now || !validWorldPosition(player)) continue;
    const target = { x: player.x,
      y: player.y - playerStance(player.stance).eyeHeight * 0.4,
      z: player.z };
    const distance = Math.hypot(target.x - origin.x, target.y - origin.y,
      target.z - origin.z);
    if (distance > config.attackRange || !visible(origin, target)) continue;
    // Continue pursuing the player who provoked this NPC while they remain
    // reachable. Fall back to the nearest eligible player if they leave.
    if (chosen && chosen.targetId === npc.targetId) continue;
    if (chosen && player.id !== npc.targetId && distance >= chosen.distance) continue;
    chosen = { npcId: npc.id, targetId: player.id, attackKind: config.attackKind,
      weapon: config.weapon, origin, target, damage: config.damage, distance };
  }
  return chosen;
}
