const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function interpolateAngle(from, to, amount) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
}

export function interpolatePlayerState(from, to, amount) {
  const t = Math.min(1, Math.max(0, amount));
  return {
    ...to,
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
    yaw: interpolateAngle(from.yaw, to.yaw, t),
    pitch: from.pitch + (to.pitch - from.pitch) * t,
  };
}

// Snapshot arrival time is used instead of relying on synchronized client clocks.
// A short delay gives a pair of server snapshots to interpolate between.
export function createPlayerStateBuffer({ delayMs = 115, teleportDistance = 22 } = {}) {
  const histories = new Map();

  function push(player, receivedAt) {
    if (!player || typeof player.id !== 'string' || !Number.isFinite(receivedAt)) return;
    const state = {
      ...player,
      x: finite(player.x), y: finite(player.y), z: finite(player.z),
      yaw: finite(player.yaw), pitch: finite(player.pitch),
    };
    let history = histories.get(player.id) || [];
    const last = history.at(-1)?.state;
    if (last && (Math.hypot(last.x - state.x, last.y - state.y, last.z - state.z)
      > teleportDistance || last.dead !== state.dead || last.mode !== state.mode)) {
      history = [];
    }
    if (history.length && receivedAt <= history.at(-1).at) return;
    history.push({ at: receivedAt, state });
    if (history.length > 5) history.shift();
    histories.set(player.id, history);
  }

  function sample(id, now) {
    const history = histories.get(id);
    if (!history?.length) return null;
    if (history.length === 1) return { ...history[0].state };
    const renderAt = now - delayMs;
    if (renderAt <= history[0].at) return { ...history[0].state };
    for (let i = 1; i < history.length; i++) {
      if (renderAt <= history[i].at) {
        const before = history[i - 1];
        const after = history[i];
        return interpolatePlayerState(before.state, after.state,
          (renderAt - before.at) / Math.max(1, after.at - before.at));
      }
    }
    // Hold the newest state instead of predicting a player through a wall.
    return { ...history.at(-1).state };
  }

  return {
    push, sample, remove: (id) => histories.delete(id),
    clear: () => histories.clear(), size: () => histories.size,
  };
}
