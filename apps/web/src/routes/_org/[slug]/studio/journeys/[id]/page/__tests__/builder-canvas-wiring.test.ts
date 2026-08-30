/**
 * The route → canvas hop: EVERY prop `JourneyBuilderCanvas` declares must
 * actually be passed (`Codex-bvhcr`, then `Codex-4wun2`).
 *
 * WHY THIS EXISTS AS A SEPARATE GUARD. `canvas-public-parity.svelte.test.ts` pins
 * that the canvas forwards what it is handed into `builderSalesContext`, and that
 * both mount paths paint the same thing from one context. Neither witnesses the
 * hop guarded here: a canvas that dutifully forwards `sellPreview` still shows
 * nothing if the ROUTE hands it none, and that is precisely the state both beads
 * found. The gap sat between a DEFAULT and a value, in a prop the canvas already
 * declared — which is why it type-checked, mounted and rendered, twice.
 *
 * WHY IT IS NOW THE GENERAL FORM. This file used to assert one prop at a time, and
 * its own header said to generalise it the moment `Codex-4wun2` landed — because
 * the specific form could not fail for `offer`, which was declared-and-unpassed at
 * the same time as `sellPreview` and by the same mechanism. That bead has landed,
 * so the assertion below is the one that would have caught both at once: parse the
 * canvas's `interface Props` and require every declared name to appear in the
 * `<JourneyBuilderCanvas … />` tag. A newly declared prop now fails here until the
 * route supplies it, which is the only place that omission is observable.
 *
 * WHY STRUCTURAL ASSERTIONS OVER A MOUNT. Same reasoning as
 * `builder-top-bar.test.ts` beside it: this builder only mounts behind a loaded
 * draft with `pageBuilder` populated, the studio subtree is `ssr = false` so the
 * data arrives from client queries, and the thing that regresses is a prop
 * omission in markup. Source text is where a prop omission is observable.
 *
 * WHY "EVERY DECLARED PROP" WAS STILL NOT ENOUGH, and this is the widening that
 * matters. The declared-prop form is blind to a prop that was never DECLARED: the
 * canvas typed `course` as `Pick<JourneyCourseView, 'id' | 'slug' | 'title'>` and
 * declared no `testimonials` at all, so `kicker`, `lede` and every testimonial
 * were invisible to a guard whose whole input is the declaration list. Three more
 * fields sat unwired for two more beads under a green test.
 *
 * So the authority moved one step upstream, to what `builderSalesContext`
 * ACCEPTS — `BuilderContextInput`, the adapter's own input type. That is the
 * complete list of what the canvas can be given, it is maintained by whoever
 * widens the adapter, and it cannot be satisfied by omission. Every accepted
 * field must now be (1) declared as a prop, (2) forwarded into
 * `builderSalesContext`, and (3) passed by the route — the three hops the
 * omission has hidden in, once each.
 *
 * AND `course` IS TYPED OFF `BuilderContextInput['course']` rather than off a
 * hand-written `Pick`, so the narrowing that hid `kicker`/`lede` is now a compile
 * error rather than a test's problem. The assertion below only pins that link.
 *
 * WHAT THIS GUARD CANNOT DO, stated so nobody trusts it further than it goes: a
 * name match cannot tell `offer={offer}` from a coincidental mention inside
 * another prop's value expression. It is calibrated for the failure that actually
 * happens — a prop left out entirely — and every prop carrying real semantics (the
 * shared query, the id gating, the failure degradation) keeps its own named
 * assertion below.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');
/** `src/lib/components/page-builder/JourneyBuilderCanvas.svelte`, from here. */
const CANVAS = readFileSync(
  join(
    HERE,
    '../../../../../../../..',
    'lib/components/page-builder/JourneyBuilderCanvas.svelte'
  ),
  'utf8'
);

/** `src/lib/page-builder/render/builder-context.ts`, from here. */
const ADAPTER = readFileSync(
  join(
    HERE,
    '../../../../../../../..',
    'lib/page-builder/render/builder-context.ts'
  ),
  'utf8'
);

/** Source with comments stripped — a doc comment must never satisfy a scan. */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * A brace-matched slice starting at `marker`, so a slice can never silently grow
 * to the end of the file when a helper moves (the shape that makes an assertion
 * pass for the wrong reason).
 */
