// Small, renderer-independent prediction queue. The server is the source of
// ammunition; unacknowledged local shots only debit the displayed magazine.
const MAX_PENDING_SHOTS = 8;
const validShotId = (id) => Number.isSafeInteger(id) && id > 0;
const validWeapon = (id) => typeof id === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(id)
  && !['constructor', 'prototype'].includes(id);
const count = (value) => Number.isSafeInteger(value) && value >= 0;

function normalizeState(state) {
  if (!state || !count(state.magazine) || !count(state.reserve)
    || !Number.isFinite(state.reloadingUntil) || state.reloadingUntil < 0) return null;
  const revision = state.revision ?? 0;
  const lastShotId = state.lastShotId ?? 0;
  if (!count(revision) || !count(lastShotId)) return null;
  return { magazine: state.magazine, reserve: state.reserve,
    reloadingUntil: state.reloadingUntil, revision, lastShotId };
}

/**
 * Reconcile at most eight shots in flight, across all weapons. A server ammo
 * revision orders state updates; lastShotId identifies accepted local shots.
 * reserve() is for an eligible shot after the caller checks movement, aim and
 * cadence. Nonzero authoritative reload timers remain blocked until cleared.
 */
export function createAmmoPrediction({ maxPending = MAX_PENDING_SHOTS } = {}) {
  const limit = Number.isInteger(maxPending) && maxPending > 0
    ? Math.min(MAX_PENDING_SHOTS, maxPending) : MAX_PENDING_SHOTS;
  const authoritative = new Map();
  const pending = new Map();
  let nextShotId = 1;

  function ingestOne(weapon, raw) {
    if (!validWeapon(weapon)) return false;
    const state = normalizeState(raw);
    if (!state) return false;
    const prior = authoritative.get(weapon);
    if (prior && state.revision < prior.revision) return false;
    // Within a revision, contradictory or older acceptance metadata must not
    // undo a newer confirmation, even if an old ACK arrives after a snapshot.
    if (prior && state.revision === prior.revision
      && state.lastShotId < prior.lastShotId) return false;
    authoritative.set(weapon, state);
    nextShotId = Math.max(nextShotId, state.lastShotId + 1);
    for (const [id, entry] of pending) {
      if (entry.weapon === weapon && id <= state.lastShotId) pending.delete(id);
    }
    return true;
  }

  function ingest(ammo = {}) {
    if (!ammo || typeof ammo !== 'object' || Array.isArray(ammo)) return false;
    let changed = false;
    for (const [weapon, state] of Object.entries(ammo))
      changed = ingestOne(weapon, state) || changed;
    return changed;
  }

  function snapshot() {
    const debit = new Map();
    for (const { weapon } of pending.values()) debit.set(weapon, (debit.get(weapon) ?? 0) + 1);
    return Object.fromEntries([...authoritative].map(([weapon, state]) => [weapon,
      { ...state, magazine: Math.max(0, state.magazine - (debit.get(weapon) ?? 0)) }]));
  }

  function reset(ammo = {}) {
    authoritative.clear(); pending.clear();
    // IDs never go backwards during this helper's lifetime. The owner should
    // also fence old callbacks when changing player identity or respawning.
    ingest(ammo);
    return snapshot();
  }

  function reserve(weapon) {
    const state = authoritative.get(weapon);
    if (!state || state.reloadingUntil > 0 || pending.size >= limit
      || !validShotId(nextShotId)) return null;
    let debits = 0;
    for (const entry of pending.values()) if (entry.weapon === weapon) debits++;
    if (state.magazine <= debits) return null;
    const id = nextShotId++;
    pending.set(id, { weapon });
    return id;
  }

  function acknowledge(weapon, shotId, state) {
    if (!validShotId(shotId) || !validWeapon(weapon)) return false;
    const normalized = normalizeState(state);
    if (!normalized || normalized.lastShotId < shotId) return false;
    const entry = pending.get(shotId);
    if (entry && entry.weapon !== weapon) return false;
    return ingestOne(weapon, normalized);
  }

  function reject(weapon, shotId) {
    if (!validShotId(shotId) || pending.get(shotId)?.weapon !== weapon) return false;
    return pending.delete(shotId);
  }

  return { reset, ingest, reserve, acknowledge, reject, snapshot,
    get pendingCount() { return pending.size; } };
}
