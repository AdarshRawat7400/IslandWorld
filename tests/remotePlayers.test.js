import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { REMOTE_PLAYER_POSES, createRemotePlayers } from '../src/remotePlayers.js';
import { PLAYER_STANCES } from '../src/playerStance.js';

// The avatar model uses a ground origin and the display pivot sits at 0.92 m.
function pointAtHeight(height, pose) {
  const fromPivot = (height - REMOTE_PLAYER_POSES.stand.pivotY) * pose.scaleY;
  return {
    y: pose.pivotY + fromPivot * Math.cos(pose.lean),
    z: fromPivot * Math.sin(pose.lean),
  };
}

function fallbackHeadTop(pose) {
  const radius = 0.23;
  const verticalRadius = radius * Math.hypot(
    pose.scaleY * Math.cos(pose.lean), Math.sin(pose.lean));
  return pointAtHeight(1.72, pose).y + verticalRadius;
}

test('remote prone avatar lies low and forward within a compact hit silhouette', () => {
  const pose = REMOTE_PLAYER_POSES.prone;
  const head = pointAtHeight(1.72, pose);
  const feet = pointAtHeight(0.05, pose);
  assert.ok(head.z > 0 && feet.z < 0, 'body extends along the facing direction');
  assert.ok(head.z - feet.z > 1.2, 'avatar reads as lying down rather than squatting');
  assert.ok(head.z - feet.z < 1.5, 'visible body stays near the prone hit radius');
  assert.ok(feet.y > 0.1, 'feet have ground clearance');
  assert.ok(head.y < 0.5, 'head stays close to the prone camera height');
  assert.ok(fallbackHeadTop(pose) < PLAYER_STANCES.prone.hitHeight + 0.05,
    'visible head stays close to the server hitbox top');
});

test('crouch posture is distinct from standing and prone', () => {
  const standHead = pointAtHeight(1.72, REMOTE_PLAYER_POSES.stand);
  const crouchHead = pointAtHeight(1.72, REMOTE_PLAYER_POSES.crouch);
  const proneHead = pointAtHeight(1.72, REMOTE_PLAYER_POSES.prone);
  const crouchFeet = pointAtHeight(0.05, REMOTE_PLAYER_POSES.crouch);
  assert.ok(standHead.y > crouchHead.y && crouchHead.y > proneHead.y);
  assert.ok(crouchFeet.y > 0 && crouchFeet.y < 0.2, 'crouch keeps feet grounded');
  assert.ok(REMOTE_PLAYER_POSES.crouch.lean < REMOTE_PLAYER_POSES.prone.lean);
  assert.ok(fallbackHeadTop(REMOTE_PLAYER_POSES.crouch)
    < PLAYER_STANCES.crouch.hitHeight + 0.05,
  'visible crouch head stays close to the server hitbox top');
});

function createTestRemotePlayers() {
  const scene = new THREE.Scene();
  let removedLabels = 0;
  const remote = createRemotePlayers(scene, { groundHeight: () => 12,
    loadModels: false, createNameplate: () => {
      const label = new THREE.Group();
      label.userData.dispose = () => { removedLabels++; };
      return label;
    } });
  const player = { id: 'remote', name: 'Walker', x: 10, z: 12, yaw: 0,
    pitch: 0, y: 13.88, health: 100, dead: false, connected: true,
    mode: 'walk', stance: 'stand' };
  const ingest = (overrides, at) => remote.ingest({ players: [{ ...player, ...overrides }] }, 'self', at);
  return { remote, scene, player, ingest, removedLabels: () => removedLabels };
}

function remoteHeadPosition(remote) {
  remote.group.updateMatrixWorld(true);
  let head;
  remote.group.traverse((object) => {
    if (object.userData.reactionPart === 'head') head = object;
  });
  return head.getWorldPosition(new THREE.Vector3());
}

