import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createMultiplayerServer } from '../server/index.js';
import { RESIDENT_SITES } from '../src/islandResidents.js';
import { PRISON_OCCUPANTS } from '../src/prisonPopulation.js';
import { NPC_COMBAT, createNpcCombatant, rayNpcHit, npcThreatenedByShot,
  alertNpc, applyNpcDamage, npcAttackDecision } from '../src/npcCombatRules.js';
import { WEAPONS, SPAWN_PROTECTION_MS } from '../src/multiplayerRules.js';
import { playerEyeHeightAt, islandCoastalRadiusAt, shotBlockedByTerrain }
  from '../src/world.js';
import { shotBlockedByStructures } from '../server/lineOfSight.js';
import { isLake } from '../src/inlandLake.js';

const request = (socket, event, data = {}) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(event, data, (error, response) =>
    error ? reject(error) : resolve(response));
});

function observe(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`${event} not observed`));
    }, 2000);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timeout);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function harness(t, mode = 'explore') {
  let now = 3_000_000;
  const server = createMultiplayerServer({ host: '127.0.0.1', port: 0,
    clock: () => now, snapshotMs: 20 });
  const { port } = await server.listen();
  const socket = connect(`http://127.0.0.1:${port}`,
    { transports: ['websocket'], reconnection: false });
  t.after(async () => { socket.disconnect(); await server.close(); });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve); socket.once('connect_error', reject);
  });
  const joined = await request(socket, 'room:create', { name: 'Tester', mode });
  const room = server.rooms.get(joined.code);
  const player = room.players.get(joined.selfId);
  const advance = (milliseconds) => { now += milliseconds; };
  const aimAt = (npc, distance = 8) => {
    const x = npc.x, z = npc.z + distance;
    const origin = { x, y: playerEyeHeightAt(x, z), z };
    const target = { x: npc.x, y: npc.y + 1.05, z: npc.z };
    const length = Math.hypot(target.x - origin.x, target.y - origin.y,
      target.z - origin.z);
    const direction = { x: (target.x - origin.x) / length,
      y: (target.y - origin.y) / length, z: (target.z - origin.z) / length };
    Object.assign(player, { ...origin, yaw: Math.atan2(-direction.x, -direction.z),
      pitch: Math.asin(direction.y), mode: 'walk' });
    return { origin, direction };
  };
  return { server, socket, joined, room, player, advance, aimAt,
    now: () => now };
}

test('room snapshots include every named resident, guard, and detainee', async (t) => {
  const game = await harness(t);
  const states = game.joined.room.npcs;
  assert.equal(states.length, RESIDENT_SITES.length + PRISON_OCCUPANTS.length);
  assert.equal(new Set(states.map((npc) => npc.id)).size, states.length);
  for (const definition of [...RESIDENT_SITES, ...PRISON_OCCUPANTS]) {
    const npc = states.find((entry) => entry.id === definition.id);
    assert.ok(npc, definition.id);
    assert.equal(npc.name, definition.name);
    assert.equal(npc.health, NPC_COMBAT[npc.kind].maxHealth);
    assert.equal(npc.dead, false);
    assert.equal(npc.alerted, false);
    assert.ok(Number.isFinite(npc.x) && Number.isFinite(npc.y)
      && Number.isFinite(npc.z));
  }
});

test('every human NPC has at least one clear, island-side gun line to its body', async (t) => {
  const game = await harness(t);
  for (const npc of game.room.npcs.values()) {
    let clear = false;
    for (const radius of [3, 5, 8]) {
      for (let angle = 0; angle < 48 && !clear; angle++) {
        const theta = angle * Math.PI / 24;
        const x = npc.x + Math.cos(theta) * radius;
        const z = npc.z + Math.sin(theta) * radius;
        if (islandCoastalRadiusAt(x, z) >= 0.999 || isLake(x, z)) continue;
        const origin = { x, y: playerEyeHeightAt(x, z), z };
        const aim = { x: npc.x, y: npc.y + 1.05, z: npc.z };
        const length = Math.hypot(aim.x - origin.x, aim.y - origin.y,
          aim.z - origin.z);
        const direction = { x: (aim.x - origin.x) / length,
          y: (aim.y - origin.y) / length, z: (aim.z - origin.z) / length };
        clear = rayNpcHit(origin, direction, npc, WEAPONS.revolver.range) !== null
          && !shotBlockedByStructures(origin, aim)
          && !shotBlockedByTerrain(origin, aim);
      }
      if (clear) break;
    }
    assert.ok(clear, `${npc.id} needs a visible and reachable target line`);
  }
});

