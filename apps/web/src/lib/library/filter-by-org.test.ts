import { describe, expect, it } from 'vitest';
import { filterLibraryItemsByOrg } from './filter-by-org';

const item = (organizationId: string | null | undefined, id = 'x') => ({
  content: { id, organizationId },
});

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';

describe('filterLibraryItemsByOrg', () => {
  it('returns empty when orgId is undefined (org data not loaded yet)', () => {
    const items = [item(ORG_A), item(ORG_B)];
    expect(filterLibraryItemsByOrg(items, undefined)).toEqual([]);
  });

  it('returns empty when items is empty', () => {
    expect(filterLibraryItemsByOrg([], ORG_A)).toEqual([]);
  });

  it('returns only items whose organizationId strictly equals orgId', () => {
    const alphaA = item(ORG_A, 'a1');
    const alphaB = item(ORG_A, 'a2');
    const betaC = item(ORG_B, 'b1');
    const result = filterLibraryItemsByOrg([alphaA, betaC, alphaB], ORG_A);
    expect(result).toEqual([alphaA, alphaB]);
  });

  it('excludes items with null organizationId (legacy localStorage entries)', () => {
    const legacy = item(null, 'legacy');
    const current = item(ORG_A, 'current');
    expect(filterLibraryItemsByOrg([legacy, current], ORG_A)).toEqual([
      current,
    ]);
  });

  it('excludes items with missing organizationId key (pre-fix entries)', () => {
    // The whole point of this test is the absence of organizationId, so
    // we deliberately construct a malformed item and cast through unknown.
    const preFix = { content: { id: 'pre' } } as unknown as {
      content: { id: string; organizationId?: string | null };
    };
    const current = item(ORG_A, 'current');
    expect(filterLibraryItemsByOrg([preFix, current], ORG_A)).toEqual([
      current,
    ]);
  });

  it('excludes items with missing content object', () => {
    const broken = { content: undefined } as unknown as {
      content?: { organizationId?: string | null };
    };
    const current = item(ORG_A, 'current');
    expect(filterLibraryItemsByOrg([broken, current], ORG_A)).toEqual([
      current,
    ]);
  });

  it('regression guard: filtering by an orgId must NOT match on organizationSlug-like string', () => {
    // The original bug filtered by slug. Simulate an entry carrying a
    // slug-shaped string in the id field (should not match the uuid).
    const slugOnly = {
      content: { id: 'slug-confuser', organizationId: 'studio-alpha' },
    };
    const real = item(ORG_A, 'real');
    // orgId is a uuid here; a slug value must never match equality.
    expect(filterLibraryItemsByOrg([slugOnly, real], ORG_A)).toEqual([real]);
  });

  it('preserves input order of matching items (used by sort-stable live queries)', () => {
    const a = item(ORG_A, '1');
    const b = item(ORG_A, '2');
    const c = item(ORG_A, '3');
    expect(filterLibraryItemsByOrg([a, b, c], ORG_A)).toEqual([a, b, c]);
  });
});
