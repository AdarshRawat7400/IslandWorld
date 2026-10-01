import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createMultiplayerClient } from '../src/multiplayerClient.js';

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.io = new EventEmitter();
    this.connected = false;
    this.calls = [];
    this.acks = new Map();
  }
  connect() {
    this.connected = true;
    queueMicrotask(() => super.emit('connect'));
  }
  disconnect() {
    if (this.connected) {
      this.connected = false;
      super.emit('disconnect');
    }
  }
  timeout() { return this; }
  emit(type, payload, ack) {
    this.calls.push({ type, payload });
    if (typeof ack === 'function') {
      const response = this.acks.get(type)?.(payload) || { ok: false, message: 'No reply' };
      queueMicrotask(() => ack(null, response));
      return true;
    }
    return super.emit(type, payload);
  }
}

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function room(code = 'WAVE42') {
  return { code, mode: 'pvp', serverNow: 1234,
    players: [{ id: 'self', name: 'Alice', x: 0, y: 10, z: 0,
      yaw: 0, pitch: 0, mode: 'walk', connected: true }] };
}

test('creates a room, exposes roster, throttles movement, and leaves cleanly', async () => {
  const socket = new FakeSocket();
  const storage = makeStorage();
  let time = 1000;
  socket.acks.set('room:create', () => ({ ok: true, code: 'WAVE42',
    token: 'secret', selfId: 'self', room: room() }));
  socket.acks.set('room:leave', () => ({ ok: true }));
  const client = createMultiplayerClient({ url: 'http://local.test:3001',
    storage, socketFactory: () => socket, now: () => time });
  const joined = [];
  client.on('joined', (state) => joined.push(state.code));
  await client.createRoom({ name: 'Alice', mode: 'pvp' });
  assert.deepEqual(joined, ['WAVE42']);
  assert.equal(client.getState().self.name, 'Alice');
  socket.emit('room:roster', { players: [{ id: 'self', name: 'Alice', connected: true }] });
  assert.equal(client.getState().self.y, 10, 'a slim roster must preserve snapshot position');
  const move = { x: 1, y: 10, z: 2, yaw: 0, pitch: 0, mode: 'walk' };
  assert.equal(client.sendPlayerState(move), true);
  assert.equal(client.sendPlayerState(move), false);
  time += 70;
  assert.equal(client.sendPlayerState(move), true);
  assert.equal(socket.calls.filter((call) => call.type === 'player:move').length, 2);
  await client.leaveRoom();
  assert.equal(client.getState().room, null);
  assert.equal(client.getState().savedSession, false);
  client.dispose();
});

test('resumes membership after a dropped transport using its saved token', async () => {
  const socket = new FakeSocket();
  const storage = makeStorage();
  socket.acks.set('room:join', () => ({ ok: true, code: 'WAVE42',
    token: 'secret', selfId: 'self', room: room() }));
  socket.acks.set('room:resume', (payload) => ({ ok: payload.token === 'secret',
    code: 'WAVE42', token: 'secret', selfId: 'self', room: room() }));
  const client = createMultiplayerClient({ url: 'http://local.test:3001',
    storage, socketFactory: () => socket });
  await client.joinRoom({ code: 'wave42', name: 'Alice' });
  socket.disconnect();
  assert.equal(client.getState().status, 'reconnecting');
  socket.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.getState().status, 'online');
  assert.equal(socket.calls.filter((call) => call.type === 'room:resume').length, 1);
  client.dispose();
});