test('remote death visibly falls, remains as a grounded corpse, and does not drift on dead snapshots', () => {
  const { remote, ingest } = createTestRemotePlayers();
  ingest({}, 0);
  remote.update(0, 0.05);
  const root = remote.group.children[0];
  const standing = remoteHeadPosition(remote);
  remote.showCombatHit('remote', { direction: { x: 1, z: 0 }, damage: 100 });
  ingest({ dead: true, health: 0, x: 11 }, 50);
  remote.update(50, 0.05);
  assert.equal(root.visible, true, 'authoritative death must not hide the avatar');
  assert.equal(root.children[1].visible, false, 'name label disappears on death');
  assert.ok(remoteHeadPosition(remote).y > standing.y - 0.3,
    'the first frame retains the upright stagger');
  for (let i = 0; i < 11; i++) remote.update(100 + i * 50, 0.05);
  const midFall = remoteHeadPosition(remote);
  assert.ok(midFall.y < standing.y - 0.25 && midFall.y > 12.5,
    'the middle frame is between standing and the settled corpse');
  ingest({ dead: true, health: 0, x: 60, z: 90, yaw: 2 }, 650);
  for (let i = 0; i < 18; i++) remote.update(700 + i * 50, 0.05);
  const settled = remoteHeadPosition(remote);
  assert.equal(root.position.x, 11);
  assert.equal(root.position.z, 12);
  assert.equal(root.rotation.y, Math.PI);
  assert.ok(settled.y > 12.15 && settled.y < 12.6, 'corpse head rests above the ground');
  assert.equal(root.visible, true);
  const rotation = root.children[0].quaternion.clone();
  remote.showCombatHit('remote', { direction: { x: -1, z: 0 }, damage: 50 });
  remote.update(1800, 0.1);
  assert.ok(rotation.angleTo(root.children[0].quaternion) < 0.00001,
    'late hits cannot restart a settled death');
  remote.dispose();
});

test('remote damage flinches, expires, and respawn clears the corpse pose and label state', () => {
  const { remote, ingest, scene, removedLabels } = createTestRemotePlayers();
  ingest({}, 0);
  remote.update(0, 0.05);
  const figure = remote.group.children[0].children[0];
  ingest({ health: 70 }, 50);
  remote.update(50, 0.1);
  assert.ok(figure.quaternion.angleTo(new THREE.Quaternion()) > 0.025);
  for (let i = 0; i < 6; i++) remote.update(150 + i * 100, 0.1);
  assert.ok(figure.quaternion.angleTo(new THREE.Quaternion()) < 0.00001);
  ingest({ dead: true, health: 0 }, 800);
  for (let i = 0; i < 16; i++) remote.update(800 + i * 100, 0.1);
  assert.ok(remoteHeadPosition(remote).y < 12.6);
  ingest({ dead: false, health: 100, x: 40, z: 42, name: 'Returned' }, 2500);
  remote.update(2500, 0.05);
  assert.equal(remote.group.children[0].children[1].visible, true);
  assert.ok(remoteHeadPosition(remote).y > 13.5, 'respawn returns to standing immediately');
  assert.deepEqual(remote.getCombatPosition('remote'), { x: 40, y: 13.2, z: 42 });
  remote.ingest({ players: [] }, 'self', 2600);
  assert.equal(remote.count, 0);
  assert.equal(remote.group.children.length, 0);
  assert.equal(removedLabels(), 2, 'renamed and removed nameplates are disposed');
  remote.dispose();
  assert.equal(scene.children.length, 0);
});

test('prone remote death stays near the ground without flipping its initial posture', () => {
  const { remote, ingest } = createTestRemotePlayers();
  ingest({ stance: 'prone' }, 0);
  for (let i = 0; i < 15; i++) remote.update(i * 50, 0.05);
  const before = remoteHeadPosition(remote);
  ingest({ stance: 'prone', dead: true, health: 0 }, 800);
  remote.update(800, 0.05);
  const early = remoteHeadPosition(remote);
  assert.ok(early.distanceTo(before) < 0.15, 'prone death begins from the existing posture');
  for (let i = 0; i < 30; i++) remote.update(850 + i * 50, 0.05);
  const settled = remoteHeadPosition(remote);
  assert.ok(settled.y > 12.1 && settled.y < 12.6);
  remote.dispose();
});

test('joining after a remote death uses authoritative death age instead of replaying an old fall', () => {
  const { remote, player } = createTestRemotePlayers();
  remote.ingest({ serverNow: 5000, players: [{ ...player,
    dead: true, health: 0, deadAt: 3000, stance: 'crouch' }] }, 'self', 0);
  remote.update(0, 0.05);
  assert.equal(remote.group.children[0].visible, true);
  assert.ok(remoteHeadPosition(remote).y < 12.6, 'older authoritative corpse is already settled');
  remote.dispose();
});
