import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createMultiplayerServer } from '../server/index.js';
import { collectItem, WORLD_PICKUP_SPAWNS } from '../src/combatLoot.js';
import { EXPLOSIVES, RESPAWN_DELAY_MS, SPAWN_PROTECTION_MS, WEAPONS }
  from '../src/multiplayerRules.js';
import { playerEyeHeightAt, islandTerrainHeightAt } from '../src/world.js';
import { SERVER_WILDLIFE_HOMES, wildlifeTargetsAt } from '../src/fauna.js';

const request = (socket, event, data = {}) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(event, data, (error, result) =>
    error ? reject(error) : resolve(result));
});
const pause = (ms = 45) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForCombatEvent(socket, matches, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('combat:event', onEvent);
      reject(new Error('Timed out waiting for combat event'));
    }, timeoutMs);
    function onEvent(event) {
      if (!matches(event)) return;
      clearTimeout(timeout);
      socket.off('combat:event', onEvent);
      resolve(event);
    }
    socket.on('combat:event', onEvent);
  });
}

async function fixture(t, mode = 'pvp') {
  let now = 3_000_000;
  const server = createMultiplayerServer({ host: '127.0.0.1', port: 0,
    clock: () => now, snapshotMs: 20, random: () => 0 });
  const address = await server.listen();
  const sockets = [];
  t.after(async () => { sockets.forEach((socket) => socket.disconnect()); await server.close(); });
  async function client() {
    const socket = connect(`http://127.0.0.1:${address.port}`,
      { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve); socket.once('connect_error', reject);
    });
    return socket;
  }
  const firstSocket = await client();
  const first = await request(firstSocket, 'room:create', { mode, name: 'First' });
  const secondSocket = await client();
  const second = await request(secondSocket, 'room:join', { code: first.code, name: 'Second' });
  const room = server.rooms.get(first.code);
  return { server, room, first, second, firstSocket, secondSocket, client,
    advance: (ms) => { now += ms; }, now: () => now };
}

function setPosition(player, x, z, yaw = 0, pitch = 0) {
  Object.assign(player, { x, y: playerEyeHeightAt(x, z), z,
    yaw, pitch, mode: 'walk' });
}

test('room pickups enforce reach, gun ownership and capacity, and reconnect preserves inventory', async (t) => {
  const game = await fixture(t);
  const player = game.room.players.get(game.first.selfId);
  assert.deepEqual(game.first.room.players.find((p) => p.id === player.id).inventory.guns,
    ['revolver', 'rifle']);
  assert.equal(game.first.room.pickups.length, WORLD_PICKUP_SPAWNS.length);
  assert.equal((await request(game.firstSocket, 'combat:fire', { weapon: 'shotgun' })).error,
    'gun_not_owned');
  const shotgun = [...game.room.pickups.values()].find((item) => item.itemId === 'shotgun');
  assert.equal((await request(game.firstSocket, 'loot:pickup', { id: shotgun.id })).error,
    'pickup_out_of_reach');
  setPosition(player, shotgun.x, shotgun.z);
  const collected = await request(game.firstSocket, 'loot:pickup', { id: shotgun.id });
  assert.equal(collected.ok, true);
  assert.deepEqual(collected.inventory.guns, ['revolver', 'rifle', 'shotgun']);
  assert.equal(game.room.pickups.has(shotgun.id), false);
  assert.equal((await request(game.firstSocket, 'inventory:select', { weapon: 'shotgun' }))
    .inventory.selectedGun, 'shotgun');
  assert.equal((await request(game.firstSocket, 'combat:fire', {
    weapon: 'shotgun', origin: { x: player.x, y: player.y, z: player.z },
    direction: { x: 0, y: 0, z: -1 },
  })).ammo.magazine, WEAPONS.shotgun.magazine - 1);
  assert.equal((await request(game.firstSocket, 'inventory:select', { weapon: 'shotgun' }))
    .inventory.selectedGun, 'shotgun');
  assert.equal((await request(game.firstSocket, 'inventory:cycle', { direction: 1 }))
    .inventory.selectedGun, 'revolver');
  assert.equal((await request(game.firstSocket, 'inventory:select', { weapon: 'fake' })).error,
    'gun_not_owned');
  const grenade = { id: 'test-grenade-stack', itemId: 'grenade', kind: 'grenade',
    x: player.x, y: islandTerrainHeightAt(player.x, player.z) + 0.25,
    z: player.z, count: 5, source: 'player', expiresAt: game.now() + 180000 };
  game.room.pickups.set(grenade.id, grenade);
  const stack = await request(game.firstSocket, 'loot:pickup', { id: grenade.id });
  assert.equal(stack.count, 3);
  assert.equal(stack.inventory.grenades, 3);
  assert.equal(game.room.pickups.get(grenade.id).count, 2);
  assert.equal((await request(game.firstSocket, 'loot:pickup', { id: grenade.id })).error,
    'inventory_full');
  game.firstSocket.disconnect();
  const resumedSocket = await game.client();
  const resumed = await request(resumedSocket, 'room:resume', {
    code: game.first.code, token: game.first.token,
  });
  assert.equal(resumed.ok, true);
  const self = resumed.room.players.find((entry) => entry.id === game.first.selfId);
  assert.equal(self.inventory.grenades, 3);
  assert.deepEqual(self.inventory.guns, ['revolver', 'rifle', 'shotgun']);
  assert.equal(resumed.room.pickups.find((entry) => entry.id === grenade.id).count, 2);
  game.advance(90000);
  await pause();
  assert.equal(game.room.pickups.has(shotgun.id), true,
    'world loot returns after its room respawn timer');
});

