// Shared camera and movement measurements in world metres. The server accepts
// a stance only when the player's reported eye is at that stance's height.
export const PLAYER_STANCES = Object.freeze({
  stand: Object.freeze({ eyeHeight: 1.88, walkSpeed: 4.6, runSpeed: 7.3,
    serverMaxSpeed: 9, hitHeight: 1.95, hitRadius: 0.48 }),
  crouch: Object.freeze({ eyeHeight: 1.18, walkSpeed: 2.5, runSpeed: 2.5,
    serverMaxSpeed: 3.4, hitHeight: 1.22, hitRadius: 0.48 }),
  prone: Object.freeze({ eyeHeight: 0.56, walkSpeed: 1.05, runSpeed: 1.05,
    serverMaxSpeed: 1.7, hitHeight: 0.58, hitRadius: 0.66 }),
});

export function validPlayerStance(stance) {
  return typeof stance === 'string' && Object.hasOwn(PLAYER_STANCES, stance);
}

export function playerStance(stance) {
  return PLAYER_STANCES[stance] || PLAYER_STANCES.stand;
}

export function togglePlayerStance(current, requested) {
  if (!validPlayerStance(requested) || requested === 'stand') return 'stand';
  return current === requested ? 'stand' : requested;
}

export function stanceEyeHeight(standingEyeHeight, stance) {
  return standingEyeHeight - PLAYER_STANCES.stand.eyeHeight
    + playerStance(stance).eyeHeight;
}
