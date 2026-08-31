/**
 * The free-text search floor (Codex-k618q · WP6).
 *
 * ## Why this file exists
 *
 * Twelve independent `search: z.string()` declarations across
 * `@codex/validation` and `apps/web/src/lib/remote` let a ONE-CHARACTER query
 * reach a `LIKE '%a%'` and scan the whole table. Ten set no minimum; two were
 * `.trim().min(1)`, which rejects only the empty string — which is also why a
 * literal grep for `z.string().min` matched none of them.
 *
 * ## The two halves that must BOTH hold
 *
 * The fix is asymmetric, and each half is easy to "tidy" into the other:
 *
 *  1. The SERVER still accepts 1-2 characters (200, not 400). A user typing
 *     "Bo" on the way to "Bones" must not get a validation error, and a
 *     bookmarked `?search=Bo` must not 400. `rejects no short query` is the
 *     witness: it goes RED the moment anyone adds `.min(3)` to the builder.
 *  2. The CLIENT does not ISSUE below three, because pg_trgm cannot use its
 *     index without a full trigram. `gateSearchQuery` / `isSearchQueryBelowFloor`
 *     are that gate, and `holds a below-floor query` /
 *     `clear is not a hold` pin the three-way distinction the call sites need.
 *
 * Falsifiability: raising `SEARCH_MIN_QUERY_LENGTH` to 4 or lowering it to 2
 * fails the boundary tests; adding a server-side minimum fails half 1; letting
 * "hold" collapse into "clear" fails `clear is not a hold`; and reverting any
 * of the twelve declarations to a bare `z.string()` fails the sweep at the
 * bottom of this file.
 */

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { adminCustomerListQuerySchema } from '../admin/admin-schemas';
import { categoryQuerySchema } from '../content/category-schemas';
import {
  contentQuerySchema,
  discoverContentQuerySchema,
  organizationQuerySchema,
  publicContentQuerySchema,
} from '../content/content-schemas';
import { listUserLibrarySchema } from '../schemas/access';
import { listSubscribersQuerySchema } from '../schemas/subscription';
import {
  createSearchQuerySchema,
  gateSearchQuery,
  isSearchQueryBelowFloor,
  SEARCH_MIN_QUERY_LENGTH,
} from './search-schema';

const validUUID = 'a1b2c3d4-e5f6-4a90-b234-567890abcdef';

describe('SEARCH_MIN_QUERY_LENGTH', () => {
  it('is three, because a trigram is three characters', () => {
    // Not a taste threshold. pg_trgm probes its GIN index with the trigram set
    // extracted from the pattern; under three characters there is no trigram to
    // extract, so the planner falls back to a sequential scan. Changing this
    // number changes the execution plan, which is why it is asserted literally.
    expect(SEARCH_MIN_QUERY_LENGTH).toBe(3);
  });
});

// ============================================================================
// Half 1 — the SERVER still accepts short queries
// ============================================================================

