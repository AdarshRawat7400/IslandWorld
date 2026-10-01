import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createVoiceChat } from '../src/voiceChat.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Track {
  constructor() {
    this.kind = 'audio';
    this.sid = 'microphone';
    this.muted = false;
    this.stops = 0;
    this.attached = new Set();
    this.mediaStreamTrack = new EventTarget();
  }
  async mute() { this.muted = true; }
  async unmute() { this.muted = false; }
  stop() { this.stops += 1; }
  attach(element) { this.attached.add(element); element.srcObject = this; }
  detach(element) { this.attached.delete(element); }
  setVolume(volume) { this.volume = volume; }
}
function fixture({ connectGate, captureGate, credentialsGate, playFails = false,
  supported = true, available = true, captureError, publishError } = {}) {
  const events = new EventEmitter();
  let game = { connected: true, status: 'online', selfId: 'alice',
    room: { code: 'WAVE42', voice: { available } },
    players: [{ id: 'alice', name: 'Alice', connected: true },
      { id: 'bob', name: 'Bob', connected: true }] };
  const requests = [];
  const client = {
    getState: () => game,
    on(type, callback) { events.on(type, callback); return () => events.off(type, callback); },
    async request(type) {
      requests.push(type);
      if (type === 'voice:join') {
        if (credentialsGate) await credentialsGate.promise;
        return { ok: true, url: 'ws://localhost:7880', token: 'token', roomId: 'room-id', identity: game.selfId };
      }
      return { ok: true };
    },
  };
  const roomEvents = Object.fromEntries(['TrackSubscribed', 'TrackUnsubscribed',
    'ParticipantConnected', 'ParticipantDisconnected', 'ActiveSpeakersChanged',
    'TrackMuted', 'TrackUnmuted', 'Reconnecting', 'Reconnected', 'Disconnected',
    'AudioPlaybackStatusChanged', 'MediaDevicesError'].map((event) => [event, event]));
  const rooms = [];
  const captured = [];
  let captureCalls = 0;
  class Room extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.remoteParticipants = new Map();
      this.disconnects = 0;
      this.published = [];
      this.unpublished = [];
      this.canPlaybackAudio = true;
      this.localParticipant = {
        isSpeaking: true, audioTrackPublications: new Map(),
        publishTrack: async (track, options) => {
          if (publishError) throw publishError;
          this.published.push({ track, options });
        },
        unpublishTrack: async (track) => { this.unpublished.push(track); },
      };
      rooms.push(this);
    }
    async connect(url, token) {
      this.url = url; this.token = token;
      if (connectGate) await connectGate.promise;
    }
    async disconnect() { this.disconnects += 1; this.emit('Disconnected'); }
    async startAudio() { this.canPlaybackAudio = true; }
  }
  const sdk = { Room, RoomEvent: roomEvents, Track: { Source: { Microphone: 'microphone' } },
    async createLocalAudioTrack(options) {
      captureCalls += 1;
      if (captureError) throw captureError;
      if (captureGate) await captureGate.promise;
      const track = new Track();
      track.options = options;
      captured.push(track);
      return track;
    },
  };
  const elements = [];
  const domEvents = new EventTarget();
  const windowEvents = new EventTarget();
  const document = {
    hidden: false,
    addEventListener: (...args) => domEvents.addEventListener(...args),
    removeEventListener: (...args) => domEvents.removeEventListener(...args),
    createElement() {
      const element = { removed: false, paused: false, srcObject: null,
        setAttribute() {}, async play() { if (playFails) throw new Error('Autoplay blocked'); },
        pause() { this.paused = true; }, remove() { this.removed = true; } };
      elements.push(element);
      return element;
    },
    body: { appendChild() {} },
  };
  const voice = createVoiceChat({ client, sdk, document, window: windowEvents, supported });
  function setGame(next, type = 'state') { game = { ...game, ...next }; events.emit(type, game); }
  function remote(identity = 'bob', track = new Track()) {
    const peer = { identity, isSpeaking: true,
      audioTrackPublications: new Map([['mic', { trackSid: identity, track, isMuted: false }]]) };
    const room = rooms.at(-1);
    room.remoteParticipants.set(identity, peer);
    room.emit('TrackSubscribed', track, peer.audioTrackPublications.get('mic'), peer);
    return { track, peer };
  }
  return { voice, rooms, captured, elements, requests, events, document, domEvents,
    windowEvents, setGame, remote, captureCalls: () => captureCalls,
    setPlayFails: (value) => { playFails = value; } };
}

