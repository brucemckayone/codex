/**
 * A creator's personal leaving article, printed (Codex-a6ofh.6.5): the
 * creator tree's twin of the org print view. The piece is keyed by its
 * creator, never an org; every refusal is the page's 404, and the page is
 * stored nowhere.
 */

import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const mockGetPublicProfile = vi.hoisted(() => vi.fn());
const mockLeavingPrint = vi.hoisted(() => vi.fn());
const mockSetHeaders = vi.hoisted(() => vi.fn());

vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    account: { getPublicProfile: mockGetPublicProfile },
    access: { leavingPrint: mockLeavingPrint },
  })),
}));

const event = (
  { username = '@alex', signedIn = true } = {} as {
    username?: string;
    signedIn?: boolean;
  }
) =>
  ({
    params: { username, contentSlug: 'writing' },
    locals: { user: signedIn ? { id: 'u1' } : null },
    platform: { env: {} },
    cookies: { get: vi.fn() },
    setHeaders: mockSetHeaders,
  }) as never;

const print = {
  contentId: 'c1',
  title: 'Writing a design system',
  creatorName: 'Alex',
  body: { contentBody: 'A personal essay.', contentBodyJson: null },
};

/** Run the load, answering its thrown 404 as a value. */
async function run(e = event()) {
  const { load } = await import('../+page.server');
  try {
    return { data: await load(e) };
  } catch (err) {
    return { err };
  }
}

describe('creator leaving article print view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicProfile.mockResolvedValue({ id: 'creator1', name: 'Alex' });
    mockLeavingPrint.mockResolvedValue(print);
  });

  it('renders what the print read returns, for the creator’s key, stored nowhere', async () => {
    const { data } = await run();

    expect(mockGetPublicProfile).toHaveBeenCalledWith('alex');
    expect(mockLeavingPrint).toHaveBeenCalledWith({
      creatorId: 'creator1',
      slug: 'writing',
    });
    expect((data as { bodyHtml: string }).bodyHtml).toContain(
      'A personal essay.'
    );
    expect(mockSetHeaders).toHaveBeenCalledWith({
      'Cache-Control': 'private, no-store',
    });
  });

  it('is a 404 when the print read refuses (anything but print)', async () => {
    mockLeavingPrint.mockRejectedValue(
      new ApiError(404, 'Content not found', 'NOT_FOUND', {
        code: 'CONTENT_NOT_FOUND',
      })
    );
    const { err } = await run();
    // The page's own 404, never the API's error passed through.
    expect(isHttpError(err, 404)).toBe(true);
  });

  it('lets a bare 404 from the print read through, never as the page’s 404', async () => {
    const skew = new ApiError(404, 'Not Found');
    mockLeavingPrint.mockRejectedValue(skew);
    const { err } = await run();

    expect(err).toBe(skew);
    expect(isHttpError(err)).toBe(false);
  });

  it('is a 404 for a signed-out visitor, and asks nothing', async () => {
    const { err } = await run(event({ signedIn: false }));

    expect(isHttpError(err, 404)).toBe(true);
    expect(mockLeavingPrint).not.toHaveBeenCalled();
  });

  it('is a 404 for a creator that does not exist', async () => {
    mockGetPublicProfile.mockResolvedValue(null);
    const { err } = await run();

    expect(isHttpError(err, 404)).toBe(true);
    expect(mockLeavingPrint).not.toHaveBeenCalled();
  });

  it('is a 404 for a malformed handle, stored nowhere, and asks nothing', async () => {
    const { err } = await run(event({ username: '@no spaces!' }));

    expect(isHttpError(err, 404)).toBe(true);
    expect(err).toMatchObject({ body: { message: 'Content not found' } });
    expect(mockSetHeaders).toHaveBeenCalledWith({
      'Cache-Control': 'private, no-store',
    });
    expect(mockGetPublicProfile).not.toHaveBeenCalled();
  });
});
