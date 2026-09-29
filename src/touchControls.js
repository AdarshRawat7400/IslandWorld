const STICK_RADIUS = 44;
const STICK_DEAD_ZONE = 7;

export function stickVector(dx, dy, radius = STICK_RADIUS) {
  const distance = Math.hypot(dx, dy);
  if (distance <= STICK_DEAD_ZONE) return { x: 0, y: 0 };
  const strength = Math.min(1, (distance - STICK_DEAD_ZONE) / (radius - STICK_DEAD_ZONE));
  return { x: dx / distance * strength, y: dy / distance * strength };
}

export function createTouchInput() {
  let stickPointer = null;
  let lookPointer = null;
  let stick = { x: 0, y: 0 };
  let lookPosition = null;
  const held = new Map();
  const isHeld = (name) => (held.get(name)?.size ?? 0) > 0;

  return {
    startStick(id, x, y, centerX, centerY) {
      if (stickPointer !== null) return false;
      stickPointer = id;
      stick = stickVector(x - centerX, y - centerY);
      return true;
    },
    moveStick(id, x, y, centerX, centerY) {
      if (id !== stickPointer) return false;
      stick = stickVector(x - centerX, y - centerY);
      return true;
    },
    endStick(id) {
      if (id !== stickPointer) return false;
      stickPointer = null;
      stick = { x: 0, y: 0 };
      return true;
    },
    startLook(id, x, y) {
      if (lookPointer !== null) return false;
      lookPointer = id;
      lookPosition = { x, y };
      return true;
    },
    moveLook(id, x, y) {
      if (id !== lookPointer || !lookPosition) return null;
      const delta = { x: x - lookPosition.x, y: y - lookPosition.y };
      lookPosition = { x, y };
      return delta;
    },
    endLook(id) {
      if (id !== lookPointer) return false;
      lookPointer = null;
      lookPosition = null;
      return true;
    },
    hold(name, active, pointerId = 0) {
      if (active) {
        if (!held.has(name)) held.set(name, new Set());
        held.get(name).add(pointerId);
      } else {
        held.get(name)?.delete(pointerId);
        if (!held.get(name)?.size) held.delete(name);
      }
    },
    isHeld,
    snapshot() {
      return { forward: stick.y === 0 ? 0 : -stick.y, sideways: stick.x, steer: stick.x,
        throttle: Number(isHeld('throttle')) - Number(isHeld('reverse')),
        brake: isHeld('brake'),
        ascend: Number(isHeld('ascend')), descend: Number(isHeld('descend')),
        boost: isHeld('boost') };
    },
    reset() {
      stickPointer = null;
      lookPointer = null;
      lookPosition = null;
      stick = { x: 0, y: 0 };
      held.clear();
    },
  };
}

export function createTouchControls(root, { onLook, onAction }) {
  const input = createTouchInput();
  const stick = root.querySelector('#touch-stick');
  const thumb = root.querySelector('#touch-stick-thumb');
  const look = root.querySelector('#touch-look');
  const action = root.querySelector('#touch-action');
  const center = () => {
    const rect = stick.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const paintStick = () => {
    const axis = input.snapshot();
    thumb.style.transform = `translate(${Math.round(axis.sideways * 32)}px, ${Math.round(-axis.forward * 32)}px)`;
  };
  stick.addEventListener('pointerdown', (event) => {
    const c = center();
    if (input.startStick(event.pointerId, event.clientX, event.clientY, c.x, c.y)) {
      stick.setPointerCapture(event.pointerId);
      paintStick();
    }
    event.preventDefault();
  });
  stick.addEventListener('pointermove', (event) => {
    const c = center();
    if (input.moveStick(event.pointerId, event.clientX, event.clientY, c.x, c.y)) paintStick();
    event.preventDefault();
  });
  const releaseStick = (event) => {
    if (input.endStick(event.pointerId)) paintStick();
    event.preventDefault();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(type, releaseStick);
  look.addEventListener('pointerdown', (event) => {
    if (input.startLook(event.pointerId, event.clientX, event.clientY)) look.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  look.addEventListener('pointermove', (event) => {
    const delta = input.moveLook(event.pointerId, event.clientX, event.clientY);
    if (delta) onLook(delta.x, delta.y);
    event.preventDefault();
  });
  const releaseLook = (event) => { input.endLook(event.pointerId); event.preventDefault(); };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) look.addEventListener(type, releaseLook);
  for (const button of root.querySelectorAll('[data-touch-hold]')) {
    const name = button.dataset.touchHold;
    button.addEventListener('pointerdown', (event) => {
      input.hold(name, true, event.pointerId);
      button.classList.add('pressed');
      button.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    const release = (event) => {
      input.hold(name, false, event.pointerId);
      button.classList.toggle('pressed', input.isHeld(name));
      event.preventDefault();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
  }
  for (const button of root.querySelectorAll('[data-touch-action]')) {
    button.addEventListener('click', () => onAction(button.dataset.touchAction));
  }
  return {
    input,
    setVisible(visible) {
      if (root.classList.contains('hidden') === !visible) return;
      root.classList.toggle('hidden', !visible);
      if (!visible) this.reset();
    },
    setMode(mode) {
      if (root.dataset.mode !== mode) root.dataset.mode = mode;
    },
    setAction(label, enabled) {
      if (action.textContent !== label) action.textContent = label;
      if (action.disabled !== !enabled) action.disabled = !enabled;
    },
    reset() {
      input.reset();
      paintStick();
      for (const button of root.querySelectorAll('[data-touch-hold]')) button.classList.remove('pressed');
    },
  };
}