test('joins authorized audio-only room without acquiring a microphone', async () => {
  const f = fixture();
  assert.equal(f.voice.getState().available, true);
  const joined = await f.voice.join();
  assert.equal(joined.status, 'connected');
  assert.equal(joined.muted, true);
  assert.equal(f.captureCalls(), 0);
  assert.deepEqual(f.requests, ['voice:join']);
  assert.equal(f.rooms[0].options.publishDefaults.forceStereo, false);
  assert.equal(f.rooms[0].options.webAudioMix, true);
  assert.equal(f.rooms[0].options.publishDefaults.audioPreset.maxBitrate, 24000);
  f.voice.dispose();
});

test('open microphone publishes once, then stop and unpublish on mute', async () => {
  const f = fixture();
  await f.voice.join();
  await f.voice.setMuted(false);
  assert.equal(f.captureCalls(), 1);
  assert.equal(f.voice.getState().transmitting, true);
  assert.equal(f.rooms[0].published.length, 1);
  assert.equal(f.captured[0].options.echoCancellation, true);
  assert.equal(f.captured[0].options.channelCount, 1);
  const pending = f.voice.setMuted(true);
  assert.equal(f.captured[0].stops, 1, 'hardware stops before an async unpublish');
  await pending;
  assert.equal(f.rooms[0].unpublished[0], f.captured[0]);
  assert.equal(f.voice.getState().transmitting, false);
  await f.voice.setMuted(false);
  assert.equal(f.captureCalls(), 2, 're-enable creates a live track instead of reusing stopped audio');
  f.voice.dispose();
});

test('push-to-talk does not transmit until held and releasing it mutes immediately', async () => {
  const f = fixture();
  await f.voice.setMode('push-to-talk');
  await f.voice.join();
  await f.voice.setMuted(false);
  assert.equal(f.voice.getState().inputMode, 'ptt');
  assert.equal(f.captured[0].muted, true);
  assert.equal(f.voice.getState().transmitting, false);
  await f.voice.setPushToTalk(true);
  assert.equal(f.captured[0].muted, false);
  assert.equal(f.voice.getState().transmitting, true);
  const released = f.voice.setPushToTalk(false);
  assert.equal(f.captured[0].muted, true);
  await released;
  assert.equal(f.voice.getState().transmitting, false);
  await f.voice.setMuted(true);
  await f.voice.setPushToTalk(true);
  assert.equal(f.captureCalls(), 1);
  f.voice.dispose();
});

test('only authorized connected audio peers attach; independent mute, volume, and deafen apply', async () => {
  const f = fixture();
  await f.voice.join();
  f.remote('intruder');
  f.remote('bob', Object.assign(new Track(), { kind: 'video' }));
  assert.equal(f.elements.length, 0);
  const remote = f.remote();
  assert.equal(f.elements.length, 1);
  f.voice.setVolume(0.5);
  f.voice.setPlayerVolume('bob', 0.4);
  assert.equal(remote.track.volume, 0.2);
  assert.equal(f.elements[0].volume, 0, 'SDK WebAudio output replaces the muted media element');
  f.voice.setPlayerMuted('bob', true);
  assert.equal(remote.track.volume, 0);
  f.voice.setPlayerMuted('bob', false);
  f.voice.setDeafened(true);
  assert.equal(remote.track.volume, 0);
  f.voice.setDeafened(false);
  assert.equal(remote.track.volume, 0.2);
  assert.equal(f.elements[0].muted, true, 'unlock cannot cause duplicate element playback');
  const bob = f.voice.getState().participants.find((peer) => peer.id === 'bob');
  assert.equal(bob.speaking, true);
  assert.equal(bob.name, 'Bob');
  assert.equal(bob.micMuted, false);
  f.setGame({ players: [{ id: 'alice', name: 'Alice', connected: true },
    { id: 'bob', name: 'Bob', connected: false }] });
  assert.equal(f.elements[0].removed, true);
  assert.equal(f.elements[0].srcObject, null);
  f.voice.dispose();
});

