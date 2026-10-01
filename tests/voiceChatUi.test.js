import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceChatUI } from '../src/voiceChatUi.js';

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.classList = { toggle: (key, force) => {
      const next = force ?? !this.classes.has(key);
      if (next) this.classes.add(key); else this.classes.delete(key);
      return next;
    }, contains: (key) => this.classes.has(key) };
  }
  append(...children) {
    for (const child of children) {
      child.remove();
      this.children.push(child);
      child.parent = this;
    }
  }
  remove() {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index !== -1) this.parent.children.splice(index, 1);
    this.parent = null;
  }
  insertAdjacentElement(_position, element) {
    const index = this.parent.children.indexOf(this);
    this.parent.children.splice(index + 1, 0, element);
    element.parent = this.parent;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  querySelector(selector) {
    if (selector.startsWith('#') && this.id === selector.slice(1)) return this;
    for (const child of this.children) {
      const result = child.querySelector(selector);
      if (result) return result;
    }
    return null;
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatch(type, properties = {}) {
    if (type === 'click' && this.disabled) return;
    const event = { code: '', preventDefault() {}, ...properties };
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}

function fixture({ mobile = false, inRoom = true, configured = true, supported = true } = {}) {
  const menu = new Element();
  const roomPanel = new Element('details');
  roomPanel.id = 'private-room-panel';
  menu.append(roomPanel);
  const hud = new Element();
  const tools = new Element();
  const win = new Element();
  const doc = new Element();
  doc.activeElement = null;
  doc.hidden = false;
  doc.createElement = (tag) => new Element(tag);
  const roomSubscriptions = new Set();
  const voiceSubscriptions = new Set();
  let roomState = { room: inRoom ? { id: 'room-1', voice: { available: configured } } : null,
    code: inRoom ? 'ABC123' : '', selfId: 'self' };
  let voiceState = { status: 'offline', joined: false, muted: true, mode: 'open',
    pushToTalk: false, volume: 1, deafened: false, audioBlocked: false,
    supported, configured, available: configured, participants: [] };
  const calls = [];
  const emit = () => { for (const render of [...voiceSubscriptions]) render(); };
  const client = { getState: () => roomState, on(_event, handler) {
    roomSubscriptions.add(handler); return () => roomSubscriptions.delete(handler);
  } };
  const voice = {
    getState: () => voiceState,
    on(_event, handler) { voiceSubscriptions.add(handler); return () => voiceSubscriptions.delete(handler); },
    async join() { calls.push(['join']); voiceState = { ...voiceState, joined: true, status: 'connected' }; emit(); },
    async leave() { calls.push(['leave']); voiceState = { ...voiceState, joined: false, muted: true, status: 'offline' }; emit(); },
    async setMuted(value) { calls.push(['muted', value]); voiceState = { ...voiceState, muted: value }; emit(); },
    setMode(mode) { calls.push(['mode', mode]); voiceState = { ...voiceState, mode }; emit(); },
    setPushToTalk(value) { calls.push(['ptt', value]); voiceState = { ...voiceState, pushToTalk: value }; emit(); },
    setDeafened(value) { calls.push(['deafened', value]); voiceState = { ...voiceState, deafened: value }; emit(); },
    setVolume(value) { calls.push(['volume', value]); voiceState = { ...voiceState, volume: value }; emit(); },
    setPlayerMuted(id, value) { calls.push(['playerMuted', id, value]); },
    setPlayerVolume(id, value) { calls.push(['playerVolume', id, value]); },
    async unlockAudio() { calls.push(['unlock']); voiceState = { ...voiceState, audioBlocked: false }; emit(); },
  };
  const ui = createVoiceChatUI({ voice, client, mobile, menuRoot: menu, hudRoot: hud,
    touchTools: tools, document: doc, window: win });
  const get = (id) => ui.panel.querySelector(`#${id}`);
  return { ui, get, menu, hud, tools, doc, win, voice, calls, roomSubscriptions, voiceSubscriptions,
    setVoice(patch) { voiceState = { ...voiceState, ...patch }; emit(); },
    setRoom(patch) { roomState = { ...roomState, ...patch }; for (const fn of roomSubscriptions) fn(); },
  };
}
const settled = () => new Promise((resolve) => setImmediate(resolve));

test('voice UI never requests a microphone automatically and joins listen-only before explicit enable', async () => {
  const f = fixture();
  assert.deepEqual(f.calls, [['mode', 'push-to-talk']]);
  assert.equal(f.ui.badge.hidden, true);
  f.get('voice-join').dispatch('click');
  await settled();
  assert.deepEqual(f.calls.slice(1), [['join']]);
  assert.equal(f.get('voice-mic').getAttribute('aria-pressed'), 'false');
  f.get('voice-mic').dispatch('click');
  await settled();
  assert.deepEqual(f.calls.at(-1), ['muted', false]);
  assert.equal(f.get('voice-mic').getAttribute('aria-pressed'), 'true');
  f.ui.setGameplayActive(true);
  assert.equal(f.ui.badge.hidden, false);
  f.get('voice-leave').dispatch('click');
  await settled();
  assert.equal(f.ui.badge.hidden, true);
  f.ui.dispose();
});

test('push to talk only transmits during active gameplay and releases on blur, menus, typing and leave', () => {
  const f = fixture();
  f.setVoice({ joined: true, status: 'connected', muted: false });
  f.win.dispatch('keydown', { code: 'KeyV' });
  assert.equal(f.calls.some(([name]) => name === 'ptt'), false);
  f.ui.setGameplayActive(true);
  f.doc.activeElement = new Element('input');
  f.win.dispatch('keydown', { code: 'KeyV' });
  assert.equal(f.calls.some(([name]) => name === 'ptt'), false);
  f.doc.activeElement = null;
  f.win.dispatch('keydown', { code: 'KeyV' });
  assert.deepEqual(f.calls.at(-1), ['ptt', true]);
  f.win.dispatch('blur');
  assert.deepEqual(f.calls.at(-1), ['ptt', false]);
  f.win.dispatch('keydown', { code: 'KeyV' });
  f.ui.setGameplayActive(false);
  assert.deepEqual(f.calls.at(-1), ['ptt', false]);
  f.ui.setGameplayActive(true);
  f.win.dispatch('keydown', { code: 'KeyV' });
  f.setVoice({ joined: false });
  assert.deepEqual(f.calls.at(-1), ['ptt', false]);
  f.ui.dispose();
});

test('voice UI preserves named roster controls and focused volume slider during frequent state updates', () => {
  const f = fixture();
  f.setVoice({ joined: true, status: 'connected', participants: [
    { id: 'self', name: 'Me', self: true, micMuted: true },
    { id: 'other', name: '<img src=x onerror=alert(1)>', speaking: false, volume: .8 },
  ] });
  const roster = f.get('voice-player-list');
  const row = roster.children[1];
  const [identity, mute, volume] = row.children;
  assert.equal(identity.children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(identity.children[0].children.length, 0);
  assert.equal(roster.children[0].children[1].hidden, true);
  f.doc.activeElement = volume;
  volume.value = '34';
  for (let update = 0; update < 20; update++) f.setVoice({ participants: [
    { id: 'self', name: 'Me', self: true, micMuted: true },
    { id: 'other', name: '<img src=x onerror=alert(1)>', speaking: true, volume: .8 },
  ] });
  assert.equal(roster.children[1], row);
  assert.equal(row.children[2], volume);
  assert.equal(volume.value, '34');
  assert.equal(row.classes.has('speaking'), true);
  mute.dispatch('click');
  assert.deepEqual(f.calls.at(-1), ['playerMuted', 'other', true]);
  volume.dispatch('input');
  assert.deepEqual(f.calls.at(-1), ['playerVolume', 'other', .34]);
  f.setVoice({ participants: [] });
  assert.equal(roster.children.length, 0);
  assert.equal(mute.listenerCount(), 0);
  assert.equal(volume.listenerCount(), 0);
  f.ui.dispose();
});

test('mobile voice lives in More and keeps join separate from microphone consent', async () => {
  const f = fixture({ mobile: true });
  assert.deepEqual(f.calls, [['mode', 'open']]);
  assert.equal(f.tools.children.length, 1);
  assert.equal(f.ui.mobileButton.id, 'touch-voice');
  assert.equal(f.ui.mobileButton.textContent, 'VOICE');
  f.ui.mobileButton.dispatch('click');
  await settled();
  assert.equal(f.ui.mobileButton.textContent, 'MIC OFF');
  assert.equal(f.calls.some(([name]) => name === 'muted'), false);
  f.ui.mobileButton.dispatch('click');
  await settled();
  assert.deepEqual(f.calls.at(-1), ['muted', false]);
  assert.equal(f.ui.mobileButton.textContent, 'MIC ON');
  f.ui.setGameplayActive(true);
  f.win.dispatch('keydown', { code: 'KeyV' });
  assert.equal(f.calls.some(([name]) => name === 'ptt'), false);
  f.setRoom({ room: null });
  assert.equal(f.ui.mobileButton.hidden, true);
  assert.equal(f.ui.badge.hidden, true);
  f.ui.dispose();
  assert.equal(f.tools.children.length, 0);
});

test('unconfigured or unsupported voice explains availability while single player remains untouched', () => {
  for (const options of [{ configured: false }, { supported: false }, { inRoom: false }]) {
    const f = fixture(options);
    assert.equal(f.get('voice-join').disabled, true);
    assert.equal(f.ui.badge.hidden, true);
    assert.ok(f.get('voice-help').textContent.length > 20);
    assert.equal(f.calls.some(([name]) => name === 'join'), false);
    f.ui.dispose();
  }
});

test('players who have not joined voice are shown as voice off and excluded from the voice connection count', () => {
  const f = fixture();
  f.setVoice({ joined: true, status: 'connected', participants: [
    { id: 'self', name: 'Me', self: true, connected: true, micMuted: true },
    { id: 'silent', name: 'Explorer', connected: false, micMuted: true },
    { id: 'other', name: 'Friend', connected: true, micMuted: true },
  ] });
  assert.match(f.get('voice-status').textContent, /Voice connected · 2 players/);
  const roster = f.get('voice-player-list');
  assert.equal(roster.children[1].children[0].children[1].textContent, 'voice off');
  f.setVoice({ status: 'reconnecting' });
  assert.equal(roster.children[1].children[0].children[1].textContent, 'reconnecting');
  f.ui.dispose();
});

test('browser playback recovery and volume settings use safe values; disposal removes every listener', async () => {
  const f = fixture();
  f.setVoice({ joined: true, status: 'connected', audioBlocked: true });
  assert.equal(f.get('voice-enable-audio').hidden, false);
  f.get('voice-enable-audio').dispatch('click');
  await settled();
  assert.deepEqual(f.calls.at(-1), ['unlock']);
  assert.equal(f.get('voice-enable-audio').hidden, true);
  const volume = f.get('voice-volume');
  volume.value = '900';
  volume.dispatch('input');
  assert.deepEqual(f.calls.at(-1), ['volume', 1]);
  volume.value = '-5';
  volume.dispatch('input');
  assert.deepEqual(f.calls.at(-1), ['volume', 0]);
  const nodes = [f.get('voice-join'), f.get('voice-leave'), f.get('voice-mic'),
    f.get('voice-deafen'), f.get('voice-input-mode'), volume, f.get('voice-enable-audio')];
  f.ui.dispose();
  f.ui.dispose();
  assert.equal(f.voiceSubscriptions.size, 0);
  assert.equal(f.roomSubscriptions.size, 0);
  assert.equal(f.win.listenerCount(), 0);
  assert.equal(f.doc.listenerCount(), 0);
  assert.ok(nodes.every((node) => node.listenerCount() === 0));
  assert.equal(f.hud.children.length, 0);
});
