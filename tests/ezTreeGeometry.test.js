import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTreePrototype } from '../src/vegetation.js';
import { Tree as GeometryTree } from '../src/ezTreeGeometry/tree.js';

// The published package eagerly starts 20 TextureLoader image requests when
// imported. A minimal image stand-in lets us compare its actual geometry
// generator under Node without loading those unused demonstration images.
globalThis.document = {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    set src(_url) {},
  }),
};
const { Tree: PublishedTree } = await import('@dgreenheck/ez-tree');
delete globalThis.document;

function compareGeometry(expected, actual, context) {
  assert.deepEqual(actual.getIndex()?.array, expected.getIndex()?.array,
    `${context} indices`);
  for (const name of Object.keys(expected.attributes)) {
    const original = expected.getAttribute(name);
    const optimized = actual.getAttribute(name);
    assert.ok(optimized, `${context} ${name} exists`);
    assert.equal(optimized.itemSize, original.itemSize, `${context} ${name} item size`);
    assert.deepEqual(optimized.array, original.array, `${context} ${name} values`);
  }
  assert.deepEqual(Object.keys(actual.attributes), Object.keys(expected.attributes),
    `${context} attribute names`);
  assert.deepEqual(actual.boundingSphere?.center.toArray(),
    expected.boundingSphere?.center.toArray(), `${context} bounding center`);
  assert.equal(actual.boundingSphere?.radius, expected.boundingSphere?.radius,
    `${context} bounding radius`);
}

test('the texture-free generator matches every game tree prototype exactly', () => {
  for (let variant = 0; variant < 12; variant++) {
    for (const near of [true, false]) {
      const published = makeTreePrototype(PublishedTree, variant, near);
      const optimized = makeTreePrototype(GeometryTree, variant, near);
      const context = `variant ${variant}, ${near ? 'near' : 'far'}`;
      compareGeometry(published.branches, optimized.branches, `${context} branches`);
      compareGeometry(published.leaves, optimized.leaves, `${context} leaves`);
      published.branches.dispose();
      published.leaves.dispose();
      optimized.branches.dispose();
      optimized.leaves.dispose();
    }
  }
});
