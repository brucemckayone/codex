/**
 * The web asks /stream for the body with the exact query the worker reads
 * (Codex-039vo review).
 *
 * Both sides' tests mock the seam between them: the web's tests check only
 * that `getStreamingUrl` got `{ includeBody: true }`, and the worker's route
 * test builds its own URL. So nothing tied the string `api.ts` sends to the
 * one `streamingUrlQuerySchema` accepts. A renamed or mistyped key would pass
 * CI on both sides, and in production the worker strips an unknown key: every
 * entitled reader of a gated piece would get the empty page again. This pins
 * the URL the real `request()` fetches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/observability', () => ({
  logger: {
    startTimer: vi.fn(() => ({ end: vi.fn() })),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// The test setup mocks `$lib/server/api` for every file (src/tests/mocks.ts);
// this one needs the real request().
const { createServerApi } =
  await vi.importActual<typeof import('./api')>('./api');

function stubFetch() {
  const fetchMock = vi.fn((_url: string | URL | Request) =>
    Promise.resolve(
      Response.json({
        data: {
          streamingUrl: null,
          waveformUrl: null,
          expiresAt: '2026-10-24T00:00:00.000Z',
          contentType: 'written',
        },
      })
    )
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fetchedUrl(fetchMock: ReturnType<typeof stubFetch>): string {
  const [input] = fetchMock.mock.calls[0] ?? [];
  if (input instanceof Request) return input.url;
  return String(input);
}

describe('server API: /stream body flag', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includeBody sends ?include=body, the query the worker accepts', async () => {
    const fetchMock = stubFetch();
    const api = createServerApi(
      { env: {} } as never,
      { get: vi.fn() } as never
    );

    await api.access.getStreamingUrl('c1', { includeBody: true });

    expect(fetchedUrl(fetchMock)).toMatch(
      /\/api\/access\/content\/c1\/stream\?include=body$/
    );
  });

  it.each([
    ['includeBody false', { includeBody: false }],
    ['no options', undefined],
  ])('%s sends no query string', async (_case, options) => {
    const fetchMock = stubFetch();
    const api = createServerApi(
      { env: {} } as never,
      { get: vi.fn() } as never
    );

    await api.access.getStreamingUrl('c1', options);

    expect(fetchedUrl(fetchMock)).toMatch(
      /\/api\/access\/content\/c1\/stream$/
    );
  });
});
