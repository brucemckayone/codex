/**
 * The builder's FAILURE and UNSAVED-WORK states (Codex-b0fm6, plus the two dirty
 * gates that read the wrong flag).
 *
 * WHY STRUCTURAL ASSERTIONS OVER A MOUNT. Same reasoning as `builder-top-bar.test.ts`
 * and `builder-canvas-wiring.test.ts` beside it: this builder only mounts behind
 * `pageBuilder.isOpen` with a loaded draft, the studio subtree is `ssr = false` so
 * every read is a client query, and `beforeNavigate` needs a router. The things
 * that regress here are a branch that is missing and an identifier that is wrong —
 * both observable in source text, neither observable in jsdom.
 *
 * WHAT EACH GROUP PROTECTS, all of them silent failures:
 *
 *  1. THE TERMINAL SPINNER. `{#if pageBuilder.isOpen && pending}` had exactly one
 *     alternative — `Loading page…` — and the store only ever opens from an
 *     `$effect` that returns on a falsy draft. So a rejected read and a null
 *     resolve were both indistinguishable from a pending one, for ever, on a
 *     surface whose only navigation lives inside the `{#if}`. Two ordinary URLs
 *     reach it: a non-UUID `[id]`, and a valid uuid that is a COURSE id rather
 *     than the portal-page id this route takes.
 *
 *  2. THE ACCESSOR. `draftQuery.error?.message` is `undefined` for every
 *     `HttpError` SvelteKit throws (the text lives at `.body.message`), so a
 *     branch keyed on it is DEAD CODE that reads as handled (Codex-xo3bl). The
 *     assertion is therefore both positive (`queryErrorMessage(` is used) and
 *     negative (`.error?.message` appears nowhere).
 *
 *  3. THE DIRTY GATES. The route derives the WIDE flag —
 *     `pageBuilder.isDirty || sellMedia.isDirty || monetisation.isDirty` — and its
 *     comment states why ("otherwise picking a clip or a tier and navigating away
 *     would lose it with no warning"). The Save button used it; the two guards that
 *     actually protect the work did not, so a media-only or pricing-only edit was
 *     discarded on navigation with no prompt, and "View live" skipped the save and
 *     opened a page that contradicted the canvas. This slices the two function
 *     bodies and asserts the narrow flag is not what they test.
 *
 *  4. THE MEDIA LEG. It ran in `handleSave` BELOW the `staleWarning` early return,
 *     so a rejected post-save `invalidate` skipped the media write and still
 *     reported success. It now belongs to `saveBuilderDraft` (see
 *     `builder-save.test.ts`), and this asserts the component does not own it
 *     again — a re-added `await sellMedia.save()` in the component is exactly the
 *     regression, and it would be invisible to `builder-save.test.ts`.
 *
 * PORTALS-INDEX NOTE: the last group reads `studio/journeys/+page.svelte`, two
 * directories up, because that file has no `__tests__` of its own and this effort's
 * file partition did not let one be created. It is the same defect in the same
 * feature — a failed read rendering as "No portals yet" — so it is guarded here
 * rather than not at all. Move it when that directory exists.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');
const INDEX = readFileSync(
  join(HERE, '..', '..', '..', '+page.svelte'),
  'utf8'
);

/**
 * The source with its COMMENTS removed.
 *
 * Every negative assertion below runs against this, and it is not a nicety: both
 * files document the traps by NAMING them ("never `.error?.message`", "not
 * `pageBuilder.isDirty`"), so a `not.toContain` over the raw text fails on the
 * very comment that records the fix. Line comments are stripped only when they
 * START a line, which is how all of them are written, so a `//` inside a URL or a
 * regex is left alone.
 */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

const ROUTE_CODE = code(ROUTE);
const INDEX_CODE = code(INDEX);

/**
 * The body of a top-level `function name(...)` declaration, brace-matched.
 *
 * Brace matching rather than "up to the next `function`", because a slice that
 * stops at the next declaration silently grows to the end of the file the moment
 * a helper is moved — and an assertion over a too-large slice can pass for the
 * wrong reason.
 */
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

/** The `beforeNavigate(...)` callback, brace-matched from its arrow body. */
function beforeNavigateBody(): string {
  return functionBody(ROUTE, 'beforeNavigate(');
}

describe('builder — the draft read has designed failure states', () => {
  it('reads the failure through queryErrorMessage, never through .error?.message', () => {
    expect(ROUTE_CODE).toContain('queryErrorMessage(');
    // The dead-code trap: undefined for every HttpError, so the branch never runs.
    expect(ROUTE_CODE).not.toMatch(/\.error\?\.message/);
  });

  it('the workspace tail has three arms, not one', () => {
    // Everything after the workspace's `{#if}`: the number of arms IS the fix,
    // because one arm can only ever be the spinner.
    const tail = ROUTE_CODE.slice(
      ROUTE_CODE.indexOf('{#if pageBuilder.isOpen')
    );
    const arms = tail.match(/\{:else(?: if [^}]*)?\}/g) ?? [];
    expect(arms.length).toBeGreaterThanOrEqual(3);
    // And one arm is keyed on a RESOLVED-but-absent draft — which is what a
    // course id in the page-id slot produces — via a derived that tests for it
    // EXPLICITLY. `!draft` would also catch an in-flight read, i.e. the spinner.
    expect(tail).toContain('{:else if draftMissing}');
    expect(ROUTE_CODE).toMatch(/draftMissing = \$derived\([\s\S]*?=== null/);
  });

  it('the error arm offers a retry and a way out of the builder', () => {
    const errorArm = ROUTE.slice(
      ROUTE.indexOf('{:else if draftError}'),
      ROUTE.indexOf('{:else if draftMissing}')
    );
    expect(errorArm).toContain('refresh()');
    expect(errorArm).toContain('href="/studio/journeys"');
    // Announced, not merely painted: there is no other content on the surface.
    expect(errorArm).toContain('role="alert"');
  });

  it('the not-found arm names the id class, because that is the mistake', () => {
    const missingArm = ROUTE.slice(
      ROUTE.indexOf('{:else if draftMissing}'),
      ROUTE.lastIndexOf('{:else}')
    );
    expect(missingArm).toMatch(/PORTAL page id/);
    expect(missingArm).toMatch(/not the course id/);
    expect(missingArm).toContain('href="/studio/journeys"');
  });

  it('still keeps a plain loading state for the in-flight case', () => {
    expect(ROUTE).toContain('class="jb-loading"');
    expect(ROUTE).toContain('Loading page…');
  });
});

