import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createMultiplayerServer } from '../server/index.js';
import { SPAWN_PROTECTION_MS, WEAPONS } from '../src/multiplayerRules.js';
import { playerEyeHeightAt } from '../src/world.js';

const request = (socket, event, data = {}) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(event, data, (error, response) =>
    error ? reject(error) : resolve(response));
});

async function harness(t, mode = 'explore') {
  let now = 3_000_000;
  const server = createMultiplayerServer({ host: '127.0.0.1', port: 0,
    clock: () => now, snapshotMs: 25 });
  const { port } = await server.listen();
  const socket = connect(`http://127.0.0.1:${port}`,
    { transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve); socket.once('connect_error', reject);
  });
  t.after(async () => { socket.disconnect(); await server.close(); });
  const joined = await request(socket, 'room:create', { name: 'Arms test', mode });
  const room = server.rooms.get(joined.code);
  const player = room.players.get(joined.selfId);
  // These tests isolate weapon rules from retaliating NPCs and wildlife.
  room.npcs.clear(); room.wildlife.clear();
  const select = (weapon) => request(socket, 'inventory:select', { weapon });
  const collect = async (weapon) => {
    const pickup = [...room.pickups.values()].find((item) => item.itemId === weapon);
    assert.ok(pickup, `${weapon} is present in real seeded world loot`);
    Object.assign(player, { x: pickup.x, y: playerEyeHeightAt(pickup.x, pickup.z),
      z: pickup.z, yaw: 0, pitch: 0, mode: 'walk' });
    return request(socket, 'loot:pickup', { id: pickup.id });
  };
  const fire = (weapon, extra = {}) => request(socket, 'combat:fire', {
    weapon, origin: { x: player.x, y: player.y, z: player.z },
    direction: { x: 0, y: 0, z: -1 }, ...extra,
  });
  const reload = (weapon, extra = {}) => request(socket, 'combat:reload', { weapon, ...extra });
  return { server, room, player, socket, select, collect, fire, reload,
    url: `http://127.0.0.1:${port}`,
    advance: (ms) => { now += ms; }, now: () => now };
}

for (const id of ['smg', 'lmg']) {
  for (const mode of ['pvp', 'explore']) {
    test(`${id}: ${mode} preserves protection and server-owned player damage`, async (t) => {
      const game = await harness(t, mode);
      const witness = connect(game.url, { transports: ['websocket'], reconnection: false });
      await new Promise((resolve, reject) => {
        witness.once('connect', resolve); witness.once('connect_error', reject);
      });
      t.after(() => witness.disconnect());
      const joined = await request(witness, 'room:join', { code: game.room.code, name: 'Witness' });
      const target = game.room.players.get(joined.selfId);
      await game.collect(id); await game.select(id);
      Object.assign(game.player, { x: 100, y: playerEyeHeightAt(100, 0), z: 0,
        yaw: 0, pitch: 0, mode: 'walk' });
      Object.assign(target, { x: 100, y: playerEyeHeightAt(100, -10), z: -10,
        yaw: Math.PI, pitch: 0, mode: 'walk' });
      assert.equal((await game.fire(id)).hit, null, 'fresh target spawn remains protected');
      assert.equal(target.health, 100);
      game.advance(SPAWN_PROTECTION_MS + 1);
      const fired = await game.fire(id, { targetId: target.id, damage: 9999, health: 0 });
      assert.equal(fired.ok, true);
      if (mode === 'pvp') {
        assert.equal(fired.hit?.targetId, target.id);
        assert.equal(fired.hit.damage, WEAPONS[id].damage);
        assert.equal(target.health, 100 - WEAPONS[id].damage);
      } else {
        assert.equal(fired.hit, null);
        assert.equal(target.health, 100);
      }
      assert.equal((await game.fire(id)).error, 'fire_rate_limited');
      assert.equal(target.health, mode === 'pvp' ? 100 - WEAPONS[id].damage : 100);
    });
  }
}

