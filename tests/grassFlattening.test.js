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

function shaderSource(material) {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>\n'
      + 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
  };
  material.onBeforeCompile(shader);
  return shader.vertexShader;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

test('grass footprints skip distant square roots while preserving interaction shape', (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        clearRect() {}, fillRect() {},
        createRadialGradient: () => ({ addColorStop() {} }),
      }),
    }),
  };
  let grass;
  try {
    grass = createGrass({ terrain, quality: 76_000, densityMultiplier: 10,
      windDirection: new THREE.Vector2(1, 0.18) });
    const detail = grass.group.getObjectByName('WorldAnchoredNearGrass');
    assert.ok(detail, 'the player detail field exists');
    for (const material of [grass.material, detail.material]) {
      const source = shaderSource(material);
      assert.match(source, /if \(dot\(delta, delta\) >= radius \* radius\) continue;/);
      assert.ok(source.indexOf('dot(delta, delta)') < source.indexOf('length(delta)'),
        'the cheap radius check precedes the square root');
    }

    const radius = 1.35;
    for (let ix = -150; ix <= 150; ix++) {
      for (let iz = -150; iz <= 150; iz++) {
        const dx = ix / 17;
        const dz = iz / 17;
        const previous = smoothstep(radius, 0, Math.hypot(dx, dz)) * 0.8;
        const guarded = dx * dx + dz * dz >= radius * radius
          ? 0 : smoothstep(radius, 0, Math.hypot(dx, dz)) * 0.8;
        assert.equal(guarded, previous);
      }
    }

    // Use the actual authored detail-grid spacing. A twelve-print walking
    // trail in a 51 m field leaves over 99% of vertex/flattener pairs outside
    // their circles, so this guard skips the expensive math in the hot path.
    const origins = detail.geometry.getAttribute('bladeOrigin');
    const spacing = detail.material.userData.uniforms.uDetailSpacing.value;
    let outside = 0;
    let pairs = 0;
    for (let i = 0; i < origins.count; i++) {
      const x = origins.getX(i) * spacing;
      const z = origins.getZ(i) * spacing;
      for (let trail = 0; trail < 12; trail++) {
        const dz = z + trail * 0.6;
        if (x * x + dz * dz >= radius * radius) outside++;
        pairs++;
      }
    }
    assert.ok(outside / pairs > 0.99,
      `expected most grass interaction pairs outside the footprint, got ${outside}/${pairs}`);
    t.diagnostic(`${(100 * outside / pairs).toFixed(3)}% of ${pairs.toLocaleString('en-US')} detail-field footprint pairs skip square roots at the authored 10x density`);
  } finally {
    grass?.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
