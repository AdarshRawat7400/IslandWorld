import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createMultiplayerServer } from '../server/index.js';
import { shotBlockedByStructures, shotBlockedByTerrain } from '../server/lineOfSight.js';
import { MAX_HEALTH, RESPAWN_DELAY_MS, SPAWN_PROTECTION_MS,
  WEAPONS, rayPlayerHit } from '../src/multiplayerRules.js';
import { playerEyeHeightAt } from '../src/world.js';

const emit = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result));
});

async function setup(t, mode = 'pvp') {
  let now = 1_000_000;
  const server = createMultiplayerServer({ host: '127.0.0.1', port: 0,
    clock: () => now, snapshotMs: 30, random: () => 0 });
  const address = await server.listen();
  const sockets = [];
  t.after(async () => { sockets.forEach((socket) => socket.disconnect()); await server.close(); });
  async function connectOne() {
    const socket = connect(`http://127.0.0.1:${address.port}`,
      { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve); socket.once('connect_error', reject);
    });
    return socket;
  }
  const shooterSocket = await connectOne();
  const a = await emit(shooterSocket, 'room:create', { name: 'A', mode });
  const targetSocket = await connectOne();
  const b = await emit(targetSocket, 'room:join', { code: a.code, name: 'B' });
  const room = server.rooms.get(a.code);
  const shooter = room.players.get(a.selfId);
  const target = room.players.get(b.selfId);
  Object.assign(shooter, { x: 100, y: playerEyeHeightAt(100, 0),
    z: 0, yaw: 0, pitch: 0 });
  Object.assign(target, { x: 100, y: playerEyeHeightAt(100, -10),
    z: -10, yaw: Math.PI, pitch: 0 });
  const shot = async (weapon = 'revolver', override = {}) => {
    await emit(shooterSocket, 'inventory:select', { weapon });
    return emit(shooterSocket, 'combat:fire', {
      weapon, origin: { x: shooter.x, y: shooter.y, z: shooter.z },
      direction: { x: 0, y: 0, z: -1 }, ...override,
    });
  };
  return { server, room, shooter, target, shooterSocket, targetSocket,
    shot, advance: (ms) => { now += ms; }, now: () => now };
}

test('hitscan accepts a forward human-sized target and rejects impossible rays', () => {
  assert.equal(rayPlayerHit({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: -1 },
    { x: 0, y: 2, z: -10 }, 65), 10);
  assert.equal(rayPlayerHit({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: -1 },
    { x: 2, y: 2, z: -10 }, 65), null);
  assert.equal(rayPlayerHit({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: -1 },
    { x: 0, y: 2, z: -70 }, 65), null);
  assert.equal(shotBlockedByStructures({ x: -90, y: 36, z: 160 },
    { x: -90, y: 36, z: 210 }), true, 'lodge footprint obstructs a shot');
  assert.equal(shotBlockedByStructures({ x: -90, y: 60, z: 160 },
    { x: -90, y: 60, z: 210 }), false, 'a shot above the roof is possible');
});

test('Explore room allows firing but blocks all player damage', async (t) => {
  const game = await setup(t, 'explore');
  game.advance(SPAWN_PROTECTION_MS + 1);
  const shot = await game.shot();
  assert.equal(shot.ok, true);
  assert.equal(shot.hit, null);
  assert.equal(game.target.health, MAX_HEALTH);
  assert.equal(game.shooter.ammo.revolver.magazine, WEAPONS.revolver.magazine - 1);
});

test('PvP server owns hit, health, rate, ammo, death, respawn and protection', async (t) => {
  const game = await setup(t);
  const combatEvents = [];
  game.targetSocket.on('combat:event', (event) => combatEvents.push(event));
  assert.equal((await game.shot()).hit, null, 'fresh spawns are protected');
  assert.equal(game.target.health, MAX_HEALTH);
  game.advance(SPAWN_PROTECTION_MS + 1);
  let result = await game.shot('revolver', { targetId: game.target.id, damage: 9999 });
  assert.equal(result.ok, true);
  assert.ok(result.hit.distance >= 9 && result.hit.distance <= 11,
    'the authoritative impact distance is returned for tracer clipping');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(combatEvents.some((event) => event.kind === 'hit'
    && event.targetId === game.target.id && event.health === result.hit.health),
  'victim receives a hit event as well as a shot event');
  assert.equal(result.hit.damage, WEAPONS.revolver.damage, 'client damage is ignored');
  assert.equal(result.hit.health, MAX_HEALTH - WEAPONS.revolver.damage);
  assert.equal((await game.shot()).error, 'fire_rate_limited');
  assert.equal(game.target.health, MAX_HEALTH - WEAPONS.revolver.damage);
  game.advance(WEAPONS.revolver.fireIntervalMs);
  result = await game.shot();
  assert.equal(result.hit.health, 32);
  game.advance(WEAPONS.revolver.fireIntervalMs);
  result = await game.shot();
  assert.equal(result.hit.health, 0);
  assert.equal(result.hit.dead, true);
  assert.equal(game.target.dead, true);
  assert.equal((await emit(game.targetSocket, 'player:respawn')).error, 'respawn_unavailable');
  game.advance(RESPAWN_DELAY_MS);
  const respawn = await emit(game.targetSocket, 'player:respawn');
  assert.equal(respawn.ok, true);
  assert.equal(respawn.health, MAX_HEALTH);
  assert.ok(respawn.spawnProtectedUntil > game.now());
  assert.equal(game.target.dead, false);
  assert.equal(game.target.ammo.revolver.magazine, WEAPONS.revolver.magazine);
});

