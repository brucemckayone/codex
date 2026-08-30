/**
 * The PUBLISH GATE — the two checks that stand between a draft and a public
 * sales page, and the two entry points both of them have to cover.
 *
 * WHAT WAS WRONG. Both checks existed as pure, well-documented functions with
 * ZERO callers anywhere in the repo except their own unit tests:
 *
 *  · `seededSections` (`section-catalog.ts`) reports the sections still holding
 *    the catalogue's own seed copy verbatim — "A common question?", "First L.",
 *    "2,400 and counting". Its docstring stated the contract it was written for:
 *    "The publish path turns this into ONE confirm naming the sections and
 *    proceeds on accept." Nothing turned it into anything. A creator who added a
 *    Proof section, never opened it and published shipped three invented
 *    testimonials and an invented claim about their own business.
 *  · `validatePageShape` (`render/section-registry.ts`) reports the compositions
 *    that must not reach a published page. Its `PageShapeIssue` doc says outright
 *    that "`error` shapes must not reach a PUBLISHED page — the builder's publish
 *    action blocks on them". The publish action did not exist as far as it was
 *    concerned: an EMPTY page (which is what `createJourney` inserts) and a
 *    TWO-HERO page (reachable with one press of Duplicate) both published.
 *
 * AND THE SECOND ENTRY POINT IS THE ONE THAT GETS FORGOTTEN. "Publish" is not the
 * only way to publish: the top bar's status `<select>` writes `status:
 * 'published'` straight into the draft, and the next Save takes the page live and
 * cascades the course to published with it. A gate on `handlePublish` alone is a
 * gate with a dropdown beside it. Both paths therefore go through ONE function,
 * and this file asserts both call it.
 *
 * WHY STRUCTURAL ASSERTIONS OVER A MOUNT. Same reasoning as the three test files
 * beside it: this builder only mounts behind `pageBuilder.isOpen` with a loaded
 * draft, the studio subtree is `ssr = false` so every read is a client query, and
 * `confirm`/`toast` are host effects. What regresses here is a call site that
 * stops being made — observable in source text, and only there.
 *
 * WHAT THIS GUARD CANNOT DO: it cannot witness the confirm actually appearing.
 * The behaviour of the two checks is unit-tested where they live
 * (`section-catalog.test.ts`, `section-registry`'s own suite); this file exists so
 * that work cannot be present-but-unconsumed a third time.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');

/**
 * The source with its COMMENTS removed. Every assertion below runs against this,
 * because this file's own subject is documented IN the route's comments — a scan
 * over the raw text would be satisfied by the prose that explains the fix.
 */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

const ROUTE_CODE = code(ROUTE);

