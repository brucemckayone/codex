/**
 * The builder below `lg` — the last dead-end control class in the studio.
 *
 * THE DEFECT THIS PINS. Under `@media (--below-lg)` (max-width 1023px) the route
 * used to set `display: none` on `.jb__outline`, `.jb__settings` AND
 * `.jb__inspector` while leaving all six mode tabs enabled. Measured live at
 * 834x1112 and 390x844 before the change: every tab still reported
 * `aria-pressed="true"` when pressed, `.jb` still flipped `data-mode`, and the
 * panel it selects measured 0x0 with `display: none`. So a creator on a tablet
 * taps "Pricing" and gets nothing — no panel, no message, no hint that the
 * surface exists on a wider screen. Same for Look, Media, Brand, SEO, and for
 * the whole section inspector in Design mode.
 *
 * That is the shape three earlier rounds killed on the PUBLIC page (dead-end
 * CTAs on an unpurchasable course, the decorative SEO fields, the invite card
 * with no offer): a control that accepts the press and does nothing. The fix
 * taken here is the other side of the same rule — make the target REACHABLE
 * rather than disable the tabs — because the canvas is already honest below lg
 * (it renders the chosen device width and states its own scale, "Tablet · 834px
 * · 94%"), so the only thing missing was somewhere to put the panels.
 *
 * WHY SOURCE-TEXT ASSERTIONS. Same reasoning as `builder-top-bar.test.ts` and
 * `builder-canvas-wiring.test.ts` beside it, and it is stronger here: jsdom does
 * no layout and evaluates no media query, so NOTHING about a responsive collapse
 * is observable in it. The behavioural half of this item is a browser
 * measurement at 1440 / 834 / 390 (recorded in the PR), and these assertions are
 * the regression guard that the CSS which made those measurements true is still
 * present. A `display: none` re-added to the below-lg block is exactly the
 * silent regression they catch.
 *
 * WHY THE FULL-BLEED HALF IS HERE TOO (F37). `.jb`, `.jb-loading` and both
 * `.jb-empty` tails are `height: 100dvh` INSIDE `.studio-layout__main`, which is
 * padded and capped — so the builder overflowed its own container by twice the
 * padding (measured: document scrollHeight 948 against clientHeight 900 at a
 * 1440x900 viewport, with the bottom of all three panes below the fold). The
 * escape hatch is an OPT-IN the route asks for (`data-studio-fullbleed` on its
 * root element) which the studio shell honours via `:has(> …)`.
 *
 * The last four assertions guard the two ways this gets "simplified" wrong:
 *   · into a change to the shell's DEFAULT cap and padding, which its own comment
 *     calls the one place the studio content width is decided, and which every
 *     other studio page depends on;
 *   · into the shell handing over a `minmax(0, 1fr)` row so the route can say
 *     `height: 100%` and name no viewport unit. That reads better and does not
 *     work: `.org-main` above the shell is a plain block with auto height, so
 *     `.studio-layout` has only a `min-height`, its `1fr` row sizes to content,
 *     and `height: 100%` is circular. It was tried — measured at a 900px
 *     viewport, the builder grew to 3532px and every pane lost its internal
 *     scroll — so both halves of the pair are pinned, not just the outcome.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');
const STUDIO_LAYOUT = readFileSync(
  join(HERE, '..', '..', '..', '..', '+layout.svelte'),
  'utf8'
);

/**
 * The body of the route's `@media (--below-lg) { … }` block.
 *
 * Brace-counted rather than regex-matched: the block contains nested rules, so
 * `[^}]*` would stop at the first inner `}` and every assertion below would be
 * reading one rule instead of the whole breakpoint.
 */