test('PvP damage is blocked when a ray crosses the high coastal cliff', async (t) => {
  const game = await setup(t);
  game.advance(SPAWN_PROTECTION_MS + 1);
  const origin = { x: -330, y: 8, z: -120 };
  const target = { x: -260, y: 40, z: -120 };
  const length = Math.hypot(target.x - origin.x, target.y - origin.y,
    target.z - origin.z);
  const direction = { x: (target.x - origin.x) / length,
    y: (target.y - origin.y) / length,
    z: (target.z - origin.z) / length };
  Object.assign(game.shooter, { ...origin, yaw: -Math.PI / 2,
    pitch: Math.asin(direction.y) });
  Object.assign(game.target, target);
  assert.equal(shotBlockedByStructures(origin, target), false);
  assert.equal(shotBlockedByTerrain(origin, target), true);
  const result = await game.shot('rifle', { origin, direction });
  assert.equal(result.ok, true);
  assert.equal(result.hit, null);
  assert.equal(game.target.health, MAX_HEALTH);
});

test('invalid origin/facing, empty magazine, timed reload and range are enforced', async (t) => {
  const game = await setup(t);
  game.advance(SPAWN_PROTECTION_MS + 1);
  assert.equal((await game.shot('rifle', { origin: { x: 30, y: 2, z: 0 } })).error,
    'invalid_shot');
  assert.equal((await game.shot('rifle', { direction: { x: 0, y: 0, z: 1 } })).error,
    'invalid_facing');
  assert.equal(game.shooter.ammo.rifle.magazine, WEAPONS.rifle.magazine);
  game.target.z = -WEAPONS.rifle.range - 5;
  assert.equal((await game.shot('rifle')).hit, null);
  game.target.z = -10;
  for (let i = 1; i < WEAPONS.rifle.magazine; i++) {
    game.advance(WEAPONS.rifle.fireIntervalMs);
    await game.shot('rifle');
  }
  assert.equal(game.shooter.ammo.rifle.magazine, 0);
  game.advance(WEAPONS.rifle.fireIntervalMs);
  assert.equal((await game.shot('rifle')).error, 'empty_magazine');
  const reload = await emit(game.shooterSocket, 'combat:reload', { weapon: 'rifle' });
  assert.equal(reload.ok, true);
  assert.equal((await game.shot('rifle')).error, 'reloading');
  game.advance(WEAPONS.rifle.reloadMs);
  // Reload finishes authoritatively on the next command/tick.
  assert.equal((await game.shot('rifle')).ok, true);
  assert.equal(game.shooter.ammo.rifle.magazine, WEAPONS.rifle.magazine - 1);
  assert.equal(game.shooter.ammo.rifle.reserve, WEAPONS.rifle.reserve - WEAPONS.rifle.magazine);
});

test('vehicle lease is exclusive and movement cannot teleport a car', async (t) => {
  const game = await setup(t);
  const vehicle = game.room.vehicles.get('staff_car');
  Object.assign(game.shooter, { x: vehicle.x, y: 44, z: vehicle.z });
  Object.assign(game.target, { x: vehicle.x + 1, y: 44, z: vehicle.z });
  const enter = await emit(game.shooterSocket, 'vehicle:enter', { id: vehicle.id });
  assert.equal(enter.ok, true);
  assert.equal(vehicle.ownerId, game.shooter.id);
  assert.equal((await emit(game.targetSocket, 'vehicle:enter', { id: vehicle.id })).error,
    'vehicle_unavailable');
  game.shooterSocket.emit('vehicle:state', { id: vehicle.id, x: vehicle.x + 100,
    z: vehicle.z, heading: vehicle.heading, speed: 10 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(vehicle.x, -34);
  game.shooterSocket.emit('vehicle:state', { id: vehicle.id, x: vehicle.x + 0.4,
    z: vehicle.z, heading: vehicle.heading, speed: 0.5 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(vehicle.x, -33.6);
  assert.equal((await emit(game.shooterSocket, 'vehicle:exit', { id: vehicle.id })).ok, true);
  assert.equal(vehicle.ownerId, null);
});
