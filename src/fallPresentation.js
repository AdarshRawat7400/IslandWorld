// A short first-person cliff fall treatment. Movement, timing, and the safe
// respawn position belong to the caller; this module only presents the fall.
const PHASES = new Set(['idle', 'falling', 'impact', 'respawn']);

function clamp01(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function smooth(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function sampleFallPresentation({
  phase = 'idle', progress = 0, elapsed = 0, dropMeters = 0,
  reducedMotion = false,
} = {}) {
  const current = PHASES.has(phase) ? phase : 'idle';
  const t = clamp01(progress);
  const eased = smooth(t);
  const drop = Number.isFinite(dropMeters) ? Math.max(0, dropMeters) : 0;
  if (current === 'falling') {
    return {
      cameraDrop: drop,
      cameraRoll: reducedMotion ? 0 : 0.18 * Math.sin(Math.PI * t)
        + 0.018 * Math.sin((Number.isFinite(elapsed) ? elapsed : 0) * 11) * Math.sin(Math.PI * t),
      opacity: 0.10 + 0.42 * eased,
      blurPx: reducedMotion ? 0 : 1.6 * eased,
      foamOpacity: 0,
      status: '',
    };
  }
  if (current === 'impact') {
    return {
      cameraDrop: drop,
      cameraRoll: 0,
      opacity: 0.78 + 0.18 * eased,
      blurPx: reducedMotion ? 0 : 1.8 * (1 - eased),
      foamOpacity: reducedMotion ? 0 : 0.68 * (1 - eased) ** 2,
      status: 'Fallen into the sea.',
    };
  }
  if (current === 'respawn') {
    return {
      cameraDrop: 0,
      cameraRoll: 0,
      opacity: 0.94 * (1 - eased),
      blurPx: 0,
      foamOpacity: 0,
      status: t < 0.72 ? 'Returning to safe ground.' : '',
    };
  }
  return {
    cameraDrop: 0, cameraRoll: 0, opacity: 0, blurPx: 0,
    foamOpacity: 0, status: '',
  };
}

function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Call update after the usual camera pose is set and before renderer.render.
 * `progress` is 0..1 within the caller's current phase, and `dropMeters` is
 * the camera's vertical displacement below that frame's normal eye height.
 * The caller chooses when to transition falling -> impact -> respawn -> idle.
 */
export function createFallPresentation({
  camera, root = globalThis.document?.body,
  reducedMotion = prefersReducedMotion(),
} = {}) {
  if (!camera?.position || !camera?.rotation || !root?.ownerDocument) {
    throw new TypeError('Fall presentation requires a camera and a DOM root.');
  }
  const doc = root.ownerDocument;
  const overlay = doc.createElement('div');
  overlay.id = 'fall-presentation';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = `position:fixed;inset:0;z-index:2;pointer-events:none;
    display:flex;align-items:center;justify-content:center;text-align:center;
    background:radial-gradient(ellipse at 50% 44%,rgba(3,18,27,.1) 15%,rgba(1,9,15,.82) 100%);
    color:#eff5f1;font:700 clamp(13px,1.6vw,20px) Georgia,serif;
    letter-spacing:.2em;text-shadow:0 2px 18px #001018;
    opacity:0;visibility:hidden;`;
  const foam = doc.createElement('div');
  foam.setAttribute('aria-hidden', 'true');
  foam.style.cssText = `position:absolute;inset:0;pointer-events:none;opacity:0;
    background:radial-gradient(ellipse at 50% 54%,rgba(231,248,243,.9) 0%,rgba(147,201,208,.36) 38%,transparent 72%);`;
  const label = doc.createElement('span');
  label.style.cssText = 'position:relative;max-width:85vw;padding:0 22px;opacity:0;';
  overlay.appendChild(foam);
  overlay.appendChild(label);
  root.appendChild(overlay);
  // Keep the announcement in the accessibility tree even while the visible
  // overlay is hidden; otherwise its first status change can be missed.
  const announcer = doc.createElement('div');
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  announcer.style.cssText = `position:absolute;width:1px;height:1px;padding:0;margin:-1px;
    overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0;`;
  root.appendChild(announcer);

  let elapsed = 0;
  let appliedDrop = 0;
  let presentedY = null;
  let currentStatus = '';
  let disposed = false;

  function undoDropIfStillPresented() {
    if (presentedY !== null && Math.abs(camera.position.y - presentedY) < 0.00001) {
      camera.position.y += appliedDrop;
    }
    appliedDrop = 0;
    presentedY = null;
  }

  function applyFrame(frame) {
    undoDropIfStillPresented();
    camera.position.y -= frame.cameraDrop;
    appliedDrop = frame.cameraDrop;
    presentedY = camera.position.y;
    // The game camera rebuilds yaw and pitch each frame, but does not set roll.
    // Assign the complete roll so it cannot accumulate across frames.
    camera.rotation.z = frame.cameraRoll;
    overlay.style.opacity = String(frame.opacity);
    overlay.style.visibility = frame.opacity > 0.001 ? 'visible' : 'hidden';
    overlay.style.backdropFilter = frame.blurPx > 0.01 ? `blur(${frame.blurPx.toFixed(2)}px)` : 'none';
    foam.style.opacity = String(frame.foamOpacity);
    label.style.opacity = frame.status ? '1' : '0';
    if (frame.status !== currentStatus) {
      currentStatus = frame.status;
      label.textContent = frame.status;
      announcer.textContent = frame.status;
    }
  }

  function update(dt, { phase = 'idle', progress = 0, dropMeters = 0 } = {}) {
    if (disposed) return;
    elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    applyFrame(sampleFallPresentation({
      phase, progress, elapsed, dropMeters, reducedMotion,
    }));
  }

  function reset() {
    if (disposed) return;
    applyFrame(sampleFallPresentation());
  }

  function dispose() {
    if (disposed) return;
    reset();
    disposed = true;
    overlay.remove();
    announcer.remove();
  }

  return { update, reset, dispose, element: overlay };
}
