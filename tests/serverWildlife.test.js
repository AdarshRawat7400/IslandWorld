import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createMultiplayerServer } from '../server/index.js';
import { SERVER_WILDLIFE_HOMES, WILDLIFE_KINDS, wildlifeTargetsAt } from '../src/fauna.js';
import { rayWildlifeHit, SPAWN_PROTECTION_MS, WEAPONS } from '../src/multiplayerRules.js';
import { islandTerrainHeightAt, playerEyeHeightAt, shotBlockedByTerrain }
  from '../src/world.js';

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

async function roomHarness(t, mode) {
  let now = 2_000_000;
  const server = createMultiplayerServer({ host: '127.0.0.1', port: 0,
    clock: () => now, snapshotMs: 25 });
  const address = await server.listen();
  const sockets = [];
  t.after(async () => { sockets.forEach((socket) => socket.disconnect()); await server.close(); });
  const client = async () => {
    const socket = connect(`http://127.0.0.1:${address.port}`,
      { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve); socket.once('connect_error', reject);
    });
    return socket;
  };
  const shooterSocket = await client();
  const joined = await request(shooterSocket, 'room:create', { name: 'Hunter', mode });
  const witnessSocket = await client();
  const witness = await request(witnessSocket, 'room:join', { code: joined.code,
    name: 'Witness' });
  const room = server.rooms.get(joined.code);
  room.world.weather = 'clear';
  const shooter = room.players.get(joined.selfId);
  assert.equal((await request(shooterSocket, 'inventory:select', { weapon: 'rifle' })).ok,
    true);
  const bystander = room.players.get(witness.selfId);
  const animal = wildlifeTargetsAt(SERVER_WILDLIFE_HOMES, 0, 'clear',
    { multiplayer: true, terrainHeight: islandTerrainHeightAt })
    .find((candidate) => candidate.id === 'sheep-0');
  const origin = { x: animal.x, z: animal.z + 8,
    y: playerEyeHeightAt(animal.x, animal.z + 8) };
  const length = Math.hypot(animal.x - origin.x, animal.y - origin.y,
    animal.z - origin.z);
  const direction = { x: (animal.x - origin.x) / length,
    y: (animal.y - origin.y) / length,
    z: (animal.z - origin.z) / length };
  Object.assign(shooter, { ...origin, yaw: 0, pitch: Math.atan2(direction.y,
    Math.hypot(direction.x, direction.z)), mode: 'walk' });
  Object.assign(bystander, { x: origin.x, y: origin.y + direction.y * 4,
    z: origin.z - 4, mode: 'walk' });
  const fire = (aimedTarget = animal) => {
    const length = Math.hypot(aimedTarget.x - origin.x, aimedTarget.y - origin.y,
      aimedTarget.z - origin.z);
    const aim = { x: (aimedTarget.x - origin.x) / length,
      y: (aimedTarget.y - origin.y) / length,
      z: (aimedTarget.z - origin.z) / length };
    shooter.yaw = Math.atan2(-aim.x, -aim.z);
    shooter.pitch = Math.asin(aim.y);
    return request(shooterSocket, 'combat:fire', {
      weapon: 'rifle', origin, direction: aim,
    });
  };
  return { server, room, shooter, bystander, shooterSocket, witnessSocket,
    initialWildlife: joined.room.wildlife,
    animal, origin, direction, fire, now: () => now, advance: (ms) => { now += ms; } };
}