function belowLgBlock(): string {
  const start = ROUTE.indexOf('@media (--below-lg)');
  if (start === -1)
    throw new Error('no @media (--below-lg) block in the route');
  const open = ROUTE.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < ROUTE.length; i += 1) {
    if (ROUTE[i] === '{') depth += 1;
    else if (ROUTE[i] === '}') {
      depth -= 1;
      if (depth === 0) return ROUTE.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced @media (--below-lg) block');
}

/** One rule body out of a stylesheet, by exact selector text. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector);
  if (at === -1) throw new Error(`rule not found: ${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1)
    throw new Error(`unterminated rule: ${selector}`);
  return css.slice(open + 1, close);
}

/** The four route-root elements — the builder and its three tails. */
const ROUTE_ROOTS = [
  'class="jb"',
  'class="jb-empty" role="alert"',
  'class="jb-empty"',
  'class="jb-loading"',
];

describe('builder shell below lg — the panels are reachable, not hidden', () => {
  it('does not hide the outline, the settings panel or the inspector', () => {
    // The exact defect. Each of these was `display: none` here, under six tabs
    // that stayed enabled.
    const below = belowLgBlock();
    const panels = below.match(
      /\.jb__outline\s*,\s*\.jb__settings\s*,\s*\.jb__inspector\s*\{[^}]*\}/
    );
    expect(panels).not.toBeNull();
    expect(panels?.[0]).not.toMatch(/display\s*:\s*none/);
  });

  it('collapses the three-column grid to one column in every mode', () => {
    // Every mode's shell, Design included, must stop competing for columns it
    // does not have — otherwise a 260px rail and a 360px inspector eat a 390px
    // viewport and the canvas has nothing left.
    const below = belowLgBlock();
    const shell = below.match(/\.jb__shell\s*,[\s\S]*?\{([^}]*)\}/);
    expect(shell).not.toBeNull();
    expect(shell?.[1]).toMatch(
      /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/
    );
    // All five settings modes, so a new mode cannot be added to the desktop
    // list and forgotten here.
    for (const mode of ['look', 'pricing', 'media', 'brand', 'seo']) {
      expect(shell?.[0]).toContain(`.jb[data-mode='${mode}'] .jb__shell`);
    }
  });

  it('puts the panels ABOVE the canvas, so pressing a tab reveals its panel without scrolling', () => {
    // The canvas is DOM-ordered between the two Design-mode panels (outline,
    // canvas, inspector), which is the correct three-column order and the wrong
    // stacking order: the inspector would land below a 70dvh canvas and a tab
    // press would still look inert until you scrolled. `order` on the canvas is
    // what keeps the controls contiguous under the tabs.
    const below = belowLgBlock();
    const canvas = below.match(/\.jb__canvas\s*\{([^}]*)\}/);
    expect(canvas).not.toBeNull();
    expect(canvas?.[1]).toMatch(/order\s*:\s*3/);
  });

  it('gives the canvas a definite height, so its stage keeps its own scroll', () => {
    // `.jbc__stage` is `overflow: auto` and only scrolls against a definite
    // height. Below lg `.jb` is no longer `100dvh` (it cannot be — the studio
    // top bar sits above it at these widths), so without an explicit height the
    // canvas band grows to the whole scaled page: measured 834/tablet at 94%,
    // that is a band thousands of pixels tall with no internal scroll.
    const below = belowLgBlock();
    const canvas = below.match(/\.jb__canvas\s*\{([^}]*)\}/);
    expect(canvas?.[1]).toMatch(/height\s*:\s*\d+(\.\d+)?dvh/);
  });

  it('lets the mode tabs wrap, so no tab is clipped out of reach', () => {
    // Measured at 390: `.jb__modes` scrollWidth 466 against clientWidth 358 with
    // `overflow-x: visible`, inside a shell that is `overflow-x: clip` — so
    // Brand was cut mid-word and SEO could not be reached at all. A tab you
    // cannot press is the same defect as a tab that does nothing.
    const below = belowLgBlock();
    const modes = below.match(/\.jb__modes\s*\{([^}]*)\}/);
    expect(modes).not.toBeNull();
    expect(modes?.[1]).toMatch(/flex-wrap\s*:\s*wrap/);
    // A fixed `height` would clip the second row — the same mistake the top
    // bar's own comment records ("a fixed height is what clipped the wrapped
    // action labels"). The base rule sets one, so it has to be released to
    // `auto` here AND replaced by a floor.
    expect(modes?.[1]).toMatch(/min-height\s*:/);
    expect(modes?.[1]).toMatch(/[;{\s]height\s*:\s*auto/);
    expect(modes?.[1]).not.toMatch(/[;{\s]height\s*:\s*(\d|var\()/);
  });

  it('caps each panel band, so the canvas stays about one screen below the tabs', () => {
    // Without a cap the band grows to its content in a content-sized row:
    // measured at 834 in Design mode with the hero selected, the inspector was
    // 3146px tall and the canvas started 3649px down the page.
    const below = belowLgBlock();
    const panels = below.match(
      /\.jb__outline\s*,\s*\.jb__settings\s*,\s*\.jb__inspector\s*\{([^}]*)\}/
    );
    expect(panels?.[1]).toMatch(/max-height\s*:\s*\d+(\.\d+)?dvh/);
  });

  it('stacks the panel bands with a bottom edge, not the column borders', () => {
    // `border-right` on a stacked band is a hairline down the middle of nothing.
    const below = belowLgBlock();
    const panels = below.match(
      /\.jb__outline\s*,\s*\.jb__settings\s*,\s*\.jb__inspector\s*\{([^}]*)\}/
    );
    expect(panels?.[1]).toMatch(/border-bottom\s*:/);
    expect(panels?.[1]).toMatch(/border-inline\s*:\s*0|border-right\s*:\s*0/);
  });
});

