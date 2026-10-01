// Room voice is independent of rendering and game audio. LiveKit is loaded only
// after a player explicitly joins voice; single-player never requests a microphone.
const clampVolume = (value) => Math.min(1, Math.max(0, Number(value) || 0));

export function createVoiceChat({ client, sdk, loadSdk = () => import('livekit-client'),
  document = globalThis.document,
  window = globalThis.window,
  supported = Boolean(globalThis.isSecureContext && globalThis.RTCPeerConnection
    && globalThis.navigator?.mediaDevices?.getUserMedia),
} = {}) {
  if (!client?.on || !client?.getState || !client?.request) {
    throw new Error('Voice chat needs the multiplayer client.');
  }
  const listeners = new Set();
  const preferences = new Map();
  const receivers = new Map();
  let liveSdk = sdk;
  let room = null;
  let roomHandlers = [];
  let localTrack = null;
  let localEndedCleanup = null;
  let mediaQueue = Promise.resolve();
  let generation = 0;
  let approvedKey = null;
  let disposed = false;
  let status = 'offline';
  let error = '';
  let muted = true;
  let inputMode = 'open';
  let pushToTalk = false;
  let transmitting = false;
  let micBusy = false;
  let deafened = false;
  let volume = 0.75;
  let audioBlocked = false;
  let pendingJoin = null;

  function membership(state = client.getState()) {
    return state.room?.code && state.selfId ? `${state.room.code}:${state.selfId}` : null;
  }
  function membershipReady(state = client.getState()) {
    // A reconnected Socket.IO transport still retains the old room locally
    // while room:resume awaits its authenticated server acknowledgement.
    return Boolean(state.connected && state.status === 'online');
  }
  function authorized(identity) {
    return client.getState().players.some((player) => player.id === identity && player.connected !== false);
  }
  function participant(identity) {
    return room?.remoteParticipants?.get(identity);
  }
  function getState() {
    const game = client.getState();
    const available = Boolean(game.room?.voice?.available);
    return { status, error, supported, available, configured: available,
      joined: status === 'connected' || status === 'reconnecting',
      muted, inputMode, mode: inputMode === 'ptt' ? 'push-to-talk' : 'open',
      pushToTalk, transmitting, micBusy, deafened, volume, audioBlocked,
      participants: game.players.map((player) => {
        const self = player.id === game.selfId;
        const peer = self ? room?.localParticipant : participant(player.id);
        const preference = preferences.get(player.id) || {};
        const microphone = [...(peer?.audioTrackPublications?.values?.() || [])]
          .some((publication) => !publication.isMuted);
        const connected = Boolean(peer && player.connected !== false && status === 'connected');
        return { id: player.id, name: player.name, self, connected,
          speaking: Boolean(connected && (self ? transmitting && peer.isSpeaking : peer.isSpeaking)),
          muted: self ? muted : Boolean(preference.muted), localMuted: Boolean(preference.muted),
          micMuted: self ? !transmitting : !microphone,
          volume: preference.volume ?? 1 };
      }),
    };
  }
  function emitState() {
    if (disposed) return;
    const state = getState();
    for (const listener of listeners) listener(state);
  }
  function changeStatus(next, message = '') {
    status = next;
    error = message;
    emitState();
  }
  function removeReceiver(key) {
    const receiver = receivers.get(key);
    if (!receiver) return;
    receivers.delete(key);
    receiver.element.pause?.();
    receiver.track.detach?.(receiver.element);
    receiver.element.srcObject = null;
    receiver.element.remove?.();
  }
  function applyReceiver(receiver) {
    const preference = preferences.get(receiver.identity) || {};
    const level = deafened || preference.muted ? 0 : volume * (preference.volume ?? 1);
    // Safari on iOS does not reliably honor HTMLMediaElement.volume. LiveKit's
    // WebAudio mix applies an independent gain per track and keeps the otherwise
    // duplicate media-element output muted, including after audio unlock.
    if (receiver.track.setVolume) {
      receiver.track.setVolume(level);
      receiver.element.muted = true;
      receiver.element.volume = 0;
    } else {
      receiver.element.muted = deafened || Boolean(preference.muted);
      receiver.element.volume = level;
    }
  }
  function cleanLocalTrack() {
    localEndedCleanup?.();
    localEndedCleanup = null;
    const previous = localTrack;
    localTrack = null;
    previous?.stop();
    transmitting = false;
    return previous;
  }
  function teardown({ preserveApproval = false } = {}) {
    generation += 1;
    if (!preserveApproval) approvedKey = null;
    const oldRoom = room;
    room = null;
    for (const [event, handler] of roomHandlers) oldRoom?.off(event, handler);
    roomHandlers = [];
    cleanLocalTrack();
    for (const key of [...receivers.keys()]) removeReceiver(key);
    muted = true;
    pushToTalk = false;
    micBusy = false;
    audioBlocked = false;
    mediaQueue = Promise.resolve();
    // disconnect stops every SDK-owned track too. A rejected disconnect must not
    // prevent immediate hardware/audio cleanup or create an unhandled rejection.
    if (oldRoom) {
      try { Promise.resolve(oldRoom.disconnect(true)).catch(() => {}); } catch {}
    }
  }
  function reconcileRoster() {
    for (const [key, receiver] of receivers) {
      if (!authorized(receiver.identity)) removeReceiver(key);
    }
    if (room && status === 'connected') {
      for (const peer of room.remoteParticipants?.values?.() || []) {
        for (const publication of peer.audioTrackPublications?.values?.() || []) {
          if (publication.track) attachRemote(publication.track, publication, peer);
        }
      }
    }
    emitState();
  }
  function attachRemote(track, publication, peer) {
    if (track.kind !== 'audio' || !authorized(peer.identity)) return;
    const key = publication.trackSid || track.sid || peer.identity;
    if (receivers.has(key)) return;
    const element = document?.createElement('audio');
    if (!element) return;
    element.autoplay = true;
    element.playsInline = true;
    element.controls = false;
    element.hidden = true;
    element.setAttribute?.('aria-hidden', 'true');
    track.attach(element);
    const receiver = { identity: peer.identity, track, element };
    receivers.set(key, receiver);
    applyReceiver(receiver);
    document.body?.appendChild(element);
    const epoch = generation;
    Promise.resolve(element.play?.()).catch(() => {
      if (epoch !== generation || !receivers.has(key)) return;
      audioBlocked = true;
      emitState();
    });
    emitState();
  }
  function bindRoom(candidate, epoch) {
    const events = liveSdk.RoomEvent;
    const listen = (event, callback) => {
      if (!event) return;
      const handler = (...args) => {
        if (epoch === generation && room === candidate && !disposed) callback(...args);
      };
      candidate.on(event, handler);
      roomHandlers.push([event, handler]);
    };
    listen(events.TrackSubscribed, attachRemote);
    listen(events.TrackUnsubscribed, (track) => {
      for (const [key, receiver] of receivers) if (receiver.track === track) removeReceiver(key);
      emitState();
    });
    listen(events.ParticipantConnected, reconcileRoster);
    listen(events.ParticipantDisconnected, (peer) => {
      for (const [key, receiver] of receivers) if (receiver.identity === peer.identity) removeReceiver(key);
      emitState();
    });
    listen(events.ActiveSpeakersChanged, emitState);
    listen(events.TrackMuted, emitState);
    listen(events.TrackUnmuted, emitState);
    listen(events.Reconnecting, () => {
      // A reconnect never resumes broadcasting without a new microphone gesture.
      void setMuted(true);
      changeStatus('reconnecting');
    });
    listen(events.Reconnected, () => {
      changeStatus('connected');
      reconcileRoster();
    });
    listen(events.AudioPlaybackStatusChanged, () => {
      audioBlocked = candidate.canPlaybackAudio === false;
      emitState();
    });
    listen(events.Disconnected, () => {
      teardown({ preserveApproval: true });
      changeStatus('error', 'Voice disconnected. Join voice again to reconnect.');
    });
    listen(events.MediaDevicesError, (cause) => {
      void setMuted(true);
      error = microphoneMessage(cause);
      emitState();
    });
  }
  function microphoneMessage(cause) {
    if (['NotAllowedError', 'PermissionDeniedError'].includes(cause?.name)) {
      return 'Microphone permission was denied. Allow it in your browser and try again.';
    }
    if (cause?.name === 'NotFoundError') return 'No microphone was found. You can still listen.';
    return 'Could not use your microphone. Check its permission and connection, then try again.';
  }
  async function joinInternal(key) {
    const epoch = ++generation;
    changeStatus('joining');
    try {
      // Tokens are scoped to the authenticated game membership by the room server.
      // Fetch one before loading WebRTC or ever asking for microphone permission.
      const credentials = await client.request('voice:join', {});
      if (epoch !== generation || key !== membership() || disposed) return getState();
      if (!credentials?.token || !credentials?.url || credentials.identity !== client.getState().selfId) {
        throw new Error('The voice server returned invalid room credentials.');
      }
      liveSdk ||= await loadSdk();
      if (epoch !== generation || key !== membership() || disposed) return getState();
      const candidate = new liveSdk.Room({ adaptiveStream: false, dynacast: true, webAudioMix: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        publishDefaults: { audioPreset: { maxBitrate: 24000 }, dtx: true, red: true,
          forceStereo: false },
      });
      room = candidate;
      bindRoom(candidate, epoch);
      await candidate.connect(credentials.url, credentials.token, { autoSubscribe: true });
      if (epoch !== generation || key !== membership() || disposed) {
        await candidate.disconnect(true);
        return getState();
      }
      changeStatus('connected');
      reconcileRoster();
      return getState();
    } catch (cause) {
      if (epoch !== generation || disposed) return getState();
      teardown({ preserveApproval: true });
      changeStatus('error', cause?.message || 'Voice could not connect.');
      return getState();
    }
  }
  function beginJoin(key) {
    const operation = joinInternal(key);
    pendingJoin = operation;
    operation.finally(() => { if (pendingJoin === operation) pendingJoin = null; });
    return operation;
  }
  async function join() {
    if (disposed) return getState();
    if (!supported) {
      changeStatus('error', 'Voice needs a supported browser on HTTPS or localhost.');
      return getState();
    }
    const state = client.getState();
    const key = membership(state);
    if (!key || !membershipReady(state)) {
      changeStatus('error', 'Join an online game room before joining voice.');
      return getState();
    }
    if (!state.room?.voice?.available) {
      changeStatus('error', 'Voice is not configured on this room server.');
      return getState();
    }
    if (approvedKey === key && status === 'connected') return getState();
    if (approvedKey === key && pendingJoin && status === 'joining') return pendingJoin;
    teardown();
    approvedKey = key;
    return beginJoin(key);
  }
  async function leave() {
    const current = approvedKey === membership() && client.getState().connected;
    teardown();
    preferences.clear();
    changeStatus('offline');
    if (current) {
      try { await client.request('voice:leave', {}); }
      catch { /* Local privacy cleanup always succeeds even if the server is offline. */ }
    }
    return getState();
  }
  async function reconcileMicrophone(epoch) {
    const candidate = room;
    if (epoch !== generation || disposed) return;
    if (muted || status !== 'connected' || !candidate) {
      const previous = cleanLocalTrack();
      if (previous && candidate) {
        try { await candidate.localParticipant.unpublishTrack(previous, true); } catch {}
      }
      if (epoch === generation) { micBusy = false; emitState(); }
      return;
    }
    micBusy = true;
    emitState();
    try {
      if (!localTrack) {
        const captured = await liveSdk.createLocalAudioTrack({ echoCancellation: true,
          noiseSuppression: true, autoGainControl: true, channelCount: 1 });
        if (epoch !== generation || disposed || muted || room !== candidate || status !== 'connected') {
          captured.stop();
          return;
        }
        localTrack = captured;
        const ended = () => {
          if (localTrack !== captured || epoch !== generation) return;
          muted = true;
          pushToTalk = false;
          error = 'Microphone stopped. Check its connection and enable it again.';
          void queueMicrophone();
        };
        captured.mediaStreamTrack?.addEventListener('ended', ended);
        localEndedCleanup = () => captured.mediaStreamTrack?.removeEventListener('ended', ended);
        if (inputMode === 'ptt' && !pushToTalk) await captured.mute();
        if (epoch !== generation || disposed || muted || room !== candidate) {
          captured.stop();
          return;
        }
        await candidate.localParticipant.publishTrack(captured, {
          source: liveSdk.Track?.Source?.Microphone || 'microphone',
          audioPreset: { maxBitrate: 24000 }, dtx: true, red: true, forceStereo: false,
        });
      }
      if (epoch !== generation || muted || room !== candidate || !localTrack) return;
      const active = inputMode === 'open' || pushToTalk;
      if (active) await localTrack.unmute();
      else await localTrack.mute();
      if (epoch === generation && localTrack) {
        const stillActive = !muted && status === 'connected' && (inputMode === 'open' || pushToTalk);
        if (!stillActive) {
          if (localTrack.mediaStreamTrack) localTrack.mediaStreamTrack.enabled = false;
          await localTrack.mute();
        }
        if (epoch === generation) transmitting = stillActive;
      }
    } catch (cause) {
      if (epoch !== generation || disposed) return;
      const previous = cleanLocalTrack();
      if (previous) {
        try { await candidate.localParticipant.unpublishTrack(previous, true); } catch {}
      }
      muted = true;
      pushToTalk = false;
      error = microphoneMessage(cause);
    } finally {
      if (epoch === generation) { micBusy = false; emitState(); }
    }
  }
  function queueMicrophone() {
    const epoch = generation;
    mediaQueue = mediaQueue.catch(() => {}).then(() => reconcileMicrophone(epoch));
    return mediaQueue;
  }
  function setMuted(value) {
    muted = Boolean(value);
    if (muted) {
      pushToTalk = false;
      const previous = cleanLocalTrack();
      const candidate = room;
      if (previous && candidate) mediaQueue = mediaQueue.catch(() => {}).then(async () => {
        try { await candidate.localParticipant.unpublishTrack(previous, true); } catch {}
      });
    }
    else if (!room || status !== 'connected') {
      muted = true;
      error = 'Join voice before enabling your microphone.';
    } else error = '';
    emitState();
    return queueMicrophone();
  }
  function setInputMode(value) {
    inputMode = value === 'ptt' || value === 'push-to-talk' ? 'ptt' : 'open';
    pushToTalk = false;
    if (inputMode === 'ptt') {
      transmitting = false;
      if (localTrack?.mediaStreamTrack) localTrack.mediaStreamTrack.enabled = false;
      localTrack?.mute().catch(() => {});
    }
    emitState();
    return queueMicrophone();
  }
  function setPushToTalk(value) {
    pushToTalk = Boolean(value && !muted && inputMode === 'ptt' && status === 'connected');
    if (!pushToTalk && inputMode === 'ptt') {
      transmitting = false;
      if (localTrack?.mediaStreamTrack) localTrack.mediaStreamTrack.enabled = false;
      localTrack?.mute().catch(() => {});
    }
    emitState();
    return queueMicrophone();
  }
  function setDeafened(value) {
    deafened = Boolean(value);
    for (const receiver of receivers.values()) applyReceiver(receiver);
    emitState();
  }
  function setVolume(value) {
    volume = clampVolume(value);
    for (const receiver of receivers.values()) applyReceiver(receiver);
    emitState();
  }
  function setPlayerMuted(id, value) {
    if (!authorized(id) || id === client.getState().selfId) return;
    preferences.set(id, { ...preferences.get(id), muted: Boolean(value) });
    for (const receiver of receivers.values()) if (receiver.identity === id) applyReceiver(receiver);
    emitState();
  }
  function setPlayerVolume(id, value) {
    if (!authorized(id) || id === client.getState().selfId) return;
    preferences.set(id, { ...preferences.get(id), volume: clampVolume(value) });
    for (const receiver of receivers.values()) if (receiver.identity === id) applyReceiver(receiver);
    emitState();
  }
  async function unlockAudio() {
    const epoch = generation;
    try {
      await room?.startAudio();
      await Promise.all([...receivers.values()].map(({ element }) => element.play?.()));
      if (epoch === generation) { audioBlocked = room?.canPlaybackAudio === false; emitState(); }
      return epoch === generation && !audioBlocked;
    } catch {
      if (epoch === generation) { audioBlocked = true; emitState(); }
      return false;
    }
  }
  function on(type, listener) {
    if (type !== 'state') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  function onGameState(state) {
    if (disposed) return;
    const key = membership(state);
    if (approvedKey && key !== approvedKey) {
      teardown();
      preferences.clear();
      changeStatus('offline');
      return;
    }
    if (approvedKey && !membershipReady(state)) {
      if (room || status === 'joining') teardown({ preserveApproval: true });
      changeStatus('reconnecting');
      return;
    }
    if (approvedKey && membershipReady(state) && status === 'reconnecting' && !room) {
      beginJoin(key);
    }
    reconcileRoster();
  }
  const unsubscribers = [client.on('state', onGameState), client.on('left', () => {
    teardown();
    preferences.clear();
    changeStatus('offline');
  })];
  const onVisibility = () => { if (document.hidden) void setMuted(true); };
  const onPageHide = () => { void leave(); };
  document?.addEventListener?.('visibilitychange', onVisibility);
  window?.addEventListener?.('pagehide', onPageHide);
  function dispose() {
    if (disposed) return;
    void leave();
    disposed = true;
    for (const unsubscribe of unsubscribers) unsubscribe();
    document?.removeEventListener?.('visibilitychange', onVisibility);
    window?.removeEventListener?.('pagehide', onPageHide);
    listeners.clear();
  }
  return { getState, on, join, leave, dispose, setMuted, setInputMode,
    setMode: setInputMode, setPushToTalk, setDeafened, setVolume,
    setPlayerMuted, setPlayerVolume, unlockAudio };
}
