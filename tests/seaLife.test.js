import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld } from '../src/world.js';
import { createSeaLife, OFFSHORE_ROUTES, OFFSHORE_SWELLS,
  offshoreRoutePose } from '../src/seaLife.js';

const world = createWorld(new THREE.Scene(), new THREE.Camera());

test('distant sea lanes and swell banks stay outside the island and dock channels', () => {
  for (const route of OFFSHORE_ROUTES) for (let sample = 0; sample <= 20; sample++) {
    const t = sample / 20;
    const x = route.start[0] + (route.end[0] - route.start[0]) * t;
    const z = route.start[1] + (route.end[1] - route.start[1]) * t;
    assert.ok(world.coastalRadius(x, z) > 1.25, `${route.kind} must stay offshore`);
    assert.ok(!(Math.abs(x) < 130 && z > 315), 'south landing ferry lane stays clear');
    assert.ok(!(Math.abs(x + 65) < 110 && z < -305), 'north jetty channel stays clear');
  }
  for (const swell of OFFSHORE_SWELLS) {
    const rotation = new THREE.Euler(-Math.PI / 2, 0, swell.yaw);
    for (const u of [-swell.length / 2, 0, swell.length / 2]) {
      for (const v of [-10, 0, 10]) {
        for (const travel of [0, 6, 12]) {
          const offset = new THREE.Vector3(u, v, 0).applyEuler(rotation);
          const x = swell.x + offset.x + swell.shorewardX * travel;
          const z = swell.z + offset.z + swell.shorewardZ * travel;
          assert.ok(world.coastalRadius(x, z) > 1.25,
            `whole swell footprint must remain offshore at ${x}, ${z}`);
          assert.ok(!(Math.abs(x) < 130 && z > 315), 'south ferry lane stays clear');
          assert.ok(!(Math.abs(x + 65) < 110 && z < -305),
            'north jetty channel stays clear');
        }
      }
    }
  }
});

test('ships appear periodically, travel on fixed lanes, and remain a bounded scene layer', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x899b9b, 0.0027);
  const seaLife = createSeaLife(scene, { waterHeight: world.waterHeight });
  assert.equal(seaLife.ships.length, 3);
  assert.equal(seaLife.swells.length, 3);
  const arrival = offshoreRoutePose(OFFSHORE_ROUTES[0], 0);
  const southPierDistance = Math.hypot(arrival.x - 2.6, arrival.z - 350);
  assert.equal(arrival.visible, true, 'the first offshore vessel appears on arrival');
  assert.ok(Math.exp(-Math.pow(southPierDistance * scene.fog.density, 2)) > 0.5,
    'the supply coaster remains distinguishable through the desktop fog');
  const first = offshoreRoutePose(OFFSHORE_ROUTES[0], 24);
  const later = offshoreRoutePose(OFFSHORE_ROUTES[0], 54);
  assert.ok(first.visible && later.visible && later.x > first.x);
  assert.equal(offshoreRoutePose(OFFSHORE_ROUTES[0], 170).visible, false);
  const initial = seaLife.update(24, 'mist');
  assert.ok(initial.vesselsVisible >= 1 && initial.vesselsVisible <= 3);
  assert.ok(initial.swellSetsVisible <= 3);
  assert.ok(seaLife.ships.every((ship) => Number.isFinite(ship.group.position.y)));
  for (const ship of seaLife.ships.filter((item) => item.group.visible)) {
    assert.ok(ship.materials.at(-1).opacity <= 0.22, 'wake must stay translucent');
  }
  seaLife.update(54, 'storm');
  assert.ok(seaLife.swells.every((swell) => swell.uniforms.uWind.value === 1));
  assert.ok(seaLife.ships.every((ship) => ship.group.children.length <= 12));
  const arrivalSwells = seaLife.update(0, 'mist');
  assert.ok(arrivalSwells.swellSetsVisible >= 1);
  const southSwell = seaLife.swells[1];
  assert.ok(southSwell.uniforms.uOpacity.value > 0.3,
    'an arriving player can see one restrained breaker in the mist');
  const firstCrestZ = southSwell.mesh.position.z;
  seaLife.update(8, 'mist');
  assert.ok(southSwell.mesh.position.z < firstCrestZ,
    'the south bank rolls toward shore while it is visible');
  seaLife.dispose();
  assert.equal(scene.children.length, 0);
});