function braceBody(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`${marker} not found`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${marker}`);
}

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

/**
 * The prop names the canvas declares, read off its `interface Props` block.
 *
 * The block ends at the closing brace sitting at the interface's OWN indentation
 * (two spaces, inside `<script>`), so a nested object type — indented deeper —
 * cannot end the slice early. Comments are stripped before the scan because a doc
 * comment may legitimately contain a brace, and only exactly-four-space-indented
 * members are collected so a nested type's own fields are never mistaken for
 * props.
 */
function declaredProps(): string[] {
  const marker = 'interface Props {';
  const start = CANVAS.indexOf(marker);
  if (start === -1)
    throw new Error(
      'JourneyBuilderCanvas no longer declares `interface Props`'
    );
  const end = CANVAS.indexOf('\n  }', start);
  if (end === -1) throw new Error('`interface Props` block is unterminated');

  const body = CANVAS.slice(start + marker.length, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  const names: string[] = [];
  for (const line of body.split('\n')) {
    const match = line.match(/^\s{4}([A-Za-z_$][\w$]*)\??\s*:/);
    if (match && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * The field names `builderSalesContext` ACCEPTS, read off `BuilderContextInput`.
 *
 * This is the list the declared-prop scan could not see: a field the adapter
 * accepts and the canvas never declared is invisible to any assertion whose input
 * is the declaration list, which is exactly how `testimonials` (and, inside
 * `course`, `kicker`/`lede`) stayed unwired.
 *
 * Members sit at TWO spaces inside an `export interface` at column 0, so a
 * continuation line (four spaces, e.g. `course`'s intersection type) cannot be
 * mistaken for a member. Comments go first, because a doc comment legitimately
 * contains both braces and `word:` pairs.
 */
function acceptedInputs(): string[] {
  const marker = 'export interface BuilderContextInput {';
  const start = ADAPTER.indexOf(marker);
  if (start === -1)
    throw new Error('builder-context no longer exports `BuilderContextInput`');
  const body = code(ADAPTER.slice(start + marker.length));
  const end = body.indexOf('\n}');
  if (end === -1) throw new Error('`BuilderContextInput` is unterminated');

  const names: string[] = [];
  for (const line of body.slice(0, end).split('\n')) {
    const match = line.match(/^ {2}([A-Za-z_$][\w$]*)\??\s*:/);
    if (match && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** The `builderSalesContext({ … })` argument the canvas assembles. */
function contextCall(): string {
  return braceBody(code(CANVAS), 'builderSalesContext(');
}

describe('canvas ← adapter: every input builderSalesContext ACCEPTS is wired', () => {
  /**
   * THE PARSER'S OWN GUARD. A parser that returns `[]` makes all three
   * assertions below unfailable — the vacuous shape that let a declared-and-
   * unpassed prop live through two beads, and an UNDECLARED one through two more.
   */
  it('reads the adapter input list before asserting anything about it', () => {
    const inputs = acceptedInputs();
    expect(
      inputs.length,
      'parsed no fields out of `BuilderContextInput` — the guards below would pass vacuously'
    ).toBeGreaterThanOrEqual(7);
    expect(inputs).toContain('course');
    expect(inputs).toContain('testimonials');
    expect(inputs).toContain('sellPreview');
    expect(inputs).toContain('offer');
  });

  it('declares a canvas prop for every accepted input', () => {
    const declared = declaredProps();
    const undeclared = acceptedInputs().filter(
      (field) => !declared.includes(field)
    );
    expect(
      undeclared,
      '`builderSalesContext` accepts these and the canvas declares no prop for them, so the adapter silently fills its documented DEFAULT — the failure a declared-prop scan cannot see (Codex-bvhcr class)'
    ).toEqual([]);
  });

  it('forwards every accepted input into builderSalesContext', () => {
    const call = contextCall();
    const dropped = acceptedInputs().filter(
      (field) => !new RegExp(`\\b${field}\\b`).test(call)
    );
    expect(
      dropped,
      'the canvas takes these as props and does not hand them to the adapter, so the value stops one hop short of the sections'
    ).toEqual([]);
  });

  it('the route passes every accepted input', () => {
    const tag = canvasTag();
    const missing = acceptedInputs().filter(
      (field) => !new RegExp(`\\b${field}\\b`).test(tag)
    );
    expect(
      missing,
      'the adapter accepts these, the canvas declares them, and the route hands over none — the exact gap between a DEFAULT and a value'
    ).toEqual([]);
  });

  it('types the course prop off the adapter, so it cannot narrow again', () => {
    // The narrowing IS the defect: `Pick<JourneyCourseView, 'id'|'slug'|'title'>`
    // made `kicker` and `lede` untypeable at the call site, so the route could
    // not have passed them even if it had tried. Typed off the adapter's own
    // input, a field the adapter accepts is a field the canvas can be handed.
    expect(code(CANVAS)).toMatch(/course\?:\s*BuilderContextInput\['course'\]/);
    expect(code(CANVAS)).not.toMatch(/course\?:\s*Pick</);
  });

  it('the route builds the course object with the fields the sections fall back to', () => {
    // `HeroSection` draws its eyebrow from `context.course.kicker` and its
    // subheadline from `.lede` whenever the props are unset — a documented
    // fallback pages are expected to rely on — so a canvas with neither draws
    // one line where the published page draws three.
    const built = braceBody(code(ROUTE), 'const course = $derived(');
    expect(built).toMatch(/\bkicker\b/);
    expect(built).toMatch(/\blede\b/);
  });
});

describe('builder route → canvas: every declared prop is passed', () => {
  /**
   * THE PARSER'S OWN GUARD, and it is not ceremony. A parser that silently
   * returns `[]` makes the assertion below unfailable — the vacuous-pass shape
   * that let a declared-and-unpassed prop live through two beads. Anchor names
   * plus a floor mean a reformatted `interface Props` breaks THIS test loudly
   * instead of quietly disarming the next one.
   */
  it('reads the canvas prop list before asserting anything about it', () => {
    const props = declaredProps();
    expect(
      props.length,
      'parsed no props out of `interface Props` — the guard below would pass vacuously'
    ).toBeGreaterThanOrEqual(10);
    expect(props).toContain('editable');
    expect(props).toContain('sellPreview');
    expect(props).toContain('offer');
  });

  it('passes every prop the canvas declares', () => {
    const tag = canvasTag();
    const missing = declaredProps().filter(
      (prop) => !new RegExp(`\\b${prop}\\b`).test(tag)
    );
    expect(
      missing,
      'the canvas declares these props and the route never passes them, so the canvas silently renders its DEFAULT for each (Codex-bvhcr, Codex-4wun2)'
    ).toEqual([]);
  });
});

describe('builder route → canvas: the sell media reaches the canvas', () => {
  it('resolves the course sell preview through the shared public query', () => {
    // The SAME query the public sales load streams. A studio-only re-implementation
    // is the regression worth naming: it would resolve media by a second code path
    // and the canvas could then differ from the page while both "worked".
    expect(ROUTE).toContain('resolveSellPreview');
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

describe('builder route → canvas: the AUTHORITATIVE offer reaches it (Codex-4wun2)', () => {
  it('reads the offer from the authoritative endpoint, not from the page draft', () => {
    // SPEC §7: every path and every price comes from `getCourseOffer`
    // (`courses.price_cents` + the live plan row + tier grants), never from
    // `landing_pages.offer`, which is PRESENTATION only. A studio-side preview
    // assembled from the authored bag is the exact failure the pricing invariant
    // exists to prevent — the canvas would teach the author a price the checkout
    // will not charge.
    expect(ROUTE).toContain('getCourseOffer');
  });

  it('gates the offer read on a real course id', () => {
    // Same precondition as the sell preview: the query validates `courseId` as a
    // UUID, and a non-course journey has no `subjectId` to read.
    const call = ROUTE.slice(
      ROUTE.indexOf('const offerQuery'),
      ROUTE.indexOf('const offer =')
    );
    expect(call, 'offerQuery not found before offer').not.toBe('');
    expect(call).toContain('isCourse');
    expect(call).toContain('course.id');
  });

  it('degrades a FAILED offer read to a price-less CTA, not to a broken canvas', () => {
    // `.current` is undefined in flight AND after a rejection (Codex-xo3bl), so
    // `?? null` reproduces the public load's `.catch(() => null)`. Null is
    // `InviteSection`'s documented price-less branch, which is the honest answer —
    // never authored numbers.
    expect(ROUTE).toContain('offerQuery?.current ?? null');
  });

  it('hands the canvas REAL checkout/dashboard URLs, not the empty default', () => {
    // The second hop, load-bearing only once paths exist. With `checkoutUrl: ''`,
    // `checkoutUrlForPath('', 'purchase')` yields `?offer=purchase` — scheme-less,
    // so `safeHref` passes it through verbatim and every priced card in the canvas
    // becomes a live relative link that reloads the BUILDER route. Built with
    // `buildJourneyUrl`, exactly as `JourneyRenderer` builds the same two URLs for
    // the public page, so the canvas's CTAs point where the page's point.
    expect(ROUTE).toContain('buildJourneyUrl');
    const tag = canvasTag();
    expect(tag).toContain('checkoutUrl');
    expect(tag).toContain('dashboardUrl');
  });
});