test('shared NPC rules constrain hitboxes, near misses, health, LOS, and target selection', () => {
  const npc = createNpcCombatant({ id: 'person', name: 'Person', x: 0, z: -10 },
    'resident', 20);
  const origin = { x: 0, y: 21.1, z: 0 };
  assert.equal(rayNpcHit(origin, { x: 0, y: 0, z: -1 }, npc, 65), 10);
  assert.equal(rayNpcHit({ x: 3, y: 21.1, z: 0 },
    { x: 0, y: 0, z: -1 }, npc, 65), null);
  assert.equal(npcThreatenedByShot({ x: 2, y: 21.1, z: 0 },
    { x: 0, y: 0, z: -1 }, npc, 65), true);
  assert.equal(npcThreatenedByShot({ x: 5, y: 21.1, z: 0 },
    { x: 0, y: 0, z: -1 }, npc, 65), false);
  const alerted = alertNpc(npc, 'attacker');
  assert.equal(npc.alerted, false, 'pure helpers never mutate input');
  assert.equal(alerted.targetId, 'attacker');
  const hit = applyNpcDamage(alerted, 35, 'attacker');
  assert.equal(hit.health, 55);
  assert.equal(hit.dead, false);
  assert.equal(applyNpcDamage(hit, 100, 'attacker').dead, true);
  const players = [
    { id: 'bystander', x: 0, y: 21.8, z: -5, mode: 'walk', dead: false,
      connected: true, spawnProtectedUntil: 0 },
    { id: 'attacker', x: 0, y: 21.8, z: -3, mode: 'walk', dead: false,
      connected: true, spawnProtectedUntil: 0 },
  ];
  assert.equal(npcAttackDecision(npc, players, 10000)?.targetId, undefined,
    'unalerted NPCs remain peaceful');
  assert.equal(npcAttackDecision(alerted, players, 10000)?.targetId, 'attacker');
  assert.equal(npcAttackDecision(alerted, players, 10000)?.attackKind,
    'resident_shot');
  assert.equal(npcAttackDecision(alerted, players, 10000)?.weapon, 'revolver');
  assert.equal(npcAttackDecision(alerted, players, 10000, () => false), null);
  players[1].mode = 'drive';
  assert.equal(npcAttackDecision(alerted, players, 10000)?.targetId, 'bystander');
  players[0].spawnProtectedUntil = 11000;
  assert.equal(npcAttackDecision(alerted, players, 10000), null);
});

test('all human NPC types retaliate with firearms and stance-safe aim points', () => {
  const player = { id: 'attacker', x: 0, y: 20.56, z: -3, mode: 'walk',
    stance: 'prone', dead: false, connected: true, spawnProtectedUntil: 0 };
  for (const [kind, attackKind, weapon] of [
    ['resident', 'resident_shot', 'revolver'],
    ['guard', 'guard_shot', 'rifle'],
    ['detainee', 'detainee_shot', 'revolver'],
  ]) {
    const npc = alertNpc(createNpcCombatant({ id: kind, x: 0, z: -10 },
      kind, 20), player.id);
    const attack = npcAttackDecision(npc, [player], 10_000);
    assert.equal(attack?.attackKind, attackKind, kind);
    assert.equal(attack?.weapon, weapon, kind);
    assert.ok(attack.target.y > 20.2 && attack.target.y < 20.5,
      `${kind} should aim above the ground at a prone player`);
    npc.lastAttackAt = 10_000;
    assert.equal(npcAttackDecision(npc, [player],
      10_000 + NPC_COMBAT[kind].attackIntervalMs - 1), null,
    `${kind} respects its fire cadence`);
  }
});

test('Explore gunfire wounds then kills a resident, emits state, and never respawns them',
  async (t) => {
    const game = await harness(t);
    const npc = game.room.npcs.get('headland_surveyor');
    game.advance(SPAWN_PROTECTION_MS + 1);
    const shot = game.aimAt(npc);
    const wounded = observe(game.socket, 'npc:state',
      (state) => state.id === npc.id && state.health === 56);
    const hitEvent = observe(game.socket, 'combat:event',
      (event) => event.kind === 'npc_hit' && event.npcId === npc.id);
    const first = await request(game.socket, 'combat:fire',
      { weapon: 'revolver', ...shot });
    assert.equal(first.ok, true);
    assert.equal(first.hit.kind, 'npc');
    assert.equal(first.hit.id, npc.id);
    assert.equal(first.hit.damage, WEAPONS.revolver.damage);
    assert.equal((await wounded).alerted, true);
    assert.equal((await hitEvent).shooterId, game.player.id);
    for (let i = 0; i < 2; i++) {
      game.advance(WEAPONS.revolver.fireIntervalMs);
      const result = await request(game.socket, 'combat:fire',
        { weapon: 'revolver', ...shot });
      assert.equal(result.ok, true);
    }
    const final = game.room.npcs.get(npc.id);
    assert.equal(final.health, 0);
    assert.equal(final.dead, true);
    game.advance(120_000);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(game.room.npcs.get(npc.id).dead, true);
  });

