/**
 * The server API's logs name a route, never its query (Codex-osuqt review).
 * A timeout's message and every request's perf timer embedded the full path,
 * so a catalogue read put the visitor's `search=` text in logs: redaction
 * scrubs metadata only, and a timer label and an error message are neither.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockStartTimer = vi.hoisted(() =>
  vi.fn((_label: string) => ({ end: vi.fn() }))
);
vi.mock('$lib/observability', () => ({
  logger: {
    startTimer: mockStartTimer,
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

describe('server API logs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps a search term out of a timeout message and its timer label', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError')))
    );
    const api = createServerApi(
      { env: {} } as never,
      { get: vi.fn() } as never
    );

    const read = api.content.getPublicContent(
      new URLSearchParams({ creatorId: 'u1', search: 'private words' })
    );

    await expect(read).rejects.toMatchObject({ status: 408 });
    const message = await read.catch((error: Error) => error.message);
    expect(message).toContain('/api/content/public');
    expect(message).not.toContain('private');
    const labels = mockStartTimer.mock.calls.map((call) => String(call[0]));
    expect(labels.some((label) => label.includes('/api/content/public'))).toBe(
      true
    );
    expect(labels.join(' ')).not.toContain('private');
  });
});
