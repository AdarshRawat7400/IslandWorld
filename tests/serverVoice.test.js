import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenVerifier } from 'livekit-server-sdk';
import { io as connect } from 'socket.io-client';
import { createMultiplayerServer } from '../server/index.js';
import { createVoiceService, validVoiceUrl, VOICE_TOKEN_SECONDS } from '../server/voiceService.js';

const request = (socket, event, body = {}) => new Promise((resolve, reject) => {
  socket.timeout(2500).emit(event, body, (error, value) => error ? reject(error) : resolve(value));
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const apiKey = 'island-test-key';
const apiSecret = 'island-test-only-secret-with-enough-entropy';
const credentials = { url: 'wss://island-test.livekit.cloud', apiKey, apiSecret };

function fakeApi(overrides = {}) {
  const calls = [];
  return {
    calls,
    async createRoom(options) { calls.push({ kind: 'create', ...options }); },
    async removeParticipant(roomId, identity, options) {
      calls.push({ kind: 'remove', roomId, identity, ...options });
    },
    async deleteRoom(roomId) { calls.push({ kind: 'delete', roomId }); },
    ...overrides,
  };
}

async function harness(t, options = {}) {
  const server = createMultiplayerServer({ port: 0, host: '127.0.0.1',
    snapshotMs: 40, ...options });
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
  return { server, client, address };
}

test('voice configuration rejects unsafe endpoints and defaults to unavailable', async () => {
  for (const value of ['http://example.com', 'https://example.com', 'ws://example.com',
    'wss://key:secret@example.com', 'wss://example.com/token',
    'wss://example.com?secret=x', 'wss://example.com#secret', 'not a URL']) {
    assert.equal(validVoiceUrl(value), null, value);
  }
  assert.equal(validVoiceUrl('wss://project.livekit.cloud/'), 'wss://project.livekit.cloud');
  assert.equal(validVoiceUrl('ws://localhost:7880'), null);
  assert.equal(validVoiceUrl('ws://localhost:7880', { allowInsecureLocal: true }),
    'ws://localhost:7880');
  assert.equal(validVoiceUrl('ws://192.168.1.5:7880', { allowInsecureLocal: true }), null);
  const voice = createVoiceService({ url: null, apiKey, apiSecret });
  assert.equal(voice.available, false);
  await assert.rejects(voice.issue({}), /unavailable/);
  await voice.removeParticipant({}); await voice.deleteRoom('absent'); await voice.close();
});

test('server tokens are signed, short-lived, room-bound and strictly microphone-only', async () => {
  const api = fakeApi();
  const voice = createVoiceService({ ...credentials, roomService: api });
  const result = await voice.issue({ roomId: 'iw-room-1', identity: 'player-one', name: 'Alice' });
  const claims = await new TokenVerifier(apiKey, apiSecret).verify(result.token);
  assert.equal(claims.sub, 'player-one'); assert.equal(claims.name, 'Alice');
  assert.equal(claims.exp - claims.nbf, VOICE_TOKEN_SECONDS);
  assert.equal(result.expiresIn, 60);
  assert.equal(claims.video.room, 'iw-room-1');
  assert.equal(claims.video.roomJoin, true);
  assert.deepEqual(claims.video.canPublishSources, ['microphone']);
  assert.equal(claims.video.canPublishData, false);
  assert.equal(claims.video.canUpdateOwnMetadata, false);
  assert.equal(claims.video.canSubscribeMetrics, false);
  assert.equal(claims.video.canManageAgentSession, false);
  for (const permission of ['roomAdmin', 'roomCreate', 'roomList', 'roomRecord', 'ingressAdmin',
    'agent', 'recorder']) assert.notEqual(claims.video[permission], true);
  assert.equal(api.calls[0].maxParticipants, 10);
  assert.ok(api.calls[0].emptyTimeout > result.expiresIn);
  assert.equal(JSON.stringify(result).includes(apiSecret), false);
  assert.equal(Object.keys(result).includes('apiKey'), false);
  await voice.close();
});

test('a completed revoke fences new tokens beyond the old-token cutoff', async () => {
  const api = fakeApi();
  const voice = createVoiceService({ ...credentials, roomService: api });
  const before = await voice.issue({ roomId: 'iw-room-1', identity: 'player-one', name: 'Alice' });
  await voice.removeParticipant({ roomId: 'iw-room-1', identity: 'player-one' });
  const removal = api.calls.find((call) => call.kind === 'remove');
  const after = await voice.issue({ roomId: 'iw-room-1', identity: 'player-one', name: 'Alice' });
  const verifier = new TokenVerifier(apiKey, apiSecret);
  const oldClaims = await verifier.verify(before.token);
  const newClaims = await verifier.verify(after.token);
  assert.ok(BigInt(oldClaims.nbf) < removal.revokeTokenTs);
  assert.ok(BigInt(newClaims.nbf) >= removal.revokeTokenTs);
  assert.equal(after.identity, before.identity);
  await voice.close();
});

test('timed-out removals stay serialized so no late cleanup can kick a fresh connection', async () => {
  const pending = deferred();
  const api = fakeApi({ async removeParticipant() { await pending.promise; } });
  const voice = createVoiceService({ ...credentials, roomService: api, timeoutMs: 35 });
  await voice.issue({ roomId: 'iw-room-1', identity: 'player-one', name: 'Alice' });
  await assert.rejects(voice.removeParticipant({ roomId: 'iw-room-1', identity: 'player-one' }),
    /timeout/);
  await assert.rejects(voice.issue({ roomId: 'iw-room-1', identity: 'player-one', name: 'Alice' }),
    /timeout/);
  assert.equal(api.calls.filter((call) => call.kind === 'create').length, 1,
    'issuance cannot run while old removal is still unresolved');
  pending.resolve();
  await delay(1050);
  const joined = await voice.issue({ roomId: 'iw-room-1', identity: 'player-one', name: 'Alice' });
  assert.equal(joined.identity, 'player-one');
  await voice.close();
});

test('failed revocations are retried before credentials can be issued', async () => {
  let removals = 0;
  const api = fakeApi({ async removeParticipant() {
    removals++;
    if (removals === 1) throw new Error('temporary outage');
  } });
  const voice = createVoiceService({ ...credentials, roomService: api });
  await voice.issue({ roomId: 'iw-room-1', identity: 'player-one', name: 'Alice' });
  await assert.rejects(voice.removeParticipant({ roomId: 'iw-room-1', identity: 'player-one' }));
  await voice.issue({ roomId: 'iw-room-1', identity: 'player-one', name: 'Alice' });
  assert.equal(removals, 2);
  await voice.close();
});

test('room deletion waits for pending creation and prevents its in-flight token', async () => {
  const pending = deferred();
  const calls = [];
  const api = fakeApi({ async createRoom() { calls.push('create'); await pending.promise; },
    async deleteRoom() { calls.push('delete'); } });
  const voice = createVoiceService({ ...credentials, roomService: api });
  const issue = voice.issue({ roomId: 'iw-room-1', identity: 'player-one', name: 'Alice' });
  const rejected = assert.rejects(issue, /closed/);
  await delay(5);
  const deleted = voice.deleteRoom('iw-room-1');
  pending.resolve();
  await rejected; await deleted;
  assert.deepEqual(calls, ['create', 'delete']);
  await voice.close();
});

test('unconfigured voice fails gracefully without breaking room creation or health', async (t) => {
  const voiceService = createVoiceService({ url: null, apiKey, apiSecret });
  const { client, address } = await harness(t, { voiceService });
  const a = await client();
  assert.equal((await request(a, 'voice:join')).error, 'not_in_room');
  const created = await request(a, 'room:create', { name: 'Alice', mode: 'explore' });
  assert.deepEqual(created.room.voice, { available: false });
  assert.equal((await request(a, 'voice:join')).error, 'voice_unavailable');
  const health = await (await fetch(`http://127.0.0.1:${address.port}/healthz`)).json();
  assert.deepEqual(health.voice, { available: false });
  assert.equal((await request(a, 'room:leave')).ok, true);
});

test('two independent members receive their own identities and only their current room token', async (t) => {
  const api = fakeApi();
  const voiceService = createVoiceService({ ...credentials, roomService: api });
  const { server, client, address } = await harness(t, { voiceService });
  const a = await client(), b = await client(), outsider = await client();
  const created = await request(a, 'room:create', { name: 'Alice', mode: 'explore' });
  const joined = await request(b, 'room:join', { code: created.code, name: 'Bob' });
  const otherRoom = await request(outsider, 'room:create', { name: 'Other', mode: 'pvp' });
  assert.deepEqual(created.room.voice, { available: true });
  const aVoice = await request(a, 'voice:join', { roomId: otherRoom.code,
    identity: joined.selfId, name: 'Impostor', apiKey: 'forged' });
  const bVoice = await request(b, 'voice:join');
  const otherVoice = await request(outsider, 'voice:join');
  assert.equal(aVoice.identity, created.selfId);
  assert.equal(bVoice.identity, joined.selfId);
  assert.equal(aVoice.roomId, bVoice.roomId);
  assert.notEqual(aVoice.roomId, otherVoice.roomId);
  assert.notEqual(aVoice.roomId, created.code);
  assert.equal(aVoice.roomId, server.rooms.get(created.code).voiceRoomId);
  const claims = await new TokenVerifier(apiKey, apiSecret).verify(aVoice.token);
  assert.equal(claims.name, 'Alice'); assert.equal(claims.video.room, aVoice.roomId);
  const health = await (await fetch(`http://127.0.0.1:${address.port}/healthz`)).json();
  assert.deepEqual(health.voice, { available: true });
});

test('credential rate limits survive socket replacement and reject parallel requests', async (t) => {
  let now = 2_000_000;
  const pending = deferred();
  let calls = 0;
  const voiceService = { available: true, async issue({ identity }) {
    calls++; if (calls === 1) await pending.promise;
    return { url: credentials.url, token: 'test-token', identity, expiresIn: 60 };
  }, async removeParticipant() {}, async deleteRoom() {} };
  const { client } = await harness(t, { voiceService, clock: () => now });
  const a = await client();
  const created = await request(a, 'room:create', { name: 'Alice', mode: 'explore' });
  const first = request(a, 'voice:join');
  await delay(15);
  assert.equal((await request(a, 'voice:join')).error, 'voice_rate_limited');
  pending.resolve(); assert.equal((await first).ok, true);
  for (let i = 0; i < 5; i++) assert.equal((await request(a, 'voice:join')).ok, true);
  assert.equal((await request(a, 'voice:join')).error, 'voice_rate_limited');
  const replacement = await client();
  assert.equal((await request(replacement, 'room:resume', {
    code: created.code, token: created.token })).ok, true);
  assert.equal((await request(replacement, 'voice:join')).error, 'voice_rate_limited');
  assert.equal((await request(a, 'voice:join')).error, 'not_in_room');
  now += 60001;
  assert.equal((await request(replacement, 'voice:join')).ok, true);
});

test('leaving or replacing membership while token work is in flight cannot return credentials', async (t) => {
  const pending = deferred();
  const removed = [];
  const voiceService = { available: true, async issue() {
    await pending.promise;
    return { url: credentials.url, token: 'must-not-leak', expiresIn: 60 };
  }, async removeParticipant(value) { removed.push(value); }, async deleteRoom() {} };
  const { client } = await harness(t, { voiceService });
  const a = await client(), b = await client();
  const created = await request(a, 'room:create', { name: 'Alice', mode: 'explore' });
  await request(b, 'room:join', { code: created.code, name: 'Bob' });
  const join = request(a, 'voice:join');
  await delay(15);
  assert.equal((await request(a, 'room:leave')).ok, true);
  await request(a, 'room:create', { name: 'Alice New', mode: 'pvp' });
  pending.resolve();
  const result = await join;
  assert.equal(result.error, 'session_changed'); assert.equal(result.token, undefined);
  assert.equal(removed[0].identity, created.selfId);
});

test('voice leave, socket replacement, disconnect and empty-room deletion revoke membership', async (t) => {
  const api = fakeApi();
  const voiceService = createVoiceService({ ...credentials, roomService: api });
  const { server, client } = await harness(t, { voiceService, reconnectGraceMs: 40 });
  const a = await client(), b = await client();
  const created = await request(a, 'room:create', { name: 'Alice', mode: 'explore' });
  const joined = await request(b, 'room:join', { code: created.code, name: 'Bob' });
  const roomId = (await request(a, 'voice:join')).roomId;
  await request(b, 'voice:join');
  assert.equal((await request(a, 'voice:leave')).ok, true);
  assert.equal(server.rooms.get(created.code).players.size, 2);
  await request(a, 'voice:join');
  const replacement = await client();
  await request(replacement, 'room:resume', { code: created.code, token: created.token });
  await request(replacement, 'voice:join');
  b.disconnect();
  await delay(80);
  assert.equal(server.rooms.get(created.code).players.has(joined.selfId), false);
  await request(replacement, 'room:leave');
  await delay(25);
  assert.equal(server.rooms.has(created.code), false);
  assert.ok(api.calls.filter((call) => call.kind === 'remove' && call.identity === created.selfId).length >= 3);
  assert.ok(api.calls.some((call) => call.kind === 'remove' && call.identity === joined.selfId));
  assert.ok(api.calls.some((call) => call.kind === 'delete' && call.roomId === roomId));
});

test('voice provider failures do not leak details or interrupt gameplay cleanup', async (t) => {
  const voiceService = { available: true,
    async issue() { throw new Error(`private-provider-detail ${apiSecret}`); },
    removeParticipant() { throw new Error('provider down'); },
    async deleteRoom() { throw new Error('provider down'); },
  };
  const { server, client } = await harness(t, { voiceService });
  const a = await client();
  const created = await request(a, 'room:create', { name: 'Alice', mode: 'pvp' });
  const result = await request(a, 'voice:join');
  assert.equal(result.error, 'voice_unavailable');
  assert.equal(JSON.stringify(result).includes(apiSecret), false);
  assert.equal((await request(a, 'world:set', { weather: 'rain', time: 'dusk' })).ok, true);
  assert.equal((await request(a, 'room:leave')).ok, true);
  assert.equal(server.rooms.has(created.code), false);
});