test('autoplay failure is visible and retried only via explicit audio unlock', async () => {
  const f = fixture({ playFails: true });
  await f.voice.join();
  f.remote();
  await tick();
  assert.equal(f.voice.getState().audioBlocked, true);
  assert.equal(await f.voice.unlockAudio(), false);
  f.setPlayFails(false);
  assert.equal(await f.voice.unlockAudio(), true);
  assert.equal(f.voice.getState().audioBlocked, false);
  f.voice.dispose();
});

test('leaving removes SDK listeners, audio nodes, microphone, and server authorization', async () => {
  const f = fixture();
  await f.voice.join();
  await f.voice.setMuted(false);
  const remote = f.remote();
  await f.voice.leave();
  assert.equal(f.voice.getState().status, 'offline');
  assert.equal(f.voice.getState().muted, true);
  assert.equal(f.captured[0].stops, 1);
  assert.equal(f.elements[0].removed, true);
  assert.equal(remote.track.attached.size, 0);
  assert.equal(f.rooms[0].disconnects, 1);
  assert.equal(f.rooms[0].eventNames().length, 0);
  assert.equal(f.requests.at(-1), 'voice:leave');
  f.voice.dispose();
  assert.equal(f.events.listenerCount('state'), 0);
});

test('stale credential request after leaving cannot instantiate or join a voice room', async () => {
  const credentialsGate = deferred();
  const f = fixture({ credentialsGate });
  const pending = f.voice.join();
  await f.voice.leave();
  credentialsGate.resolve();
  await pending;
  assert.equal(f.rooms.length, 0);
  assert.equal(f.voice.getState().status, 'offline');
  f.voice.dispose();
});

test('stale connect after disposal closes the candidate and never asks for a mic', async () => {
  const connectGate = deferred();
  const f = fixture({ connectGate });
  const pending = f.voice.join();
  await tick();
  f.voice.dispose();
  connectGate.resolve();
  await pending;
  assert.ok(f.rooms[0].disconnects >= 1);
  assert.equal(f.captureCalls(), 0);
  assert.equal(f.voice.getState().status, 'offline');
});

test('late microphone permission after leaving is stopped and never published', async () => {
  const captureGate = deferred();
  const f = fixture({ captureGate });
  await f.voice.join();
  const pending = f.voice.setMuted(false);
  await tick();
  await f.voice.leave();
  captureGate.resolve();
  await pending;
  assert.equal(f.captured[0].stops, 1);
  assert.equal(f.rooms[0].published.length, 0);
  assert.equal(f.voice.getState().muted, true);
  f.voice.dispose();
});

test('socket interruption stops broadcasting; only the same game identity auto-rejoins listen-only', async () => {
  const f = fixture();
  await f.voice.join();
  await f.voice.setMuted(false);
  f.remote();
  f.setGame({ connected: false });
  assert.equal(f.voice.getState().status, 'reconnecting');
  assert.equal(f.captured[0].stops, 1);
  assert.equal(f.elements[0].removed, true);
  f.setGame({ connected: true });
  await tick();
  assert.equal(f.rooms.length, 2);
  assert.equal(f.voice.getState().status, 'connected');
  assert.equal(f.voice.getState().muted, true);
  assert.equal(f.captureCalls(), 1);
  f.setGame({ selfId: 'replacement' });
  assert.equal(f.voice.getState().status, 'offline');
  f.setGame({ selfId: 'alice' });
  await tick();
  assert.equal(f.rooms.length, 2, 'session replacement cancels persistent voice approval');
  f.voice.dispose();
});

