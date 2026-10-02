import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createMultiplayerServer } from '../server/index.js';
import { playerEyeHeightAt } from '../src/world.js';
import { RESPAWN_DELAY_MS, SPAWN_PROTECTION_MS, WEAPONS } from '../src/multiplayerRules.js';

const APP_ORIGIN = 'https://localhost';
const GAME_ORIGIN = 'https://islandworld-3ccb4.web.app';
const ALLOWED_ORIGINS = [APP_ORIGIN, GAME_ORIGIN,
  'https://islandworld-3ccb4.firebaseapp.com'];
const request = (socket, event, body = {}) => new Promise((resolve, reject) => {
  socket.timeout(2500).emit(event, body, (error, value) => error ? reject(error) : resolve(value));
});
const observe = (socket, event, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.off(event, handler); reject(new Error(`${event} not observed`));
  }, 2500);
  function handler(value) {
    if (!predicate(value)) return;
    clearTimeout(timer); socket.off(event, handler); resolve(value);
  }
  socket.on(event, handler);
});

async function harness(t, options = {}) {
  const server = createMultiplayerServer({ host: '127.0.0.1', port: 0,
    allowedOrigins: ALLOWED_ORIGINS, snapshotMs: 25, ...options });
  const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach((socket) => socket.disconnect()); await server.close(); });
  async function identity(origin, transports = ['polling', 'websocket']) {
    const socket = connect(url, { extraHeaders: { Origin: origin },
      transports, reconnection: false, timeout: 1800 });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve); socket.once('connect_error', reject);
    });
    return socket;
  }
  return { server, url, identity };
}

