// @vitest-environment node
/**
 * Layered stages' rule and label in each Style (Codex-61zsk.55), in the rules
 * jsdom cannot run:
 *
 *   1. the rule above a stage is the stage's first row, on the content
 *      column, which the layout places and never draws: a row it drew would
 *      take a gap in every Style, rule or none;
 *   2. Studio draws a hairline there and Bold its ink rule, and no other
 *      Style draws one (Soft's stages are set apart by space alone);
 *   3. the stage's number is drawn with the eyebrow's dials, so it is a chip
 *      exactly where a Style fills its eyebrow.
 *
 * A SOURCE test, the weaker instrument: the gallery shows the three Styles at
 * `/studio/page-kit?layout=curriculum:layered`.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_STYLE_IDS } from '../../model/ids';
import { componentRules, sheetRules } from '../testing';

const STYLES = join(import.meta.dirname, '..', '..', 'styles');
const layers = componentRules(join(import.meta.dirname, 'StageLayers.svelte'));
const RULE = '.layers__stage::before';

/** Every rule in a Style's sheets whose selector ends on the stage's row. */
const styleRows = (id: string) =>
  readdirSync(STYLES)
    .filter(
      (name) => name === `style-${id}.css` || name.startsWith(`style-${id}-`)
    )
    .flatMap((name) => sheetRules(join(STYLES, name)))
    .filter((r) => r.selector.endsWith(RULE));

describe('layered stages in each Style', () => {
  it('places the rule’s row on the content column and gives it no content', () => {
    const row = layers.filter((r) => r.selector === RULE);
    expect(row).toHaveLength(1);
    expect(row[0].decls.get('grid-column')).toBe('content');
    expect(row[0].decls.has('content')).toBe(false);
    expect(row[0].decls.has('border-block-start')).toBe(false);
  });

  it('draws Studio’s hairline and Bold’s ink rule over a stage', () => {
    const studio = styleRows('studio');
    expect(studio).toHaveLength(1);
    expect(studio[0].decls.get('content')).toBe("''");
    expect(studio[0].decls.get('border-block-start')).toBe(
      'var(--border-width) var(--border-style) var(--lp-line)'
    );

    const bold = styleRows('bold');
    expect(bold).toHaveLength(1);
    expect(bold[0].decls.get('content')).toBe("''");
    expect(bold[0].decls.get('border-block-start')).toBe(
      'var(--lp-rule) var(--border-style) var(--lp-ink)'
    );
  });

  it('draws no rule over a stage in any other Style', () => {
    const others = PAGE_STYLE_IDS.filter(
      (id) => id !== 'studio' && id !== 'bold'
    );
    expect(others).toContain('soft');
    for (const id of others) expect(styleRows(id), id).toEqual([]);
  });

  it('draws the stage’s number with the eyebrow’s dials', () => {
    const number = layers.find((r) => r.selector === '.layers__number');
    expect(number?.decls.get('padding')).toBe('var(--lp-eyebrow-pad)');
    expect(number?.decls.get('border-radius')).toBe('var(--lp-eyebrow-radius)');
    expect(number?.decls.get('background')).toBe(
      'color-mix( in oklab, var(--lp-panel) calc(var(--lp-eyebrow-fill) * 100%), transparent )'
    );
  });
});