for (const id of ['smg', 'lmg']) {
  test(`${id}: server owns automatic cadence, ammunition and timed reloads`, async (t) => {
    const game = await harness(t);
    const weapon = WEAPONS[id];
    assert.equal(weapon.automatic, true);
    assert.equal((await game.fire(id)).error, 'gun_not_owned');
    assert.equal((await game.reload(id)).error, 'gun_not_owned');
    const collected = await game.collect(id);
    assert.equal(collected.ok, true);
    assert.equal(collected.inventory.guns.length, 3);
    assert.equal(collected.ammo[id].magazine, weapon.magazine);
    assert.equal((await game.fire(id)).error, 'gun_not_selected');
    assert.equal((await game.reload(id)).error, 'gun_not_selected');
    assert.equal((await game.select(id)).ok, true);

    const initial = await game.fire(id, { magazine: 999, ammo: 999, damage: 9999 });
    assert.equal(initial.ok, true);
    assert.equal(initial.ammo.magazine, weapon.magazine - 1);
    assert.equal((await game.fire(id)).error, 'fire_rate_limited');
    game.advance(weapon.fireIntervalMs - 1);
    assert.equal((await game.fire(id)).error, 'fire_rate_limited');
    assert.equal(game.player.ammo[id].magazine, weapon.magazine - 1,
      'rejected calls never spend or refill server ammunition');
    game.advance(1);
    assert.equal((await game.fire(id)).ok, true);
    for (let round = 2; round < weapon.magazine; round++) {
      game.advance(weapon.fireIntervalMs);
      assert.equal((await game.fire(id)).ok, true);
    }
    assert.equal(game.player.ammo[id].magazine, 0);
    game.advance(weapon.fireIntervalMs);
    assert.equal((await game.fire(id, { ammo: weapon.magazine })).error, 'empty_magazine');
    const reloading = await game.reload(id, { finishesAt: game.now(), reserve: 9999 });
    assert.equal(reloading.ok, true);
    assert.equal(reloading.ammo.reloadingUntil, game.now() + weapon.reloadMs);
    assert.equal((await game.fire(id)).error, 'reloading');
    game.advance(weapon.reloadMs - 1);
    assert.equal((await game.fire(id)).error, 'reloading');
    game.advance(1);
    const resumed = await game.fire(id);
    assert.equal(resumed.ok, true);
    assert.equal(resumed.ammo.magazine, weapon.magazine - 1);
    assert.equal(resumed.ammo.reserve, weapon.reserve - weapon.magazine);
  });
}

test('gun switching cannot evade the recovery time of an accepted shot', async (t) => {
  const game = await harness(t);
  assert.equal((await game.fire('revolver')).ok, true);
  assert.equal((await game.select('rifle')).ok, true);
  assert.equal((await game.fire('rifle')).error, 'fire_rate_limited');
  assert.equal(game.player.ammo.rifle.magazine, WEAPONS.rifle.magazine);
  game.advance(WEAPONS.revolver.fireIntervalMs);
  assert.equal((await game.fire('rifle')).ok, true);
  assert.equal((await game.select('revolver')).ok, true);
  game.advance(WEAPONS.rifle.fireIntervalMs - 1);
  assert.equal((await game.fire('revolver')).error, 'fire_rate_limited');
  game.advance(1);
  assert.equal((await game.fire('revolver')).ok, true);
});

test('a fourth firearm cannot be collected or selected, and its world pickup stays available', async (t) => {
  const game = await harness(t);
  assert.equal((await game.collect('smg')).ok, true);
  const denied = await game.collect('lmg');
  assert.equal(denied.error, 'inventory_full');
  assert.deepEqual(game.player.inventory.guns, ['revolver', 'rifle', 'smg']);
  assert.equal((await game.select('lmg')).error, 'gun_not_owned');
  assert.equal((await game.fire('lmg')).error, 'gun_not_owned');
  assert.ok([...game.room.pickups.values()].some((item) => item.itemId === 'lmg'),
    'an unavailable pickup remains for another player');
});

test('reload is on-foot and selected-only; stowed reload timing remains server-owned', async (t) => {
  const game = await harness(t);
  await game.collect('smg'); await game.select('smg');
  assert.equal((await game.fire('smg')).ok, true);
  game.player.mode = 'drive';
  assert.equal((await game.reload('smg')).error, 'not_on_foot');
  game.player.mode = 'walk';
  const reloading = await game.reload('smg');
  assert.equal(reloading.ok, true);
  assert.equal((await game.select('revolver')).ok, true);
  assert.equal((await game.reload('smg')).error, 'gun_not_selected');
  game.advance(WEAPONS.smg.reloadMs);
  assert.equal((await game.fire('revolver')).ok, true);
  assert.equal(game.player.ammo.smg.magazine, WEAPONS.smg.magazine);
  assert.equal(game.player.ammo.smg.reserve, WEAPONS.smg.reserve - 1);
});

