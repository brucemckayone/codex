/**
 * The search floor's SHAPE, swept over source (Codex-k618q · WP6).
 *
 * The behaviour is proved elsewhere — `DiscoverFilters.svelte.test.ts` drives a
 * real input and asserts the query is not issued, and
 * `packages/validation/src/shared/search-schema.test.ts` pins the builder and
 * the gate. What is left is the thing behaviour tests cannot see: a NEW or
 * REVERTED declaration somewhere else in apps/web.
 *
 * Twelve independent `search: z.string()` declarations is how this defect
 * existed in the first place, and the reason it went unnoticed is worth
 * repeating: two of the twelve were written `z.string().trim().min(1)`, so a
 * literal grep for `z.string().min` matched NONE of them. These tests match
 * the DECLARATION and the CALL, never a spelling.
 *
 * What this file does NOT claim: it cannot notice a brand-new search surface
 * that never imports the gate at all. That is the repo-wide static gate's job
 * (WP9). This file's job is to make DELETION of the landed gate loud.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** apps/web/src — this file lives at src/lib/remote/. */
const SRC_ROOT = join(import.meta.dirname, '..', '..');

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.svelte-kit')
        continue;
      out.push(...(await walk(full)));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) &&
      !entry.name.includes('.test.')
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A `q` / `search` key inside a patch object handed to the shared filter-url
 * helpers: `filterHref(page.url, { q: … })`, the shorthand `{ q }`, or a
 * multi-line `applyFilterPatch(url, { sort, search: … })`.
 */
const HELPER_PATCH_KEY =
  /\b(?:filterHref|applyFilterPatch)\([^;]*?\{[^}]*?\b(?:q|search)\b\s*[:,}]/;

/**
 * Does this source put a `q` / `search` param on a URL it navigates to? The
 * shapes apps/web uses: a template `?q=${…}`; `params.set('q', …)`; a helper
 * patch object (HELPER_PATCH_KEY; the studio list pages since Codex-a6ofh.1.1);
 * and a page's own `setUrlParam('q', …)` wrapper called with a literal key. A
 * detector blind to a shape passes by seeing nothing, so the calibration tests
 * below pin each one, including against a REAL source file.
 *
 * KNOWN GAPS, so a pass is never read as proof: a computed key
 * (`{ [key]: value }`, `params.set(key, …)`), a patch built elsewhere and
 * passed by name (explore's `applyFilterPatch(url, patch)`), and a patch value
 * holding a `}` before the key (a template literal) are all invisible.
 */
