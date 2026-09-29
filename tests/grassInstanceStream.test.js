import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGrass } from '../src/grass/WindSweptGrass.js';

test('the authored near-grass field draws every blade without identity instance matrices', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ getContext: () => ({
      clearRect() {}, fillRect() {},
      createRadialGradient: () => ({ addColorStop() {} }),
    }) }),
  };
  let grass;
  try {
    const terrain = {
      size: 704,
      heightAt: () => 24,
      normalAt: (_x, _z, target) => target.set(0, 1, 0),
      isPath: () => false,
      path: { width: 7.5, shoulderWidth: 12.5,
        nearest: () => ({ distance: 100 }) },
    };
    grass = createGrass({ terrain, quality: 76_000,
      densityMultiplier: 10, windDirection: new THREE.Vector2(1, 0.18) });
    const detail = grass.group.getObjectByName('WorldAnchoredNearGrass');
    const origins = detail.geometry.getAttribute('bladeOrigin');
    assert.equal(detail.geometry.isInstancedBufferGeometry, true);
    assert.equal(origins.isInstancedBufferAttribute, true);
    assert.equal(detail.geometry.instanceCount, origins.count);
    assert.equal(detail.geometry.instanceCount, grass.detailBladeCount);
    assert.equal(detail.geometry.instanceCount, 160345,
      'the 10x authored near-grass density is retained');
    assert.equal(detail.instanceMatrix, undefined,
      'the 10.26 MB identity transform stream is not allocated');

    const meadow = grass.group.getObjectByName('ContinuousChunkedMeadow');
    const meadowMeshes = meadow.children;
    const authoredClusters = meadowMeshes.reduce((sum, mesh) => {
      const origins = mesh.geometry.getAttribute('bladeOrigin');
      assert.equal(mesh.geometry.isInstancedBufferGeometry, true);
      assert.equal(mesh.instanceMatrix, undefined,
        'meadow clusters need no duplicate identity transform stream');
      assert.equal(mesh.geometry.instanceCount, origins.count);
      return sum + origins.count;
    }, 0);
    assert.equal(authoredClusters, grass.meadowTuftCount);
    const cards = grass.group.getObjectByName('SoftDistantMeadowClusters');
    assert.equal(cards.geometry.isInstancedBufferGeometry, true);
    assert.equal(cards.geometry.instanceCount,
      cards.geometry.getAttribute('clusterOrigin').count);
    assert.equal(cards.instanceMatrix, undefined,
      'soft meadow cards need no duplicate identity transform stream');

    // The desktop field still authors the same clusters and triangles, while
    // avoiding 64 bytes of GPU upload for every cluster and soft card.
    const avoidedMatrixBytes = (authoredClusters + cards.geometry.instanceCount) * 64;
    assert.ok(avoidedMatrixBytes > 6_000_000,
      `expected over 6 MB of eliminated identity matrices, got ${avoidedMatrixBytes}`);
    assert.equal(grass.meadowBladeCount, authoredClusters * 40);
  } finally {
    grass?.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
