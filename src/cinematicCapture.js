// Capture-only camera paths. They use the real scene and renderer, and are
// deliberately independent of player and drone controls.
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const DEFAULT_ORBIT = Object.freeze({
  centerX: 0,
  centerZ: 0,
  targetY: 25,
  radius: 900,
  altitude: 270,
  startBearing: 0,
  durationSeconds: 60,
  fov: 60,
  // Distant weather remains visible while the complete high-cliff outline can
  // still be read. The normal world's atmospheric range is untouched.
  fogDensityCap: 0.00062,
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function orbitOptions(options = {}) {
  return {
    centerX: finite(options.centerX, DEFAULT_ORBIT.centerX),
    centerZ: finite(options.centerZ, DEFAULT_ORBIT.centerZ),
    targetY: finite(options.targetY, DEFAULT_ORBIT.targetY),
    radius: clamp(finite(options.radius, DEFAULT_ORBIT.radius), 550, 1600),
    altitude: clamp(finite(options.altitude, DEFAULT_ORBIT.altitude), 80, 700),
    startBearing: finite(options.startBearing, DEFAULT_ORBIT.startBearing),
    durationSeconds: clamp(finite(options.durationSeconds, DEFAULT_ORBIT.durationSeconds), 1, 3600),
    fov: clamp(finite(options.fov, DEFAULT_ORBIT.fov), 30, 100),
    fogDensityCap: clamp(finite(options.fogDensityCap, DEFAULT_ORBIT.fogDensityCap), 0.0001, 0.01),
  };
}

/** A complete orbit changes world position, and progress 1 closes at progress 0. */
export function orbitCameraPose(progress, options = {}) {
  const config = orbitOptions(options);
  const fraction = clamp(finite(progress, 0), 0, 1);
  const bearing = config.startBearing + TAU * fraction;
  return {
    position: {
      x: config.centerX + Math.sin(bearing) * config.radius,
      y: config.altitude,
      z: config.centerZ + Math.cos(bearing) * config.radius,
    },
    target: { x: config.centerX, y: config.targetY, z: config.centerZ },
    bearing,
    progress: fraction,
    fov: config.fov,
  };
}

function copyPoint(point, fallback) {
  return {
    x: finite(point?.x, fallback.x),
    y: finite(point?.y, fallback.y),
    z: finite(point?.z, fallback.z),
  };
}

/** Reusable controller for a continuous orbit or stable scripted viewpoints. */
export function createCinematicCapture(camera) {
  const normalFov = camera.fov;
  let mode = 'off';
  let orbit = orbitOptions();
  let elapsedSeconds = 0;
  let view = null;

  function pose() {
    if (mode === 'orbit') return orbitCameraPose(elapsedSeconds / orbit.durationSeconds, orbit);
    return view;
  }

  function startOrbit(options = {}) {
    orbit = orbitOptions(options);
    elapsedSeconds = 0;
    view = null;
    mode = 'orbit';
    return state();
  }

  function seekOrbit(seconds) {
    if (mode !== 'orbit') return state();
    elapsedSeconds = clamp(finite(seconds, 0), 0, orbit.durationSeconds);
    return state();
  }

  function update(deltaSeconds) {
    if (mode !== 'orbit') return;
    elapsedSeconds = clamp(elapsedSeconds + Math.max(0, finite(deltaSeconds, 0)),
      0, orbit.durationSeconds);
  }

  function setView({ position, target, fov = normalFov,
    fogDensityCap = null, aerialTrees = false, nightFill = 0 } = {}) {
    view = {
      position: copyPoint(position, camera.position),
      target: copyPoint(target, { x: 0, y: 25, z: 0 }),
      fov: clamp(finite(fov, normalFov), 30, 100),
      fogDensityCap: Number.isFinite(Number(fogDensityCap)) && fogDensityCap !== null
        ? clamp(Number(fogDensityCap), 0.0001, 0.01) : null,
      aerialTrees: Boolean(aerialTrees),
      nightFill: clamp(finite(nightFill, 0), 0, 1),
    };
    mode = 'view';
    return state();
  }

  function stop() {
    mode = 'off';
    view = null;
    if (camera.fov !== normalFov) {
      camera.fov = normalFov;
      camera.updateProjectionMatrix();
    }
    return state();
  }

  function applyToCamera() {
    if (mode === 'off') return false;
    const current = pose();
    camera.position.set(current.position.x, current.position.y, current.position.z);
    camera.lookAt(current.target.x, current.target.y, current.target.z);
    if (camera.fov !== current.fov) {
      camera.fov = current.fov;
      camera.updateProjectionMatrix();
    }
    return true;
  }

  function state() {
    const current = pose();
    return {
      active: mode !== 'off',
      mode,
      elapsedSeconds: mode === 'orbit' ? elapsedSeconds : null,
      durationSeconds: mode === 'orbit' ? orbit.durationSeconds : null,
      progress: mode === 'orbit' ? elapsedSeconds / orbit.durationSeconds : null,
      complete: mode === 'orbit' && elapsedSeconds >= orbit.durationSeconds,
      bearing: mode === 'orbit' ? current.bearing : null,
      startBearing: mode === 'orbit' ? orbit.startBearing : null,
      radius: mode === 'orbit' ? orbit.radius : null,
      altitude: mode === 'orbit' ? orbit.altitude : null,
      position: current ? { ...current.position } : null,
      target: current ? { ...current.target } : null,
      fov: current?.fov ?? normalFov,
      fogDensityCap: mode === 'orbit' ? orbit.fogDensityCap : view?.fogDensityCap ?? null,
      aerialTrees: mode === 'orbit' || Boolean(view?.aerialTrees),
      nightFill: mode === 'view' ? view?.nightFill ?? 0 : 0,
    };
  }

  return { startOrbit, seekOrbit, update, setView, stop, applyToCamera, state,
    get active() { return mode !== 'off'; } };
}