test('medkits and ammo boxes apply only useful bounded effects and preserve combat timers', async (t) => {
  const game = await fixture(t);
  const player = game.room.players.get(game.first.selfId);
  const medkit = [...game.room.pickups.values()].find((item) => item.itemId === 'medkit');
  const ammo = [...game.room.pickups.values()].find((item) => item.itemId === 'ammo');
  assert.ok(medkit && ammo, 'each room has scattered health and ammo supplies');
  setPosition(player, medkit.x, medkit.z);
  assert.equal((await request(game.firstSocket, 'loot:pickup', { id: medkit.id })).error,
    'health_full');
  assert.equal(game.room.pickups.has(medkit.id), true);
  player.health = 69;
  const protection = player.spawnProtectedUntil;
  const healed = await request(game.firstSocket, 'loot:pickup', {
    id: medkit.id, heal: 9999, health: 100,
  });
  assert.equal(healed.ok, true);
  assert.equal(healed.health, 100);
  assert.equal(healed.count, 1);
  assert.equal(player.health, 100);
  assert.equal(player.spawnProtectedUntil, protection,
    'a supply pickup does not end spawn protection');
  const medkitStack = { ...medkit, id: 'stack-medkit', source: 'player',
    count: 3, expiresAt: game.now() + 180000 };
  game.room.pickups.set(medkitStack.id, medkitStack);
  player.health = 80;
  const partialHeal = await request(game.firstSocket, 'loot:pickup', { id: medkitStack.id });
  assert.equal(partialHeal.count, 1);
  assert.equal(partialHeal.health, 100);
  assert.equal(game.room.pickups.get(medkitStack.id).count, 2);
  assert.equal((await request(game.firstSocket, 'loot:pickup', { id: medkitStack.id })).error,
    'health_full');
  setPosition(player, ammo.x, ammo.z);
  assert.equal((await request(game.firstSocket, 'loot:pickup', { id: ammo.id })).error,
    'ammo_full');
  assert.equal(game.room.pickups.has(ammo.id), true);
  player.ammo.revolver.reserve = WEAPONS.revolver.reserve - 5;
  player.ammo.rifle.reserve = WEAPONS.rifle.reserve - 1;
  player.ammo.shotgun.reserve = 4; // The shotgun is not owned.
  player.ammo.revolver.lastFiredAt = game.now() - 80;
  player.ammo.revolver.reloadingUntil = game.now() + 500;
  const replenished = await request(game.firstSocket, 'loot:pickup', {
    id: ammo.id, reserve: 9999, weapon: 'shotgun',
  });
  assert.equal(replenished.ok, true);
  assert.equal(replenished.count, 1);
  assert.equal(replenished.ammo.revolver.reserve, WEAPONS.revolver.reserve);
  assert.equal(replenished.ammo.rifle.reserve, WEAPONS.rifle.reserve);
  assert.equal(replenished.ammo.shotgun.reserve, 4);
  assert.equal(player.ammo.revolver.lastFiredAt, game.now() - 80);
  assert.equal(player.ammo.revolver.reloadingUntil, game.now() + 500);
  const ammoStack = { ...ammo, id: 'stack-ammo', source: 'player',
    count: 2, expiresAt: game.now() + 180000 };
  game.room.pickups.set(ammoStack.id, ammoStack);
  player.ammo.rifle.reserve = WEAPONS.rifle.reserve - 2;
  const partialAmmo = await request(game.firstSocket, 'loot:pickup', { id: ammoStack.id });
  assert.equal(partialAmmo.count, 1);
  assert.equal(game.room.pickups.get(ammoStack.id).count, 1);
  game.firstSocket.disconnect();
  const resumedSocket = await game.client();
  const resumed = await request(resumedSocket, 'room:resume', {
    code: game.first.code, token: game.first.token,
  });
  const self = resumed.room.players.find((entry) => entry.id === game.first.selfId);
  assert.equal(self.health, 100);
  assert.equal(self.ammo.rifle.reserve, WEAPONS.rifle.reserve);
  assert.equal(resumed.room.pickups.find((entry) => entry.id === ammoStack.id).count, 1);
  player.dead = true;
  assert.equal((await request(resumedSocket, 'loot:pickup', { id: ammoStack.id })).error,
    'not_available');
  assert.equal(game.room.pickups.get(ammoStack.id).count, 1);
});

