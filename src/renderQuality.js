// Hardware hints select a starting cost envelope. The authored island,
// weather transitions and interactions stay the same.
const PROFILES = Object.freeze({
  desktop: Object.freeze({
    tier: 'desktop', pixelRatioCap: 1.6, grassQuality: 76_000,
    grassDensityMultiplier: 10, shadowMapSize: 2048, cloudStepCap: 8,
  }),
  mobileHigh: Object.freeze({
    tier: 'mobile-high', pixelRatioCap: 1.25, grassQuality: 42_000,
    grassDensityMultiplier: 8, shadowMapSize: 1024, cloudStepCap: 6,
  }),
  mobileStandard: Object.freeze({
    tier: 'mobile-standard', pixelRatioCap: 1, grassQuality: 28_000,
    grassDensityMultiplier: 6, shadowMapSize: 1024, cloudStepCap: 5,
  }),
  mobileConstrained: Object.freeze({
    tier: 'mobile-constrained', pixelRatioCap: 0.85, grassQuality: 18_000,
    grassDensityMultiplier: 4, shadowMapSize: 512, cloudStepCap: 4,
  }),
});

function positiveHint(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export const DESKTOP_RENDER_PROFILE = PROFILES.desktop;

export function detectRenderEnvironment(view = typeof window === 'undefined' ? null : window) {
  const navigator = view?.navigator;
  const userAgent = String(navigator?.userAgent ?? '');
  const touchPoints = positiveHint(navigator?.maxTouchPoints) ?? 0;
  const coarsePointer = Boolean(view?.matchMedia?.('(pointer: coarse)')?.matches);
  const shortestSide = Math.min(
    positiveHint(view?.innerWidth) ?? Infinity,
    positiveHint(view?.innerHeight) ?? Infinity,
  );
  return {
    mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
      || (touchPoints > 0 && coarsePointer && shortestSide <= 1100),
    deviceMemory: positiveHint(navigator?.deviceMemory),
    hardwareConcurrency: positiveHint(navigator?.hardwareConcurrency),
    devicePixelRatio: positiveHint(view?.devicePixelRatio) ?? 1,
  };
}

export function selectRenderProfile({ mobile = false, deviceMemory = null,
  hardwareConcurrency = null } = {}) {
  if (!mobile) return PROFILES.desktop;
  const memory = positiveHint(deviceMemory);
  const cores = positiveHint(hardwareConcurrency);
  if ((memory != null && memory <= 3) || (cores != null && cores <= 4)) {
    return PROFILES.mobileConstrained;
  }
  if (memory != null && memory >= 8 && cores != null && cores >= 8) {
    return PROFILES.mobileHigh;
  }
  return PROFILES.mobileStandard;
}
