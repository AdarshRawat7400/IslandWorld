import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import * as THREE from 'three';
import { createMultiplayerServer } from '../server/index.js';
import { ARRIVAL_SPAWNS, MAX_ROOM_PLAYERS, RECONNECT_GRACE_MS, SAFE_SPAWNS }
  from '../src/multiplayerRules.js';
import { createWorld, islandCoastalRadiusAt, playerEyeHeightAt } from '../src/world.js';
import { buildingWallBlocks, circlesBlock } from '../src/collision.js';
import { createSetDressing } from '../src/setDressing.js';
import { SITES } from '../src/worldSites.js';
import { isRoad } from '../src/roads.js';

const emit = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result));
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function harness(t, options = {}) {
  const server = createMultiplayerServer({ port: 0, host: '127.0.0.1', snapshotMs: 35, ...options });
  const address = await server.listen();
  const clients = [];
  t.after(async () => { clients.forEach((socket) => socket.disconnect()); await server.close(); });
  async function client() {
    const socket = connect(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'], reconnection: false, timeout: 2000,
    });
    clients.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve); socket.once('connect_error', reject);
    });
    return socket;
  }
  return { server, client };
}

test('a short-code room caps at ten, survives its creator leaving, and isolates snapshots', async (t) => {
  const { server, client } = await harness(t);
  const creator = await client();
  const created = await emit(creator, 'room:create', { name: 'Keeper', mode: 'explore' });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-Z2-9]{6}$/);
  assert.equal(created.room.mode, 'explore');
  assert.equal(created.room.players[0].name, 'Keeper');
  assert.ok(Number.isFinite(created.room.serverNow));
  const members = [];
  for (let index = 1; index < MAX_ROOM_PLAYERS; index++) {
    const socket = await client();
    const joined = await emit(socket, 'room:join', { code: created.code.toLowerCase(), name: `P${index}` });
    assert.equal(joined.ok, true);
    members.push(socket);
  }
  const excess = await client();
  assert.equal((await emit(excess, 'room:join', { code: created.code, name: 'Too Many' })).error,
    'room_full');
  assert.equal(server.rooms.get(created.code).players.size, 10);
  const arrivals = [...server.rooms.get(created.code).players.values()];
  assert.ok(arrivals.every((person) => Math.hypot(person.x, person.z - 270) < 10),
    'every initial player arrives in one South Landing cluster');
  assert.equal((await emit(creator, 'room:leave')).ok, true);
  assert.equal(server.rooms.get(created.code).players.size, 9);
  assert.equal((await emit(excess, 'room:join', { code: created.code, name: 'New Tenth' })).ok, true);
  assert.equal((await emit(members[0], 'room:leave')).ok, true);
  assert.equal((await emit(creator, 'room:join', { code: created.code, name: 'Returning' })).ok, true);
  assert.equal(server.rooms.get(created.code).players.size, 10);
});

test('all ten arrival clearings are walkable and free of lake and tree collisions', () => {
  const world = createWorld(new THREE.Scene(), new THREE.Camera());
  assert.equal(ARRIVAL_SPAWNS.length, 10);
  for (const spawn of ARRIVAL_SPAWNS) {
    assert.equal(world.isWalkable(spawn.x, spawn.z), true, JSON.stringify(spawn));
    assert.equal(world.isLake(spawn.x, spawn.z, 0.32), false, JSON.stringify(spawn));
    assert.equal(circlesBlock(spawn.x, spawn.z, 0.32, world.natureObstacles),
      false, JSON.stringify(spawn));
  }
  for (let i = 0; i < ARRIVAL_SPAWNS.length; i++) {
    for (let j = 0; j < i; j++) {
      assert.ok(Math.hypot(ARRIVAL_SPAWNS[i].x - ARRIVAL_SPAWNS[j].x,
        ARRIVAL_SPAWNS[i].z - ARRIVAL_SPAWNS[j].z) >= 3);
    }
  }
});

