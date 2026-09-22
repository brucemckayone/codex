import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * The ORG layout's footer must not link legal pages relatively. (Codex-6wkr1)
 *
 * The two footers in this app need OPPOSITE treatments, and conflating them is
 * what this file and `Footer.svelte.test.ts` exist to prevent:
 *
 *   routes/_org/[slug]/+layout.svelte  — renders on a TENANT host, which
 *     `hooks.ts` REWRITES to `/_org/<slug>/terms`. That route does not exist,
 *     so a relative href 404s. It MUST use `buildPlatformUrl`.
 *
 *   lib/components/ui/Layout/Footer.svelte — mounted only by `(platform)`,
 *     reachable on the apex and on RESERVED subdomains, where `hooks.ts`
 *     returns the path UNREWRITTEN. A relative href is correct, and an absolute
 *     one sends a `staging.revelations.studio` viewer to PRODUCTION. It MUST
 *     stay relative. Pinned in `Footer.svelte.test.ts`; asserted here too so
 *     the distinction is visible from both sides.
 *
 * WHY THIS IS A SOURCE TEST AND NOT A RENDER TEST. `_org/[slug]/+layout.svelte`
 * is ~900 lines with brand-token injection, ShaderHero, collection hydration,
 * progress sync and MobileBottomNav; the repo has no render harness for it (its
 * only existing test, `layout.server.test.ts`, is server-side). Standing one up
 * to assert three hrefs is disproportionate. It is the weaker instrument and
 * says so: it proves the markup, not the rendered output. `Footer.svelte` DOES
 * get a render test, being the one footer that renders cheaply.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is load-bearing rather than tidiness:
 * both files' explanatory comments contain the literal string `/terms`, so a
 * scan of raw source would match the prose and pass while the markup regressed.
 * Stripping also stops a commented-out link from hiding.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

/** Strip block and line comments so prose cannot satisfy or mask an assertion. */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function codeOf(relative: string): string {
  return stripComments(readFileSync(join(ROOT, relative), 'utf8'));
}

describe('the two footers need opposite treatments (Codex-6wkr1)', () => {
  const ORG_LAYOUT = 'src/routes/_org/[slug]/+layout.svelte';
  const PLATFORM_FOOTER = 'src/lib/components/ui/Layout/Footer.svelte';

  test('ORG layout has no relative legal href', () => {
    // The real 404: a tenant host rewrites these to /_org/<slug>/... which
    // does not exist.
    const code = codeOf(ORG_LAYOUT);
    for (const path of ['/about', '/terms', '/privacy']) {
      expect(code).not.toMatch(
        new RegExp(`href=["']${path}["']`.replace(/\//g, '\\/'))
      );
    }
  });

  test('ORG layout builds them with buildPlatformUrl', () => {
    // The positive half. Without it, deleting the links entirely would satisfy
    // the negative assertion above.
    const code = codeOf(ORG_LAYOUT);
    expect(code).toMatch(/buildPlatformUrl\(page\.url, '\/about'\)/);
    expect(code).toMatch(/buildPlatformUrl\(page\.url, '\/terms'\)/);
    expect(code).toMatch(/buildPlatformUrl\(page\.url, '\/privacy'\)/);
  });

  test('PLATFORM footer keeps them RELATIVE (the inverse)', () => {
    // Deliberately the opposite of the org layout. An absolute apex URL here
    // sends a staging.revelations.studio viewer to production, because
    // isReservedSubdomain('staging') is true and hooks.ts leaves the path
    // unrewritten — so (platform)/terms renders in place on that host.
    const code = codeOf(PLATFORM_FOOTER);
    expect(code).toMatch(/href="\/about"/);
    expect(code).toMatch(/href="\/terms"/);
    expect(code).toMatch(/href="\/privacy"/);
    expect(code).not.toMatch(/buildPlatformUrl/);
  });

  test('the comment-stripper actually strips (control)', () => {
    // Control for the instrument itself: proves stripComments removes a comment
    // containing the very string the assertions look for. Both source files now
    // carry such a comment, so without this every test above could pass or fail
    // on prose alone.
    const withComment = `// href="/terms" in a comment\n<a href={x}>y</a>`;
    expect(stripComments(withComment)).not.toMatch(/href="\/terms"/);
    expect(stripComments(withComment)).toMatch(/href=\{x\}/);
  });

  test('both source files were actually read (control)', () => {
    // Control against this test type's characteristic silent failure: a wrong
    // ROOT would throw, but an empty read would make every `not.toMatch` pass
    // vacuously.
    for (const file of [ORG_LAYOUT, PLATFORM_FOOTER]) {
      expect(codeOf(file).length).toBeGreaterThan(500);
    }
  });
});
