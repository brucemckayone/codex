import { describe, expect, it } from 'vitest';
import { transcodingJobPolicy } from '../dispatch';
import {
  GIVE_UP_AFTER_MS,
  LOST_JOB_CEILING_MS,
  lostJobAction,
  MIN_RECONCILE_AGE_MS,
  RECONCILE_MARGIN_MS,
  reconcileDueAt,
  waitingAction,
} from '../maintenance-rules';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-24T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR);

describe('reconcileDueAt', () => {
  const updatedAt = hoursAgo(1);

  it('asks about a job with an id once its execution timeout has passed', () => {
    const policy = transcodingJobPolicy(646);
    expect(
      reconcileDueAt({ updatedAt, durationSeconds: 646, runpodJobId: 'job-1' })
    ).toBe(updatedAt.getTime() + policy.executionTimeout + RECONCILE_MARGIN_MS);
  });

  it('never falls due sooner than the prefilter the query uses', () => {
    const shortest = reconcileDueAt({
      updatedAt,
      durationSeconds: 1,
      runpodJobId: 'job-1',
    });
    expect(shortest - updatedAt.getTime()).toBe(MIN_RECONCILE_AGE_MS);
  });

  it('waits out the queue time too when there is no job id to ask about', () => {
    const policy = transcodingJobPolicy(646);
    expect(
      reconcileDueAt({ updatedAt, durationSeconds: 646, runpodJobId: null })
    ).toBe(updatedAt.getTime() + policy.ttl + RECONCILE_MARGIN_MS);
  });
});

describe('lostJobAction', () => {
  it.each([
    'IN_QUEUE',
    'IN_PROGRESS',
  ] as const)('leaves a job RunPod is still on (%s)', (state) => {
    expect(lostJobAction({ ok: true, state }, 0)).toEqual({ kind: 'leave' });
  });

  it('leaves a job RunPod could not answer about: the next run asks again', () => {
    expect(lostJobAction('unanswered', HOUR)).toEqual({ kind: 'leave' });
  });

  it.each([
    ['COMPLETED', 'WEBHOOK_LOST'],
    // RunPod keeps a result 30 min: by the time a row is due, a job whose
    // webhook was lost is usually gone.
    ['GONE', 'WEBHOOK_LOST'],
    ['FAILED', 'INFRA_ERROR'],
    ['CANCELLED', 'TIMED_OUT'],
    ['TIMED_OUT', 'TIMED_OUT'],
  ] as const)('fails a job RunPod reports %s as %s', (state, code) => {
    expect(lostJobAction({ ok: true, state }, 0)).toMatchObject({
      kind: 'fail',
      code,
    });
  });

  it.each([
    ['still running', { ok: true, state: 'IN_PROGRESS' } as const],
    ['never answered about', 'unanswered' as const],
  ])('fails a job %s once the ceiling has passed', (_case, answer) => {
    expect(lostJobAction(answer, LOST_JOB_CEILING_MS)).toMatchObject({
      kind: 'fail',
      code: 'TIMED_OUT',
      ceiling: true,
    });
    expect(lostJobAction(answer, LOST_JOB_CEILING_MS - 1)).toEqual({
      kind: 'leave',
    });
  });

  it('puts a row with no job id back to waiting', () => {
    expect(lostJobAction('no_job', 0)).toMatchObject({ kind: 'wait' });
  });
});

describe('waitingAction', () => {
  const row = {
    transcodingErrorCode: 'TRANSCODER_PAUSED',
    transcodingAttempts: 0,
    uploadedAt: hoursAgo(1),
    createdAt: hoursAgo(2),
  };

  it('retries a waiting row', () => {
    expect(waitingAction(row, NOW)).toEqual({ kind: 'retry' });
  });

  it('gives up at 24 h, keeping the reason it waited', () => {
    expect(
      waitingAction({ ...row, uploadedAt: hoursAgo(24) }, NOW)
    ).toMatchObject({ kind: 'give_up', code: 'TRANSCODER_PAUSED' });
    expect(GIVE_UP_AFTER_MS).toBe(24 * HOUR);
  });

  it('counts from created_at when uploaded_at was never stamped', () => {
    expect(
      waitingAction({ ...row, uploadedAt: null, createdAt: hoursAgo(25) }, NOW)
    ).toMatchObject({ kind: 'give_up' });
  });

  it('gives up with no attempts left', () => {
    expect(
      waitingAction({ ...row, transcodingAttempts: 3 }, NOW)
    ).toMatchObject({
      kind: 'give_up',
      detail: 'No transcoding attempts left',
    });
  });

  it('names a stranded row (no code) as the transcoder unavailable', () => {
    expect(
      waitingAction(
        { ...row, transcodingErrorCode: null, uploadedAt: hoursAgo(30) },
        NOW
      )
    ).toMatchObject({ code: 'TRANSCODER_UNAVAILABLE' });
  });
});