describe('builder — the unsaved-work guards read the WIDE dirty flag', () => {
  it('derives the wide flag from all three stores', () => {
    expect(ROUTE).toMatch(
      /pageBuilder\.isDirty \|\| sellMedia\.isDirty \|\| monetisation\.isDirty/
    );
  });

  it('beforeNavigate does not test the narrow page-draft flag', () => {
    const body = code(beforeNavigateBody());
    expect(body).not.toMatch(/pageBuilder\.isDirty/);
    expect(body).toMatch(/\bisDirty\b/);
  });

  it('handleViewLive saves on ANY dirty resource, not just the page draft', () => {
    const body = code(functionBody(ROUTE, 'async function handleViewLive'));
    expect(body).not.toMatch(/pageBuilder\.isDirty/);
    expect(body).toMatch(/isDirty && !\(await handleSave\(\)\)/);
  });

  it('the confirm copy covers media and pricing too', () => {
    const body = code(beforeNavigateBody());
    expect(body).toContain('unsaved changes');
    // "page changes" would be a lie now that the guard covers three resources.
    expect(body).not.toContain('unsaved page changes');
  });

  it('an unload is cancelled WITHOUT a confirm, which browsers suppress anyway', () => {
    const body = beforeNavigateBody();
    const leave = body.slice(body.indexOf("=== 'leave'"));
    const untilConfirm = leave.slice(0, leave.indexOf('confirm('));
    expect(leave).toContain('cancel()');
    // The cancel must come FIRST on that path — a suppressed confirm returns
    // false and would double-prompt behind the browser's own dialog.
    expect(untilConfirm).toContain('cancel()');
  });

  it('cancels a navigation to the journey’s own public surfaces', () => {
    // The canvas's CTAs are live links to the real checkout now. In an editor a
    // click on one must not leave the page — and the pre-existing confirm only
    // fired on a DIRTY draft, so a clean one navigated away silently.
    const body = beforeNavigateBody();
    expect(body).toContain('isPublicJourneySurface(');
    const guard = functionBody(ROUTE, 'function isPublicJourneySurface');
    expect(guard).toContain('checkoutUrl');
    expect(guard).toContain('dashboardUrl');
  });
});

describe('builder — the component owns no write of its own', () => {
  it('does not save the sell media after saveBuilderDraft has returned', () => {
    const body = code(functionBody(ROUTE, 'async function handleSave'));
    // The whole point of the orchestrator: a leg the caller runs afterwards is a
    // leg the caller can skip, and this one was skipped by the staleWarning
    // early return while the save still reported success.
    expect(body).not.toMatch(/await sellMedia\.save\(\)/);
    expect(body).toMatch(/sellMedia: \{/);
  });

  it('passes the media leg as a port, so the orchestrator sequences it', () => {
    const body = functionBody(ROUTE, 'async function handleSave');
    expect(body).toMatch(/isDirty: sellMedia\.isDirty/);
    expect(body).toMatch(/save: \(\) => sellMedia\.save\(\)/);
  });

  it('confirms the destructive status before writing it', () => {
    const body = functionBody(ROUTE, 'function setStatus');
    expect(body).toMatch(/archived/);
    expect(body).toContain('confirm(');
    // On cancel the select is snapped back, or it shows a status the draft
    // does not have.
    expect(body).toMatch(/select\.value =/);
  });
});

describe('portals index — a failed list read is not "No portals yet"', () => {
  it('derives the error through queryErrorMessage', () => {
    expect(INDEX_CODE).toMatch(/queryErrorMessage\(\s*journeysQuery\.error/);
    expect(INDEX_CODE).not.toMatch(/journeysQuery\.error\?\.message/);
  });

  it('renders the error arm BEFORE the items / empty pair', () => {
    const errorArm = INDEX.indexOf('{:else if loadError}');
    const itemsArm = INDEX.indexOf('{:else if items.length > 0}');
    expect(errorArm).toBeGreaterThan(-1);
    expect(itemsArm).toBeGreaterThan(-1);
    // Order IS the fix: an error must never fall through to a claim about data.
    expect(errorArm).toBeLessThan(itemsArm);
  });

  it('offers a retry and announces the failure', () => {
    const arm = INDEX.slice(
      INDEX.indexOf('{:else if loadError}'),
      INDEX.indexOf('{:else if items.length > 0}')
    );
    expect(arm).toContain('journeysQuery.refresh()');
    expect(arm).toContain('role="alert"');
  });
});
