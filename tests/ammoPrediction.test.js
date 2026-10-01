import test from 'node:test';
import assert from 'node:assert/strict';
import { createAmmoPrediction } from '../src/ammoPrediction.js';

const state = (magazine, revision = 0, lastShotId = 0, extra = {}) => ({ magazine,
  reserve: 150, reloadingUntil: 0, revision, lastShotId, ...extra });

test('several automatic shots predict immediately without mutating server snapshots', () => {
  const ammo = { smg: state(30) };
  const prediction = createAmmoPrediction();
  prediction.reset(ammo);
  assert.deepEqual([prediction.reserve('smg'), prediction.reserve('smg'),
    prediction.reserve('smg')], [1, 2, 3]);
  assert.equal(prediction.snapshot().smg.magazine, 27);
  assert.equal(prediction.pendingCount, 3);
  assert.equal(ammo.smg.magazine, 30);
  const displayed = prediction.snapshot();
  displayed.smg.magazine = 999;
  assert.equal(prediction.snapshot().smg.magazine, 27,
    'a HUD consumer cannot change authoritative or predicted ammo');
});

test('reversed ACKs and older snapshots cannot roll ammunition backwards', () => {
  const prediction = createAmmoPrediction();
  prediction.reset({ smg: state(30) });
  const shots = Array.from({ length: 4 }, () => prediction.reserve('smg'));
  prediction.acknowledge('smg', shots[2], state(27, 3, shots[2]));
  assert.equal(prediction.pendingCount, 1);
  assert.equal(prediction.snapshot().smg.magazine, 26,
    'the fourth shot stays debited when the first three are confirmed');
  assert.equal(prediction.acknowledge('smg', shots[0], state(29, 1, shots[0])), false);
  assert.equal(prediction.ingest({ smg: state(28, 2, shots[1]) }), false);
  assert.equal(prediction.snapshot().smg.magazine, 26);
  prediction.ingest({ smg: state(26, 4, shots[3]) });
  assert.equal(prediction.pendingCount, 0);
  assert.equal(prediction.snapshot().smg.magazine, 26);
  assert.equal(prediction.acknowledge('smg', shots[3], state(26, 4, shots[3])), true,
    'the matching ACK after its snapshot is harmless');
});

test('the in-flight cap is shared across weapon switches and ammo never overdraws', () => {
  const prediction = createAmmoPrediction();
  prediction.reset({ smg: state(30), lmg: state(60), revolver: state(2) });
  const first = prediction.reserve('revolver');
  const second = prediction.reserve('revolver');
  assert.equal(prediction.reserve('revolver'), null);
  for (let round = 0; round < 3; round++) {
    assert.ok(prediction.reserve('smg'));
    assert.ok(prediction.reserve('lmg'));
  }
  assert.equal(prediction.pendingCount, 8);
  assert.equal(prediction.reserve('lmg'), null);
  assert.equal(prediction.snapshot().revolver.magazine, 0);
  assert.equal(prediction.reject('smg', first), false, 'wrong weapon cannot release another debit');
  assert.equal(prediction.reject('revolver', first), true);
  assert.equal(prediction.snapshot().revolver.magazine, 1);
  assert.ok(prediction.reserve('lmg'), 'a rejected shot frees one shared queue slot');
  assert.equal(prediction.reject('revolver', second), true);
});

test('a rejected shot restores only its own pending round while accepted shots remain spent', () => {
  const prediction = createAmmoPrediction();
  prediction.reset({ smg: state(3) });
  const first = prediction.reserve('smg'), rejected = prediction.reserve('smg');
  prediction.acknowledge('smg', first, state(2, 1, first));
  assert.equal(prediction.snapshot().smg.magazine, 1);
  assert.equal(prediction.reject('smg', rejected), true);
  assert.equal(prediction.snapshot().smg.magazine, 2);
  assert.equal(prediction.reject('smg', first), false);
  assert.equal(prediction.snapshot().smg.magazine, 2);
  const replacement = prediction.reserve('smg');
  assert.ok(replacement > rejected, 'rejected IDs are not reused');
});

