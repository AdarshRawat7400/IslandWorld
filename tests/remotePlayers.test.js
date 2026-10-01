import test from 'node:test';
import assert from 'node:assert/strict';
import { REMOTE_PLAYER_POSES } from '../src/remotePlayers.js';
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
