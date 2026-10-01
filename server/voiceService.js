import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { MAX_ROOM_PLAYERS } from '../src/multiplayerRules.js';

export const VOICE_TOKEN_SECONDS = 60;
const DEFAULT_TIMEOUT_MS = 5000;
const PRIVATE_ID = /^[a-zA-Z0-9_-]{1,100}$/;

/** Credentials belong to the room backend, never to the Vite client. */
export function validVoiceUrl(value, { allowInsecureLocal = false } = {}) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'wss:'
      && !(allowInsecureLocal && loopback && url.protocol === 'ws:')) return null;
    if (!url.hostname || url.username || url.password || url.search || url.hash
      || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}

function bounded(promise, timeoutMs) {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Voice service timeout')), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function waitUntil(timestamp) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, timestamp - Date.now())));
}

/**
 * Audio SFU adapter. Raw operations remain serialized even when a caller times
 * out: a late removal must never kick a newly connected session of that player.
 * LiveKit Cloud revokes expired membership tokens via the explicit cutoff.
 */
export function createVoiceService({
  url = process.env.LIVEKIT_URL, apiKey = process.env.LIVEKIT_API_KEY,
  apiSecret = process.env.LIVEKIT_API_SECRET, allowInsecureLocal = false,
  roomService, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const endpoint = validVoiceUrl(url, { allowInsecureLocal });
  const available = Boolean(endpoint && typeof apiKey === 'string' && apiKey.trim()
    && typeof apiSecret === 'string' && apiSecret.trim());
  if (!available) return {
    available: false,
    async issue() { throw new Error('Voice service unavailable'); },
    async removeParticipant() {}, async deleteRoom() {}, async close() {},
  };
  const api = roomService || new RoomServiceClient(endpoint, apiKey, apiSecret,
    { requestTimeout: Math.max(1, timeoutMs / 1000), failover: false });
  const rooms = new Map();
  const pruneTimers = new Set();
  let closed = false;
  const validIds = (roomId, identity) => typeof roomId === 'string' && PRIVATE_ID.test(roomId)
    && (identity === undefined || typeof identity === 'string' && PRIVATE_ID.test(identity));

  function roomState(roomId) {
    if (closed || !validIds(roomId)) throw new Error('Invalid voice room');
    let record = rooms.get(roomId);
    if (!record) {
      record = { closed: false, creating: null, participants: new Map() };
      rooms.set(roomId, record);
    }
    return record;
  }

  function participantState(record, identity) {
    let state = record.participants.get(identity);
    if (!state) {
      state = { chain: Promise.resolve(), needsRemoval: false, revokeBefore: 0 };
      record.participants.set(identity, state);
    }
    return state;
  }

  function serialize(state, operation) {
    const raw = state.chain.catch(() => {}).then(operation);
    state.chain = raw;
    // The returned deadline is bounded. Keep raw in the queue until it really
    // settles, including API cancellation; do not serialize the raced promise.
    return bounded(raw, timeoutMs);
  }

  async function ensureRoom(roomId, record) {
    if (record.closed || closed) throw new Error('Voice room closed');
    if (!record.creating) {
      record.creating = Promise.resolve().then(() => api.createRoom({
        name: roomId, maxParticipants: MAX_ROOM_PLAYERS,
        emptyTimeout: VOICE_TOKEN_SECONDS + 30, departureTimeout: 20,
      })).finally(() => { record.creating = null; });
    }
    await record.creating;
    if (record.closed || closed) throw new Error('Voice room closed');
  }

  async function revoke(roomId, identity, state) {
    if (!state.needsRemoval) return;
    const cutoff = state.revokeBefore;
    try {
      await api.removeParticipant(roomId, identity, { revokeTokenTs: BigInt(cutoff) });
    } catch (error) {
      // Cloud still revokes a token when the participant has already left.
      if (error?.code !== 'not_found') throw error;
    }
    if (state.revokeBefore === cutoff) state.needsRemoval = false;
  }

  return {
    available: true,
    issue({ roomId, identity, name }) {
      if (typeof identity !== 'string' || !validIds(roomId, identity)) {
        return Promise.reject(new Error('Invalid voice identity'));
      }
      const record = roomState(roomId);
      const state = participantState(record, identity);
      return serialize(state, async () => {
        if (record.closed || closed) throw new Error('Voice room closed');
        // Retry a previously failed removal rather than issue credentials while
        // an old game socket can still use its voice membership.
        await revoke(roomId, identity, state);
        await ensureRoom(roomId, record);
        await waitUntil(state.revokeBefore * 1000);
        if (record.closed || closed) throw new Error('Voice room closed');
        const access = new AccessToken(apiKey, apiSecret, {
          identity, name, ttl: VOICE_TOKEN_SECONDS,
        });
        access.addGrant({ roomJoin: true, room: roomId,
          canPublish: true, canPublishSources: [TrackSource.MICROPHONE],
          canSubscribe: true, canPublishData: false,
          canUpdateOwnMetadata: false, canSubscribeMetrics: false,
          canManageAgentSession: false,
        });
        const token = await access.toJwt();
        if (record.closed || closed) throw new Error('Voice room closed');
        return { url: endpoint, token, identity, roomId,
          expiresIn: VOICE_TOKEN_SECONDS };
      });
    },
    removeParticipant({ roomId, identity }) {
      if (closed || typeof identity !== 'string' || !validIds(roomId, identity)) return Promise.resolve();
      const record = roomState(roomId);
      const state = participantState(record, identity);
      // A second's precision requires a cutoff just after now, so tokens issued
      // in the same second as leaving are also invalidated. New issuance waits.
      state.revokeBefore = Math.max(state.revokeBefore, Math.floor(Date.now() / 1000) + 1);
      state.needsRemoval = true;
      const result = serialize(state, () => revoke(roomId, identity, state));
      const raw = state.chain;
      raw.then(() => {
        const timer = setTimeout(() => {
          pruneTimers.delete(timer);
          if (state.chain === raw && !state.needsRemoval) record.participants.delete(identity);
        }, Math.max(0, state.revokeBefore * 1000 - Date.now()));
        pruneTimers.add(timer);
        timer.unref?.();
      }).catch(() => {});
      return result;
    },
    deleteRoom(roomId) {
      if (closed || !validIds(roomId)) return Promise.resolve();
      const record = rooms.get(roomId);
      if (!record) return Promise.resolve();
      record.closed = true;
      const raw = Promise.allSettled([
        record.creating,
        ...[...record.participants.values()].map((state) => state.chain),
      ]).then(() => api.deleteRoom(roomId)).catch((error) => {
        if (error?.code !== 'not_found') throw error;
      }).finally(() => { if (rooms.get(roomId) === record) rooms.delete(roomId); });
      return bounded(raw, timeoutMs);
    },
    async close() {
      const pending = [...rooms.keys()].map((roomId) => this.deleteRoom(roomId));
      closed = true;
      await Promise.allSettled(pending);
      for (const timer of pruneTimers) clearTimeout(timer);
      pruneTimers.clear();
    },
  };
}
