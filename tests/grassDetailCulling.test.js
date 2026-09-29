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

test('detail grass submits no cells that cannot reach the visible fade circle', (t) => {
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
    const detail = grass.group.getObjectByName('WorldAnchoredNearGrass');
    assert.ok(detail);
    const origins = detail.geometry.getAttribute('bladeOrigin');
    const { uDetailSpacing, uDetailOuterRadius } = detail.material.userData.uniforms;
    const spacing = uDetailSpacing.value;
    const radius = uDetailOuterRadius.value;
    const gridSide = Math.round(151 * Math.sqrt(10));
    const halfGrid = Math.floor(gridSide * 0.5);
    const retained = new Set();
    for (let i = 0; i < origins.count; i++) {
      const x = origins.getX(i);
      const z = origins.getZ(i);
      retained.add(`${x},${z}`);
      assert.ok(Number.isInteger(x) && Number.isInteger(z));
    }
    assert.equal(retained.size, origins.count);
    assert.ok(retained.has('0,0'));

    let omitted = 0;
    for (let row = 0; row < gridSide; row++) {
      for (let column = 0; column < gridSide; column++) {
        const x = column - halfGrid;
        const z = row - halfGrid;
        if (retained.has(`${x},${z}`)) continue;
        omitted++;
        // A cell can shift at most 0.5 from camera snapping and 0.38 from
        // blade jitter along each axis. Check the nearest possible origin to
        // the camera's fade circle, independent of the radial culling formula.
        const nearestX = Math.max(0, Math.abs(x) - 0.88);
        const nearestZ = Math.max(0, Math.abs(z) - 0.88);
        assert.ok(Math.hypot(nearestX, nearestZ) * spacing > radius,
          `potentially visible detail cell ${x},${z} was culled`);
      }
    }
    assert.equal(omitted + origins.count, gridSide * gridSide);
    assert.ok(omitted / (gridSide * gridSide) > 0.25);
    assert.match(detail.material.onBeforeCompile.toString(),
      /if \(distanceKeep <= 0\.0\) discard;/);
    t.diagnostic(`${omitted.toLocaleString('en-US')} of ${(gridSide * gridSide).toLocaleString('en-US')} invisible detail cells omitted (${(omitted / (gridSide * gridSide) * 100).toFixed(1)}%)`);
  } finally {
    grass?.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