test('all PvP respawn clearings avoid water, nature, walls, props and vehicle roads', () => {
  const scene = new THREE.Scene();
  const world = createWorld(scene, new THREE.Camera());
  const dressing = createSetDressing(scene, world.terrainHeight);
  for (const spawn of SAFE_SPAWNS) {
    const label = JSON.stringify(spawn);
    assert.equal(world.isWalkable(spawn.x, spawn.z), true, label);
    assert.equal(world.isLake(spawn.x, spawn.z, 0.32), false, label);
    assert.equal(circlesBlock(spawn.x, spawn.z, 0.32, world.natureObstacles),
      false, label);
    assert.equal(SITES.some((site) => buildingWallBlocks(site,
      spawn.x, spawn.z, 0.32)), false, label);
    assert.equal(dressing.collides(spawn.x, spawn.z, 0.32), false, label);
    assert.equal(isRoad(spawn.x, spawn.z, 0.32), false, label);
  }
});

test('disconnect holds slot during grace; token resumes the same identity and state', async (t) => {
  const { server, client } = await harness(t);
  const first = await client();
  const a = await emit(first, 'room:create', { name: 'A', mode: 'pvp' });
  const second = await client();
  await emit(second, 'room:join', { code: a.code, name: 'B' });
  first.disconnect();
  await delay(50);
  const slot = server.rooms.get(a.code).players.get(a.selfId);
  assert.equal(slot.connected, false);
  assert.ok(slot.disconnectTimer);
  const resumedSocket = await client();
  assert.equal((await emit(resumedSocket, 'room:resume', { code: a.code, token: 'wrong' })).error,
    'resume_expired');
  const resumed = await emit(resumedSocket, 'room:resume', { code: a.code, token: a.token });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.selfId, a.selfId);
  assert.equal(resumed.room.players.length, 2);
  assert.equal(slot.connected, true);
  assert.equal(slot.disconnectTimer, null);
  // The room is a peer room, not owned by its original creator.
  assert.equal((await emit(resumedSocket, 'room:leave')).ok, true);
  assert.equal(server.rooms.has(a.code), true);
  assert.equal(RECONNECT_GRACE_MS, 120000);
});

test('expired reconnect token releases its slot and cannot revive the departed player', async (t) => {
  const { server, client } = await harness(t, { reconnectGraceMs: 45 });
  const aSocket = await client();
  const a = await emit(aSocket, 'room:create', { name: 'A', mode: 'explore' });
  const bSocket = await client();
  await emit(bSocket, 'room:join', { code: a.code, name: 'B' });
  aSocket.disconnect();
  await delay(85);
  assert.equal(server.rooms.get(a.code).players.has(a.selfId), false);
  const resumed = await client();
  assert.equal((await emit(resumed, 'room:resume', { code: a.code, token: a.token })).error,
    'resume_expired');
  assert.equal(server.rooms.has(a.code), true);
});

test('an empty room ends after the last leave or final disconnect grace', async (t) => {
  const { server, client } = await harness(t, { reconnectGraceMs: 45 });
  const first = await client();
  const leftRoom = await emit(first, 'room:create', { name: 'A', mode: 'explore' });
  assert.equal((await emit(first, 'room:leave')).ok, true);
  assert.equal(server.rooms.has(leftRoom.code), false);
  const second = await client();
  const abandoned = await emit(second, 'room:create', { name: 'B', mode: 'pvp' });
  second.disconnect();
  assert.equal(server.rooms.has(abandoned.code), true, 'brief disconnect can still resume');
  await delay(85);
  assert.equal(server.rooms.has(abandoned.code), false, 'idle room is removed after grace');
});

test('rooms isolate weather and vehicle state; invalid world settings are rejected', async (t) => {
  const { server, client } = await harness(t);
  const a = await client(); const b = await client();
  const first = await emit(a, 'room:create', { name: 'A', mode: 'explore' });
  const second = await emit(b, 'room:create', { name: 'B', mode: 'pvp' });
  assert.notEqual(first.code, second.code);
  assert.equal((await emit(a, 'world:set', { weather: 'storm', time: 'night' })).ok, true);
  assert.equal((await emit(b, 'world:set', { weather: 'meteor', time: 'night' })).error,
    'invalid_world_setting');
  assert.equal(server.rooms.get(first.code).world.weather, 'storm');
  assert.equal(server.rooms.get(second.code).world.weather, 'auto');
  assert.equal(server.rooms.get(first.code).vehicles.size, 3);
});