test('armor plates apply immediately, cap at 100, and persist through reconnect', async (t) => {
  const game = await fixture(t);
  const player = game.room.players.get(game.first.selfId);
  const plates = [...game.room.pickups.values()].filter((item) => item.itemId === 'armor');
  assert.ok(plates.length >= 3);
  assert.equal(game.first.room.players.find((entry) => entry.id === player.id).armor, 0);
  player.health = 66;
  const protection = player.spawnProtectedUntil;
  for (let index = 0; index < 2; index++) {
    setPosition(player, plates[index].x, plates[index].z);
    const equipped = await request(game.firstSocket, 'loot:pickup', {
      id: plates[index].id, armor: 9999,
    });
    assert.equal(equipped.ok, true);
    assert.equal(equipped.armor, (index + 1) * 50);
    assert.equal(equipped.health, 66, 'armor does not heal existing wounds');
  }
  assert.equal(player.spawnProtectedUntil, protection);
  setPosition(player, plates[2].x, plates[2].z);
  assert.equal((await request(game.firstSocket, 'loot:pickup', { id: plates[2].id })).error,
    'armor_full');
  assert.equal(game.room.pickups.has(plates[2].id), true);
  const stack = { ...plates[2], id: 'stack-armor', source: 'player',
    count: 3, expiresAt: game.now() + 180000 };
  game.room.pickups.set(stack.id, stack);
  player.armor = 75;
  const partial = await request(game.firstSocket, 'loot:pickup', { id: stack.id });
  assert.equal(partial.armor, 100);
  assert.equal(partial.count, 1);
  assert.equal(game.room.pickups.get(stack.id).count, 2);
  game.firstSocket.disconnect();
  const resumedSocket = await game.client();
  const resumed = await request(resumedSocket, 'room:resume', {
    code: game.first.code, token: game.first.token,
  });
  assert.equal(resumed.room.players.find((entry) => entry.id === player.id).armor, 100);
  assert.equal(resumed.room.pickups.find((entry) => entry.id === stack.id).count, 2);
});

test('PvP gunfire drains armor before health and reports the damage split', async (t) => {
  const game = await fixture(t);
  const attacker = game.room.players.get(game.first.selfId);
  const target = game.room.players.get(game.second.selfId);
  setPosition(attacker, 100, 0);
  setPosition(target, 100, -10, Math.PI);
  target.armor = 100;
  game.advance(SPAWN_PROTECTION_MS + 1);
  const events = [];
  game.secondSocket.on('combat:event', (event) => events.push(event));
  assert.equal((await request(game.firstSocket, 'inventory:select', { weapon: 'rifle' })).ok,
    true);
  const fire = () => request(game.firstSocket, 'combat:fire', {
    weapon: 'rifle', origin: { x: attacker.x, y: attacker.y, z: attacker.z },
    direction: { x: 0, y: 0, z: -1 }, damage: 9999,
  });
  const first = await fire();
  assert.equal(first.hit.damage, WEAPONS.rifle.damage);
  assert.equal(first.hit.armorDamage, 60);
  assert.equal(first.hit.healthDamage, 0);
  assert.equal(first.hit.armor, 40);
  assert.equal(first.hit.health, 100);
  game.advance(WEAPONS.rifle.fireIntervalMs);
  const second = await fire();
  assert.equal(second.hit.armorDamage, 40);
  assert.equal(second.hit.healthDamage, 20);
  assert.equal(second.hit.armor, 0);
  assert.equal(second.hit.health, 80);
  target.health = 35;
  game.advance(WEAPONS.rifle.fireIntervalMs);
  const third = await fire();
  assert.equal(third.hit.armorDamage, 0);
  assert.equal(third.hit.healthDamage, 35);
  assert.equal(third.hit.health, 0);
  assert.equal(third.hit.dead, true);
  await pause(10);
  assert.ok(events.some((event) => event.kind === 'hit' && event.targetId === target.id
    && event.armorDamage === 40 && event.healthDamage === 20));
  assert.ok(events.some((event) => event.kind === 'death' && event.playerId === target.id
    && event.armor === 0 && event.health === 0));
  game.advance(RESPAWN_DELAY_MS);
  const respawn = await request(game.secondSocket, 'player:respawn');
  assert.equal(respawn.armor, 0);
  assert.equal(game.room.players.get(target.id).armor, 0);
});

