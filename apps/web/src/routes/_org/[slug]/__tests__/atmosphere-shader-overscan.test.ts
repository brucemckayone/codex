// @vitest-environment node
/**
 * The org shader's overscan on a blurred "Moving background" page
 * (landing-builder 03 §5.1, Codex-61zsk.25).
 *
 * Off the landing page the layout blurs its fixed, window-sized shader box
 * with `filter: blur()`, which averages in the transparent pixels beyond the
 * box: within twice the radius of each edge the page's background shows
 * through. Under the usual 80% cover nobody sees it; an `atmosphere` section
 * clears that cover, and the fade showed round the section as a pale frame.
 * So on such a page the canvas runs twice the blur radius past every edge.
 *
 * Pinned here:
 *   1. the overscan exists only under the atmosphere gate, so no other org
 *      page changes (a sharp atmosphere has no blur, so no fade either);
 *   2. it is written in the blur's own token, so a new radius moves it;
 *   3. it enlarges the CANVAS's box, never the shader box: ShaderHero sizes
 *      its drawing buffer (and its mobile resolution cap) from that box, so
 *      the frame the GPU renders every tick is unchanged.
 *
 * A SOURCE test, the weaker instrument (this layout has no render harness):
 * it proves the rules, not the paint. The paint was measured in the browser:
 * on Clean over Bloom, the outer 16px ring sat +0.048 L above the band 160px
 * in at 1440 (light) and +0.000 after. Read with svelte's own parser, which
 * drops the style block's comments.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

type CssNode = {
  type: string;
  property?: string;
  value?: string;
  prelude?: { start: number; end: number } | string;
  block?: { children: CssNode[] } | null;
};

const LAYOUT = join(import.meta.dirname, '..', '+layout.svelte');
const SHADER = '.shader-hero--fullpage';
/** The gate's parts, compared with every space removed (formatting is free). */
const GATE = [
  '.org-layout[data-hero-shader-active]',
  ':not(.org-layout--landing)',
  ":has(:global(.lp[data-lp-atmosphere]:not([data-lp-atmosphere='sharp'])))",
];
/** What places or sizes the shader box or its canvas. */
const GEOMETRY = [
  'overflow',
  'inset',
  'width',
  'height',
  'max-width',
  'margin',
  'object-fit',
  'transform',
  'scale',
  'translate',
];

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function rulesOf(source: string) {
  const css = parse(source, { modern: true }).css;
  const rules: { selector: string; decls: Map<string, string> }[] = [];
  const visit = (children: CssNode[]) => {
    for (const node of children) {
      if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const decls = new Map<string, string>();
        for (const d of node.block?.children ?? [])
          if (d.type === 'Declaration')
            decls.set(d.property ?? '', squash(d.value ?? ''));
        rules.push({
          selector: squash(source.slice(node.prelude.start, node.prelude.end)),
          decls,
        });
      }
      visit(node.block?.children ?? []);
    }
  };
  visit((css?.children ?? []) as unknown as CssNode[]);
  return rules;
}

const rules = rulesOf(readFileSync(LAYOUT, 'utf8'));
const gated = (selector: string) =>
  GATE.every((part) => selector.replace(/\s+/g, '').includes(part));
const shaderRules = rules.filter(({ selector }) => selector.includes(SHADER));
const geometryRules = shaderRules.filter(({ decls }) =>
  GEOMETRY.some((p) => decls.has(p))
);
/** The rule that fixes the shader box to the window. */
const base = shaderRules.find(
  ({ selector }) => selector === `:global(${SHADER})`
);
const box = geometryRules.find(
  ({ selector }) => gated(selector) && selector.endsWith(`:global(${SHADER})`)
);
const canvas = geometryRules.find(
  ({ selector }) =>
    gated(selector) && selector.endsWith(`:global(${SHADER} canvas)`)
);
const blur = shaderRules.find(({ decls }) =>
  decls.get('filter')?.startsWith('blur(')
);

describe('the org shader on a blurred Moving-background page', () => {
  it('keeps the shader box the window everywhere', () => {
    expect(base?.decls.get('inset')).toBe('0 !important');
    expect(base?.decls.get('position')).toBe('fixed !important');
  });

  it('overscans the canvas only under the atmosphere gate', () => {
    expect(box, 'the gated shader-box rule').toBeDefined();
    expect(canvas, 'the gated canvas rule').toBeDefined();
    // Every other rule that places or sizes the shader is the base rule.
    const ungated = geometryRules.filter(
      (r) => r !== base && !gated(r.selector)
    );
    expect(ungated.map((r) => r.selector)).toEqual([]);
  });

  it('lets the canvas out of the shader box without resizing the box', () => {
    expect(box!.decls.get('overflow')).toBe('visible');
    for (const p of GEOMETRY.filter((g) => g !== 'overflow'))
      expect(box!.decls.has(p), `the shader box must not set ${p}`).toBe(false);
  });

  it('runs the canvas twice the blur radius past every edge, in the blur’s own token', () => {
    const token = blur?.decls
      .get('filter')
      ?.match(/^blur\(var\((--[\w-]+)\)\)$/)?.[1];
    expect(token, 'the blur is written in a token').toBeDefined();
    const d = canvas!.decls;
    expect(d.get('width')).toBe(`calc(100% + 4 * var(${token}))`);
    expect(d.get('height')).toBe(`calc(100% + 4 * var(${token}))`);
    expect(d.get('margin')).toBe(`calc(-2 * var(${token}))`);
    // reset.css caps every canvas at `max-width: 100%`.
    expect(d.get('max-width')).toBe('none');
    // One scale for both axes: the shader keeps its aspect, the crop is off screen.
    expect(d.get('object-fit')).toBe('cover');
  });
});
