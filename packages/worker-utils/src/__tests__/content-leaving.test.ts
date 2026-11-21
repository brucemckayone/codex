/**
 * The leaving notice's sweep (Codex-a6ofh.6.4), the workers' halves:
 * media-api's signed call for one tick, and the page every email links,
 * built from the environment's name.
 */

import type { ObservabilityClient } from '@codex/observability';
import type { ContentLeavingSweepReport } from '@codex/validation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTENT_LEAVING_SWEEP_ROUTE,
  contentLeavingSweeperFor,
  leavingNoticeLinkFor,
  WorkerContentLeavingSweeper,
} from '../content-leaving';

const fakeObs = () =>
  ({ warn: vi.fn(), error: vi.fn() }) as unknown as ObservabilityClient & {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

const REPORT: ContentLeavingSweepReport = {
  claimed: 3,
  sent: 2,
  failed: 1,
  unknown: 0,
  abandoned: 0,
  cancelled: 0,
  givenBack: 0,
  notRecorded: 0,
  errors: 0,
  librariesBumped: 3,
  remindersAdded: 0,
  completed: 1,
  more: false,
};

const answered = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorkerContentLeavingSweeper', () => {
  it("posts an empty, signed body to content-api's route and returns its report", async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(answered(200, { data: REPORT }));

    const report = await new WorkerContentLeavingSweeper(
      'https://content-api.test',
      'secret'
    ).sweep();

    expect(report).toEqual(REPORT);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://content-api.test${CONTENT_LEAVING_SWEEP_ROUTE}`);
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-Worker-Signature')).toBeTruthy();
    expect(headers.get('X-Worker-Timestamp')).toBeTruthy();
    expect((init as RequestInit).body).toBe('{}');
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  // A bad secret or a route not deployed stops every owner's emails until
  // fixed, so it is loud. A blip is only thrown (the step fails, the next
  // hour asks again).
  it('throws on a refusal, at error first when no retry cures it', async () => {
    const obs = fakeObs();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      answered(401, { error: { code: 'UNAUTHORIZED', message: 'no' } })
    );
    const sweeper = new WorkerContentLeavingSweeper(
      'https://content-api.test',
      'secret',
      obs
    );

    await expect(sweeper.sweep()).rejects.toThrow('content-api answered 401');
    expect(obs.error).toHaveBeenCalledWith(
      'Leaving sweep call refused by content-api',
      { status: 401, code: 'UNAUTHORIZED' }
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      answered(503, { error: { code: 'INTERNAL_ERROR', message: 'down' } })
    );
    obs.error.mockClear();
    await expect(sweeper.sweep()).rejects.toThrow('content-api answered 503');
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('throws on a 2xx that carries no report', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      answered(200, { data: { claimed: 'three' } })
    );

    await expect(
      new WorkerContentLeavingSweeper(
        'https://content-api.test',
        'secret'
      ).sweep()
    ).rejects.toThrow('without a report');
  });

  it('is built only with the shared secret, for content-api by name', () => {
    expect(contentLeavingSweeperFor({ ENVIRONMENT: 'production' })).toBe(
      undefined
    );
    const sweeper = contentLeavingSweeperFor({
      ENVIRONMENT: 'production',
      WORKER_SHARED_SECRET: 'secret',
    });
    expect(sweeper).toBeInstanceOf(WorkerContentLeavingSweeper);
    expect(
      (sweeper as unknown as { contentApiUrl: string }).contentApiUrl
    ).toBe('https://content-api.revelations.studio');
  });
});

describe('leavingNoticeLinkFor', () => {
  const page = {
    slug: 'css-variables-masterclass',
    organizationSlug: null,
    creatorUsername: null,
  };

  it("links an org's piece on its org's subdomain", () => {
    expect(
      leavingNoticeLinkFor('production')({
        ...page,
        organizationSlug: 'studio-alpha',
      })
    ).toBe(
      'https://studio-alpha.revelations.studio/content/css-variables-masterclass'
    );
  });

  it("links a personal piece under its creator's handle", () => {
    expect(
      leavingNoticeLinkFor('production')({ ...page, creatorUsername: 'sam' })
    ).toBe(
      'https://creators.revelations.studio/@sam/content/css-variables-masterclass'
    );
  });

  it("links the owner's library when its creator has no handle, staying in its environment", () => {
    expect(leavingNoticeLinkFor('production')(page)).toBe(
      'https://revelations.studio/library'
    );
    expect(leavingNoticeLinkFor('staging')(page)).toBe(
      'https://codex-staging.revelations.studio/library'
    );
    expect(leavingNoticeLinkFor('development')(page)).toBe(
      'http://lvh.me:3000/library'
    );
  });

  it('builds no link for an environment it does not know', () => {
    expect(leavingNoticeLinkFor(undefined)(page)).toBeNull();
    expect(leavingNoticeLinkFor('prod')(page)).toBeNull();
  });
});
