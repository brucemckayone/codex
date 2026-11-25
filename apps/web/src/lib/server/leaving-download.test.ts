/**
 * An owner's download of a leaving piece (Codex-a6ofh.6.7): the page note's
 * link lands on `redirectToLeavingDownload`, which answers a 302 to the
 * worker's signed link, stored nowhere. Anything else is a 303 back to the
 * piece's page, never an error page: a refusal plainly, any other failure
 * logged and with `?download=failed`, so the note can say so.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const mockLeavingDownload = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('$lib/observability', () => ({ logger: mockLogger }));

vi.mock('./api', () => ({
  createServerApi: vi.fn(() => ({
    access: { leavingDownload: mockLeavingDownload },
  })),
}));

const ID = '11111111-2222-4333-8444-555555555555';
const ORIGIN = 'https://studio-alpha.revelations.studio';
const PAGE = `${ORIGIN}/content/x`;

const event = ({
  id = ID,
  signedIn = true,
  path = '/content/x/download',
} = {}) =>
  ({
    url: new URL(`${ORIGIN}${path}?id=${id}`),
    locals: { user: signedIn ? { id: 'u1' } : null },
    platform: { env: {} },
    cookies: { get: vi.fn() },
  }) as never;

/** The worker's refusal: its 404, naming the content. */
const refusal = () =>
  new ApiError(404, 'Content not found', 'NOT_FOUND', {
    code: 'CONTENT_NOT_FOUND',
  });

async function run(e = event()) {
  const { redirectToLeavingDownload } = await import('./leaving-download');
  return redirectToLeavingDownload(e);
}

describe('redirectToLeavingDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeavingDownload.mockResolvedValue({
      url: 'https://r2.example/originals/v.mp4?X-Amz-Signature=abc',
      filename: 'v.mp4',
      sizeBytes: 10,
      expiresAt: '2026-11-24T12:15:00.000Z',
    });
  });

  it('redirects to the signed link for the id, and the answer is stored nowhere', async () => {
    const response = await run();
    expect(mockLeavingDownload).toHaveBeenCalledWith(ID);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://r2.example/originals/v.mp4?X-Amz-Signature=abc'
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('a signed-out reader goes back to the page, and the worker is never asked', async () => {
    const response = await run(event({ signedIn: false }));
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(PAGE);
    expect(mockLeavingDownload).not.toHaveBeenCalled();
  });

  it('an id that is not one goes back to the page, and the worker is never asked', async () => {
    const response = await run(event({ id: 'not-an-id' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(PAGE);
    expect(mockLeavingDownload).not.toHaveBeenCalled();
  });

  it("the worker's refusal goes back to the page, which says what is true now", async () => {
    mockLeavingDownload.mockRejectedValue(refusal());
    const response = await run();
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(PAGE);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('any other failure is logged and goes back saying the download did not start', async () => {
    mockLeavingDownload.mockRejectedValue(new ApiError(503, 'Unavailable'));
    const response = await run();
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(`${PAGE}?download=failed`);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Leaving download failed; back to the page',
      expect.objectContaining({ contentId: ID, status: 503 })
    );
  });

  it("the creator page's route goes back to its own page", async () => {
    mockLeavingDownload.mockRejectedValue(refusal());
    const response = await run(event({ path: '/alfie/content/x/download/' }));
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/alfie/content/x`);
  });
});
