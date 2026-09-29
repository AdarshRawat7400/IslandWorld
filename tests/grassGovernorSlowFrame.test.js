import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGrass } from '../src/grass/WindSweptGrass.js';

test('sustained visible slow frames lower grass work while hidden-tab gaps do not', () => {
  const previousDocument = globalThis.document;
  const fakeDocument = {
    visibilityState: 'visible',
    createElement: () => ({ getContext: () => ({
      clearRect() {}, fillRect() {},
      createRadialGradient: () => ({ addColorStop() {} }),
    }) }),
  };
  globalThis.document = fakeDocument;
  let grass;
  try {
    const terrain = {
      size: 200,
      heightAt: () => 24,
      normalAt: (_x, _z, target) => target.set(0, 1, 0),
      isPath: () => false,
      path: { width: 7.5, shoulderWidth: 12.5,
        nearest: () => ({ distance: 100 }) },
    };
    grass = createGrass({ terrain, quality: 12_000,
      windDirection: new THREE.Vector2(1, 0.18) });
    const meadow = grass.group.getObjectByName('ContinuousChunkedMeadow');
    const drawnClusters = () => meadow.children.reduce(
      (sum, mesh) => sum + mesh.geometry.instanceCount, 0,
    );
    assert.equal(drawnClusters(), grass.telemetry.authoredClusterCount);
    assert.equal(grass.densityScale, 1);
    for (let frame = 1; frame <= 20; frame += 1) grass.update(1, frame);
    assert.ok(grass.densityScale < 1,
      'a visible game struggling at one frame per second eventually reduces grass work');
    assert.ok(grass.telemetry.adaptationCount >= 1);
    assert.equal(drawnClusters(), grass.telemetry.renderedClusterCount,
      'the governor changes actual instanced geometry draw counts');
    const visibleScale = grass.densityScale;
    fakeDocument.visibilityState = 'hidden';
    for (let frame = 21; frame <= 41; frame += 1) grass.update(1, frame);
    assert.equal(grass.densityScale, visibleScale,
      'background-tab pauses cannot trigger further quality changes');
    assert.equal(grass.telemetry.ignoredFrameSamples, 21);
  } finally {
    grass?.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
