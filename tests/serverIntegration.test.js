import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createMultiplayerServer } from '../server/index.js';
import { RESPAWN_DELAY_MS, SPAWN_PROTECTION_MS, WEAPONS } from '../src/multiplayerRules.js';
import { playerEyeHeightAt } from '../src/world.js';

const request = (socket, event, body = {}) => new Promise((resolve, reject) => {
  socket.timeout(2500).emit(event, body, (error, result) => error ? reject(error) : resolve(result));
});
const observe = (socket, event, predicate = () => true) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`${event} not observed`)); }, 2500);
  function handler(value) {
    if (!predicate(value)) return;
    clearTimeout(timer); socket.off(event, handler); resolve(value);
  }
  socket.on(event, handler);
});

test('two isolated Socket.IO identities agree on driving, combat, respawn, mode and reconnect', async (t) => {
  let now = 2_000_000;
  const server = createMultiplayerServer({ host: '127.0.0.1', port: 0,
    clock: () => now, random: () => 0, snapshotMs: 25 });
  const address = await server.listen();
  const clients = [];
  t.after(async () => { clients.forEach((socket) => socket.disconnect()); await server.close(); });
  async function identity() {
    const socket = connect(`http://127.0.0.1:${address.port}`,
      { transports: ['websocket'], reconnection: false });
    clients.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve); socket.once('connect_error', reject);
    });
    return socket;
  }
  const a = await identity();
  const created = await request(a, 'room:create', { name: 'Alice', mode: 'pvp' });
  const b = await identity();
  const joined = await request(b, 'room:join', { code: created.code, name: 'Bob' });
  const room = server.rooms.get(created.code);
  const alice = room.players.get(created.selfId);
  const bob = room.players.get(joined.selfId);
  assert.equal(created.room.mode, 'pvp');
  assert.equal(joined.room.players.length, 2);

  // Fixture positions put the real socket identities near the same car; all
  // state changes and assertions below travel through the network protocol.
  Object.assign(alice, { x: -35, y: 45, z: 117 });
  Object.assign(bob, { x: -33, y: 45, z: 117 });
  a.emit('player:move', { x: -34.8, y: 45, z: 117, yaw: 0, pitch: 0, mode: 'walk' });
  b.emit('player:move', { x: -32.8, y: 45, z: 117, yaw: 0, pitch: 0, mode: 'walk' });
  const sharedMove = await observe(b, 'room:snapshot', (snap) =>
    snap.players.find((p) => p.id === created.selfId)?.x === -34.8);
  assert.equal(sharedMove.players.find((p) => p.id === joined.selfId).x, -32.8);
  assert.equal((await request(a, 'vehicle:enter', { id: 'staff_car' })).ok, true);
  assert.equal((await request(b, 'vehicle:enter', { id: 'staff_car' })).error,
    'vehicle_unavailable');
  assert.equal((await request(a, 'vehicle:state', { id: 'staff_car', x: -33.4, z: 117,
    heading: -1.76, speed: 0.5 })).ok, true);
  const driven = await observe(b, 'room:snapshot', (snap) =>
    snap.vehicles.find((v) => v.id === 'staff_car')?.x === -33.4);
  assert.equal(driven.vehicles.find((v) => v.id === 'staff_car').ownerId, created.selfId);
  assert.equal((await request(a, 'vehicle:exit', { id: 'staff_car' })).ok, true);
  assert.equal((await request(b, 'vehicle:enter', { id: 'staff_car' })).ok, true);
  assert.equal((await request(b, 'vehicle:exit', { id: 'staff_car' })).ok, true);

  Object.assign(alice, { x: 100, y: playerEyeHeightAt(100, 0), z: 0,
    yaw: 0, pitch: 0, mode: 'walk', hasMoved: true });
  Object.assign(bob, { x: 100, y: playerEyeHeightAt(100, -10), z: -10,
    yaw: Math.PI, pitch: 0, mode: 'walk', hasMoved: true });
  now += SPAWN_PROTECTION_MS + 1;
  const fireA = async (weapon) => {
    await request(a, 'inventory:select', { weapon });
    return request(a, 'combat:fire', {
      weapon, origin: { x: alice.x, y: alice.y, z: alice.z },
      direction: { x: 0, y: 0, z: -1 },
    });
  };
  const fireB = async (weapon) => {
    await request(b, 'inventory:select', { weapon });
    return request(b, 'combat:fire', {
      weapon, origin: { x: bob.x, y: bob.y, z: bob.z },
      direction: { x: 0, y: 0, z: 1 },
    });
  };
  const observedShot = observe(b, 'combat:event', (event) =>
    event.kind === 'shot' && event.shooterId === created.selfId);
  let shot = await fireA('revolver');
  assert.equal(shot.hit.health, 66);
  assert.equal(shot.ammo.magazine, WEAPONS.revolver.magazine - 1);
  assert.equal((await observedShot).hit.targetId, joined.selfId);
  assert.equal((await fireA('revolver')).error, 'fire_rate_limited');
  assert.equal((await fireB('rifle')).hit.health, 40);
  now += WEAPONS.revolver.fireIntervalMs;
  assert.equal((await fireA('revolver')).hit.health, 32);
  now += WEAPONS.revolver.fireIntervalMs;
  const death = observe(b, 'combat:event', (event) => event.kind === 'death'
    && event.playerId === joined.selfId);
  shot = await fireA('revolver');
  assert.equal(shot.hit.dead, true);
  assert.equal((await death).killerId, created.selfId);
  const corpse = await observe(a, 'room:snapshot', (snap) =>
    snap.players.find((p) => p.id === joined.selfId)?.dead === true);
  assert.equal(corpse.players.find((p) => p.id === joined.selfId).health, 0);
  assert.equal((await request(b, 'player:respawn')).error, 'respawn_unavailable');
  now += RESPAWN_DELAY_MS;
  const respawned = await request(b, 'player:respawn');
  assert.equal(respawned.ok, true);
  assert.equal(respawned.health, 100);
  assert.equal(respawned.ammo.rifle.magazine, WEAPONS.rifle.magazine);
  Object.assign(bob, { x: 100, y: playerEyeHeightAt(100, -10), z: -10 });
  now += WEAPONS.rifle.fireIntervalMs;
  const protectedShot = await fireA('rifle');
  assert.equal(protectedShot.hit, null);
  assert.equal(bob.health, 100);

  a.disconnect();
  const resumedSocket = await identity();
  const resumed = await request(resumedSocket, 'room:resume', {
    code: created.code, token: created.token,
  });
  assert.equal(resumed.selfId, created.selfId);
  assert.equal((await observe(b, 'room:snapshot', (snap) =>
    snap.players.find((p) => p.id === created.selfId)?.connected === true))
    .players.length, 2);

  const explorer = await identity();
  const explore = await request(explorer, 'room:create', { name: 'Explorer', mode: 'explore' });
  const explorePeer = await identity();
  const companion = await request(explorePeer, 'room:join',
    { code: explore.code, name: 'Companion' });
  const exploreShot = await request(explorer, 'combat:fire', {
    weapon: 'revolver', origin: { x: 0, y: 5, z: 270 },
    direction: { x: 0, y: 0, z: -1 },
  });
  assert.equal(exploreShot.ok, true);
  assert.equal(exploreShot.hit, null);
  assert.equal(server.rooms.get(explore.code).players.get(companion.selfId).health, 100);
  for (let i = 2; i < 10; i++) {
    const socket = await identity();
    assert.equal((await request(socket, 'room:join', { code: explore.code, name: `P${i}` })).ok, true);
  }
  const eleventh = await identity();
  assert.equal((await request(eleventh, 'room:join', { code: explore.code, name: 'P11' })).error,
    'room_full');
});
