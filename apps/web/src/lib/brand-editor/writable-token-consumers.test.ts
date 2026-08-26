import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND_PREFIX_KEYS } from './css-injection';

/**
 * WP-0.1 guard — every CSS-derived editor-writable token must have a real consumer.
 *
 * The brand editor lets an org write `--brand-{key}` inputs (enumerated by
 * BRAND_PREFIX_KEYS in css-injection.ts). `org-brand.css` derives the
 * consumer-facing tokens from those inputs, e.g.
 *   `--color-heading: var(--brand-heading-color, …)`
 * A derived token is only useful if a COMPONENT actually reads it via `var()`.
 * Otherwise the editor control is a dead knob — which is exactly the bug WP-0.1
 * fixes: `--color-heading` was derived from the "Heading Color" control but no
 * card/content title consumed it (class selectors like `.cc__title` /
 * `.card-title` outranked the `[data-org-brand] :is(h1..h6)` rule once Svelte
 * added its scoping class), so the heading colour was invisible on the product.
 *
 * This test derives the canonical set of CSS-derived, editor-writable consumer
 * tokens PROGRAMMATICALLY — BRAND_PREFIX_KEYS × the derivations parsed out of
 * org-brand.css — with no hardcoded token list, then asserts each one has ≥1
 * `var(--token)` reference somewhere in `apps/web/src` OUTSIDE the brand
 * editor's own files and OUTSIDE the derivation file (org-brand.css). Any
 * orphan fails the test with a clear list.
 *
 * Scope: CSS-derived tokens only. Shader/hero keys that ShaderHero reads via
 * `getComputedStyle('--brand-shader-*')` are a different (JS) consumption model
 * and are intentionally out of scope here.
 */

const HERE = dirname(fileURLToPath(import.meta.url)); // …/src/lib/brand-editor
const SRC_DIR = resolve(HERE, '../..'); // …/src
const ORG_BRAND_CSS = join(SRC_DIR, 'lib', 'styles', 'tokens', 'org-brand.css');

// ── Parse org-brand.css: build the editor-input → consumer-token map ────────
const cssText = readFileSync(ORG_BRAND_CSS, 'utf8');

// Custom-property DECLARATIONS only: `--foo: <rhs>;` (a real CSS property such
// as `color: var(--color-heading)` is NOT a declaration and is skipped — that
// distinction is what keeps --color-heading OUT of `intermediateTokens`).
const DECL_RE = /(--[\w-]+)\s*:\s*([^;]*);/g;

// Tokens referenced on the RHS of a custom-property declaration are
// "intermediate": they feed another token INSIDE org-brand.css rather than a
// component (e.g. --text-scale → --text-*, --heading-weight → --font-bold,
// --font-sans → --font-body). They are not component-facing consumer tokens, so
// they must not be asserted as needing a component consumer.
const intermediateTokens = new Set<string>();
// brand key (bare, e.g. "heading-color") → consumer tokens it derives.
const derivedByKey = new Map<string, Set<string>>();

for (const decl of cssText.matchAll(DECL_RE)) {
  const lhs = decl[1];
  const rhs = decl[2];
  for (const ref of rhs.matchAll(/var\(\s*(--[\w-]+)/g)) {
    intermediateTokens.add(ref[1]);
  }
  for (const ref of rhs.matchAll(
    /var\(\s*--brand-([\w-]+?)(?:-dark)?\s*[,)]/g
  )) {
    const key = ref[1];
    if (!BRAND_PREFIX_KEYS.has(key)) continue;
    let set = derivedByKey.get(key);
    if (!set) {
      set = new Set();
      derivedByKey.set(key, set);
    }
    set.add(lhs);
  }
}

// Canonical set: consumer tokens derived from an editor `--brand-{key}` input,
// minus intermediates that org-brand.css consumes internally.
const canonicalTokens = [
  ...new Set([...derivedByKey.values()].flatMap((set) => [...set])),
]
  .filter((token) => !intermediateTokens.has(token))
  .sort();

// ── Collect candidate consumer files across src ────────────────────────────
function isEditorOrDerivationFile(path: string): boolean {
  // The editor's own files (store dir `lib/brand-editor` AND panel components
  // `lib/components/brand-editor`) and the derivation file itself never count
  // as product consumers.
  return (
    path.split(sep).includes('brand-editor') ||
    path.endsWith(join('tokens', 'org-brand.css'))
  );
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    // Skip node_modules and dotfiles/dirs (.svelte-kit, .turbo, …).
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(svelte|css|ts)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      // Skip test files — a token referenced only in a test is not a real
      // product consumer (and avoids this guard file satisfying itself).
      out.push(full);
    }
  }
}

const allFiles: string[] = [];
walk(SRC_DIR, allFiles);
const consumerFiles = allFiles.filter((f) => !isEditorOrDerivationFile(f));

function hasConsumer(token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `var(--token` with a trailing boundary so `--x` never matches `--x-y`
  // (e.g. --color-player-text must not be satisfied by --color-player-text-muted).
  const re = new RegExp(`var\\(\\s*${esc}(?![\\w-])`);
  return consumerFiles.some((file) => re.test(readFileSync(file, 'utf8')));
}

describe('brand-editor writable tokens have real consumers', () => {
  it('derives a non-empty canonical set from the editor config + org-brand.css', () => {
    expect(canonicalTokens.length).toBeGreaterThan(0);
    // The WP-0.1 target: editor writes --brand-heading-color; org-brand.css
    // derives --color-heading. It MUST appear in the canonical set, else the
    // derivation-parsing logic has drifted and the guard would be toothless.
    expect(canonicalTokens).toContain('--color-heading');
    // Vestigial tokens must never resurface as editor-writable consumer tokens.
    expect(canonicalTokens).not.toContain('--color-text-heading');
    expect(canonicalTokens.filter((t) => t.startsWith('--card-media'))).toEqual(
      []
    );
  });

  it('the orphan-detection mechanism can fail (a non-existent token has no consumer)', () => {
    // Proves hasConsumer() genuinely returns false for an unconsumed token, so
    // the orphan assertion below is a real gate rather than a vacuous pass.
    expect(hasConsumer('--codex-guard-token-that-should-not-exist')).toBe(
      false
    );
  });

  it('--color-heading is consumed by a component (WP-0.1 fix)', () => {
    expect(hasConsumer('--color-heading')).toBe(true);
  });

  it('every CSS-derived editor-writable token has ≥1 consumer outside the editor + org-brand.css', () => {
    const orphans = canonicalTokens.filter((token) => !hasConsumer(token));
    expect(
      orphans,
      `Orphan editor-writable tokens — derived in org-brand.css from a brand-editor input but no component reads them via var(). Either wire a consumer or drop the control:\n  ${orphans.join('\n  ')}`
    ).toEqual([]);
  });
});
