/**
 * The route → canvas hop for the course's SELL MEDIA (`Codex-bvhcr`).
 *
 * WHY THIS EXISTS AS A SEPARATE GUARD. `canvas-public-parity.svelte.test.ts` pins
 * that the canvas forwards a `sellPreview` into `builderSalesContext`, and that
 * both mount paths paint the same hero still from one context. Neither witnesses
 * the hop guarded here: a canvas that dutifully forwards `sellPreview` still shows
 * nothing if the ROUTE hands it none, and that is precisely the state this bead
 * found. The gap sat between a default and a value, in a prop the canvas already
 * declared.
 *
 * WHY STRUCTURAL ASSERTIONS OVER A MOUNT. Same reasoning as
 * `builder-top-bar.test.ts` beside it: this builder only mounts behind a loaded
 * draft with `pageBuilder` populated, the studio subtree is `ssr = false` so the
 * data arrives from client queries, and the thing that regresses is a prop
 * omission in markup. Source text is where a prop omission is observable.
 *
 * WHY PER-PROP RATHER THAN "every declared prop must be passed". That stronger,
 * obviously-better guard FAILS TODAY, and legitimately: `offer` is declared on the
 * canvas and never passed either, so `InviteSection` draws a price-less CTA in the
 * canvas while the live page prices itself (`Codex-4wun2`). Generalise this file
 * the moment that bead lands — the general form is the one that would have caught
 * both at once, and writing the specific form now is a deliberate stopgap rather
 * than the intended end state.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');

/**
 * The `<JourneyBuilderCanvas … />` tag body, so a prop mentioned anywhere else in
 * a 900-line route file cannot satisfy an assertion about what the canvas is
 * handed. Deliberately not a regex over the whole file for that reason.
 */
function canvasTag(): string {
  const open = ROUTE.indexOf('<JourneyBuilderCanvas');
  if (open === -1)
    throw new Error('route no longer mounts JourneyBuilderCanvas');
  const close = ROUTE.indexOf('/>', open);
  if (close === -1)
    throw new Error('JourneyBuilderCanvas tag is not self-closing');
  return ROUTE.slice(open, close);
}

describe('builder route → canvas: the sell media reaches the canvas', () => {
  it('resolves the course sell preview through the shared public query', () => {
    // The SAME query the public sales load streams. A studio-only re-implementation
    // is the regression worth naming: it would resolve media by a second code path
    // and the canvas could then differ from the page while both "worked".
    expect(ROUTE).toContain('resolveSellPreview');
  });

  it('hands the resolved preview to the canvas', () => {
    expect(
      canvasTag(),
      'the canvas is mounted without sellPreview — it is blind to the course media again (Codex-bvhcr)'
    ).toContain('sellPreview');
  });

  it('gates the query on both ids being present', () => {
    // `resolveSellPreview`'s schema validates `pageId` and `courseId` as UUIDs, and
    // a non-course journey has no `subjectId` at all — so calling unguarded means a
    // validation rejection on every page-builder load for a non-course journey.
    // This is a precondition of the query, not defensiveness about it.
    const call = ROUTE.slice(
      ROUTE.indexOf('const sellPreviewQuery'),
      ROUTE.indexOf('const sellPreview =')
    );
    expect(call, 'sellPreviewQuery not found before sellPreview').not.toBe('');
    expect(call).toContain('isCourse');
    expect(call).toContain('course.id');
  });

  it('degrades a FAILED preview read to no-media rather than to a broken canvas', () => {
    // A rejected remote query leaves `.current` undefined and puts its reason on
    // `.error` (Codex-xo3bl), so `?? null` is what reproduces the public load's
    // `.catch(() => null)`. Without it the canvas would hand `undefined` down and
    // the sections would read a missing context field instead of an absent preview.
    expect(ROUTE).toContain('sellPreviewQuery?.current ?? null');
  });
});
