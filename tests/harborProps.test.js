import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HARBOR_PROP_SITES, createHarborProps } from '../src/harborProps.js';
import { isRoad } from '../src/roads.js';
import { isLake } from '../src/inlandLake.js';

test('ground props stay off driving lanes and lake water', () => {
  for (const site of HARBOR_PROP_SITES.filter((item) => item.surface === 'ground')) {
    assert.equal(isRoad(site.x, site.z, (site.radius ?? 0) + 0.9), false, site.id);
    assert.equal(isLake(site.x, site.z, (site.radius ?? 0) + 0.5), false, site.id);
  }
});

test('cargo blocks bodies while the south pier center remains open', () => {
  const props = createHarborProps(new THREE.Scene(), {
    groundHeight: () => 40, pierHeight: () => 0.49,
    northJettyHeight: 0.23, waterHeight: () => 0,
    isGroundSafe: () => true,
  });
  assert.equal(props.collides(-2.75, 346, 0.32), true);
  assert.equal(props.collides(0, 350, 0.32), false);
  assert.equal(props.collides(29, 373, 0.32), false);
  assert.equal(props.sites.length, HARBOR_PROP_SITES.length);
});
