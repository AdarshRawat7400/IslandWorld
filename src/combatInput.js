// A PointerEvent fires pointerdown for the first mouse button only. Combat
// needs mousedown/mouseup instead, because aim and fire are separate buttons.
// Keep this state independent from touch pointers and from camera drag input.
const buttonBit = (button) => button === 0 ? 1 : button === 2 ? 2 : button === 1 ? 4 : 0;

export function createCombatMouseInput({
  onAim = () => {}, onTriggerChange = () => {}, onFire = () => {},
} = {}) {
  let buttons = 0;
  let aiming = false;
  let firing = false;

  function reconcile(event, pressed, {
    canAim = true, canFire = true, fireOnPress = true,
  } = {}) {
    const reported = Number(event?.buttons);
    buttons = event?.buttons !== undefined && Number.isSafeInteger(reported) && reported >= 0
      ? reported : pressed ? buttons | buttonBit(event?.button)
        : buttons & ~buttonBit(event?.button);
    const nextAim = canAim && Boolean(buttons & 2);
    const nextFire = canFire && Boolean(buttons & 1);
    const fireBegan = nextFire && !firing;
    if (aiming !== nextAim) { aiming = nextAim; onAim(aiming); }
    if (firing !== nextFire) { firing = nextFire; onTriggerChange(firing); }
    if (pressed && fireBegan && fireOnPress) onFire();
    return { buttons, aiming, firing };
  }

  return {
    handleMouseDown(event, policy) { return reconcile(event, true, policy); },
    handleMouseUp(event, policy) { return reconcile(event, false, policy); },
    reset() {
      buttons = 0;
      if (aiming) { aiming = false; onAim(false); }
      if (firing) { firing = false; onTriggerChange(false); }
    },
    get state() { return { buttons, aiming, firing }; },
  };
}
