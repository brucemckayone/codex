import { describe, expect, it } from 'vitest';
import { filterContentItemsByOrg } from './filter-by-org';

const item = (organizationId: string | null | undefined, id = 'x') => ({
  id,
  organizationId,
});

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';

describe('filterContentItemsByOrg', () => {
  it('returns empty when orgId is undefined (org data not loaded yet)', () => {
    const items = [item(ORG_A), item(ORG_B)];
    expect(filterContentItemsByOrg(items, undefined)).toEqual([]);
  });

  it('returns empty when items is empty', () => {
    expect(filterContentItemsByOrg([], ORG_A)).toEqual([]);
  });

  it('returns only items whose organizationId strictly equals orgId', () => {
    const alphaA = item(ORG_A, 'a1');
    const alphaB = item(ORG_A, 'a2');
    const betaC = item(ORG_B, 'b1');
    const result = filterContentItemsByOrg([alphaA, betaC, alphaB], ORG_A);
    expect(result).toEqual([alphaA, alphaB]);
  });

  it('excludes items with null organizationId (personal-creator content)', () => {
    const personal = item(null, 'personal');
    const current = item(ORG_A, 'current');
    expect(filterContentItemsByOrg([personal, current], ORG_A)).toEqual([
      current,
    ]);
  });

  it('excludes items with missing organizationId key', () => {
    const malformed = { id: 'mal' } as unknown as {
      id: string;
      organizationId?: string | null;
    };
    const current = item(ORG_A, 'current');
    expect(filterContentItemsByOrg([malformed, current], ORG_A)).toEqual([
      current,
    ]);
  });

  it('regression guard: filtering must NOT match on a slug-shaped string', () => {
    // Mirror of the library-side regression: original library bug filtered
    // by org slug, allowing legacy null-slug entries to slip through. Pin
    // this test so a future refactor never silently swaps the predicate
    // back to slug comparison.
    const slugLike = item('studio-alpha', 'slug');
    const uuidEntry = item(ORG_A, 'real');
    expect(filterContentItemsByOrg([slugLike, uuidEntry], ORG_A)).toEqual([
      uuidEntry,
    ]);
  });

  it('preserves input order of matching items (sort-stable live queries depend on this)', () => {
    const a = item(ORG_A, '1');
    const b = item(ORG_A, '2');
    const c = item(ORG_A, '3');
    expect(filterContentItemsByOrg([a, b, c], ORG_A)).toEqual([a, b, c]);
  });

  it('the user-reported scenario: cross-org poisoning is dropped on render', () => {
    // Simulate the contentCollection being poisoned with Alpha's items
    // while the page is rendering for Of Blood and Bones. Strict equality
    // by orgId ensures Alpha's items never reach the DOM.
    const ofBloodAndBonesItem = item(ORG_A, 'obab-1');
    const alphaPoison1 = item(ORG_B, 'alpha-1');
    const alphaPoison2 = item(ORG_B, 'alpha-2');
    const result = filterContentItemsByOrg(
      [alphaPoison1, ofBloodAndBonesItem, alphaPoison2],
      ORG_A
    );
    expect(result).toEqual([ofBloodAndBonesItem]);
  });
});
