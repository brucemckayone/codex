import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  failureFromStatus,
  jobStateOf,
  RunPodApi,
  workersMaxOf,
} from '../runpod-api';

const later = () => Date.now() + 20_000;

function api(
  overrides: Partial<ConstructorParameters<typeof RunPodApi>[0]> = {}
) {
  return new RunPodApi({ apiKey: 'key', endpointId: 'ep-1', ...overrides });
}

function answers(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })
  );
}

const call = (spy: ReturnType<typeof answers>) => {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('answer readers', () => {
  it.each([
    [401, 'not_permitted'],
    [403, 'not_permitted'],
    [404, 'not_found'],
    [429, 'unavailable'],
    [502, 'unavailable'],
  ])('maps %i to %s', (status, reason) => {
    expect(failureFromStatus(status)).toEqual({ ok: false, reason, status });
  });

  it('reads workers.max from a REST v2 endpoint', () => {
    expect(workersMaxOf(JSON.stringify({ workers: { min: 0, max: 5 } }))).toBe(
      5
    );
    expect(workersMaxOf(JSON.stringify({ workers: { max: 0 } }))).toBe(0);
  });

  it.each([
    ['a v1-shaped body', { workersMax: 5 }],
    ['no workers', {}],
    ['a negative max', { workers: { max: -1 } }],
    ['a fractional max', { workers: { max: 1.5 } }],
  ])('reads nothing from %s', (_case, body) => {
    expect(workersMaxOf(JSON.stringify(body))).toBeUndefined();
  });

  it('reads a job state, never its error text', () => {
    expect(
      jobStateOf(JSON.stringify({ status: 'FAILED', error: 'ffmpeg died' }))
    ).toBe('FAILED');
    expect(jobStateOf(JSON.stringify({ status: 'IN_QUEUE' }))).toBe('IN_QUEUE');
  });

  it('reads nothing from a state RunPod has not documented', () => {
    expect(jobStateOf(JSON.stringify({ status: 'EXPLODED' }))).toBeUndefined();
    expect(jobStateOf('<html>')).toBeUndefined();
  });
});

describe('RunPodApi', () => {
  it('reads the endpoint over REST v2, never the retiring v1', async () => {
    const spy = answers(200, { id: 'ep-1', workers: { min: 0, max: 0 } });

    expect(await api().endpointWorkers(later())).toEqual({ ok: true, max: 0 });

    const { url, init, headers } = call(spy);
    expect(url).toBe('https://api.runpod.io/v2/serverless/ep-1');
    expect(init.method).toBe('GET');
    expect(headers.Authorization).toBe('Bearer key');
  });

  it('raises max workers with a partial PATCH of workers.max only', async () => {
    const spy = answers(200, { workers: { min: 0, max: 5 } });

    expect(await api().setWorkersMax(5, later())).toEqual({ ok: true, max: 5 });

    const { url, init } = call(spy);
    expect(url).toBe('https://api.runpod.io/v2/serverless/ep-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ workers: { max: 5 } });
  });

  it('reports a key that may not change the endpoint', async () => {
    answers(403, { title: 'Forbidden', detail: 'access denied' });

    expect(await api().setWorkersMax(5, later())).toEqual({
      ok: false,
      reason: 'not_permitted',
      status: 403,
    });
  });

  it('asks after a job on the serverless API', async () => {
    const spy = answers(200, { id: 'job-1', status: 'COMPLETED' });

    expect(await api().jobStatus('job-1', later())).toEqual({
      ok: true,
      state: 'COMPLETED',
    });
    expect(call(spy).url).toBe('https://api.runpod.ai/v2/ep-1/status/job-1');
  });

  it('calls a job RunPod no longer has GONE', async () => {
    answers(404, {});

    expect(await api().jobStatus('job-1', later())).toEqual({
      ok: true,
      state: 'GONE',
    });
  });

  it('pings with a low-priority job that expires before any worker starts', async () => {
    const spy = answers(200, { id: 'ping-1', status: 'IN_QUEUE' });

    expect(await api().ping(2, later())).toEqual({ ok: true });

    const { url, init } = call(spy);
    expect(url).toBe('https://api.runpod.ai/v2/ep-1/run');
    expect(JSON.parse(init.body as string)).toEqual({
      input: { ping: true, contract: 2 },
      policy: { lowPriority: true, ttl: 10_000, executionTimeout: 60_000 },
    });
  });

  it('calls nothing once the deadline has passed', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');

    expect(await api().endpointWorkers(Date.now() - 1)).toEqual({
      ok: false,
      reason: 'out_of_time',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('calls nothing against a local container, which has /run only', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');

    expect(
      await api({ directUrl: 'http://localhost:8000/run' }).ping(2, later())
    ).toEqual({ ok: false, reason: 'unsupported' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('calls a call cut off by its deadline out of time', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError')
    );

    expect(await api().jobStatus('job-1', later())).toEqual({
      ok: false,
      reason: 'out_of_time',
    });
  });

  it('never throws on a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed')
    );

    expect(await api().jobStatus('job-1', later())).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('calls a 2xx it cannot read unreadable', async () => {
    answers(200, '<html>ok</html>');

    expect(await api().endpointWorkers(later())).toMatchObject({
      ok: false,
      reason: 'unreadable',
    });
  });
});