test('an alerted resident attacks its shooter in Explore and armor absorbs damage first',
  async (t) => {
    const game = await harness(t);
    game.advance(SPAWN_PROTECTION_MS + 1);
    const npc = game.room.npcs.get('headland_surveyor');
    const shot = game.aimAt(npc);
    game.player.armor = 5;
    const attackEvent = observe(game.socket, 'combat:event',
      (event) => event.kind === 'npc_attack' && event.npcId === npc.id);
    const fired = await request(game.socket, 'combat:fire',
      { weapon: 'revolver', ...shot });
    assert.equal(fired.hit.kind, 'npc');
    const attack = await attackEvent;
    assert.equal(attack.targetId, game.player.id);
    assert.equal(attack.attackKind, 'resident_shot');
    assert.equal(attack.weapon, 'revolver');
    assert.equal(attack.armorDamage, 5);
    assert.equal(attack.healthDamage, NPC_COMBAT.resident.damage - 5);
    assert.equal(game.player.armor, 0);
    assert.equal(game.player.health, 100 - attack.healthDamage);
    assert.equal(game.room.npcs.get(npc.id).health, npc.maxHealth - WEAPONS.revolver.damage,
      'retaliation does not injure the attacking NPC or other residents');
  });

test('a clear near miss alerts a resident without assigning damage', async (t) => {
  const game = await harness(t);
  const npc = game.room.npcs.get('headland_surveyor');
  game.advance(SPAWN_PROTECTION_MS + 1);
  const x = npc.x + 2, z = npc.z + 8;
  const origin = { x, y: playerEyeHeightAt(x, z), z };
  const direction = { x: 0, y: 0, z: -1 };
  Object.assign(game.player, { ...origin, yaw: 0, pitch: 0, mode: 'walk' });
  const alert = observe(game.socket, 'npc:state',
    (state) => state.id === npc.id && state.alerted);
  const fired = await request(game.socket, 'combat:fire',
    { weapon: 'revolver', origin, direction });
  assert.equal(fired.ok, true);
  assert.equal(fired.hit?.kind === 'npc', false);
  assert.equal((await alert).health, npc.maxHealth);
  assert.equal(game.room.npcs.get(npc.id).targetId, game.player.id);
});

test('grenade damage is authoritative for nearby NPCs in Explore', async (t) => {
  const game = await harness(t);
  const npc = game.room.npcs.get('headland_surveyor');
  game.advance(SPAWN_PROTECTION_MS + 1);
  game.player.inventory.grenades = 1;
  game.aimAt(npc, 6);
  const changed = observe(game.socket, 'npc:state',
    (state) => state.id === npc.id && state.health < state.maxHealth);
  const used = await request(game.socket, 'combat:use', {
    kind: 'grenade', target: { x: npc.x, z: npc.z },
  });
  assert.equal(used.ok, true);
  game.advance(2200);
  const state = await changed;
  assert.ok(state.health < npc.maxHealth);
  assert.equal(state.alerted, !state.dead);
  assert.equal(game.room.npcs.get(npc.id).health, state.health);
});

test('prison walls block a detainee attack despite close range', async (t) => {
  const game = await harness(t);
  game.advance(SPAWN_PROTECTION_MS + 1);
  const detainee = game.room.npcs.get('detainee_s1');
  game.room.npcs.set(detainee.id, alertNpc(detainee, game.player.id));
  Object.assign(game.player, { x: -68, z: 39,
    y: playerEyeHeightAt(-68, 39), mode: 'walk' });
  await new Promise((resolve) => setTimeout(resolve, 65));
  assert.equal(game.player.health, 100);
  assert.equal(game.room.npcs.get(detainee.id).lastAttackAt, -Infinity);
});

test('a guard can down an unprotected attacker; room respawn restores protection',
  async (t) => {
    const game = await harness(t);
    game.advance(SPAWN_PROTECTION_MS + 1);
    const guard = game.room.npcs.get('gate_guard_east');
    game.room.npcs.set(guard.id, alertNpc(guard, game.player.id));
    Object.assign(game.player, { x: guard.x + 3, z: guard.z + 4,
      y: playerEyeHeightAt(guard.x + 3, guard.z + 4), mode: 'walk',
      health: 10, armor: 0 });
    const attacked = observe(game.socket, 'combat:event',
      (event) => event.kind === 'npc_attack' && event.npcId === guard.id);
    const death = observe(game.socket, 'combat:event',
      (event) => event.kind === 'death' && event.killerId === guard.id);
    const event = await attacked;
    assert.equal(event.attackKind, 'guard_shot');
    assert.equal(event.weapon, 'rifle');
    assert.equal(event.health, 0);
    assert.equal((await death).playerId, game.player.id);
    assert.equal(game.player.dead, true);
    game.advance(3000);
    const respawn = await request(game.socket, 'player:respawn');
    assert.equal(respawn.ok, true);
    assert.ok(respawn.spawnProtectedUntil > game.now());
  });