test('ammo revisions and accepted shot IDs survive snapshots, reloads and supply refills', async (t) => {
  const game = await harness(t);
  const pickup = await game.collect('smg'); await game.select('smg');
  assert.equal(pickup.ammo.smg.revision, 0);
  assert.equal(pickup.ammo.smg.lastShotId, 0);
  const first = await game.fire('smg', { shotId: 10 });
  assert.equal(first.ammo.revision, 1);
  assert.equal(first.ammo.lastShotId, 10);
  assert.equal((await game.fire('smg', { shotId: 99 })).error, 'fire_rate_limited');
  assert.equal(game.player.ammo.smg.lastShotId, 10,
    'a rejected ID cannot acknowledge or erase pending valid shots');
  game.advance(WEAPONS.smg.fireIntervalMs);
  const second = await game.fire('smg', { shotId: 11 });
  assert.equal(second.ammo.revision, 2);
  assert.equal(second.ammo.lastShotId, 11);
  const snapshot = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('ammo snapshot missing')), 1000);
    function handler(room) {
      const ammo = room.players.find(({ id }) => id === game.player.id)?.ammo.smg;
      if (ammo?.revision !== 2) return;
      clearTimeout(timeout); game.socket.off('room:snapshot', handler); resolve(ammo);
    }
    game.socket.on('room:snapshot', handler);
  });
  assert.equal(snapshot.magazine, second.ammo.magazine);
  assert.equal(snapshot.lastShotId, 11);
  game.advance(WEAPONS.smg.fireIntervalMs);
  assert.equal((await game.fire('smg', { shotId: 10 })).error, 'stale_shot');
  for (const shotId of [0, -1, 1.5, null, '12', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await game.fire('smg', { shotId })).error, 'invalid_shot_id');
  }
  assert.equal(game.player.ammo.smg.revision, 2);
  assert.equal((await game.fire('smg', { shotId: 12 })).ammo.revision, 3);
  game.advance(WEAPONS.smg.fireIntervalMs);
  const legacy = await game.fire('smg');
  assert.equal(legacy.ok, true, 'legacy clients may omit shot ID');
  assert.equal(legacy.ammo.revision, 4);
  assert.equal(legacy.ammo.lastShotId, 12);
  const reload = await game.reload('smg');
  assert.equal(reload.ammo.revision, 5);
  assert.equal(reload.ammo.lastShotId, 12);
  game.advance(WEAPONS.smg.reloadMs);
  const finished = await game.fire('smg', { shotId: 13 });
  assert.equal(finished.ammo.revision, 7, 'reload completion and firing each increment revision');
  assert.equal(finished.ammo.lastShotId, 13);
  const supplies = [...game.room.pickups.values()].find((item) => item.itemId === 'ammo');
  Object.assign(game.player, { x: supplies.x, y: playerEyeHeightAt(supplies.x, supplies.z),
    z: supplies.z });
  const refilled = await request(game.socket, 'loot:pickup', { id: supplies.id });
  assert.equal(refilled.ok, true);
  assert.equal(refilled.ammo.smg.revision, 8);
  assert.equal(refilled.ammo.smg.lastShotId, 13);
  assert.equal(refilled.ammo.smg.reserve, WEAPONS.smg.reserve);
  assert.equal(refilled.ammo.revolver.revision, 0, 'unchanged ammo never receives a revision');
});

test('replaying an accepted shot ID cannot damage a player twice', async (t) => {
  const game = await harness(t, 'pvp');
  const witness = connect(game.url, { transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => {
    witness.once('connect', resolve); witness.once('connect_error', reject);
  });
  t.after(() => witness.disconnect());
  const joined = await request(witness, 'room:join', { code: game.room.code, name: 'Target' });
  const target = game.room.players.get(joined.selfId);
  await game.collect('smg'); await game.select('smg');
  Object.assign(game.player, { x: 100, y: playerEyeHeightAt(100, 0), z: 0,
    yaw: 0, pitch: 0, mode: 'walk' });
  Object.assign(target, { x: 100, y: playerEyeHeightAt(100, -10), z: -10,
    yaw: Math.PI, pitch: 0, mode: 'walk' });
  game.advance(SPAWN_PROTECTION_MS + 1);
  const accepted = await game.fire('smg', { shotId: 2 });
  assert.equal(accepted.hit?.health, 100 - WEAPONS.smg.damage);
  game.advance(WEAPONS.smg.fireIntervalMs);
  assert.equal((await game.fire('smg', { shotId: 2, damage: 9999 })).error, 'stale_shot');
  assert.equal((await game.fire('smg', { shotId: 1 })).error, 'stale_shot');
  assert.equal(target.health, 100 - WEAPONS.smg.damage);
  assert.equal(game.player.ammo.smg.magazine, WEAPONS.smg.magazine - 1);
  assert.equal(game.player.ammo.smg.revision, 1);
  const next = await game.fire('smg', { shotId: 3 });
  assert.equal(next.hit.health, 100 - WEAPONS.smg.damage * 2);
  assert.equal(next.ammo.revision, 2);
});