function writesSearchParam(src: string): boolean {
  return (
    /\?q=\$\{/.test(src) ||
    /(?:searchParams|params)\.set\(\s*['"](?:q|search)['"]/.test(src) ||
    HELPER_PATCH_KEY.test(src) ||
    /\bsetUrlParam\(\s*['"](?:q|search)['"]/.test(src)
  );
}

describe('no hand-rolled search declaration survives in apps/web', () => {
  it('declares no `search:` field with a raw Zod chain', async () => {
    const offenders: string[] = [];
    for (const file of await walk(SRC_ROOT)) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (/^\s*search\s*:\s*z\./.test(line)) {
          offenders.push(`${relative(SRC_ROOT, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('the migrated remote declarations use the shared builder', () => {
  // The `search:` declarations that live in apps/web/src/lib/remote. A fourth,
  // content.remote.ts's `getPublicContent` args, moved to @codex/validation as
  // `publicContentArgsSchema` (Codex-osuqt), where search-schema.test.ts's
  // sweep of that package covers it; content.remote.test.ts pins the remote
  // to that schema.
  const REMOTE_DECLARATIONS = [
    'lib/remote/admin.remote.ts',
    'lib/remote/journeys.remote.ts',
    'lib/remote/subscription.remote.ts',
  ] as const;

  for (const rel of REMOTE_DECLARATIONS) {
    it(`${rel} builds its search field with createSearchQuerySchema`, async () => {
      const src = await readFile(join(SRC_ROOT, rel), 'utf8');
      const declarations = src
        .split('\n')
        .filter((line) => /^\s*search\s*:/.test(line));

      // Guard against the test silently passing because the field was renamed
      // or removed: there must still be exactly one, and it must be built.
      expect(declarations).toHaveLength(1);
      expect(declarations[0]).toMatch(/createSearchQuerySchema\(/);
      expect(src).toMatch(/createSearchQuerySchema/);
    });
  }
});

describe('every landed client gate is still wired', () => {
  /**
   * The surfaces where a search value reaches the DATABASE, and what each one
   * must carry. Three shapes, because the query is issued in three places:
   *
   *  • `arg`   — a client-issued remote query (the route has no
   *              `+page.server.ts`), so the gate sits on the derived query
   *              argument and a below-floor value simply omits it;
   *  • `fetch` — a client `fetch()` of an API route, gated at the call;
   *  • `hold`  — the query is issued by `+page.server.ts` on navigation, so a
   *              below-floor value must not enter the URL AND must not clear an
   *              active one (holding, not clearing — otherwise dropping the
   *              param navigates, which re-renders the input from the URL and
   *              empties the box mid-edit).
   *
   * `/discover` splits the two: the PAGE owns the URL write (`gateSearchQuery`)
   * and `DiscoverFilters` owns the hold, because `updateFilters` also carries
   * type and sort changes and a blanket early return there would make every
   * drawer facet a silent no-op for anyone on a hand-typed `?q=Bo`.
   */
  const GATED_SURFACES: { file: string; shape: 'arg' | 'fetch' | 'hold' }[] = [
    { file: 'routes/_org/[slug]/studio/content/+page.svelte', shape: 'arg' },
    { file: 'routes/_org/[slug]/studio/customers/+page.svelte', shape: 'arg' },
    { file: 'routes/_org/[slug]/(space)/explore/+page.svelte', shape: 'hold' },
    { file: 'routes/(platform)/discover/+page.svelte', shape: 'arg' },
    { file: 'lib/components/discover/DiscoverFilters.svelte', shape: 'hold' },
    { file: 'routes/_creators/[username]/content/+page.svelte', shape: 'hold' },
    {
      file: 'lib/components/search/CommandPaletteSearch.svelte',
      shape: 'fetch',
    },
    // The tier checklist's title search (Codex-2hxff.91).
    {
      file: 'routes/_org/[slug]/studio/monetisation/tiers/[tierId]/+page.svelte',
      shape: 'hold',
    },
  ];

  for (const { file, shape } of GATED_SURFACES) {
    it(`${file} still calls the gate`, async () => {
      // readFile throws on a moved path, so a stale entry fails loudly rather
      // than vacuously passing.
      const src = await readFile(join(SRC_ROOT, file), 'utf8');
      expect(src).toMatch(/from '@codex\/validation'/);
      expect(src).toMatch(/gateSearchQuery\(|isSearchQueryBelowFloor\(/);
      if (shape === 'hold') {
        expect(src).toMatch(/isSearchQueryBelowFloor\(/);
      } else {
        expect(src).toMatch(/gateSearchQuery\(/);
      }
    });
  }

  it('no client fetches /api/search without gating the query', async () => {
    // The palette is the only caller today, and it is the most expensive
    // search on the platform (org lookup + content + creators per keystroke).
    const callers: string[] = [];
    for (const file of await walk(SRC_ROOT)) {
      const src = await readFile(file, 'utf8');
      if (!src.includes('/api/search')) continue;
      if (file.endsWith(join('routes', 'api', 'search', '+server.ts')))
        continue;
      if (!/gateSearchQuery\(/.test(src))
        callers.push(relative(SRC_ROOT, file));
    }
    expect(callers).toEqual([]);
  });

  /**
   * Surfaces that write a `q` / `search` URL param but reach NO database
   * search, so the floor would only degrade them. Each is excluded with a
   * reason AND a self-check below, so the exclusion cannot quietly become
   * wrong if the surface starts hitting the API.
   */
  const CLIENT_ONLY_SEARCH = [
    // Filters the CURRENT page's media items in memory (`filteredItems`);
    // `mediaQuerySchema` has no `search` field, so nothing is sent.
    'lib/components/studio/StudioMediaPage.svelte',
    // Filters the hydrated TanStack DB library collection in memory; the web
    // client never sends `search` to `getUserLibrary`.
    'routes/(platform)/library/+page.svelte',
  ] as const;

  it('no client navigates a `?q=` / `?search=` param without gating it', async () => {
    // This is the assertion that caught the command palette: its live fetch was
    // gated, but Enter-to-see-all-results still `goto`'d `/discover?q=Bo`,
    // whose `+page.server.ts` issued the very scan the gate had just refused.
    const gated = new Set(GATED_SURFACES.map(({ file }) => file));
    const clientOnly = new Set<string>(CLIENT_ONLY_SEARCH);
    const bypasses: string[] = [];

    for (const file of await walk(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      if (rel.endsWith('.server.ts') || rel.endsWith('+server.ts')) continue;
      // Remote functions forward an already-gated value to the worker.
      if (rel.startsWith(join('lib', 'remote'))) continue;
      if (gated.has(rel) || clientOnly.has(rel)) continue;

      const src = await readFile(file, 'utf8');
      if (!writesSearchParam(src)) continue;
      if (!/gateSearchQuery\(|isSearchQueryBelowFloor\(/.test(src)) {
        bypasses.push(rel);
      }
    }

    expect(bypasses).toEqual([]);
  });

  it('the param-writer detector sees every shape apps/web uses (calibration)', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a SOURCE sample that contains a template literal
    expect(writesSearchParam('goto(`/discover?q=${term}`)')).toBe(true);
    expect(writesSearchParam("params.set('search', term)")).toBe(true);
    expect(writesSearchParam('goto(filterHref(page.url, { q: term }))')).toBe(
      true
    );
    expect(
      writesSearchParam('applyFilterPatch(url, {\n  sort,\n  search: term,\n})')
    ).toBe(true);
    expect(writesSearchParam('goto(filterHref(page.url, { q }))')).toBe(true);
    expect(writesSearchParam("setUrlParam('search', term)")).toBe(true);
    // Negatives: other params.
    expect(writesSearchParam("params.set('status', s)")).toBe(false);
    expect(writesSearchParam('goto(filterHref(page.url, { status: s }))')).toBe(
      false
    );
    // Not asserted either way: a computed key (`{ [key]: value }`), which the
    // studio pages use inside setUrlParam. It is a KNOWN GAP (see
    // writesSearchParam), not correct behaviour; the literal-key call above is
    // what catches a `setUrlParam('search', …)` added to one of those pages.
  });

  it('the helper-patch detector sees the REAL filterHref writer (calibration on source)', async () => {
    // Strings alone prove the regex, not that it meets the code: the media
    // page writes `q` through filterHref, so the detector must see it. When
    // that page stops writing `q` (E1.6 replaces it), point this at the file
    // that does.
    const src = await readFile(join(SRC_ROOT, CLIENT_ONLY_SEARCH[0]), 'utf8');
    expect(HELPER_PATCH_KEY.test(src)).toBe(true);
  });

  for (const rel of CLIENT_ONLY_SEARCH) {
    it(`${rel} is exempt because its search never reaches the API`, async () => {
      const src = await readFile(join(SRC_ROOT, rel), 'utf8');
      // The self-check: an in-memory filter must exist, and no `search` (or
      // `q`) may be put on an outbound URLSearchParams from here. If either
      // flips, the exemption fails rather than silently covering a real DB
      // search. The API side of these surfaces is pinned separately — a
      // `search` field could only reach the worker through a schema, and the
      // declaration sweep above proves every one of those is now built by
      // `createSearchQuerySchema`.
      expect(src).toMatch(/\.filter\(/);
      expect(src).not.toMatch(
        /(?:searchParams|params)\.set\(\s*['"]search['"]/
      );
      // The same check for the helper-patch shape: `filterHref(…, { search })`
      // must not slip past the `params.set` form above.
      expect(src).not.toMatch(
        /\b(?:filterHref|applyFilterPatch)\([^;]*?\{[^}]*?\bsearch\b\s*[:,}]/
      );
    });
  }

  it('reads the search URL param nowhere else without gating it', async () => {
    // `searchParams.get('search' | 'q')` in CLIENT code is the shape that must
    // go through the gate. `.server.ts` files are exempt on purpose: they are
    // the server side, where the contract is explicit that a 1-2 character
    // search still returns 200. Pagination base-URL builders and SEO
    // canonicals read `data.*`, i.e. an already-gated value, so they never
    // match this pattern.
    const gatedFiles = new Set(
      GATED_SURFACES.map(({ file }) => join(SRC_ROOT, file))
    );
    const ungated: string[] = [];

    for (const file of await walk(join(SRC_ROOT, 'routes'))) {
      if (gatedFiles.has(file)) continue;
      if (file.endsWith('.server.ts') || file.endsWith('+server.ts')) continue;
      const src = await readFile(file, 'utf8');
      if (!/searchParams\.get\(\s*['"](?:search|q)['"]\s*\)/.test(src))
        continue;
      ungated.push(relative(SRC_ROOT, file));
    }

    expect(ungated).toEqual([]);
  });
});