test('walking eye height rejects forged altitude and keeps a server hitbox on visible ground', async (t) => {
  const { server, client } = await harness(t);
  const socket = await client();
  const joined = await emit(socket, 'room:create', { name: 'Walker', mode: 'pvp' });
  const player = server.rooms.get(joined.code).players.get(joined.selfId);
  assert.ok(Math.abs(player.y - playerEyeHeightAt(player.x, player.z)) < 1e-8);
  const near = { x: player.x + 2, z: player.z };
  const eye = playerEyeHeightAt(near.x, near.z);
  socket.emit('player:move', { ...near, y: eye, yaw: 0, pitch: 0, mode: 'walk' });
  await delay(15);
  assert.equal(player.x, near.x);
  socket.emit('player:move', { x: near.x + 0.2, y: 180, z: near.z,
    yaw: 0, pitch: 0, mode: 'walk' });
  await delay(15);
  assert.equal(player.x, near.x, 'a forged high eye position cannot move the hitbox');
  assert.equal(player.y, eye);
  socket.emit('player:move', { x: 270, y: playerEyeHeightAt(270, -270), z: -270,
    yaw: 0, pitch: 0, mode: 'walk' });
  await delay(15);
  assert.equal(player.x, near.x);
});

test('cliff recovery is repeatable before five seconds, keeps health, and rejects inland warps', async (t) => {
  let now = 3_000_000;
  const { server, client } = await harness(t, { clock: () => now });
  const socket = await client();
  const joined = await emit(socket, 'room:create', { name: 'Walker', mode: 'pvp' });
  const player = server.rooms.get(joined.code).players.get(joined.selfId);
  const safe = { x: -314, z: -120, y: playerEyeHeightAt(-314, -120) };
  assert.ok(islandCoastalRadiusAt(safe.x, safe.z) < 0.94);
  const lip = { x: -328, z: -120, y: playerEyeHeightAt(-328, -120) };
  assert.ok(islandCoastalRadiusAt(lip.x, lip.z) > 0.97);
  player.health = 46;
  assert.equal((await emit(socket, 'player:recover', safe)).error,
    'invalid_recovery', 'inland recovery is not a teleport action');
  Object.assign(player, { ...lip, lastSafe: { ...safe }, lastMoveAt: now, hasMoved: true });
  assert.equal((await emit(socket, 'player:recover', { x: 200, y: 5, z: 0 })).error,
    'invalid_recovery');
  assert.equal((await emit(socket, 'player:recover', { ...safe, y: 180 })).error,
    'invalid_recovery');
  assert.equal((await emit(socket, 'player:recover', safe)).ok, true);
  assert.equal(player.health, 46, 'fall recovery is distinct from health respawn');
  now += 2_000;
  Object.assign(player, { ...lip, lastSafe: { ...safe }, lastMoveAt: now });
  assert.equal((await emit(socket, 'player:recover', safe)).ok, true,
    'a second natural fall before the old 5s cooldown must recover');
  socket.emit('player:move', { x: safe.x + 0.15,
    y: playerEyeHeightAt(safe.x + 0.15, safe.z), z: safe.z,
    yaw: 0, pitch: 0, mode: 'walk' });
  await delay(15);
  assert.equal(player.x, safe.x + 0.15, 'normal movement resumes after recovery');
});

test('a driver can release a leased car when its final speed packet is stale', async (t) => {
  const { server, client } = await harness(t);
  const socket = await client();
  const joined = await emit(socket, 'room:create', { name: 'Driver', mode: 'explore' });
  const room = server.rooms.get(joined.code);
  const player = room.players.get(joined.selfId);
  const car = room.vehicles.get('staff_car');
  Object.assign(player, { x: car.x, z: car.z, y: playerEyeHeightAt(car.x, car.z) });
  assert.equal((await emit(socket, 'vehicle:enter', { id: car.id })).ok, true);
  car.speed = 6;
  assert.equal((await emit(socket, 'vehicle:exit', { id: car.id })).ok, true);
  assert.equal(car.ownerId, null);
  assert.equal(car.speed, 0);
  assert.equal(player.vehicleId, null);
  assert.equal(player.mode, 'walk');
});
