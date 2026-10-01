const clampVolume = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const isTyping = (element) => Boolean(element?.isContentEditable
  || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName));

/** Room voice controls. Creating the panel never requests microphone permission. */
export function createVoiceChatUI({ voice, client, mobile = false,
  menuRoot, hudRoot, touchTools, document: doc = globalThis.document,
  window: win = globalThis.window } = {}) {
  menuRoot ??= doc?.querySelector('.screen-card');
  hudRoot ??= doc?.getElementById('hud');
  touchTools ??= mobile ? doc?.getElementById('touch-tools') : null;
  if (!voice || !client || !doc || !menuRoot || !hudRoot) {
    throw new Error('Voice UI requires a voice client, room client, menu, and HUD.');
  }
  const listeners = [];
  const listen = (target, type, handler) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };
  const create = (tag, { id, className, text, ...attributes } = {}) => {
    const element = doc.createElement(tag);
    if (id) element.id = id;
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  };
  const text = (element, value) => {
    const next = String(value);
    if (element.textContent !== next) element.textContent = next;
  };
  const pressed = (element, value) => {
    const next = String(Boolean(value));
    if (element.getAttribute('aria-pressed') !== next) element.setAttribute('aria-pressed', next);
  };
  const button = (id, label) => create('button', { id, type: 'button', text: label });
  const panel = create('details', { id: 'voice-chat-panel' });
  const summary = create('summary', { text: 'ROOM VOICE ' });
  const summaryStatus = create('span', { id: 'voice-summary-detail', text: 'MIC OFF' });
  summary.append(summaryStatus);
  const content = create('div', { className: 'voice-content' });
  const help = create('p', { id: 'voice-help', className: 'voice-help',
    text: 'Join a private room to talk with its players. Voice is optional and your microphone starts off.' });
  const controls = create('div', { className: 'voice-actions' });
  const joinButton = button('voice-join', 'JOIN VOICE · LISTEN ONLY');
  const leaveButton = button('voice-leave', 'LEAVE VOICE');
  const micButton = button('voice-mic', 'MIC OFF');
  const deafenButton = button('voice-deafen', 'HEADPHONES ON');
  controls.append(joinButton, leaveButton, micButton, deafenButton);
  const settings = create('div', { className: 'voice-settings' });
  const modeLabel = create('label', { for: 'voice-input-mode', text: 'MICROPHONE MODE' });
  const modeSelect = create('select', { id: 'voice-input-mode', 'aria-label': 'Microphone mode' });
  modeSelect.append(create('option', { value: 'push-to-talk', text: 'Push to talk · hold V' }),
    create('option', { value: 'open', text: 'Open microphone' }));
  const volumeLabel = create('label', { for: 'voice-volume', text: 'VOICE VOLUME' });
  const volumeInput = create('input', { id: 'voice-volume', type: 'range', min: '0', max: '100',
    step: '1', 'aria-label': 'Voice volume' });
  volumeInput.value = '100';
  const volumeValue = create('output', { id: 'voice-volume-value', for: 'voice-volume', text: '100%' });
  const volumeRow = create('div', { className: 'voice-volume-row' });
  volumeRow.append(volumeInput, volumeValue);
  settings.append(modeLabel, modeSelect, volumeLabel, volumeRow);
  const resumeButton = button('voice-enable-audio', 'ENABLE VOICE AUDIO');
  const roster = create('ul', { id: 'voice-player-list', 'aria-label': 'Players in voice chat' });
  const status = create('p', { id: 'voice-status', className: 'voice-status', role: 'status',
    'aria-live': 'polite' });
  content.append(help, controls, settings, resumeButton, roster, status);
  panel.append(summary, content);
  const roomPanel = menuRoot.querySelector('#private-room-panel');
  if (roomPanel) roomPanel.insertAdjacentElement('afterend', panel);
  else menuRoot.append(panel);
  const badge = create('div', { id: 'voice-chat-badge', 'aria-hidden': 'true' });
  badge.hidden = true;
  hudRoot.append(badge);
  let mobileButton = null;
  if (mobile && touchTools) {
    mobileButton = button('touch-voice', 'VOICE');
    mobileButton.setAttribute('aria-label', 'Join room voice with microphone off');
    touchTools.append(mobileButton);
  }
  const rows = new Map();
  let gameplayActive = false;
  let busy = false;
  let disposed = false;
  let message = '';
  let pttHeld = false;
  let previousRoom = null;
  const stateMode = (state) => state.mode || (state.inputMode === 'ptt' ? 'push-to-talk' : 'open');
  const setMode = (mode) => {
    if (voice.setMode) voice.setMode(mode);
    else voice.setInputMode(mode === 'push-to-talk' ? 'ptt' : 'open');
  };
  const releasePtt = () => {
    if (!pttHeld) return;
    pttHeld = false;
    voice.setPushToTalk(false);
  };
  const run = async (action) => {
    if (busy || disposed) return;
    busy = true;
    message = '';
    render();
    try { await action(); }
    catch (cause) { message = cause?.message || 'Voice action failed. Please try again.'; }
    finally { busy = false; if (!disposed) render(); }
  };
  const makePlayerRow = (id) => {
    const item = create('li', { className: 'voice-player' });
    item.dataset.playerId = id;
    const name = create('span', { className: 'voice-player-name' });
    const state = create('small', { className: 'voice-player-state' });
    const identity = create('div', { className: 'voice-player-identity' });
    identity.append(name, state);
    const mute = button(null, 'MUTE');
    mute.className = 'voice-player-mute';
    const volume = create('input', { type: 'range', min: '0', max: '100', step: '1',
      className: 'voice-player-volume' });
    const onMute = () => {
      const person = (voice.getState().participants || voice.getState().players || [])
        .find((player) => player.id === id);
      if (person) voice.setPlayerMuted(id, !Boolean(person.localMuted ?? person.muted));
    };
    const onVolume = () => voice.setPlayerVolume(id, clampVolume(Number(volume.value) / 100));
    mute.addEventListener('click', onMute);
    volume.addEventListener('input', onVolume);
    const dispose = () => {
      mute.removeEventListener('click', onMute);
      volume.removeEventListener('input', onVolume);
      item.remove();
    };
    item.append(identity, mute, volume);
    roster.append(item);
    return { item, name, state, mute, volume, dispose };
  };
  function render() {
    if (disposed) return;
    const state = voice.getState();
    const roomState = client.getState();
    const inRoom = Boolean(roomState.room);
    const roomId = roomState.room?.id || roomState.code || null;
    if (previousRoom !== roomId) { message = ''; previousRoom = roomId; releasePtt(); }
    const available = state.available ?? state.configured ?? roomState.room?.voice?.available;
    const unsupported = state.supported === false;
    const unavailable = available === false;
    const joined = Boolean(state.joined);
    const connecting = ['joining', 'reconnecting'].includes(state.status);
    const mode = stateMode(state);
    const participants = state.participants || state.players || [];
    const connectedCount = participants.filter((player) => player.connected === true).length;
    if (!joined || state.muted || mode !== 'push-to-talk') releasePtt();
    text(summaryStatus, joined ? state.muted ? 'MIC OFF · LISTENING'
      : mode === 'push-to-talk' ? 'HOLD V TO TALK' : 'MIC ON'
      : connecting ? 'CONNECTING…' : 'MIC OFF');
    text(help, !inRoom ? 'Join a private room to talk with its players. Voice is optional and your microphone starts off.'
      : unsupported ? 'Voice needs HTTPS (or localhost) and a browser that supports WebRTC.'
        : unavailable ? 'The voice relay is not configured on this room server. Room gameplay remains available.'
          : joined ? (mode === 'push-to-talk' && !mobile
            ? 'Enable your microphone, then hold V during play to talk. Release V to stop. Microphone permission is requested only when you enable it.'
            : 'Enable your microphone to talk to the room. MIC OFF stops transmission. Use headphones to avoid feedback.')
            : 'Join to listen first. Enable the microphone separately when you are ready to talk. Only players in this private room can hear you.');
    joinButton.hidden = joined;
    joinButton.disabled = busy || !inRoom || unsupported || unavailable || connecting;
    leaveButton.hidden = !joined && !connecting;
    leaveButton.disabled = busy;
    micButton.hidden = !joined;
    micButton.disabled = busy || connecting;
    text(micButton, state.muted ? 'MIC OFF · ENABLE' : 'MIC ON · MUTE');
    micButton.setAttribute('aria-label', state.muted ? 'Enable microphone' : 'Mute microphone');
    pressed(micButton, !state.muted);
    deafenButton.hidden = !joined;
    deafenButton.disabled = busy;
    text(deafenButton, state.deafened ? 'HEADPHONES OFF' : 'HEADPHONES ON');
    deafenButton.setAttribute('aria-label', state.deafened ? 'Unmute all room voice audio' : 'Mute all room voice audio');
    pressed(deafenButton, state.deafened);
    settings.hidden = !joined;
    modeLabel.hidden = mobile;
    modeSelect.hidden = mobile;
    modeSelect.disabled = busy;
    if (modeSelect.value !== mode) modeSelect.value = mode;
    const volumePercent = Math.round(clampVolume(state.volume ?? 1) * 100);
    if (doc.activeElement !== volumeInput && volumeInput.value !== String(volumePercent)) {
      volumeInput.value = String(volumePercent);
    }
    text(volumeValue, `${volumePercent}%`);
    resumeButton.hidden = !joined || !state.audioBlocked;
    resumeButton.disabled = busy;
    text(status, message || state.error || (connecting ? 'Connecting voice…'
      : state.audioBlocked ? 'Your browser paused voice audio. Select Enable voice audio to listen.'
        : joined ? `Voice connected · ${connectedCount} ${connectedCount === 1 ? 'player' : 'players'} · ${state.muted ? 'microphone off' : mode === 'push-to-talk' ? 'hold V to talk' : 'microphone on'}`
          : 'Voice is off.'));
    roster.hidden = !joined;
    const present = new Set();
    for (const player of joined ? participants : []) {
      if (!player?.id) continue;
      present.add(player.id);
      let row = rows.get(player.id);
      if (!row) { row = makePlayerRow(player.id); rows.set(player.id, row); }
      const self = player.self === true || player.id === roomState.selfId;
      const name = String(player.name || 'Player');
      const locallyMuted = !self && Boolean(player.localMuted ?? player.muted);
      text(row.name, `${name}${self ? ' (you)' : ''}`);
      text(row.state, player.connected === false ? state.status === 'reconnecting' ? 'reconnecting' : 'voice off'
        : player.speaking && !locallyMuted && !state.deafened ? 'speaking'
          : locallyMuted ? 'muted for you' : player.micMuted ? 'microphone off' : 'listening');
      row.item.classList.toggle('speaking', Boolean(player.speaking && !locallyMuted && !state.deafened));
      row.mute.hidden = self;
      row.volume.hidden = self;
      text(row.mute, locallyMuted ? 'UNMUTE' : 'MUTE');
      pressed(row.mute, locallyMuted);
      row.mute.setAttribute('aria-label', `${locallyMuted ? 'Unmute' : 'Mute'} ${name}`);
      row.volume.setAttribute('aria-label', `Voice volume for ${name}`);
      const playerVolume = String(Math.round(clampVolume(player.volume ?? 1) * 100));
      if (doc.activeElement !== row.volume && row.volume.value !== playerVolume) row.volume.value = playerVolume;
    }
    for (const [id, row] of rows) if (!present.has(id)) { row.dispose(); rows.delete(id); }
    const speakers = participants.filter((player) => player.speaking
      && !(player.localMuted ?? player.muted) && !state.deafened).map((player) => String(player.name || 'Player'));
    badge.hidden = !gameplayActive || !inRoom || !joined;
    const speakerText = speakers.length ? `${speakers.slice(0, 2).join(', ')}${speakers.length > 2 ? ` +${speakers.length - 2}` : ''}` : '';
    text(badge, `${state.deafened ? 'VOICE MUTED' : state.muted ? 'MIC OFF' : mode === 'push-to-talk'
      ? state.pushToTalk ? 'TALKING' : 'VOICE · HOLD V' : 'MIC ON'}${speakerText ? ` · ${speakerText}` : ''}`);
    badge.classList.toggle('speaking', speakers.length > 0 || Boolean(state.pushToTalk && !state.muted));
    if (mobileButton) {
      mobileButton.hidden = !inRoom;
      mobileButton.disabled = busy || unsupported || unavailable || connecting;
      text(mobileButton, !joined ? 'VOICE' : state.muted ? 'MIC OFF' : 'MIC ON');
      mobileButton.setAttribute('aria-label', !joined ? 'Join room voice with microphone off'
        : state.muted ? 'Enable room voice microphone' : 'Mute room voice microphone');
      pressed(mobileButton, joined && !state.muted);
    }
  }
  listen(joinButton, 'click', () => run(() => voice.join()));
  listen(leaveButton, 'click', () => run(() => { releasePtt(); return voice.leave(); }));
  listen(micButton, 'click', () => run(() => voice.setMuted(!voice.getState().muted)));
  listen(deafenButton, 'click', () => voice.setDeafened(!voice.getState().deafened));
  listen(modeSelect, 'change', () => { releasePtt(); setMode(modeSelect.value); });
  listen(volumeInput, 'input', () => voice.setVolume(clampVolume(Number(volumeInput.value) / 100)));
  listen(resumeButton, 'click', () => run(() => voice.unlockAudio()));
  if (mobileButton) listen(mobileButton, 'click', () => run(async () => {
    const state = voice.getState();
    if (!state.joined) { await voice.join(); return; }
    await voice.setMuted(!state.muted);
  }));
  listen(win, 'keydown', (event) => {
    const state = voice.getState();
    if (mobile || event.code !== 'KeyV' || event.repeat || !gameplayActive
      || isTyping(doc.activeElement) || !state.joined || state.muted
      || stateMode(state) !== 'push-to-talk') return;
    event.preventDefault();
    pttHeld = true;
    voice.setPushToTalk(true);
  });
  listen(win, 'keyup', (event) => { if (event.code === 'KeyV') releasePtt(); });
  listen(win, 'blur', releasePtt);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) releasePtt(); });
  const unsubscribeVoice = voice.on('state', render);
  const unsubscribeRoom = client.on('state', render);
  setMode(mobile ? 'open' : 'push-to-talk');
  render();
  return {
    panel, badge, mobileButton, render,
    setGameplayActive(active) {
      const next = Boolean(active);
      if (next === gameplayActive) return;
      gameplayActive = next;
      if (!next) releasePtt();
      render();
    },
    dispose() {
      if (disposed) return;
      releasePtt();
      disposed = true;
      unsubscribeVoice?.();
      unsubscribeRoom?.();
      for (const unlisten of listeners) unlisten();
      for (const row of rows.values()) row.dispose();
      rows.clear();
      panel.remove();
      badge.remove();
      mobileButton?.remove();
    },
  };
}