test('voice reconnect waits for authenticated room resume, not just the socket connection', async () => {
  const f = fixture();
  await f.voice.join();
  await f.voice.setMuted(false);
  f.setGame({ connected: false, status: 'reconnecting' });
  // This is the actual multiplayer client's connect callback state: its old
  // local room is still present, but room:resume has not been acknowledged.
  f.setGame({ connected: true, status: 'reconnecting' });
  await tick();
  assert.equal(f.requests.filter((type) => type === 'voice:join').length, 1);
  assert.equal(f.rooms.length, 1);
  assert.equal(f.voice.getState().status, 'reconnecting');
  // Pre-ack room snapshots/rosters must not produce credential retries either.
  f.setGame({ players: [{ id: 'alice', name: 'Alice', connected: true },
    { id: 'bob', name: 'Bob', connected: true }] });
  await tick();
  assert.equal(f.requests.filter((type) => type === 'voice:join').length, 1);
  f.setGame({ status: 'online' });
  await tick();
  assert.equal(f.requests.filter((type) => type === 'voice:join').length, 2);
  assert.equal(f.voice.getState().status, 'connected');
  assert.equal(f.voice.getState().muted, true);
  assert.equal(f.captureCalls(), 1);
  f.voice.dispose();
});

test('an SDK reconnect resets mic permission state without resuming transmission', async () => {
  const f = fixture();
  await f.voice.join();
  await f.voice.setMuted(false);
  f.rooms[0].emit('Reconnecting');
  await tick();
  assert.equal(f.voice.getState().muted, true);
  assert.equal(f.voice.getState().status, 'reconnecting');
  assert.equal(f.captured[0].stops, 1);
  f.rooms[0].emit('Reconnected');
  assert.equal(f.voice.getState().status, 'connected');
  assert.equal(f.voice.getState().transmitting, false);
  f.voice.dispose();
});

test('permission rejection and publication failure preserve listening and stop leaked tracks', async () => {
  const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  const f = fixture({ captureError: denied });
  await f.voice.join();
  await f.voice.setMuted(false);
  assert.equal(f.voice.getState().status, 'connected');
  assert.equal(f.voice.getState().muted, true);
  assert.match(f.voice.getState().error, /permission was denied/);
  f.voice.dispose();
  const g = fixture({ publishError: new Error('publish failed') });
  await g.voice.join();
  await g.voice.setMuted(false);
  assert.equal(g.captured[0].stops, 1);
  assert.equal(g.voice.getState().muted, true);
  g.voice.dispose();
});

test('unsupported contexts and unconfigured servers fail before credentials or microphone access', async () => {
  const f = fixture({ supported: false });
  assert.equal((await f.voice.join()).status, 'error');
  assert.deepEqual(f.requests, []);
  assert.equal(f.captureCalls(), 0);
  f.voice.dispose();
  const g = fixture({ available: false });
  await g.voice.join();
  assert.match(g.voice.getState().error, /not configured/);
  assert.deepEqual(g.requests, []);
  g.voice.dispose();
});

test('background visibility stops a microphone and page exit tears down voice', async () => {
  const f = fixture();
  await f.voice.join();
  await f.voice.setMuted(false);
  f.document.hidden = true;
  f.domEvents.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.captured[0].stops, 1);
  assert.equal(f.voice.getState().muted, true);
  f.windowEvents.dispatchEvent(new Event('pagehide'));
  assert.equal(f.voice.getState().status, 'offline');
  f.voice.dispose();
});

test('microphone unplug disables transmission and can still leave cleanly', async () => {
  const f = fixture();
  await f.voice.join();
  await f.voice.setMuted(false);
  f.captured[0].mediaStreamTrack.dispatchEvent(new Event('ended'));
  await tick();
  assert.equal(f.voice.getState().muted, true);
  assert.equal(f.voice.getState().transmitting, false);
  assert.match(f.voice.getState().error, /Microphone stopped/);
  f.voice.dispose();
});
