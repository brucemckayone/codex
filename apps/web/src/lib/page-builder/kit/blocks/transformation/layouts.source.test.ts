// @vitest-environment node
/**
 * What the transformation's layouts draw that jsdom cannot (03 X55).
 *
 *   1. The toggle's switch is for a phone-width section only, and "phone
 *      width" is the columns' own breakpoint: the flag the toggle reads
 *      (`--_phone`) is set under exactly the complement of the query that sets
 *      the columns side by side, so the two can never drift apart.
 *   2. Side by side, the after lines are the loudest thing in the section:
 *      the display face at title size, over the before side's body lines.
 *   3. A toggle drawn as the columns is the columns in every Style's own
 *      treatment too: Soft centres its head over either.
 *
 * A SOURCE test, the weaker instrument: it proves the rules, not the paint.
 * The paint is measured in a browser by `e2e/page-kit/type-rank.spec.ts`.
 * Read with svelte's own parser, which drops the style block's comments.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { componentRules } from '../testing';

const rulesOf = (file: string) =>
  componentRules(join(import.meta.dirname, file));

const columns = rulesOf('ChangeColumns.svelte');
const toggle = rulesOf('ChangeToggle.svelte');
const block = rulesOf('TransformationBlock.svelte');

describe('the transformation layouts', () => {
  it('flags phone width under exactly the complement of the columns’ side-by-side query', () => {
    const sideBySide = columns.filter(
      (r) =>
        r.selector === '.tf-cols' &&
        r.decls.get('grid-template-columns')?.startsWith('repeat(2,')
    );
    expect(sideBySide).toHaveLength(1);
    const [query] = sideBySide[0].within;
    expect(query).toMatch(/^@container \(min-width: [\d.]+rem\)$/);

    const flags = toggle.filter((r) => r.decls.has('--_phone'));
    expect(flags).toHaveLength(1);
    expect(flags[0].selector).toBe('.tf-toggle');
    expect(flags[0].decls.get('--_phone')).toBe('1');
    expect(flags[0].within).toEqual([
      query.replace('@container (', '@container not ('),
    ]);
  });

  it('sets the after lines in the display face at title size, over body-size before lines', () => {
    const line = columns.find(
      (r) => r.selector === 'li' && r.within.length === 0
    );
    expect(line?.decls.get('font-size')).toBe('var(--lp-size-body)');
    const after = columns.filter(
      (r) => r.selector === ".tf-col[data-side='after'] li"
    );
    expect(after).toHaveLength(1);
    expect(after[0].within).toEqual([]);
    expect(after[0].decls.get('font-family')).toBe('var(--lp-font-display)');
    expect(after[0].decls.get('font-size')).toBe('var(--lp-size-title)');
    // No rule raises the before lines to the after's size.
    expect(
      columns.filter(
        (r) =>
          r.selector.includes("[data-side='before']") &&
          r.decls.has('font-size')
      )
    ).toEqual([]);
  });

  it('centres a Soft head over a toggle drawn as the columns, as over the columns', () => {
    const centred = block.filter(
      (r) =>
        r.selector.includes("data-lp-style='soft'") &&
        (r.decls.get('justify-items') === 'center' ||
          r.decls.get('--lp-actions-align') === 'center' ||
          r.decls.get('justify-self') === 'center') &&
        r.selector.includes("[data-layout='columns']")
    );
    // The actions, the head and the eyebrow.
    expect(centred).toHaveLength(3);
    for (const rule of centred)
      expect(rule.selector).toContain(
        "[data-layout='toggle']:has(:global(.tf-cols))"
      );
  });
});