describe('createSearchQuerySchema — the server schema', () => {
  const schema = createSearchQuerySchema(255);

  it('rejects no short query: 1 and 2 characters parse (200, not 400)', () => {
    // THE acceptance criterion. This test is the reason the builder must never
    // grow a `.min(3)`: it goes red immediately if one is added.
    expect(schema.parse('B')).toBe('B');
    expect(schema.parse('Bo')).toBe('Bo');
  });

  it('accepts the empty string and undefined (an absent facet)', () => {
    expect(schema.parse('')).toBe('');
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it('trims, so whitespace does not become a match-everything pattern', () => {
    expect(schema.parse('  Bones  ')).toBe('Bones');
    expect(schema.parse('   ')).toBe('');
  });

  it('caps length at the requested maximum, measured AFTER trimming', () => {
    expect(createSearchQuerySchema(5).parse('  abc  ')).toBe('abc');
    expect(() => createSearchQuerySchema(5).parse('abcdef')).toThrow(ZodError);
  });

  it('defaults its maximum to 255', () => {
    expect(createSearchQuerySchema().parse('a'.repeat(255))).toHaveLength(255);
    expect(() => createSearchQuerySchema().parse('a'.repeat(256))).toThrow(
      ZodError
    );
  });

  it('composes with .default() without losing the optionality', () => {
    // `listUserLibrarySchema` needs `search` to land as '' rather than
    // undefined; the builder must not have foreclosed that.
    const withDefault = createSearchQuerySchema(200).default('');
    expect(withDefault.parse(undefined)).toBe('');
    expect(withDefault.parse('  Bo  ')).toBe('Bo');
  });
});

// ============================================================================
// Half 2 — the CLIENT gate
// ============================================================================

describe('gateSearchQuery — the client gate', () => {
  it('issues a query at or above the floor, trimmed', () => {
    expect(gateSearchQuery('Bones')).toBe('Bones');
    expect(gateSearchQuery('  Bones  ')).toBe('Bones');
    expect(gateSearchQuery('Bon')).toBe('Bon'); // exactly the floor
  });

  it('issues nothing below the floor', () => {
    expect(gateSearchQuery('Bo')).toBeNull();
    expect(gateSearchQuery('B')).toBeNull();
    expect(gateSearchQuery('  Bo  ')).toBeNull(); // trimmed length decides
  });

  it('issues nothing for empty, whitespace-only, null or undefined input', () => {
    expect(gateSearchQuery('')).toBeNull();
    expect(gateSearchQuery('   ')).toBeNull();
    expect(gateSearchQuery(null)).toBeNull();
    expect(gateSearchQuery(undefined)).toBeNull();
  });

  it('is exact at the boundary', () => {
    const belowFloor = 'a'.repeat(SEARCH_MIN_QUERY_LENGTH - 1);
    const atFloor = 'a'.repeat(SEARCH_MIN_QUERY_LENGTH);
    expect(gateSearchQuery(belowFloor)).toBeNull();
    expect(gateSearchQuery(atFloor)).toBe(atFloor);
  });
});

describe('isSearchQueryBelowFloor — hold vs clear', () => {
  it('holds a below-floor query: the user typed something, but too little', () => {
    expect(isSearchQueryBelowFloor('B')).toBe(true);
    expect(isSearchQueryBelowFloor('Bo')).toBe(true);
    expect(isSearchQueryBelowFloor('  Bo  ')).toBe(true);
  });

  it('clear is not a hold: an emptied field must still commit', () => {
    // If this collapsed into "hold", the clear button and an emptied field
    // would both stop working — an active search could never be removed.
    expect(isSearchQueryBelowFloor('')).toBe(false);
    expect(isSearchQueryBelowFloor('   ')).toBe(false);
    expect(isSearchQueryBelowFloor(null)).toBe(false);
    expect(isSearchQueryBelowFloor(undefined)).toBe(false);
  });

  it('an issuable query is not a hold', () => {
    expect(isSearchQueryBelowFloor('Bon')).toBe(false);
    expect(isSearchQueryBelowFloor('Bones')).toBe(false);
  });
});

// ============================================================================
// The migrated declarations — every one still returns 200 on 1-2 characters
// ============================================================================

describe('the migrated search facets accept a 1-2 character query', () => {
  const cases: [string, (search: string) => unknown][] = [
    ['contentQuerySchema', (search) => contentQuerySchema.parse({ search })],
    [
      'publicContentQuerySchema',
      (search) => publicContentQuerySchema.parse({ orgId: validUUID, search }),
    ],
    [
      'discoverContentQuerySchema',
      (search) => discoverContentQuerySchema.parse({ search }),
    ],
    [
      'organizationQuerySchema',
      (search) => organizationQuerySchema.parse({ search }),
    ],
    ['categoryQuerySchema', (search) => categoryQuerySchema.parse({ search })],
    [
      'adminCustomerListQuerySchema',
      (search) => adminCustomerListQuerySchema.parse({ search }),
    ],
    [
      'listUserLibrarySchema',
      (search) => listUserLibrarySchema.parse({ search }),
    ],
    [
      'listSubscribersQuerySchema',
      (search) => listSubscribersQuerySchema.parse({ search }),
    ],
  ];

  for (const [name, parse] of cases) {
    it(`${name} accepts 'Bo'`, () => {
      expect(() => parse('Bo')).not.toThrow();
    });
    it(`${name} accepts an empty search`, () => {
      // `listSubscribersQuerySchema` used to be `.trim().min(1)` and threw
      // here — a cleared search box was a 400.
      expect(() => parse('')).not.toThrow();
    });
  }

  it("normalises a whitespace-only search to '' rather than a wildcard", () => {
    expect(contentQuerySchema.parse({ search: '   ' }).search).toBe('');
    expect(listUserLibrarySchema.parse({ search: '   ' }).search).toBe('');
  });
});

// ============================================================================
// The sweep — nothing in this package may declare `search` by hand again
// ============================================================================

describe('no hand-rolled search declaration survives in @codex/validation', () => {
  it('every `search:` field in src/ is built by createSearchQuerySchema', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const srcRoot = join(import.meta.dirname, '..');

    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(full)));
        else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.'))
          out.push(full);
      }
      return out;
    }

    const offenders: string[] = [];
    for (const file of await walk(srcRoot)) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        // A `search:` object field whose value is a raw Zod chain. Matching the
        // DECLARATION rather than a spelling is the point: `.trim().min(1)` is
        // why a grep for `z.string().min` found nothing for months.
        if (/^\s*search\s*:\s*z\./.test(line)) {
          offenders.push(`${file.slice(srcRoot.length + 1)}:${i + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
