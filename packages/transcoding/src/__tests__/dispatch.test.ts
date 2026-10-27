import { describe, expect, it } from 'vitest';
import {
  classifyRunPodAnswer,
  classifyWebhookPayload,
  jobFailureFromWebhook,
  transcodingJobPolicy,
} from '../dispatch';

const MEDIA_ID = '550e8400-e29b-41d4-a716-446655440000';
const MINUTE = 60 * 1000;

describe('classifyRunPodAnswer', () => {
  it('accepts a 2xx carrying a job id', () => {
    expect(
      classifyRunPodAnswer(
        200,
        JSON.stringify({ id: 'job-1', status: 'IN_QUEUE' })
      )
    ).toEqual({ kind: 'accepted', jobId: 'job-1' });
  });

  it.each([
    ['no id', JSON.stringify({ status: 'IN_QUEUE' })],
    ['an empty id', JSON.stringify({ id: '' })],
    ['a body that is not JSON', '<html>ok</html>'],
  ])('calls a 2xx with %s ambiguous: a job may exist', (_case, body) => {
    expect(classifyRunPodAnswer(200, body).kind).toBe('ambiguous');
  });

  it.each([
    [409, { code: 'ENDPOINT_PAUSED' }, 'TRANSCODER_PAUSED'],
    [409, { code: 'SOMETHING_ELSE' }, 'TRANSCODER_UNAVAILABLE'],
    [429, {}, 'TRANSCODER_BUSY'],
    [400, {}, 'TRANSCODER_MISCONFIGURED'],
    [401, {}, 'TRANSCODER_MISCONFIGURED'],
    [403, {}, 'TRANSCODER_MISCONFIGURED'],
    [404, {}, 'TRANSCODER_MISCONFIGURED'],
    [422, {}, 'TRANSCODER_MISCONFIGURED'],
    [500, {}, 'TRANSCODER_UNAVAILABLE'],
    [503, {}, 'TRANSCODER_UNAVAILABLE'],
    // Cloudflare never reached RunPod: nothing was queued.
    [521, {}, 'TRANSCODER_UNAVAILABLE'],
    [522, {}, 'TRANSCODER_UNAVAILABLE'],
    [523, {}, 'TRANSCODER_UNAVAILABLE'],
  ])('maps %i %j to %s', (status, body, code) => {
    expect(classifyRunPodAnswer(status, JSON.stringify(body))).toMatchObject({
      kind: 'rejected',
      code,
    });
  });

  it.each([
    502, 504, 520, 524,
  ])('calls a gateway %i ambiguous: RunPod may have queued the job', (status) => {
    expect(classifyRunPodAnswer(status, '')).toEqual({
      kind: 'ambiguous',
      detail: `RunPod answered ${status}`,
    });
  });

  it('keeps the detail to the status and RunPod code: the creator sees it', () => {
    const outcome = classifyRunPodAnswer(
      409,
      JSON.stringify({
        code: 'ENDPOINT_PAUSED',
        message: 'internal host 10.0.0.4',
      })
    );

    expect(outcome).toMatchObject({
      detail: 'RunPod answered 409 (ENDPOINT_PAUSED)',
    });
  });

  it('ignores a "code" that is not a short machine token', () => {
    const outcome = classifyRunPodAnswer(
      500,
      JSON.stringify({ code: 'see https://example.com for details' })
    );

    expect(outcome).toMatchObject({ detail: 'RunPod answered 500' });
  });
});

describe('transcodingJobPolicy', () => {
  it('gives an unknown length 2 h (owner decision)', () => {
    expect(transcodingJobPolicy(null).executionTimeout).toBe(120 * MINUTE);
    expect(transcodingJobPolicy(0).executionTimeout).toBe(120 * MINUTE);
  });

  it('scales with length: 15 min + 5x the video', () => {
    // 646 s: the 2026-10-23 QuickTime upload.
    expect(transcodingJobPolicy(646).executionTimeout).toBe(
      15 * MINUTE + 5 * 646 * 1000
    );
  });

  it('never goes below 30 min or above 6 h', () => {
    expect(transcodingJobPolicy(5).executionTimeout).toBe(30 * MINUTE);
    expect(transcodingJobPolicy(10 * 60 * 60).executionTimeout).toBe(
      6 * 60 * MINUTE
    );
  });

  it('lets a queued job wait an hour beyond its run time', () => {
    const policy = transcodingJobPolicy(646);
    expect(policy.ttl - policy.executionTimeout).toBe(60 * MINUTE);
  });
});