test('timed grenade applies server damage, drops carried gear, and respawns with a revolver', async (t) => {
  const game = await fixture(t);
  const shooter = game.room.players.get(game.first.selfId);
  const victim = game.room.players.get(game.second.selfId);
  setPosition(shooter, 100, 0);
  setPosition(victim, 100, -9, Math.PI);
  shooter.inventory = collectItem(shooter.inventory, 'grenade');
  victim.inventory = collectItem(collectItem(victim.inventory, 'shotgun'), 'mine', 2);
  victim.health = 25;
  victim.armor = 50;
  game.advance(SPAWN_PROTECTION_MS + 1);
  const events = [];
  game.secondSocket.on('combat:event', (event) => events.push(event));
  const used = await request(game.firstSocket, 'combat:use', {
    kind: 'grenade', target: { x: 100, z: -8 }, damage: 9999,
  });
  assert.equal(used.ok, true);
  assert.equal(used.inventory.grenades, 0);
  assert.equal(used.explosive.detonatesAt, game.now() + EXPLOSIVES.grenade.fuseMs);
  assert.equal(game.room.explosives.size, 1);
  game.advance(EXPLOSIVES.grenade.fuseMs - 1);
  await pause();
  assert.equal(victim.health, 25, 'fuse must expire before damage');
  const explosionReceived = waitForCombatEvent(game.secondSocket,
    (event) => event.kind === 'explosion' && event.id === used.explosive.id);
  game.advance(1);
  await explosionReceived;
  assert.equal(victim.dead, true);
  assert.equal(game.room.explosives.size, 0);
  assert.ok(events.some((event) => event.kind === 'hit' && event.targetId === victim.id
    && event.damage <= EXPLOSIVES.grenade.damage));
  assert.ok(events.some((event) => event.kind === 'death' && event.weapon === 'grenade'));
  assert.ok(events.some((event) => event.kind === 'explosion'
    && event.hits.some((hit) => hit.kind === 'player' && hit.targetId === victim.id
      && hit.armorDamage === 50 && hit.healthDamage === 25 && hit.armor === 0)));
  const drops = [...game.room.pickups.values()].filter((item) => item.source === 'player');
  assert.deepEqual(drops.map((item) => item.itemId).sort(), ['mine', 'rifle', 'shotgun']);
  const mines = drops.find((item) => item.itemId === 'mine');
  assert.equal(mines.count, 2);
  shooter.inventory = collectItem(shooter.inventory, 'mine', 2);
  setPosition(shooter, mines.x, mines.z);
  const looted = await request(game.firstSocket, 'loot:pickup', { id: mines.id });
  assert.equal(looted.count, 1);
  assert.equal(looted.inventory.mines, 3);
  assert.equal(game.room.pickups.get(mines.id).count, 1);
  game.advance(RESPAWN_DELAY_MS);
  const respawn = await request(game.secondSocket, 'player:respawn');
  assert.equal(respawn.ok, true);
  assert.deepEqual(respawn.inventory.guns, ['revolver']);
  assert.equal(respawn.inventory.mines, 0);
  assert.equal((await request(game.secondSocket, 'combat:reload', { weapon: 'rifle' })).error,
    'gun_not_owned');
  game.advance(180000);
  await pause();
  assert.equal([...game.room.pickups.values()].filter((item) => item.source === 'player').length,
    0, 'death drops expire and cannot grow without bound');
});

