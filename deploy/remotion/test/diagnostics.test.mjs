import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiagnostics } from '../src/diagnostics.mjs';

test('ring buffer keeps the last 500 entries with increasing ids', () => {
  const diag = createDiagnostics({ print: false });
  for (let i = 0; i < 520; i += 1) {
    diag.info('e', { i });
  }
  const all = diag.getLogs({ limit: 1000 });
  assert.equal(all.length, 500);
  assert.equal(all[0].id, 21);
  assert.equal(all.at(-1).id, 520);
  assert.equal(diag.lastId(), 520);
});

test('level filter, limit and after-id', () => {
  const diag = createDiagnostics({ print: false });
  diag.debug('a');
  diag.info('b');
  diag.warn('c');
  diag.error('d');
  assert.deepEqual(
    diag.getLogs({ minLevel: 'warn' }).map((e) => e.event),
    ['c', 'd'],
  );
  assert.deepEqual(
    diag.getLogs({ afterId: 2 }).map((e) => e.event),
    ['c', 'd'],
  );
  assert.deepEqual(
    diag.getLogs({ limit: 1 }).map((e) => e.event),
    ['d'],
  );
});

test('entries never carry base64, tokens or scene text; long strings are cut', () => {
  const diag = createDiagnostics({ print: false });
  const blob = 'QUJD'.repeat(500);
  diag.info('x', {
    audioBase64: blob,
    note: `data ${blob} end`,
    auth: 'Bearer abcDEF123456.secret',
    token: 'zzz',
    heading: 'h'.repeat(1000),
  });
  const entry = diag.getLogs()[0];
  const text = JSON.stringify(entry);
  assert.ok(!text.includes('QUJDQUJD'));
  assert.ok(!text.includes('abcDEF123456'));
  assert.ok(!text.includes('zzz'));
  assert.ok(entry.data.heading.length < 330);
  assert.ok(entry.data.note.includes('[blob]'));
});

test('job summaries and counters', () => {
  const diag = createDiagnostics({ print: false });
  for (let i = 0; i < 20; i += 1) {
    diag.recordJob({ jobId: `j${i}`, ok: i % 2 === 0, stage: 'render', error: 'render_failed', message: 'boom' });
  }
  assert.equal(diag.lastJobs().length, 15);
  assert.equal(diag.lastJobs()[0].jobId, 'j19');
  assert.equal(diag.counters().rendersOk, 10);
  assert.equal(diag.counters().rendersFailed, 10);
  assert.equal(diag.counters().lastError.message, 'boom');
});