describe('jobFailureFromWebhook', () => {
  it('records a job-side code as sent', () => {
    expect(
      jobFailureFromWebhook('CORRUPT_INPUT', 'moov atom not found')
    ).toEqual({ code: 'CORRUPT_INPUT', detail: 'moov atom not found' });
  });

  it('refuses a code only our side may set, and reports it: a job cannot claim the transcoder is paused', () => {
    expect(jobFailureFromWebhook('TRANSCODER_PAUSED', 'x')).toMatchObject({
      code: 'INFRA_ERROR',
      unrecognisedCode: 'TRANSCODER_PAUSED',
    });
  });

  it('reports a code that is not a string', () => {
    expect(jobFailureFromWebhook(42, 'x')).toMatchObject({
      code: 'INFRA_ERROR',
      unrecognisedCode: '42',
    });
  });

  it('keeps an unrecognised code visible and reports it', () => {
    const failure = jobFailureFromWebhook('GPU_ON_FIRE', 'boom');

    expect(failure).toEqual({
      code: 'INFRA_ERROR',
      detail: '[raw:GPU_ON_FIRE] boom',
      unrecognisedCode: 'GPU_ON_FIRE',
    });
  });

  it('treats a missing code (an older handler) as INFRA_ERROR, unreported', () => {
    expect(jobFailureFromWebhook(undefined, undefined)).toEqual({
      code: 'INFRA_ERROR',
      detail: 'Unknown transcoding error',
    });
  });

  it('leaves the cut to the write, so a long message keeps its raw code', () => {
    const { detail } = jobFailureFromWebhook('NOT_A_CODE', 'x'.repeat(5000));

    expect(detail.startsWith('[raw:NOT_A_CODE] xxx')).toBe(true);
    expect(detail).toHaveLength('[raw:NOT_A_CODE] '.length + 5000);
  });
});

describe('classifyWebhookPayload', () => {
  it('passes a valid failure webhook through', () => {
    const result = classifyWebhookPayload({
      jobId: 'job-1',
      status: 'failed',
      mediaId: MEDIA_ID,
      error: 'bad',
    });

    expect(result.kind).toBe('valid');
  });

  it('marks a completion it cannot parse as rejected-terminal, with the raw ids', () => {
    const result = classifyWebhookPayload({
      jobId: 'job-1',
      status: 'completed',
      output: { mediaId: MEDIA_ID, readyVariants: 'not-an-array' },
    });

    expect(result).toMatchObject({
      kind: 'rejected-terminal',
      jobId: 'job-1',
      mediaId: MEDIA_ID,
    });
  });

  it('drops a media id that is not a uuid rather than trusting it', () => {
    const result = classifyWebhookPayload({
      status: 'failed',
      jobId: 7,
      mediaId: "1' OR '1'='1",
    });

    expect(result).toMatchObject({
      kind: 'rejected-terminal',
      jobId: null,
      mediaId: null,
    });
  });

  it('marks an unreadable progress update rejected-progress', () => {
    expect(
      classifyWebhookPayload({
        jobId: 'job-1',
        status: 'progress',
        progress: 500,
      }).kind
    ).toBe('rejected-progress');
  });

  it.each([
    ['null', null],
    ['a string', 'hello'],
    ['an unknown status', { jobId: 'job-1', status: 'exploded' }],
  ])('calls %s unreadable', (_case, raw) => {
    expect(classifyWebhookPayload(raw).kind).toBe('unreadable');
  });
});
