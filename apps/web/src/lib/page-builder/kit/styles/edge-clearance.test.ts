/**
 * What sits at a section's foot keeps clear of the next section's edge
 * (03 X64, Codex-61zsk.53). In a Style whose sections rise into the one above
 * along an edge (a curve, an angle: `surfaces.css`), the next section covers
 * the foot to the edge's depth, `--_edge-d`. A full-width picture runs to its
 * band's foot and a Break has no padding at all, so each reserves that depth,
 * read by name: a rename in `surfaces.css` would quietly make both reserve
 * nothing. Measured in a browser (Soft and Poster at 1440 and 390), a marked
 * Break's mark sat up to 18px under the next section's cut before it did.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (path: string) =>
  readFileSync(join(DIR, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the rule whose selector is exactly `selector`. */
function body(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `a rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe("what sits at a section's foot keeps clear of the next section's edge", () => {
  const surfaces = read('surfaces.css');
  const kit = read('kit.css');

  it('names the depth each edge rises by, and rises by it', () => {
    expect(surfaces.match(/--_edge-d:\s*min\(/g)).toHaveLength(2);
    expect(body(surfaces, '.lp-section + .lp-section')).toContain(
      'margin-block-start: calc(-1 * var(--_edge-d, 0px));'
    );
  });

  it("a full-width picture's foot is the edge's depth", () => {
    expect(
      body(kit, ".lp-section[data-lp-type='picture'][data-lp-layout='full']")
    ).toContain('--lp-pad-end: var(--_edge-d, 0px);');
  });

  it("a marked Break centres its mark above the edge's depth, inside its one step", () => {
    expect(
      body(kit, ".lp-section[data-lp-type='break'] .lp-break[data-mark]")
    ).toContain('padding-block-end: var(--_edge-d, 0px);');
    // The padding sits inside the step, not on top of it.
    expect(read('../blocks/break/BreakBlock.svelte')).toMatch(
      /\.lp-break \{[^}]*block-size: var\(--lp-pad\);/
    );
  });
});
