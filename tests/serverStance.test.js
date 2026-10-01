import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createMultiplayerServer } from '../server/index.js';
import { playerStance, stanceEyeHeight } from '../src/playerStance.js';
import { RESPAWN_DELAY_MS, SPAWN_PROTECTION_MS, WEAPONS }
  from '../src/multiplayerRules.js';
import { playerEyeHeightAt } from '../src/world.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(event, payload, (error, result) =>
    error ? reject(error) : resolve(result));
});

async function harness(t) {
  let now = 2_000_000;
  const server = createMultiplayerServer({ host: '127.0.0.1', port: 0,
    clock: () => now, snapshotMs: 25, random: () => 0 });
  const { port } = await server.listen();
  const sockets = [];
  t.after(async () => { sockets.forEach((socket) => socket.disconnect()); await server.close(); });
  async function connectPlayer() {
    const socket = connect(`http://127.0.0.1:${port}`,
      { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }
  return { server, connectPlayer, advance: (ms) => { now += ms; }, now: () => now };
}

function move(socket, x, z, stance, yaw = 0, pitch = 0) {
  socket.emit('player:move', { x, y: stanceEyeHeight(playerEyeHeightAt(x, z), stance),
    z, yaw, pitch, mode: 'walk', stance });
}

test('room snapshots carry stance; crouch and prone obey server eye and speed checks',
  async (t) => {
    const game = await harness(t);
    const socket = await game.connectPlayer();
    const joined = await request(socket, 'room:create', { name: 'Stance', mode: 'pvp' });
    const player = game.server.rooms.get(joined.code).players.get(joined.selfId);
    assert.equal(joined.room.players[0].stance, 'stand');

    const x1 = player.x + 0.5, z = player.z;
    move(socket, x1, z, 'crouch');
    await delay(20);
    assert.equal(player.stance, 'crouch');
    assert.equal(player.x, x1);
    assert.ok(Math.abs(player.y - stanceEyeHeight(playerEyeHeightAt(x1, z),
      'crouch')) < 1e-8);
    const snapshot = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('crouch snapshot missing')), 800);
      const handler = (room) => {
        if (room.players?.find(({ id }) => id === player.id)?.stance !== 'crouch') return;
        clearTimeout(timeout); socket.off('room:snapshot', handler); resolve(room);
      };
      socket.on('room:snapshot', handler);
    });
    assert.equal(snapshot.players.find(({ id }) => id === player.id).stance, 'crouch');

    game.advance(1000);
    move(socket, x1 + 6, z, 'crouch');
    await delay(15);
    assert.equal(player.x, x1, 'crouch speed cap rejects a six-metre second');
    move(socket, x1 + 2, z, 'crouch');
    await delay(15);
    assert.equal(player.x, x1 + 2, 'a normal crouch step remains responsive');

    socket.emit('player:move', { x: player.x + 0.1,
      y: playerEyeHeightAt(player.x + 0.1, z), z,
      yaw: 0, pitch: 0, mode: 'walk', stance: 'prone' });
    await delay(15);
    assert.equal(player.stance, 'crouch', 'forged prone eye height is rejected');
    const proneX = player.x;
    move(socket, proneX, z, 'prone');
    await delay(15);
    assert.equal(player.stance, 'prone');
    game.advance(1000);
    move(socket, proneX + 4, z, 'prone');
    await delay(15);
    assert.equal(player.x, proneX, 'prone speed cap rejects sprinting');
    move(socket, proneX + 1, z, 'prone');
    await delay(15);
    assert.equal(player.x, proneX + 1);
  });

test('server hitbox permits a low shot at prone player but rejects a standing-height shot',
  async (t) => {
    const game = await harness(t);
    const shooterSocket = await game.connectPlayer();
    const joined = await request(shooterSocket, 'room:create',
      { name: 'Shooter', mode: 'pvp' });
    const targetSocket = await game.connectPlayer();
    const targetJoined = await request(targetSocket, 'room:join',
      { code: joined.code, name: 'Target' });
    const room = game.server.rooms.get(joined.code);
    const shooter = room.players.get(joined.selfId);
    const target = room.players.get(targetJoined.selfId);
    move(targetSocket, target.x, target.z, 'prone');
    move(shooterSocket, shooter.x, shooter.z, 'stand', -Math.PI / 2, 0);
    await delay(20);
    assert.equal(target.stance, 'prone');
    game.advance(SPAWN_PROTECTION_MS + 1);

    const highShot = await request(shooterSocket, 'combat:fire', {
      weapon: 'revolver', origin: { x: shooter.x, y: shooter.y, z: shooter.z },
      direction: { x: 1, y: 0, z: 0 },
    });
    assert.equal(highShot.ok, true);
    assert.notEqual(highShot.hit?.targetId, target.id);
    assert.equal(target.health, 100);

    game.advance(WEAPONS.revolver.fireIntervalMs + 1);
    const targetCenterY = target.y - playerStance(target.stance).eyeHeight
      + playerStance(target.stance).hitHeight / 2;
    const dx = target.x - shooter.x, dy = targetCenterY - shooter.y;
    const length = Math.hypot(dx, dy);
    const pitch = Math.atan2(dy, dx);
    move(shooterSocket, shooter.x, shooter.z, 'stand', -Math.PI / 2, pitch);
    await delay(15);
    const lowShot = await request(shooterSocket, 'combat:fire', {
      weapon: 'revolver', origin: { x: shooter.x, y: shooter.y, z: shooter.z },
      direction: { x: dx / length, y: dy / length, z: 0 },
    });
    assert.equal(lowShot.ok, true);
    assert.equal(lowShot.hit?.kind, 'player');
    assert.equal(lowShot.hit?.targetId, target.id);
    assert.equal(target.health, 100 - WEAPONS.revolver.damage);
  });

test('health respawn restores standing stance and eye height', async (t) => {
  const game = await harness(t);
  const socket = await game.connectPlayer();
  const joined = await request(socket, 'room:create',
    { name: 'Respawner', mode: 'pvp' });
  const player = game.server.rooms.get(joined.code).players.get(joined.selfId);
  move(socket, player.x, player.z, 'prone');
  await delay(15);
  assert.equal(player.stance, 'prone');
  player.dead = true;
  player.deadAt = game.now();
  game.advance(RESPAWN_DELAY_MS);
  const result = await request(socket, 'player:respawn');
  assert.equal(result.ok, true);
  assert.equal(player.stance, 'stand');
  assert.ok(Math.abs(player.y - playerEyeHeightAt(player.x, player.z)) < 1e-8);
  assert.equal(player.health, 100);
});

test('standing travel accepts a 7.3 m/s sprint while rejecting a teleport', async (t) => {
  const game = await harness(t);
  const socket = await game.connectPlayer();
  const joined = await request(socket, 'room:create', { name: 'Runner', mode: 'explore' });
  const player = game.server.rooms.get(joined.code).players.get(joined.selfId);
  const startX = player.x, z = player.z;
  move(socket, startX + 0.1, z, 'stand');
  await delay(15);
  assert.equal(player.hasMoved, true);
  game.advance(1000);
  move(socket, startX + 7.4, z, 'stand');
  await delay(15);
  assert.equal(player.x, startX + 7.4,
    'the sprint controller maximum fits the standing server travel allowance');
  game.advance(1000);
  move(socket, startX + 27.4, z, 'stand');
  await delay(15);
  assert.equal(player.x, startX + 7.4, 'a twenty-metre second is rejected');
});
