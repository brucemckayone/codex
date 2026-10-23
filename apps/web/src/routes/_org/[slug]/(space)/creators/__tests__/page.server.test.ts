/**
 * The public creators directory bounds `?page=` to a page the list accepts
 * (Codex-osuqt). Unbounded, a 400-digit page parsed to Infinity, which the
 * remote query's schema refused, and 1e20 reached organization-api as an
 * offset Postgres cannot hold.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPublicCreatorsMock } = vi.hoisted(() => ({
  getPublicCreatorsMock: vi.fn(),
}));

vi.mock('$lib/remote/org.remote', () => ({
  getPublicCreators: getPublicCreatorsMock,
}));

const loadWith = async (search: string) => {
  const { load } = await import('../+page.server');
  return load({
    url: new URL(`http://studio-alpha.lvh.me:3000/creators${search}`),
    setHeaders: vi.fn(),
    parent: async () => ({ org: { slug: 'studio-alpha' } }),
  } as never);
};

describe('creators directory: ?page=', () => {
  beforeEach(() => {
    getPublicCreatorsMock.mockReset();
    getPublicCreatorsMock.mockResolvedValue({ items: [], pagination: {} });
  });

  it.each([
    ['a 400-digit page', `?page=${'9'.repeat(400)}`, 1000],
    ['1e20', '?page=99999999999999999999', 1000],
    ['page 0', '?page=0', 1],
    ['no page', '', 1],
    ['page 3', '?page=3', 3],
  ])('sends %s as a page the list accepts', async (_label, search, page) => {
    await loadWith(search);

    expect(getPublicCreatorsMock).toHaveBeenCalledWith(
      expect.objectContaining({ page })
    );
  });
});
