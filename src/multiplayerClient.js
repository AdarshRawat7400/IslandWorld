import { io } from 'socket.io-client';

const SESSION_KEY = 'island-world-private-room-v1';
const MOVE_INTERVAL_MS = 1000 / 15;

function readSession(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(SESSION_KEY) || 'null');
    return saved && typeof saved.code === 'string' && typeof saved.token === 'string'
      ? saved : null;
  } catch { return null; }
}

function resolveServerUrl(explicitUrl) {
  if (explicitUrl) return explicitUrl;
  const configured = import.meta.env?.VITE_ISLAND_SERVER_URL;
  if (configured) return configured;
  if (typeof location !== 'undefined'
    && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    return `http://${location.hostname}:3001`;
  }
  return null;
}

export function createMultiplayerClient({ url, storage = globalThis.localStorage,
  socketFactory = io, now = () => performance.now() } = {}) {
  const serverUrl = resolveServerUrl(url);
  const listeners = new Map();
  let socket = null;
  let session = readSession(storage);
  let room = null;
  let selfId = null;
  let status = 'offline';
  let error = '';
  let resumeOnConnect = false;
  let disposed = false;
  let lastMoveAt = -Infinity;

  function emit(type, payload) {
    for (const listener of listeners.get(type) || []) listener(payload);
  }

  function getState() {
    return {
      status, error, serverUrl, room, code: room?.code || session?.code || null,
      mode: room?.mode || null, selfId,
      self: room?.players?.find((player) => player.id === selfId) || null,
      players: room?.players || [],
      savedSession: Boolean(session),
      connected: Boolean(socket?.connected && room),
    };
  }

  function changeStatus(next, message = '') {
    status = next;
    error = message;
    emit('state', getState());
    if (message) emit('error', message);
  }

  function saveSession(next) {
    session = next;
    try {
      if (next) storage?.setItem(SESSION_KEY, JSON.stringify(next));
      else storage?.removeItem(SESSION_KEY);
    } catch { /* Private browsing may disable storage; the room still works. */ }
  }

  function acceptMembership(ack, name) {
    if (!ack?.ok || !ack.room || !ack.code || !ack.token || !ack.selfId) {
      throw new Error(ack?.message || 'Could not join the room.');
    }
    room = ack.room;
    selfId = ack.selfId;
    saveSession({ code: ack.code, token: ack.token, name: name || session?.name || '' });
    resumeOnConnect = false;
    changeStatus('online');
    emit('joined', getState());
    emit('snapshot', room);
    return getState();
  }

  function clearMembership({ keepSocket = false } = {}) {
    room = null;
    selfId = null;
    resumeOnConnect = false;
    saveSession(null);
    if (!keepSocket) socket?.disconnect();
    changeStatus('offline');
    emit('left', getState());
  }

  function socketRequest(event, payload, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (!socket?.connected) return reject(new Error('Room server is disconnected.'));
      socket.timeout(timeoutMs).emit(event, payload, (timeoutError, ack) => {
        if (timeoutError) return reject(new Error('Room server did not respond.'));
        if (!ack?.ok) return reject(new Error(ack?.message || ack?.error || 'Request failed.'));
        resolve(ack);
      });
    });
  }

  async function resumeConnected() {
    if (!session || !socket?.connected) return;
    try {
      const ack = await socketRequest('room:resume',
        { code: session.code, token: session.token });
      acceptMembership(ack, session.name);
    } catch (cause) {
      clearMembership({ keepSocket: true });
      changeStatus('error', `Room session expired: ${cause.message}`);
    }
  }

  function ensureSocket() {
    if (disposed) throw new Error('Room connection was closed.');
    if (!serverUrl) throw new Error('Online rooms need VITE_ISLAND_SERVER_URL for this site.');
    if (socket) return socket;
    socket = socketFactory(serverUrl, {
      autoConnect: false, reconnection: true, reconnectionDelay: 500,
      reconnectionDelayMax: 3000, timeout: 8000,
    });
    socket.on('connect', () => {
      if (resumeOnConnect && session) {
        changeStatus('reconnecting');
        void resumeConnected();
      }
    });
    socket.on('disconnect', () => {
      if (room) {
        resumeOnConnect = true;
        changeStatus('reconnecting', 'Connection lost. Rejoining the room…');
      } else if (status !== 'offline') changeStatus('connecting');
    });
    socket.io.on('reconnect_attempt', () => {
      if (room) changeStatus('reconnecting');
    });
    socket.on('room:snapshot', (nextRoom) => {
      if (!room || nextRoom?.code !== room.code) return;
      room = nextRoom;
      emit('snapshot', room);
      emit('state', getState());
    });
    socket.on('room:roster', (roster) => {
      if (!room) return;
      const incoming = Array.isArray(roster) ? roster
        : Array.isArray(roster?.players) ? roster.players : null;
      if (!incoming) return;
      const current = new Map(room.players?.map((player) => [player.id, player]));
      room = { ...room, players: incoming.map((player) =>
        ({ ...(current.get(player.id) || {}), ...player })) };
      emit('state', getState());
    });
    socket.on('combat:event', (event) => emit('combat', event));
    socket.on('npc:state', (npc) => emit('npc', npc));
    socket.on('wildlife:state', (event) => emit('wildlife', event));
    socket.on('loot:state', (event) => emit('loot', event));
    socket.on('explosive:state', (event) => emit('explosive', event));
    socket.on('world:state', (world) => emit('world', world));
    socket.on('interaction:event', (event) => emit('interaction', event));
    socket.on('room:error', (problem) => {
      changeStatus(room ? status : 'error', problem?.message || String(problem));
    });
    socket.on('room:replaced', () => {
      clearMembership({ keepSocket: true });
      changeStatus('error', 'This room was resumed in another browser.');
    });
    return socket;
  }

  async function connect() {
    const candidate = ensureSocket();
    if (candidate.connected) return;
    changeStatus(room ? 'reconnecting' : 'connecting');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup(); reject(new Error('Could not reach the room server.'));
      }, 9000);
      const cleanup = () => {
        clearTimeout(timer);
        candidate.off('connect', onConnected);
        candidate.off('connect_error', onError);
      };
      const onConnected = () => { cleanup(); resolve(); };
      const onError = (cause) => { cleanup(); reject(new Error(cause?.message || 'Connection failed.')); };
      candidate.once('connect', onConnected);
      candidate.once('connect_error', onError);
      candidate.connect();
    });
  }

  async function createRoom({ name, mode = 'explore' }) {
    if (room) throw new Error('Leave your current room first.');
    try {
      await connect();
      const ack = await socketRequest('room:create', { name, mode });
      return acceptMembership(ack, name);
    } catch (cause) { changeStatus('error', cause.message); throw cause; }
  }

  async function joinRoom({ code, name }) {
    if (room) throw new Error('Leave your current room first.');
    try {
      await connect();
      const ack = await socketRequest('room:join', {
        code: String(code || '').trim().toUpperCase(), name,
      });
      return acceptMembership(ack, name);
    } catch (cause) { changeStatus('error', cause.message); throw cause; }
  }

  async function resumeRoom() {
    if (!session) throw new Error('No saved room session.');
    if (room && socket?.connected) return getState();
    try {
      resumeOnConnect = false;
      await connect();
      const ack = await socketRequest('room:resume',
        { code: session.code, token: session.token });
      return acceptMembership(ack, session.name);
    } catch (cause) { changeStatus('error', cause.message); throw cause; }
  }

  async function leaveRoom() {
    if (socket?.connected && room) {
      try { await socketRequest('room:leave', {}); }
      catch { /* The local leave should still complete after a network failure. */ }
    }
    clearMembership();
  }

  function sendPlayerState(player) {
    if (!room || !socket?.connected) return false;
    const at = now();
    if (at - lastMoveAt < MOVE_INTERVAL_MS) return false;
    const { x, y, z, yaw, pitch } = player || {};
    if (![x, y, z, yaw, pitch].every(Number.isFinite)) return false;
    lastMoveAt = at;
    socket.emit('player:move', {
      x, y, z, yaw, pitch,
      mode: ['walk', 'drive', 'drone'].includes(player.mode) ? player.mode : 'walk',
      stance: ['stand', 'crouch', 'prone'].includes(player.stance)
        ? player.stance : 'stand',
      vehicleId: player.vehicleId || null,
    });
    return true;
  }

  function request(event, payload = {}) {
    if (!room) return Promise.reject(new Error('Join a room first.'));
    return socketRequest(event, payload);
  }

  function on(type, listener) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
    return () => listeners.get(type)?.delete(listener);
  }

  function dispose() {
    disposed = true;
    socket?.disconnect();
    socket?.removeAllListeners();
    socket?.io.removeAllListeners();
    socket = null;
    listeners.clear();
  }

  return { createRoom, joinRoom, resumeRoom, leaveRoom, sendPlayerState,
    request, on, getState, dispose };
}