test('mine validation, arming, trigger and expiry are server controlled', async (t) => {
  const game = await fixture(t);
  const owner = game.room.players.get(game.first.selfId);
  const target = game.room.players.get(game.second.selfId);
  setPosition(owner, 100, 0);
  setPosition(target, 100, -6);
  owner.inventory = collectItem(owner.inventory, 'mine', 2);
  setPosition(owner, -70, -26);
  assert.equal((await request(game.firstSocket, 'combat:use', {
    kind: 'mine', target: { x: -70, z: -28.5 },
  })).error, 'unsafe_ground');
  setPosition(owner, 100, 0);
  game.advance(SPAWN_PROTECTION_MS + 1);
  const explosions = [];
  game.secondSocket.on('combat:event', (event) => {
    if (event.kind === 'explosion') explosions.push(event);
  });
  assert.equal((await request(game.firstSocket, 'combat:use', {
    kind: 'mine', target: { x: 100, z: -10 },
  })).error, 'invalid_target');
  assert.equal((await request(game.firstSocket, 'combat:use', {
    kind: 'mine', target: { x: 100, z: 1.5 },
  })).error, 'invalid_facing');
  const placed = await request(game.firstSocket, 'combat:use', {
    kind: 'mine', target: { x: 100, z: -1.5 }, damage: 9999,
  });
  assert.equal(placed.ok, true);
  assert.equal(placed.inventory.mines, 1);
  assert.ok(owner.spawnProtectedUntil <= game.now(),
    'deploying a mine ends the owner’s spawn protection');
  assert.equal((await request(game.firstSocket, 'combat:use', {
    kind: 'mine', target: { x: 100, z: -1.7 },
  })).error, 'use_rate_limited');
  game.firstSocket.disconnect();
  const resumedSocket = await game.client();
  const resumed = await request(resumedSocket, 'room:resume', {
    code: game.first.code, token: game.first.token,
  });
  assert.equal(resumed.room.explosives.find((item) => item.id === placed.explosive.id)
    .armedAt, placed.explosive.armedAt);
  setPosition(target, 100, -2);
  game.advance(EXPLOSIVES.mine.armMs - 1);
  await pause();
  assert.equal(target.health, 100, 'an unarmed mine does not trigger');
  game.advance(1);
  await pause();
  assert.ok(target.health < 100);
  assert.equal(game.room.explosives.has(placed.explosive.id), false);
  const hitHealth = target.health;
  await pause();
  assert.equal(target.health, hitHealth);
  assert.equal(explosions.filter((event) => event.id === placed.explosive.id).length, 1);
  setPosition(target, 100, -20);
  game.advance(350);
  const second = await request(resumedSocket, 'combat:use', {
    kind: 'mine', target: { x: 100, z: -1.5 },
  });
  assert.equal(second.ok, true);
  game.advance(EXPLOSIVES.mine.ttlMs);
  await pause();
  assert.equal(game.room.explosives.has(second.explosive.id), false,
    'an untouched mine cannot accumulate forever');
});

test('grenade cannot pass through masonry or injure a spawn-protected player', async (t) => {
  const game = await fixture(t);
  const owner = game.room.players.get(game.first.selfId);
  const target = game.room.players.get(game.second.selfId);
  owner.inventory = collectItem(owner.inventory, 'grenade');
  setPosition(owner, -65, 112);
  assert.equal((await request(game.firstSocket, 'combat:use', {
    kind: 'grenade', target: { x: -65, z: 98 },
  })).error, 'blocked_throw');
  assert.equal(owner.inventory.grenades, 1, 'blocked throws do not consume inventory');
  setPosition(owner, 100, 0);
  setPosition(target, 100, -8);
  const used = await request(game.firstSocket, 'combat:use', {
    kind: 'grenade', target: { x: 100, z: -7 },
  });
  assert.equal(used.ok, true);
  game.advance(EXPLOSIVES.grenade.fuseMs);
  await pause();
  assert.equal(target.health, 100);
});

test('Explore grenade harms wildlife but never damages players', async (t) => {
  const game = await fixture(t, 'explore');
  game.room.world.weather = 'clear';
  const shooter = game.room.players.get(game.first.selfId);
  const bystander = game.room.players.get(game.second.selfId);
  const animal = wildlifeTargetsAt(SERVER_WILDLIFE_HOMES, 0, 'clear',
    { multiplayer: true, terrainHeight: islandTerrainHeightAt })
    .find((entry) => entry.id === 'sheep-0');
  setPosition(shooter, animal.x, animal.z + 8);
  setPosition(bystander, animal.x, animal.z + 1);
  bystander.armor = 50;
  shooter.inventory = collectItem(shooter.inventory, 'grenade');
  const state = game.room.wildlife.get(animal.id);
  const oldHealth = state.health;
  const used = await request(game.firstSocket, 'combat:use', {
    kind: 'grenade', target: { x: animal.x, z: animal.z },
  });
  assert.equal(used.ok, true);
  game.advance(EXPLOSIVES.grenade.fuseMs);
  await pause();
  assert.equal(bystander.health, 100);
  assert.equal(bystander.armor, 50);
  assert.ok(state.health < oldHealth, 'the server includes nearby wildlife in blast damage');
});
