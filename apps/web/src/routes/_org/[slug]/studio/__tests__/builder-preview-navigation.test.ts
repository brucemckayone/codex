/**
 * The builder's navigation backstop vs the canvas's preview exemption — the two
 * correct changes that composed into a wrong result.
 *
 * WHAT HAPPENED. `JourneyBuilderCanvas.onBlockClick` cancels a click on a live
 * CTA in EDITABLE mode and deliberately exempts preview mode (`editable ===
 * false`): "there the author has explicitly asked to see the page behave, and the
 * links are the page." Both branches were test-proven in the canvas. But the
 * route's `beforeNavigate` backstop then cancelled EVERY navigation to a public
 * journey surface, dirty or clean, editing or previewing — so neither mode
 * navigated, and the canvas's exemption was dead in the browser. Two changes,
 * each right on its own, composing into a promise the product could not keep.
 *
 * HOW THIS IS TESTED, and why not with a mount. Same reasoning as
 * `journeys/[id]/page/__tests__/builder-failure-states.test.ts`: the builder only
 * mounts behind `pageBuilder.isOpen` with a loaded draft, the studio subtree is
 * `ssr = false`, and `beforeNavigate` needs a router. So the callback is lifted
 * out of the route source and EVALUATED as a function against a stub navigation —
 * which makes this a real truth table over (previewMode × isDirty × target)
 * rather than a text match, while still surviving any reformatting of the body.
 * If the body stops being liftable the test throws rather than passing quietly.
 *
 * THE FOUR CASES, and the decision they encode:
 *   editing, clean       → CANCEL. A click on a price card is an edit gesture.
 *   editing, dirty       → CANCEL. Both reasons apply.
 *   preview, clean       → NAVIGATE. The deliberate act the canvas exempts.
 *   preview, dirty       → CANCEL. Losing unsaved work is worse than a blocked
 *                          click, and "View live" saves first.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(
  join(HERE, '..', 'journeys', '[id]', 'page', '+page.svelte'),
  'utf8'
);
const CANVAS = readFileSync(
  join(
    // __tests__ → studio → [slug] → _org → routes → src
    HERE,
    '..',
    '..',
    '..',
    '..',
    '..',
    'lib',
    'components',
    'page-builder',
    'JourneyBuilderCanvas.svelte'
  ),
  'utf8'
);

/** The `beforeNavigate(...)` callback body, braces included. */
function beforeNavigateBody(): string {
  const at = ROUTE.indexOf('beforeNavigate(');
  if (at < 0) throw new Error('beforeNavigate( not found in the route');
  const open = ROUTE.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < ROUTE.length; i++) {
    if (ROUTE[i] === '{') depth++;
    else if (ROUTE[i] === '}') {
      depth--;
      if (depth === 0) return ROUTE.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced braces after beforeNavigate(');
}

type Outcome = { cancelled: boolean; toasted: boolean; confirmed: boolean };

/**
 * Run the route's own callback body with its closure supplied as parameters.
 *
 * `new Function` rather than an import: the callback closes over component state
 * (`previewMode`, `isDirty`) and two component-scope helpers, none of which exist
 * outside a mounted `.svelte` module. Lifting the body is the only way to
 * exercise the COMPOSED predicate, which is where the defect lived.
 */
function runGuard(opts: {
  previewMode: boolean;
  isDirty: boolean;
  publicSurface: boolean;
  type?: string;
  confirmAnswer?: boolean;
}): Outcome {
  const out: Outcome = { cancelled: false, toasted: false, confirmed: false };
  const navigation = {
    to: { url: new URL('http://x.lvh.me:3010/journeys/bone-deep') },
    type: opts.type ?? 'link',
    cancel: () => {
      out.cancelled = true;
    },
  };
  const guard = new Function(
    'navigation',
    'previewMode',
    'isDirty',
    'isPublicJourneySurface',
    'toast',
    'm',
    'confirm',
    `(${beforeNavigateBody().replace(/^\{/, 'function guard() {')})();`
  );
  guard(
    navigation,
    opts.previewMode,
    opts.isDirty,
    () => opts.publicSurface,
    {
      info: () => {
        out.toasted = true;
      },
    },
    { studio_builder_toast_ctas_inert: () => 'inert' },
    () => {
      out.confirmed = true;
      return opts.confirmAnswer ?? true;
    }
  );
  return out;
}

describe('the backstop is liftable, which is what makes the rest a real test', () => {
  it('the callback body evaluates', () => {
    expect(() =>
      runGuard({ previewMode: false, isDirty: false, publicSurface: false })
    ).not.toThrow();
  });
});

describe('a public journey surface — the four composed cases', () => {
  it('EDITING + clean → cancelled with the toast (the pre-existing behaviour)', () => {
    const out = runGuard({
      previewMode: false,
      isDirty: false,
      publicSurface: true,
    });
    expect(out.cancelled).toBe(true);
    expect(out.toasted).toBe(true);
    expect(out.confirmed).toBe(false);
  });

  it('EDITING + dirty → cancelled with the toast, never a discard prompt', () => {
    const out = runGuard({
      previewMode: false,
      isDirty: true,
      publicSurface: true,
    });
    expect(out.cancelled).toBe(true);
    expect(out.toasted).toBe(true);
    // The toast, not "Discard?": the author did not ask to leave, they clicked a
    // CTA inside their own editor.
    expect(out.confirmed).toBe(false);
  });

  it('PREVIEW + clean → NAVIGATES. This is the branch that was dead.', () => {
    const out = runGuard({
      previewMode: true,
      isDirty: false,
      publicSurface: true,
    });
    expect(out.cancelled).toBe(false);
    expect(out.toasted).toBe(false);
    expect(out.confirmed).toBe(false);
  });

  it('PREVIEW + dirty → still cancelled: unsaved work outranks a deliberate click', () => {
    const out = runGuard({
      previewMode: true,
      isDirty: true,
      publicSurface: true,
    });
    expect(out.cancelled).toBe(true);
    // And the toast's second sentence is the right instruction here — "View live"
    // saves first and refuses to open on a failed save.
    expect(out.toasted).toBe(true);
  });
});

describe('every other destination is unchanged by this', () => {
  it('a clean draft leaving for anywhere else is not stopped', () => {
    for (const previewMode of [false, true]) {
      const out = runGuard({
        previewMode,
        isDirty: false,
        publicSurface: false,
      });
      expect(out.cancelled).toBe(false);
      expect(out.confirmed).toBe(false);
    }
  });

  it('a dirty draft still gets the discard confirm, in both modes', () => {
    for (const previewMode of [false, true]) {
      const out = runGuard({
        previewMode,
        isDirty: true,
        publicSurface: false,
        confirmAnswer: false,
      });
      expect(out.confirmed).toBe(true);
      expect(out.cancelled).toBe(true);
    }
  });

  it('an unload is cancelled with NO confirm — browsers suppress the dialog', () => {
    for (const previewMode of [false, true]) {
      const out = runGuard({
        previewMode,
        isDirty: true,
        publicSurface: false,
        type: 'leave',
      });
      expect(out.cancelled).toBe(true);
      expect(out.confirmed).toBe(false);
    }
  });

  it('preview mode does NOT weaken the unload guard on a public target either', () => {
    const out = runGuard({
      previewMode: true,
      isDirty: true,
      publicSurface: true,
      type: 'leave',
    });
    expect(out.cancelled).toBe(true);
  });
});

describe('the canvas half of the pair is still in place', () => {
  it('the canvas still exempts preview mode, so this route is the only gate left', () => {
    // If this ever changes to cancel in both modes, the route's exemption becomes
    // pointless in the opposite direction and this test should be revisited.
    expect(CANVAS).toContain('if (!editable) return;');
    expect(CANVAS).toContain("closest?.('a[href]')");
  });

  it('the route documents the composition rather than only the predicate', () => {
    // The predicate is three tokens; the reasoning is the part a future reader
    // needs, and it is what stopped this being "fixed" by deleting one side.
    expect(ROUTE).toContain('!previewMode || isDirty');
    expect(ROUTE).toMatch(/FULL-WIDTH PREVIEW/);
  });
});
