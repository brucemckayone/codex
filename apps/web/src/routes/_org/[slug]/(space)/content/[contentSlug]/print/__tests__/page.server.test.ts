/**
 * An org's leaving article, printed (Codex-a6ofh.6.5): the page renders only
 * what the worker's print read returns, which it answers only when the
 * piece's download eligibility is `'print'`. Every refusal is the page's 404,
 * and the page, carrying a paid body, is stored nowhere.
 *
 * The page resets to the root layout, so the org layout's load does not run:
 * the org is resolved here, by its slug.
 */

import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const mockGetPublicInfo = vi.hoisted(() => vi.fn());
const mockLeavingPrint = vi.hoisted(() => vi.fn());
const mockSetHeaders = vi.hoisted(() => vi.fn());

vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    org: { getPublicInfo: mockGetPublicInfo },
    access: { leavingPrint: mockLeavingPrint },
  })),
}));

const event = (
  { contentSlug = 'writing', signedIn = true } = {} as {
    contentSlug?: string;
    signedIn?: boolean;
  }
) =>
  ({
    params: { slug: 'studio-alpha', contentSlug },
    locals: { user: signedIn ? { id: 'u1' } : null },
    platform: { env: {} },
    cookies: { get: vi.fn() },
    setHeaders: mockSetHeaders,
  }) as never;

const print = {
  contentId: 'c1',
  title: 'Writing a design system',
  creatorName: 'Alex',
  body: { contentBody: 'The whole essay.', contentBodyJson: null },
};

/** The worker's refusal of the print read: its 404, naming the content. */
const refusal = () =>
  new ApiError(404, 'Content not found', 'NOT_FOUND', {
    code: 'CONTENT_NOT_FOUND',
  });

/** A 404 the worker did not give: a route that isn't there, no envelope. */
const bare404 = () => new ApiError(404, 'Not Found');

/** Run the load, answering its thrown 404 as a value. */
async function run(e = event()) {
  const { load } = await import('../+page.server');
  try {
    return { data: await load(e) };
  } catch (err) {
    return { err };
  }
}

describe('org leaving article print view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicInfo.mockResolvedValue({ id: 'o1', slug: 'studio-alpha' });
    mockLeavingPrint.mockResolvedValue(print);
  });

  it('renders what the print read returns, for the org’s key, stored nowhere', async () => {
    const { data } = await run();

    expect(mockGetPublicInfo).toHaveBeenCalledWith('studio-alpha');
    expect(mockLeavingPrint).toHaveBeenCalledWith({
      orgId: 'o1',
      slug: 'writing',
    });
    expect(data).toMatchObject({
      title: 'Writing a design system',
      creatorName: 'Alex',
      bodyUnavailable: false,
    });
    expect((data as { bodyHtml: string }).bodyHtml).toContain(
      'The whole essay.'
    );
    expect(mockSetHeaders).toHaveBeenCalledWith({
      'Cache-Control': 'private, no-store',
    });
  });

  it('is a 404 when the print read refuses (anything but print)', async () => {
    mockLeavingPrint.mockRejectedValue(refusal());
    const { err } = await run();

    // The page's own 404, never the API's error passed through.
    expect(isHttpError(err, 404)).toBe(true);
    // Stored nowhere whatever it answers.
    expect(mockSetHeaders).toHaveBeenCalledWith({
      'Cache-Control': 'private, no-store',
    });
  });

  it('is a 404 for a signed-out visitor, and asks nothing', async () => {
    const { err } = await run(event({ signedIn: false }));

    expect(isHttpError(err, 404)).toBe(true);
    expect(mockGetPublicInfo).not.toHaveBeenCalled();
    expect(mockLeavingPrint).not.toHaveBeenCalled();
  });

  it('is a 404 for a slug the API would refuse, and asks nothing', async () => {
    const { err } = await run(event({ contentSlug: 'bad\u0000slug' }));

    expect(isHttpError(err, 404)).toBe(true);
    expect(mockLeavingPrint).not.toHaveBeenCalled();
  });

  it('is a 404 for an org that does not exist', async () => {
    mockGetPublicInfo.mockRejectedValue(
      new ApiError(404, 'Organization not found', 'NOT_FOUND')
    );
    const { err } = await run();

    expect(isHttpError(err, 404)).toBe(true);
    expect(mockLeavingPrint).not.toHaveBeenCalled();
  });

  it('lets a bare 404 from the print read through, never as the page’s 404', async () => {
    const skew = bare404();
    mockLeavingPrint.mockRejectedValue(skew);
    const { err } = await run();

    expect(err).toBe(skew);
    expect(isHttpError(err)).toBe(false);
  });

  it('lets a NOT_FOUND that names no content through too', async () => {
    const other = new ApiError(404, 'Not found', 'NOT_FOUND');
    mockLeavingPrint.mockRejectedValue(other);
    const { err } = await run();

    expect(err).toBe(other);
  });

  it('lets a bare 404 from the org lookup through, as the org layout does', async () => {
    const skew = bare404();
    mockGetPublicInfo.mockRejectedValue(skew);
    const { err } = await run();

    expect(err).toBe(skew);
    expect(mockLeavingPrint).not.toHaveBeenCalled();
  });

  it('lets any other failure through as itself, never as a 404', async () => {
    const outage = new ApiError(503, 'Service unavailable');
    mockLeavingPrint.mockRejectedValue(outage);
    const { err } = await run();

    expect(err).toBe(outage);
  });
});
