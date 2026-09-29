import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createTreeVisibilityFilter, makeTreePrototype, syncTreeLodMeshes, treeDetailForRoot,
} from '../src/vegetation.js';
import { Tree } from '../src/ezTreeGeometry/tree.js';

test('far tree batches omit off-camera roots and refresh immediately on a camera turn', () => {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 1000);
  camera.position.set(0, 34, 0);
  const filter = createTreeVisibilityFilter();
  const root = (x, z) => ({ x, y: 25, z, size: 1.31 });

  assert.equal(filter.refresh(camera), true);
  assert.equal(treeDetailForRoot(root(0, -80), 0, 0, filter), 'near');
  assert.equal(treeDetailForRoot(root(0, 80), 0, 0, filter), 'near',
    'near shadow casters keep the original distance-only placement');
  assert.equal(treeDetailForRoot(root(0, 20), 0, 0, filter), 'near');
  assert.equal(treeDetailForRoot(root(0, -180), 0, 0, filter), 'far');
  assert.equal(treeDetailForRoot(root(0, 180), 0, 0, filter), null);
  assert.equal(filter.refresh(camera), false, 'unchanged camera avoids repacking tree batches');

  camera.rotation.y = Math.PI;
  assert.equal(filter.refresh(camera), true,
    'turning in place must refresh instances even without walking 2.5 m');
  assert.equal(treeDetailForRoot(root(0, 180), 0, 0, filter), 'far');
  assert.equal(treeDetailForRoot(root(0, -180), 0, 0, filter), null);
  camera.position.y += 4;
  assert.equal(filter.refresh(camera), true, 'falling or climbing also refreshes view culling');
});

test('far view spheres cover every authored crown vertex', () => {
  // The landmark is 1.56x; both geometry and filter radii scale equally.
  // Near trees and their directional shadows are deliberately not culled.
  const farRadius = 14.5;
  for (let variant = 0; variant < 12; variant++) {
    const prototype = makeTreePrototype(Tree, variant, false);
    for (const geometry of [prototype.branches, prototype.leaves]) {
      const positions = geometry.getAttribute('position');
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = positions.getX(vertex);
        const y = positions.getY(vertex);
        const z = positions.getZ(vertex);
        assert.ok(Math.hypot(x, y - 6, z) < farRadius,
          `variant ${variant} crown exceeds its view sphere`);
      }
      geometry.dispose();
    }
  }
});

test('unchanged tree membership preserves exact instance data without another GPU upload', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const meshes = [0, 1].map(() => new THREE.InstancedMesh(geometry, material, 3));
  for (const mesh of meshes) mesh.count = 0;
  const roots = [0, 1, 2].map((index) => ({
    matrix: new THREE.Matrix4().makeTranslation(index * 7, index, -index),
    tint: new THREE.Color().setRGB(0.6 + index * 0.1, 0.7, 0.8),
  }));
  const previous = [];
  const boundingCalls = [0, 0];
  meshes.forEach((mesh, index) => {
    const original = mesh.computeBoundingSphere.bind(mesh);
    mesh.computeBoundingSphere = () => {
      boundingCalls[index]++;
      original();
    };
  });

  assert.equal(syncTreeLodMeshes(meshes, [roots[0], roots[2]], previous), true);
  assert.equal(meshes[0].count, 2);
  assert.equal(meshes[1].count, 2);
  const matrix = new THREE.Matrix4();
  const tint = new THREE.Color();
  for (let index = 0; index < 2; index++) {
    for (const mesh of meshes) {
      mesh.getMatrixAt(index, matrix);
      assert.deepEqual(matrix.elements, roots[index * 2].matrix.elements);
    }
    meshes[1].getColorAt(index, tint);
    assert.equal(tint.getHex(), roots[index * 2].tint.getHex());
  }

  const uploadVersions = meshes.map((mesh) => mesh.instanceMatrix.version);
  const colorVersion = meshes[1].instanceColor.version;
  const bytesAvoided = meshes.reduce((bytes, mesh) => bytes + mesh.instanceMatrix.array.byteLength,
    meshes[1].instanceColor.array.byteLength);
  assert.equal(bytesAvoided, 420, 'a stable three-root batch skips two matrices and one color buffer');
  assert.equal(syncTreeLodMeshes(meshes, [roots[0], roots[2]], previous), false);
  assert.deepEqual(meshes.map((mesh) => mesh.instanceMatrix.version), uploadVersions);
  assert.equal(meshes[1].instanceColor.version, colorVersion);
  assert.deepEqual(boundingCalls, [1, 1]);

  assert.equal(syncTreeLodMeshes(meshes, [roots[2], roots[1]], previous), true);
  meshes[0].getMatrixAt(0, matrix);
  assert.deepEqual(matrix.elements, roots[2].matrix.elements);
  meshes[1].getColorAt(1, tint);
  assert.equal(tint.getHex(), roots[1].tint.getHex());
  assert.ok(meshes[0].instanceMatrix.version > uploadVersions[0]);
  assert.deepEqual(boundingCalls, [2, 2]);

  assert.equal(syncTreeLodMeshes(meshes, [], previous), true);
  assert.equal(meshes[0].count, 0);
  assert.equal(meshes[1].count, 0);
  assert.deepEqual(boundingCalls, [2, 2], 'empty batches need no bounds rebuild');
  geometry.dispose();
  material.dispose();
});
