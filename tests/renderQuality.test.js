import assert from 'node:assert/strict';
import test from 'node:test';
import { detectRenderEnvironment, selectRenderProfile } from '../src/renderQuality.js';

test('native Android uses a conservative GPU budget despite high memory and core hints', () => {
  const profile = selectRenderProfile({ nativeAndroid: true, mobile: true,
    deviceMemory: 8, hardwareConcurrency: 8 });
  assert.deepEqual(profile, { tier: 'mobile-constrained', pixelRatioCap: 0.85,
    grassQuality: 18_000, grassDensityMultiplier: 4, shadowMapSize: 512,
    cloudStepCap: 4 });
  assert.equal(selectRenderProfile({ nativeAndroid: true, mobile: false,
    deviceMemory: 32, hardwareConcurrency: 16 }), profile,
  'native host budget also holds for emulators and unusual pointer/hardware hints');
  assert.equal(selectRenderProfile({ nativeAndroid: true }), profile);
  assert.ok(Object.isFrozen(profile));
});

test('desktop and mobile browsers retain their existing quality choices', () => {
  for (const [environment, tier, grass, pixelRatio] of [
    [{}, 'desktop', 76_000, 1.6],
    [{ mobile: false, deviceMemory: 2, hardwareConcurrency: 2 }, 'desktop', 76_000, 1.6],
    [{ mobile: true, deviceMemory: 8, hardwareConcurrency: 8 }, 'mobile-high', 42_000, 1.25],
    [{ mobile: true, deviceMemory: 6, hardwareConcurrency: 8 }, 'mobile-standard', 28_000, 1],
    [{ mobile: true }, 'mobile-standard', 28_000, 1],
    [{ mobile: true, deviceMemory: 2, hardwareConcurrency: 8 }, 'mobile-constrained', 18_000, 0.85],
    [{ mobile: true, deviceMemory: 8, hardwareConcurrency: 4 }, 'mobile-constrained', 18_000, 0.85],
  ]) {
    const profile = selectRenderProfile(environment);
    assert.equal(profile.tier, tier);
    assert.equal(profile.grassQuality, grass);
    assert.equal(profile.pixelRatioCap, pixelRatio);
    assert.equal(selectRenderProfile({ ...environment, nativeAndroid: false }), profile);
  }
});

test('Android browser detection alone does not opt a browser into APK graphics', () => {
  const detected = detectRenderEnvironment({ navigator: {
    userAgent: 'Mozilla/5.0 (Linux; Android 16) Chrome/140 Mobile', maxTouchPoints: 5,
    deviceMemory: 8, hardwareConcurrency: 8 },
  innerWidth: 964, innerHeight: 433, devicePixelRatio: 2.8,
  matchMedia: () => ({ matches: true }) });
  assert.equal(detected.mobile, true);
  assert.equal(selectRenderProfile(detected).tier, 'mobile-high');
  assert.equal(selectRenderProfile({ ...detected, nativeAndroid: true }).tier,
    'mobile-constrained');
});
