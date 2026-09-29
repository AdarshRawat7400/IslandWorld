import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGrass } from '../src/grass/WindSweptGrass.js';

const terrain = {
  size: 704,
  heightAt: () => 24,
  normalAt: (_x, _z, target) => target.set(0, 1, 0),
  isPath: () => false,
  path: { width: 7.5, shoulderWidth: 12.5, nearest: () => ({ distance: 100 }) },
};

function smoothstep(low, high, value) {
  const fraction = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return fraction * fraction * (3 - 2 * fraction);
}

test('invisible near-field soft meadow cards skip five atlas reads', (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ getContext: () => ({
      clearRect() {}, fillRect() {},
      createRadialGradient: () => ({ addColorStop() {} }),
    }) }),
  };
  let grass;
  try {
    grass = createGrass({ terrain, quality: 76_000, densityMultiplier: 10,
      windDirection: new THREE.Vector2(1, 0.18) });
    const cards = grass.group.getObjectByName('SoftDistantMeadowClusters');
    assert.ok(cards && cards.geometry.instanceCount > 0,
      'the production soft meadow field exists');
    const shader = cards.material.fragmentShader;
    const earlyDiscard = shader.indexOf('if (farBlend <= 0.0) discard;');
    const firstAtlasRead = shader.indexOf('texture2D(uClusterTexture, vCardUv)');
    assert.ok(earlyDiscard >= 0 && firstAtlasRead >= 0);
    assert.ok(earlyDiscard < firstAtlasRead,
      'the zero-alpha near field is rejected before any of its five atlas reads');

    // The former alpha threshold was 0.004. A zero blend always yielded alpha
    // zero regardless of texture shape and mask density, so the early branch
    // must make exactly the same visibility decision across that full range.
    for (let distance = 0; distance <= 100; distance += 0.125) {
      const blend = smoothstep(34, 72, distance);
      for (const shape of [0, 0.09, 0.36, 0.99]) {
        for (const density of [0, 0.2, 0.7, 1]) {
          const previousVisible = shape * density * blend * 0.34 >= 0.004;
          const optimizedVisible = blend > 0
            && shape * density * blend * 0.34 >= 0.004;
          assert.equal(optimizedVisible, previousVisible);
        }
      }
    }

    const origins = cards.geometry.getAttribute('clusterOrigin');
    const scenicOverlooks = [[-169, 75], [-190, -28], [150, -32], [125, 141], [167, 163]];
    const nearbyCounts = scenicOverlooks.map(([x, z]) => {
      let count = 0;
      for (let index = 0; index < cards.geometry.instanceCount; index++) {
        const dx = origins.getX(index) - x;
        const dz = origins.getZ(index) - z;
        if (dx * dx + dz * dz < 34 * 34) count++;
      }
      return count;
    });
    assert.ok(Math.max(...nearbyCounts) > 0,
      'scenic views include soft meadow cards inside the zero-alpha zone');
    t.diagnostic(`scenic views have ${nearbyCounts.join(', ')} near-field cards whose fragments skip five atlas reads`);
  } finally {
    grass?.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