/** The body of a top-level `function name(...)` declaration, brace-matched. */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`${declaration} not found`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${declaration}`);
}

describe('publish gate — it exists and both publish paths go through it', () => {
  it('consumes the two checks that had no callers at all', () => {
    // The import IS the finding: both functions were exported, documented for
    // this exact call site, and reached only by their own unit tests.
    expect(ROUTE_CODE).toMatch(/\bseededSections\b/);
    expect(ROUTE_CODE).toMatch(/\bvalidatePageShape\b/);
  });

  it('gates the Publish button', () => {
    const body = code(functionBody(ROUTE, 'async function handlePublish'));
    expect(body).toMatch(/passesPublishGate\(\)/);
  });

  it('gates the status select, which is the other way to publish', () => {
    const body = code(functionBody(ROUTE, 'function setStatus'));
    expect(body).toMatch(/passesPublishGate\(\)/);
    // Only for the one value that goes public — choosing Draft or Archived has
    // nothing to check, and a confirm on either would be noise.
    expect(body).toMatch(/'published'/);
  });

  it('checks BEFORE the status is written, so a blocked publish leaves no trace', () => {
    const body = code(functionBody(ROUTE, 'async function handlePublish'));
    const gate = body.indexOf('passesPublishGate()');
    const write = body.indexOf("updateMeta('status', 'published')");
    expect(gate).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    // Writing first and rolling back would leave the draft dirty (and the
    // history holding a step) for a publish that never happened.
    expect(gate).toBeLessThan(write);
  });

  it('snaps the select back when the gate refuses', () => {
    // A `<select>` keeps the user's choice on screen, so a refused publish that
    // does not reset it leaves the control claiming a status the draft does not
    // have — the same reason the archive confirm resets it.
    const body = code(functionBody(ROUTE, 'function setStatus'));
    const gate = body.indexOf('passesPublishGate()');
    // Anchored: with no gate at all, `indexOf(_, -1)` finds the ARCHIVE reset
    // below and this assertion passes for the wrong reason.
    expect(gate).toBeGreaterThan(-1);
    const reset = body.indexOf('select.value =', gate);
    expect(reset).toBeGreaterThan(gate);
  });
});

describe('publish gate — an unpublishable SHAPE blocks, and only on `error`', () => {
  it('blocks on the error severities and lets the warnings through', () => {
    const body = code(functionBody(ROUTE, 'function shapeBlockers'));
    // `no-hero` and `hero-not-first` are `warn` BY DESIGN — opening on an ache,
    // or putting a turn above the hero, are real editorial choices. Blocking a
    // creator's taste would be worse than the defect this closes.
    expect(body).toMatch(/severity === 'error'/);
  });

  it('names each blocking shape in copy a creator can act on', () => {
    const body = code(functionBody(ROUTE, 'function shapeBlockers'));
    // The three `error` codes, each mapped to its own message — a bare "this
    // page cannot be published" tells a creator nothing to do next.
    expect(body).toMatch(/'empty-page'/);
    expect(body).toMatch(/'multiple-hero'/);
    expect(body).toMatch(/'no-cta'/);
  });

  it('refuses the publish rather than warning and proceeding', () => {
    const body = code(functionBody(ROUTE, 'function passesPublishGate'));
    const blockers = body.indexOf('shapeBlockers()');
    expect(blockers).toBeGreaterThan(-1);
    // A hard stop: the shape check returns false, unlike the seed-copy check
    // below it, which asks.
    expect(body).toMatch(/return false/);
    // And the shape check runs FIRST — asking "publish anyway?" about placeholder
    // copy on a page that cannot be published at all is a question with no
    // useful answer.
    expect(blockers).toBeLessThan(body.indexOf('seededSections('));
  });
});

describe('publish gate — the placeholder-copy check ASKS, it does not block', () => {
  it('proceeds on accept, so it can never trap a deliberate publish', () => {
    const body = code(functionBody(ROUTE, 'function passesPublishGate'));
    // "This copy is identical to the catalogue's" is a strong hint, not a
    // certainty: a creator may legitimately want "Who holds this" as their guide
    // heading. So the answer is the creator's, and accept proceeds.
    //
    // Asserted on the half of the gate BELOW the seed check, because the shape
    // half above it legitimately hard-stops: what must not appear here is a
    // refusal the creator cannot answer.
    const seedHalf = body.slice(body.indexOf('seededSections('));
    expect(seedHalf).toMatch(/confirm\(/);
    expect(seedHalf).toMatch(/return[\s\S]*confirm\(/);
    expect(seedHalf).not.toMatch(/return false/);
  });

  it('names the sections, because "somewhere" is not actionable', () => {
    const body = code(functionBody(ROUTE, 'function passesPublishGate'));
    // `seededSections` returns the catalogue LABEL per section for exactly this
    // ("Proof, FAQ"), and the two singular/plural messages take it.
    expect(body).toMatch(/\.label\b/);
  });

  it('has no plural ICU in its copy, which paraglide 1.11.8 cannot compile', () => {
    const body = code(functionBody(ROUTE, 'function passesPublishGate'));
    // A separate `_one` key plus a call-site ternary is the house pattern.
    expect(body).not.toMatch(/\{count,\s*plural/);
    expect(body).toMatch(/_one\(/);
  });

  it('names only sections whose seeded keys are COPY', () => {
    // MEASURED, not assumed: run against the seven seeded fixture pages,
    // `seededSections` reports `hero` on the strength of `bg: 'ember'` — the
    // Background SELECT's default, an appearance choice and not a word anyone
    // reads. Unfiltered, the confirm names the hero of every page in the
    // database and the creator learns to dismiss it.
    const gate = code(functionBody(ROUTE, 'function passesPublishGate'));
    expect(gate).toMatch(/isSeedCopyField\(/);

    const helper = code(functionBody(ROUTE, 'function isSeedCopyField'));
    // The inspector's own control type is the discriminator, so a field that
    // changes type cannot leave a stale key list behind here.
    expect(helper).toMatch(/fieldsForSectionType\(/);
    expect(helper).toMatch(/'text'/);
    expect(helper).toMatch(/'textarea'/);
  });

  it('reads the PENDING sections, not the saved ones', () => {
    // Publish saves the draft, so the copy that is about to go public is the
    // pending copy. Checking the saved baseline would clear a leak the creator
    // has just re-introduced and flag one they have just fixed.
    const body = code(functionBody(ROUTE, 'function passesPublishGate'));
    expect(body).toMatch(/pageBuilder\.sections/);
    expect(body).not.toMatch(/pageBuilder\.saved/);
  });
});
