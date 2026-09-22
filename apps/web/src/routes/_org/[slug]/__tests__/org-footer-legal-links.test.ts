import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * The org layout's footer must not link legal pages relatively. (Codex-6wkr1)
 *
 * `/about`, `/terms` and `/privacy` exist ONLY in the `(platform)` route group.
 * This layout renders on a TENANT host, where `hooks.ts` rewrites a relative
 * `/terms` to `/_org/<slug>/terms` — and `routes/_org/[slug]/` has no such
 * route — so all three 404'd on every org subdomain.
 *
 * WHY THIS IS A SOURCE TEST AND NOT A RENDER TEST. `_org/[slug]/+layout.svelte`
 * is ~900 lines with brand-token injection, ShaderHero, collection hydration,
 * progress sync and MobileBottomNav; the repo has no render harness for it (its
 * only existing test, `layout.server.test.ts`, is server-side). Standing one up
 * to assert three href strings is disproportionate, so this asserts the source
 * instead — and states plainly that it is the weaker instrument:
 *   - it cannot prove the rendered output, only the markup that produces it;
 *   - it is why `Footer.svelte.test.ts` DOES render, for the one footer that can
 *     be rendered cheaply. Between them both footers are covered.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is load-bearing rather than tidiness:
 * the fix's own explanatory comment in each file contains the literal string
 * `/terms`, so a scan of raw source would match the comment and pass while the
 * markup regressed. Stripping also stops a commented-out link from hiding.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

const FOOTER_FILES = [
  'src/routes/_org/[slug]/+layout.svelte',
  'src/lib/components/ui/Layout/Footer.svelte',
] as const;

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

describe('footers must not link legal pages relatively (Codex-6wkr1)', () => {
  for (const file of FOOTER_FILES) {
    test(`${file} has no relative legal href`, () => {
      const code = codeOf(file);
      for (const path of ['/about', '/terms', '/privacy']) {
        // Matches href="/terms" and href='/terms' — the shape that 404s.
        expect(code).not.toMatch(
          new RegExp(`href=["']${path}["']`.replace(/\//g, '\\/'))
        );
      }
    });

    test(`${file} builds them with buildPlatformUrl`, () => {
      // The positive half. Without it, deleting the links entirely would pass
      // the negative assertion above.
      const code = codeOf(file);
      expect(code).toMatch(/buildPlatformUrl\(page\.url, '\/about'\)/);
      expect(code).toMatch(/buildPlatformUrl\(page\.url, '\/terms'\)/);
      expect(code).toMatch(/buildPlatformUrl\(page\.url, '\/privacy'\)/);
    });
  }

  test('the comment-stripper actually strips (control)', () => {
    // Control for the instrument itself: proves stripComments removes a
    // comment containing the very string the assertions look for. If this
    // regressed, every test above could pass on prose alone.
    const withComment = `// href="/terms" in a comment\n<a href={x}>y</a>`;
    expect(stripComments(withComment)).not.toMatch(/href="\/terms"/);
    expect(stripComments(withComment)).toMatch(/href=\{x\}/);
  });

  test('both source files were actually read (control)', () => {
    // Control against the silent failure this kind of test is prone to: a wrong
    // ROOT path would make readFileSync throw, but a mis-scoped glob elsewhere
    // could yield empty strings and every `not.toMatch` would pass vacuously.
    for (const file of FOOTER_FILES) {
      expect(codeOf(file).length).toBeGreaterThan(500);
    }
  });
});