test('reload snapshots preserve queued debits until confirmation or rejection arrives', () => {
  const prediction = createAmmoPrediction();
  prediction.reset({ smg: state(30) });
  const accepted = prediction.reserve('smg'), queued = prediction.reserve('smg');
  prediction.ingest({ smg: state(29, 2, accepted, { reloadingUntil: 5000 }) });
  assert.equal(prediction.snapshot().smg.magazine, 28);
  assert.equal(prediction.pendingCount, 1);
  assert.equal(prediction.reserve('smg'), null, 'an authoritative reload blocks new reservations');
  prediction.ingest({ smg: state(30, 3, accepted, { reserve: 149 }) });
  assert.equal(prediction.snapshot().smg.magazine, 29,
    'refilling a magazine does not forget an unconfirmed shot');
  prediction.reject('smg', queued);
  assert.equal(prediction.snapshot().smg.magazine, 30);
  assert.equal(prediction.snapshot().smg.reserve, 149);
  assert.ok(prediction.reserve('smg'));
});

test('resuming a room advances IDs past accepted shots and reset clears pending state', () => {
  const prediction = createAmmoPrediction();
  prediction.reset({ smg: state(30, 19, 120), lmg: state(60, 8, 180) });
  assert.equal(prediction.reserve('smg'), 181);
  assert.equal(prediction.reserve('lmg'), 182);
  prediction.reset({ revolver: state(6) });
  assert.equal(prediction.pendingCount, 0);
  assert.deepEqual(Object.keys(prediction.snapshot()), ['revolver']);
  assert.equal(prediction.reserve('smg'), null, 'old player equipment is discarded');
  assert.equal(prediction.reserve('revolver'), 183, 'a respawn does not reuse stale callback IDs');
});

test('invalid states and mismatched confirmations never release pending ammo', () => {
  const prediction = createAmmoPrediction();
  prediction.reset({ smg: state(2), lmg: state(60) });
  const shot = prediction.reserve('smg');
  assert.equal(prediction.acknowledge('lmg', shot, state(59, 1, shot)), false);
  assert.equal(prediction.acknowledge('smg', shot, state(1, 1, 0)), false);
  for (const invalid of [state(-1), state(1.5), state(1, -1), state(1, 1, -1),
    state(1, 1, 1, { reserve: NaN }), state(1, 1, 1, { reloadingUntil: Infinity })]) {
    assert.equal(prediction.ingest({ smg: invalid }), false);
  }
  assert.equal(prediction.pendingCount, 1);
  assert.equal(prediction.snapshot().smg.magazine, 1);
  assert.equal(prediction.reserve('unknown'), null);
  assert.equal(prediction.ingest(JSON.parse('{"__proto__":{"magazine":30,"reserve":90,"reloadingUntil":0}}')),
    false);
  assert.equal(Object.prototype.magazine, undefined);
});

test('a later server acceptance clears older pending IDs, while legacy snapshots remain usable', () => {
  const prediction = createAmmoPrediction({ maxPending: 2 });
  prediction.reset({ smg: { magazine: 30, reserve: 150, reloadingUntil: 0 } });
  const first = prediction.reserve('smg'), second = prediction.reserve('smg');
  assert.equal(prediction.reserve('smg'), null);
  prediction.ingest({ smg: state(28, 2, second) });
  assert.equal(prediction.pendingCount, 0);
  assert.equal(prediction.reject('smg', first), false);
  assert.equal(prediction.snapshot().smg.magazine, 28);
  assert.equal(prediction.ingest({ smg: state(29, 2, first) }), false,
    'contradictory older acceptance metadata cannot replace the same revision');
  assert.equal(prediction.snapshot().smg.magazine, 28);
});

test('even custom configuration cannot exceed eight pending shots or wrap shot IDs', () => {
  const prediction = createAmmoPrediction({ maxPending: 1000 });
  prediction.reset({ lmg: state(60) });
  for (let round = 0; round < 8; round++) assert.ok(prediction.reserve('lmg'));
  assert.equal(prediction.reserve('lmg'), null);
  prediction.reset({ lmg: state(60, 1, Number.MAX_SAFE_INTEGER) });
  assert.equal(prediction.reserve('lmg'), null, 'unsafe integer IDs are never emitted');
});
