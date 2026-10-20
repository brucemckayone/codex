// @vitest-environment node
/**
 * The org layout's shader-backed page rules never watch the page editor
 * (Codex-61zsk.21).
 *
 * Those rules key on `:has(.lp[data-lp-atmosphere])` at this layout's root,
 * for a live sales page with a Moving background. The page editor draws a
 * page, and a thumbnail of it per Style, under the same root, so with the
 * rules live every page added or taken away under it had the browser
 * re-match the `:has()` and restyle the whole page: measured on a 28-section
 * page, a Page-tab switch spent 153-245ms restyling, 24-103ms with the gate.
 *
 * Nothing shows it: the result is the same, only slower. So each rule's gate
 * is held here: two classes (the studio, and the page kit's gallery, which
 * stands in for a live page), in the rule's own compound and BEFORE its
 * `:has()`. A compound that fails first never reaches the `:has()`; one gated
 * by another `:has()`, or after it, still marks the root to re-match.
 *
 * A SOURCE test: it proves the selectors, not the restyle. The restyle was
 * measured with Chrome's timeline on a production build
 * (`docs/handover/phase3-sources/work-2026-10/t21`, local). Read with
 * svelte's own parser, which drops the style block's comments.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

type CssNode = {
  type: string;
  prelude?: { start: number; end: number } | string;
  block?: { children: CssNode[] } | null;
};

const ROUTE = join(import.meta.dirname, '..');
const LAYOUT = join(ROUTE, '+layout.svelte');
/** The gate, compared with every space removed (formatting is free). */
const GATE = ':is(:not(.org-layout--studio),.org-layout--kit-gallery)';

function selectorsOf(source: string): string[] {
  const css = parse(source, { modern: true }).css;
  const selectors: string[] = [];
  const visit = (children: CssNode[]) => {
    for (const node of children) {
      if (node.type === 'Rule' && typeof node.prelude === 'object')
        selectors.push(source.slice(node.prelude.start, node.prelude.end));
      visit(node.block?.children ?? []);
    }
  };
  visit((css?.children ?? []) as unknown as CssNode[]);
  return selectors;
}

/** A selector's first compound: up to its first combinator outside parens. */
function firstCompound(selector: string): string {
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) return selector.slice(0, i);
  }
  return selector;
}

const source = readFileSync(LAYOUT, 'utf8');
/** The root's compound of every rule that matches a `:has()` on the root. */
const rooted = selectorsOf(source)
  .map((s) => firstCompound(s.trim()).replace(/\s+/g, ''))
  .filter(
    (compound) =>
      compound.startsWith('.org-layout') && compound.includes(':has(')
  );

describe('the org layout’s root :has() rules (Codex-61zsk.21)', () => {
  it('reads the rules it guards', () => {
    expect(rooted.length).toBe(6);
  });

  it('gates each in its own compound, before the :has()', () => {
    const ungated = rooted.filter((s) => {
      const at = s.indexOf(GATE);
      return at < 0 || at > s.indexOf(':has(');
    });
    expect(ungated).toEqual([]);
  });

  it('keeps the gate free of :has()', () => {
    // A `:has()` in the gate marks the root as one to re-match on its own.
    expect(GATE).not.toContain(':has(');
  });

  it('sets the two classes the gate reads, from the route', () => {
    expect(source).toContain('class:org-layout--studio={isStudio}');
    expect(source).toContain('class:org-layout--kit-gallery={isKitGallery}');
    expect(source).toMatch(
      /const isKitGallery = \$derived\(page\.url\.pathname\.startsWith\('\/studio\/page-kit'\)\);/
    );
    // The gallery is where the class says it is.
    expect(existsSync(join(ROUTE, 'studio', 'page-kit', '+page.svelte'))).toBe(
      true
    );
  });
});
