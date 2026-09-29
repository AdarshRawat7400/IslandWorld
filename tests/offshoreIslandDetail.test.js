import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DISTANT_ISLANDS, sampleDistantIslandHeight } from '../src/distantIslands.js';
import { createOffshoreIslandDetail } from '../src/offshoreIslandDetail.js';

test('offshore island details have bounded, deterministic scenery geometry', () => {
  assert.throws(() => createOffshoreIslandDetail(null), TypeError);
  for (const spec of DISTANT_ISLANDS) {
    const first = createOffshoreIslandDetail(spec,
      { sampleHeight: sampleDistantIslandHeight });
    const second = createOffshoreIslandDetail(spec,
      { sampleHeight: sampleDistantIslandHeight });
    const geometry = first.mesh.geometry;
    geometry.computeBoundingBox();
    assert.equal(first.group.children.length, 1);
    assert.equal(first.stats.drawCalls, 1);
    assert.ok(first.stats.treeCount >= 40);
    assert.ok(first.stats.cliffBeds >= 30);
    assert.equal(first.stats.structureCount, 2);
    assert.ok(first.stats.triangles < 5_000);
    assert.ok(geometry.boundingBox.min.y < 0);
    assert.ok(geometry.boundingBox.max.y > spec.cliffHeight + 20);
    assert.deepEqual(Array.from(geometry.attributes.position.array.slice(0, 100)),
      Array.from(second.mesh.geometry.attributes.position.array.slice(0, 100)));
    first.dispose();
    second.dispose();
  }
});

test('remote island detail follows weather, visibility and wind settings', () => {
  const detail = createOffshoreIslandDetail(DISTANT_ISLANDS[0],
    { sampleHeight: sampleDistantIslandHeight });
  const fogColor = new THREE.Color(0x8899aa);
  detail.update(5, { weather: 'clear', fogColor, fogDensity: 0.0019,
    night: 0.1, windStrength: 0.2 });
  const uniforms = detail.mesh.material.uniforms;
  assert.equal(uniforms.uVisibilityFloor.value, 0.45);
  assert.equal(uniforms.uFogDensity.value, 0.0019);
  assert.equal(uniforms.uTime.value, 5);
  assert.ok(uniforms.uFogColor.value.equals(fogColor));
  detail.update(12, { weather: 'storm', night: 1, lightning: 0.7,
    windStrength: 2, visibilityFloor: 0.34 });
  assert.equal(uniforms.uVisibilityFloor.value, 0.34);
  assert.equal(uniforms.uNight.value, 1);
  assert.equal(uniforms.uLightning.value, 0.7);
  assert.ok(uniforms.uWind.value > 2);
  detail.dispose();
});