test('secure Android and exact Firebase origins connect; lookalikes fail polling and WebSocket', async (t) => {
  const { url, identity } = await harness(t);
  for (const origin of ALLOWED_ORIGINS) {
    const handshake = await fetch(`${url}/socket.io/?EIO=4&transport=polling`,
      { headers: { Origin: origin } });
    assert.equal(handshake.status, 200, origin);
    assert.equal(handshake.headers.get('access-control-allow-origin'), origin);
    assert.match(await handshake.text(), /^0\{/);
    const socket = await identity(origin, ['websocket']);
    assert.equal(socket.connected, true, origin);
    socket.disconnect();
  }
  for (const origin of ['http://localhost', 'https://localhost:444',
    'https://localhost.attacker.example', 'https://islandworld-3ccb4.web.app.attacker.example',
    'https://another-game.web.app', 'capacitor://localhost']) {
    const handshake = await fetch(`${url}/socket.io/?EIO=4&transport=polling`,
      { headers: { Origin: origin } });
    assert.equal(handshake.status, 403, origin);
    assert.equal(handshake.headers.get('access-control-allow-origin'), null);
    await assert.rejects(identity(origin, ['websocket']), /websocket error/, origin);
  }
});

test('Android and browser identities share PvP, server health, death, protection and reconnect', async (t) => {
  let now = 8_000_000;
  const { server, identity } = await harness(t, { clock: () => now, random: () => 0 });
  const app = await identity(APP_ORIGIN);
  const browser = await identity(GAME_ORIGIN, ['websocket']);
  const created = await request(app, 'room:create', { name: 'Android', mode: 'pvp' });
  const joined = await request(browser, 'room:join', { code: created.code, name: 'Browser' });
  assert.equal(joined.room.players.length, 2);
  const room = server.rooms.get(created.code);
  const appPlayer = room.players.get(created.selfId);
  const browserPlayer = room.players.get(joined.selfId);
  Object.assign(appPlayer, { x: 100, y: playerEyeHeightAt(100, 0), z: 0,
    yaw: 0, pitch: 0, mode: 'walk', hasMoved: true });
  Object.assign(browserPlayer, { x: 100, y: playerEyeHeightAt(100, -10), z: -10,
    yaw: Math.PI, pitch: 0, mode: 'walk', hasMoved: true });
  now += SPAWN_PROTECTION_MS + 1;
  const fire = () => request(app, 'combat:fire', { weapon: 'revolver',
    origin: { x: appPlayer.x, y: appPlayer.y, z: appPlayer.z },
    direction: { x: 0, y: 0, z: -1 }, damage: 99999, health: 99999 });
  const seenHit = observe(browser, 'combat:event', (event) => event.kind === 'hit'
    && event.targetId === joined.selfId);
  const shot = await fire();
  assert.equal(shot.ok, true);
  assert.equal(shot.hit.health, 66, 'client damage/health fields cannot overwrite server values');
  assert.equal(shot.ammo.magazine, WEAPONS.revolver.magazine - 1);
  assert.equal((await seenHit).health, 66);
  assert.equal((await fire()).error, 'fire_rate_limited');
  assert.equal(appPlayer.health, 100);
  now += WEAPONS.revolver.fireIntervalMs;
  assert.equal((await fire()).hit.health, 32);
  now += WEAPONS.revolver.fireIntervalMs;
  const seenDeath = observe(browser, 'combat:event', (event) => event.kind === 'death'
    && event.playerId === joined.selfId);
  assert.equal((await fire()).hit.dead, true);
  assert.equal((await seenDeath).killerId, created.selfId);
  assert.equal((await request(browser, 'player:respawn')).error, 'respawn_unavailable');
  now += RESPAWN_DELAY_MS;
  assert.equal((await request(browser, 'player:respawn')).health, 100);
  Object.assign(browserPlayer, { x: 100, y: playerEyeHeightAt(100, -10), z: -10 });
  assert.equal((await fire()).hit, null, 'spawn protection also applies to native-origin shooters');
  for (let index = 0; index < 2; index++) {
    now += WEAPONS.revolver.fireIntervalMs;
    assert.equal((await fire()).ok, true);
  }
  now += WEAPONS.revolver.fireIntervalMs;
  assert.equal((await fire()).error, 'empty_magazine', 'native clients cannot bypass ammunition');

  app.disconnect();
  await observe(browser, 'room:snapshot', (snapshot) =>
    snapshot.players.some((player) => player.id === created.selfId && !player.connected));
  const replacement = await identity(APP_ORIGIN);
  const resumed = await request(replacement, 'room:resume', {
    code: created.code, token: created.token });
  assert.equal(resumed.selfId, created.selfId);
  assert.equal(resumed.room.players.length, 2);
  assert.equal(resumed.room.players.find((player) => player.id === created.selfId)
    .ammo.revolver.magazine, 0, 'transport replacement must not refill ammunition');
  assert.equal(resumed.room.players.find((player) => player.id === joined.selfId).health, 100);
  assert.equal((await request(replacement, 'room:leave')).ok, true);
  assert.equal(server.rooms.has(created.code), true, 'browser member keeps the room alive');
  assert.equal((await request(browser, 'room:leave')).ok, true);
  assert.equal(server.rooms.has(created.code), false);
});

test('native-origin Explore damage stays blocked and voice credentials remain room and identity bound', async (t) => {
  let now = 12_000_000;
  const issued = [];
  const voiceService = { available: true,
    async issue({ roomId, identity, name }) {
      issued.push({ roomId, identity, name });
      return { url: 'wss://test-only.livekit.cloud', token: `test-only-${identity}`, expiresIn: 60 };
    },
    async removeParticipant() {}, async deleteRoom() {} };
  const { server, identity } = await harness(t, { clock: () => now, voiceService });
  const app = await identity(APP_ORIGIN);
  const browser = await identity(GAME_ORIGIN);
  assert.equal((await request(app, 'voice:join')).error, 'not_in_room');
  const created = await request(browser, 'room:create', { name: 'Browser', mode: 'explore' });
  const joined = await request(app, 'room:join', { code: created.code, name: 'Android' });
  const room = server.rooms.get(created.code);
  const attacker = room.players.get(joined.selfId), target = room.players.get(created.selfId);
  Object.assign(attacker, { x: 100, y: playerEyeHeightAt(100, 0), z: 0,
    yaw: 0, pitch: 0, mode: 'walk', hasMoved: true });
  Object.assign(target, { x: 100, y: playerEyeHeightAt(100, -10), z: -10,
    yaw: Math.PI, pitch: 0, mode: 'walk', hasMoved: true });
  now += SPAWN_PROTECTION_MS + 1;
  assert.equal((await request(app, 'inventory:select', { weapon: 'rifle' })).ok, true);
  const shot = await request(app, 'combat:fire', { weapon: 'rifle',
    origin: { x: attacker.x, y: attacker.y, z: attacker.z },
    direction: { x: 0, y: 0, z: -1 }, damage: 99999 });
  assert.equal(shot.ok, true);
  assert.equal(shot.hit, null);
  assert.equal(target.health, 100);
  const appVoice = await request(app, 'voice:join', {
    identity: created.selfId, roomId: 'forged-room', name: 'Forged' });
  const browserVoice = await request(browser, 'voice:join');
  assert.equal(appVoice.identity, joined.selfId);
  assert.equal(appVoice.roomId, browserVoice.roomId);
  assert.equal(appVoice.roomId, room.voiceRoomId);
  assert.deepEqual(issued[0], { roomId: room.voiceRoomId,
    identity: joined.selfId, name: 'Android' });
  assert.equal((await request(app, 'room:leave')).ok, true);
  assert.equal((await request(app, 'voice:join')).error, 'not_in_room');
});