describe('the rail toggle switches back to Design instead of doing nothing (O25)', () => {
  it('routes onToggleRail through a handler that restores Design mode', () => {
    // The canvas's "« Sections" button stays visible in Look/Pricing/Media/
    // Brand/SEO, where the rail does not exist at all, so pressing it did
    // nothing. It matters more now: below lg the rail is a real band the toggle
    // hides and restores, so the control has to mean one thing everywhere.
    expect(ROUTE).toContain('onToggleRail={toggleRail}');
    const fn = ROUTE.match(/function toggleRail\(\)[\s\S]{0,400}?\n {2}\}/);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/mode\s*=\s*'design'/);
    expect(fn?.[0]).toMatch(/railCollapsed\s*=/);
  });
});

describe('full-bleed is an opt-in the route asks for (F37)', () => {
  it('marks every route-root element, so the three tails are full-height too', () => {
    for (const root of ROUTE_ROOTS) {
      const at = ROUTE.indexOf(root);
      expect(at, `route root not found: ${root}`).toBeGreaterThan(-1);
      // The attribute has to be on the element the shell sees as its direct
      // child, which is the same element that carries `height: 100dvh`.
      const tag = ROUTE.slice(at, ROUTE.indexOf('>', at));
      expect(tag, root).toContain('data-studio-fullbleed');
    }
  });

  it('the studio shell honours it only through :has(> …) on a direct child', () => {
    expect(STUDIO_LAYOUT).toMatch(
      /\.studio-layout__main:has\(>\s*:global\(\[data-studio-fullbleed\]\)\)/
    );
  });

  it('leaves the default studio content column exactly as it was', () => {
    // The shell's own comment calls this the one place the studio content width
    // is decided ("NO exceptions any more"). The opt-in must not become a change
    // to the default: every other studio page keeps the cap, the centring and
    // the padding.
    const main = rule(STUDIO_LAYOUT, '.studio-layout__main {');
    expect(main).toMatch(/max-width\s*:\s*var\(--container-studio\)/);
    expect(main).toMatch(/margin-inline\s*:\s*auto/);
    expect(main).toMatch(/padding\s*:\s*var\(--space-4\)/);
    expect(main).toMatch(/width\s*:\s*100%/);
  });

  it('drops only the padding and the cap for the opt-in, and keeps overflow-x clipped', () => {
    const optIn = rule(
      STUDIO_LAYOUT,
      '.studio-layout__main:has(> :global([data-studio-fullbleed])) {'
    );
    expect(optIn).toMatch(/padding\s*:\s*0/);
    expect(optIn).toMatch(/max-width\s*:\s*none/);
    // `overflow-x: clip` is inherited from the base rule and must not be
    // reverted here: the builder's top bar and mode tabs are wrap-or-clip, and
    // a horizontal window scrollbar on the studio is the thing that comment
    // exists to prevent.
    expect(optIn).not.toMatch(/overflow-x\s*:\s*(visible|auto|scroll)/);
  });

  it('changes only the edges — it does not hand the route a height', () => {
    // `display: grid; grid-template-rows: minmax(0, 1fr)` here, so the route
    // could say `height: 100%` and name no viewport unit at all, is the obvious
    // next step and it DOES NOT WORK: `.org-main` above this shell is a plain
    // block with auto height, so `.studio-layout` has only a `min-height`, its
    // `1fr` row sizes to content, and `height: 100%` is circular. Measured at a
    // 900px viewport: the builder grew to 3532px and every pane lost its
    // internal scroll. Both halves of that pair are pinned — the opt-in stays
    // edges-only, and the route keeps the viewport unit.
    const optIn = rule(
      STUDIO_LAYOUT,
      '.studio-layout__main:has(> :global([data-studio-fullbleed])) {'
    );
    expect(optIn).not.toMatch(/grid-template-rows/);
    expect(optIn).not.toMatch(/[;{\s]height\s*:/);
  });

  it('keeps the viewport unit on all four route roots, and releases it below lg', () => {
    for (const selector of ['.jb {', '.jb-loading {', '.jb-empty {']) {
      expect(rule(ROUTE, selector), selector).toMatch(/height\s*:\s*100dvh/);
    }
    // Below lg the fixed height must go, or the stack (panel band + canvas) is
    // capped at one viewport and the canvas is clipped off the bottom of it.
    const below = belowLgBlock();
    const roots = below.match(
      /\.jb\s*,\s*\.jb-loading\s*,\s*\.jb-empty\s*\{([^}]*)\}/
    );
    expect(roots).not.toBeNull();
    expect(roots?.[1]).toMatch(/height\s*:\s*auto/);
    expect(roots?.[1]).toMatch(/min-height\s*:\s*100dvh/);
  });
});
