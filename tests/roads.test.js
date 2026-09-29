import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld } from '../src/world.js';
import { SITES } from '../src/worldSites.js';
import { buildingWallBlocks, circlesBlock, isInsideBuilding } from '../src/collision.js';
import { ROAD_ROUTES, createRoads, nearestRoad, isRoad } from '../src/roads.js';
import { createSetDressing } from '../src/setDressing.js';
import { createDriving } from '../src/driving.js';

test('the service network reaches the three parked vehicles and key destinations', () => {
  for (const [name, x, z] of [
    ['service wagon', -97, 156], ['staff car', -34, 117], ['transport', -22, 78],
    ['prison gate', -58, 105], ['lodge pull-in', -105, 188],
    ['archive pull-in', -169, 75], ['tower lay-by', 30, -207],
    ['radio pull-in', 166, -47], ['pump pull-in', 143, 135],
  ]) assert.ok(isRoad(x, z), `${name} is not connected to a road`);
  assert.ok(!isRoad(0, 270), 'the steep boat landing remains a footpath');
  assert.ok(!isRoad(-65, -315), 'the north inlet jetty remains a footpath');
  const nearest = nearestRoad(-34, 117);
  assert.equal(nearest.routeId, 'staff-apron');
  assert.ok(nearest.distance < 0.01);
  assert.ok(nearest.width >= 5.5);
});

test('the keeper’s wagon pull-in leaves the through road clear and lets the wagon drive out', () => {
  const scene = new THREE.Scene();
  const world = createWorld(scene, new THREE.Camera());
  const dressing = createSetDressing(scene, world.terrainHeight);
  const wagon = dressing.vehicles.find((vehicle) => vehicle.id === 'service_wagon');
  assert.ok(wagon);
  assert.deepEqual([wagon.x, wagon.z], [-97, 156]);
  assert.ok(isRoad(wagon.x, wagon.z), 'the parked wagon sits on a surfaced pull-in');
  for (let x = -109; x <= -102; x += 0.5) {
    assert.equal(dressing.collides(x, 156, 1.25), false,
      `the main road is obstructed by the parked wagon at x=${x}`);
  }
  const drive = createDriving(dressing.vehicles, world.terrainHeight, { onRoad: isRoad });
  const canPlace = (x, z, vehicle, radius) => world.isWalkable(x, z)
    && !SITES.some((site) => buildingWallBlocks(site, x, z, radius))
    && !circlesBlock(x, z, radius, world.natureObstacles)
    && !dressing.collides(x, z, radius, vehicle.id);
  assert.equal(drive.enter(wagon.id), true);
  for (let frame = 0; frame < 180; frame++) {
    drive.update(1 / 60, { throttle: 1 }, canPlace);
  }
  assert.ok(wagon.x < -105, `wagon cannot reach through road: x=${wagon.x.toFixed(2)}`);
  assert.ok(wagon.speed > 1, 'wagon has propulsion when it reaches the main road');
});

test('roads stay on traversable high ground and skirt building envelopes', () => {
  const world = createWorld(new THREE.Scene(), new THREE.Camera());
  const buildings = SITES.filter(site => site.kind === 'building');
  for (const route of ROAD_ROUTES) {
    for (let edge = 1; edge < route.points.length; edge++) {
      const [ax, az] = route.points[edge - 1];
      const [bx, bz] = route.points[edge];
      const subdivisions = Math.ceil(Math.hypot(bx - ax, bz - az) / 5);
      for (let i = 0; i <= subdivisions; i++) {
        const t = i / subdivisions;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        assert.ok(world.isWalkable(x, z), `${route.id} leaves island at ${x}, ${z}`);
        assert.ok(world.terrainHeight(x, z) > 8, `${route.id} falls to coastal surf`);
        for (const building of buildings) {
          assert.equal(isInsideBuilding(building, x, z, -1.5), false,
            `${route.id} passes through ${building.name}`);
        }
      }
    }
  }
});

test('each road centreline remains within vintage car body-grade limits', () => {
  const world = createWorld(new THREE.Scene(), new THREE.Camera());
  for (const route of ROAD_ROUTES) {
    const curve = new THREE.CatmullRomCurve3(route.points.map(([x, z]) =>
      new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const samples = Math.ceil(curve.getLength() / 2);
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      const lateral = { x: tangent.z, z: -tangent.x };
      const height = (forward, side) => world.terrainHeight(
        point.x + tangent.x * forward + lateral.x * side,
        point.z + tangent.z * forward + lateral.z * side,
      );
      for (const [length, width] of [[5.15, 2.18], [6.45, 2.52]]) {
        const fore = length * 0.34, halfWidth = width * 0.34;
        const along = Math.abs(height(fore, 0) - height(-fore, 0)) / (fore * 2);
        const across = Math.abs(height(0, halfWidth) - height(0, -halfWidth)) /
          (halfWidth * 2);
        assert.ok(along <= 0.38, `${route.id} has ${along.toFixed(3)} length grade`);
        assert.ok(across <= 0.42, `${route.id} has ${across.toFixed(3)} cross grade`);
      }
    }
  }
});

test('spatial-grid road queries agree with exact nearest-route distances', () => {
  for (let x = -280; x <= 280; x += 13) for (let z = -260; z <= 260; z += 17) {
    const nearest = nearestRoad(x, z);
    for (const margin of [0, 2.5]) {
      assert.equal(isRoad(x, z, margin),
        nearest.distance <= nearest.width * 0.5 + margin,
        `grid missed road near ${x}, ${z}`);
    }
  }
});

test('the gravel and water are batched into finite, modest desktop geometry', () => {
  const scene = new THREE.Scene();
  const roads = createRoads(scene, (x, z) => 38 + Math.sin(x * 0.01) + Math.cos(z * 0.01));
  assert.ok(scene.children.includes(roads.group));
  assert.equal(roads.group.children.length, 2);
  assert.ok(roads.length > 1300 && roads.length < 1800);
  assert.ok(roads.puddleCount > 10 && roads.puddleCount < 100);
  let triangles = 0;
  for (const mesh of roads.group.children) {
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      assert.ok(Number.isFinite(position.getX(i)) && Number.isFinite(position.getY(i))
        && Number.isFinite(position.getZ(i)), `${mesh.name} has a non-finite vertex`);
    }
    triangles += mesh.geometry.index.count / 3;
  }
  assert.ok(triangles < 25_000, `road geometry is too dense: ${triangles} triangles`);
  assert.ok(roads.isRoadCorridor(-105, 156));
  assert.ok(!roads.isRoadCorridor(300, 300));
});
