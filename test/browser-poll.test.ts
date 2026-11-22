// The tablet's job queue: a poll whose caller has gone must not take a job. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finishJob, nextJob, sendJob } from '../src/apps/claude/server/browser.ts';

test('an aborted poll ends with no job and leaves the queue', async () => {
  const ac = new AbortController();
  const poll = nextJob(ac.signal);
  ac.abort();
  assert.equal(await poll, null);
});

test('a job sent after an aborted poll waits for the next live poll', async () => {
  const gone = new AbortController();
  const dead = nextJob(gone.signal);
  gone.abort();
  assert.equal(await dead, null);

  const answer = sendJob({ op: 'read' });
  const job = await nextJob();   // the live poll gets the job, not the aborted one
  assert.ok(job, 'the live poll should receive the job');
  assert.equal(job.op, 'read');
  finishJob(job.id, true, 'page text');
  assert.deepEqual(await answer, { ok: true, data: 'page text' });
});

test('a poll given an already aborted signal returns at once', async () => {
  const ac = new AbortController();
  ac.abort();
  assert.equal(await nextJob(ac.signal), null);
});