test('rayWildlifeHit uses the first intersection of each moving animal sphere', () => {
  const origin = { x: 0, y: 2, z: 0 };
  const direction = { x: 0, y: 0, z: -1 };
  assert.equal(rayWildlifeHit(origin, direction,
    { x: 0, y: 2, z: -10, radius: 1 }, 65), 9);
  assert.equal(rayWildlifeHit(origin, direction,
    { x: 2, y: 2, z: -10, radius: 1 }, 65), null);
  assert.equal(rayWildlifeHit(origin, direction,
    { x: 0, y: 2, z: -10, radius: 1 }, 8.9), null);
  assert.equal(rayWildlifeHit(origin, direction,
    { x: 0, y: 2, z: -10, radius: -1 }, 65), null);
  assert.equal(shotBlockedByTerrain({ x: -330, y: 8, z: -120 },
    { x: -260, y: 40, z: -120 }), true, 'the west cliff blocks shots through rock');
  assert.equal(shotBlockedByTerrain({ x: -300, y: 50, z: -120 },
    { x: -250, y: 50, z: -120 }), false, 'a clear ray above the ridge remains possible');
});

test('Explore gunfire hunts server-owned wildlife without injuring a player', async (t) => {
  const game = await roomHarness(t, 'explore');
  assert.equal(game.room.wildlife.size, 250);
  assert.deepEqual(game.initialWildlife, [],
    'healthy deterministic wildlife is omitted from room snapshots');
  assert.equal(game.room.wildlife.get(game.animal.id).health,
    WILDLIFE_KINDS.sheep.maxHealth);
  const changed = observe(game.witnessSocket, 'wildlife:state',
    (state) => state.id === game.animal.id && state.dead);
  const shot = await game.fire();
  assert.equal(shot.ok, true);
  assert.equal(shot.hit.kind, 'wildlife');
  assert.equal(shot.hit.id, game.animal.id);
  assert.equal(shot.hit.dead, true);
  assert.equal(shot.ammo.magazine, WEAPONS.rifle.magazine - 1);
  assert.equal(game.bystander.health, 100, 'Explore never damages the bystander in the ray');
  assert.equal((await changed).health, 0);
  const current = game.room.wildlife.get(game.animal.id);
  assert.equal(current.dead, true);
  const deadSnapshot = await observe(game.witnessSocket, 'room:snapshot',
    (snapshot) => snapshot.wildlife.some((state) => state.id === game.animal.id));
  assert.equal(deadSnapshot.wildlife.length, 1,
    'the snapshot sends only the animal with changed health');
  game.advance(WILDLIFE_KINDS.sheep.respawnMs - 1);
  assert.equal(current.dead, true);
  const revived = observe(game.witnessSocket, 'wildlife:state',
    (state) => state.id === game.animal.id && !state.dead);
  game.advance(1);
  assert.equal((await revived).health, WILDLIFE_KINDS.sheep.maxHealth);
  assert.equal(current.dead, false);
  const healedSnapshot = await observe(game.witnessSocket, 'room:snapshot',
    (snapshot) => !snapshot.wildlife.some((state) => state.id === game.animal.id));
  assert.equal(healedSnapshot.wildlife.length, 0);
});

test('PvP chooses the nearer player before wildlife, then hits wildlife once clear', async (t) => {
  const game = await roomHarness(t, 'pvp');
  game.advance(SPAWN_PROTECTION_MS + 1);
  const first = await game.fire();
  assert.equal(first.hit.kind, 'player');
  assert.equal(first.hit.targetId, game.bystander.id);
  assert.equal(game.bystander.health, 100 - WEAPONS.rifle.damage);
  assert.equal(game.room.wildlife.get(game.animal.id).health,
    WILDLIFE_KINDS.sheep.maxHealth);
  game.bystander.x += 5;
  game.advance(WEAPONS.rifle.fireIntervalMs);
  const currentTarget = wildlifeTargetsAt(SERVER_WILDLIFE_HOMES,
    (game.now() - game.room.world.startedAt) / 1000, 'clear',
    { multiplayer: true, terrainHeight: islandTerrainHeightAt })
    .find((animal) => animal.id === game.animal.id);
  const second = await game.fire(currentTarget);
  assert.equal(second.hit.kind, 'wildlife');
  assert.equal(second.hit.id, game.animal.id);
  assert.equal(game.room.wildlife.get(game.animal.id).dead, true);
});
