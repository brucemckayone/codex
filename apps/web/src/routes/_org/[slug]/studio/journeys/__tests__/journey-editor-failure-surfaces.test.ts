/**
 * The CREATE flow's and the CURRICULUM editor's failure surfaces — the two
 * journey routes that had none, or had one that could not fire.
 *
 * WHY STRUCTURAL ASSERTIONS OVER A MOUNT. Same reasoning as
 * `[id]/page/__tests__/builder-failure-states.test.ts`: the studio subtree is
 * `ssr = false`, so every read here is a client query, and `beforeNavigate` needs
 * a router. What regresses is a branch that is missing, a branch ordered behind
 * the one it must precede, and an accessor that is silently always `undefined` —
 * all three observable in source text, none observable in jsdom.
 *
 * WHAT EACH GROUP PROTECTS, and all four were silent:
 *
 *  1. THE CREATE FLOW'S ONLY ERROR SURFACE WAS DEAD FOR EVERY REAL FAILURE.
 *     `new/+page.svelte` toasted `err instanceof Error ? err.message : <generic>`.
 *     SvelteKit rejects a remote call with `HttpError`, and `HttpError` does NOT
 *     extend `Error` — it is a plain class holding `{ status, body: { message } }`
 *     (`@sveltejs/kit/src/exports/internal/index.js`). So the test was FALSE for
 *     every `error(status, message)` the create path raises and the creator
 *     always got the generic line: never "Journeys can only be created within an
 *     organization", never a forwarded 4xx from the worker. The one rejection it
 *     did catch — a network `TypeError` — is the one with nothing useful to say.
 *
 *  2. THE CURRICULUM SAVE THREW ITS REASON AWAY. A bare `catch {}` — no binding,
 *     so nothing could read it — under a fixed "please try again". Discarded with
 *     it: "A practice can only appear once per stage", the space guard's refusal
 *     for content from another org, and the 400 for an emptied stage name. Every
 *     one of those names something on screen to change, and "try again" re-sends
 *     the identical body for the identical refusal.
 *
 *  3. THE PICKER'S FAILURE RENDERED AS ITS EMPTY STATE. `.current` is `undefined`
 *     after a rejection as well as in flight (Codex-xo3bl), so a failed library
 *     read fell through to "No content matches. Publish or upload content, then
 *     link it here." — an instruction a creator with a full library cannot act
 *     on. The error arm must therefore come BEFORE the empty arm: an unanswered
 *     question must never fall through to a claim about the data. That ORDER is
 *     the assertion, not merely the arm's existence.
 *
 *  4. THE CURRICULUM EDITOR HAD NO UNSAVED-WORK GUARD AT ALL. Every edit lives in
 *     local `$state` until Save, so adding three stages and clicking either link
 *     in this page's own header discarded the lot with no prompt, while the Save
 *     button sat lit beside them. `dirty` was already tracked and already gating
 *     Save; only the guard was missing. Its `type === 'leave'` arm must call
 *     `cancel()` WITHOUT `confirm()` — browsers suppress a dialog during unload,
 *     so `confirm()` returns false immediately and it is `cancel()` that raises
 *     the browser's own prompt; calling both asks twice, once invisibly.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const NEW_ROUTE = readFileSync(join(HERE, '..', 'new', '+page.svelte'), 'utf8');
const CURRICULUM = readFileSync(
  join(HERE, '..', '[id]', 'curriculum', '+page.svelte'),
  'utf8'
);

/**
 * The source with its COMMENTS removed — the same helper, for the same reason, as
 * `builder-failure-states.test.ts`.
 *
 * Every negative assertion below runs against this, and it is load-bearing rather
 * than tidy: both files now DOCUMENT the traps by naming them ("`err instanceof
 * Error` was FALSE for every…", "never `err.message`"), so a `not.toContain` over
 * the raw text would fail on the very comment that records the fix. Line comments
 * are stripped only when they start a line, which is how all of them are written.
 */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

const NEW_CODE = code(NEW_ROUTE);
const CURRICULUM_CODE = code(CURRICULUM);

/**
 * Slice a function body out of the comment-stripped source by brace matching.
 *
 * Needed because several assertions are about WHICH function contains a token —
 * `confirm(` appears legitimately in `handleSave`-adjacent code elsewhere in a
 * file, and the `leave` arm's whole point is that `confirm` is absent from IT.
 */
function body(source: string, signature: string): string {
  const at = source.indexOf(signature);
  if (at < 0) return '';
  let i = source.indexOf('{', at);
  if (i < 0) return '';
  let depth = 0;
  const start = i;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

describe('the guard reads the files it claims to check', () => {
  it('found both routes and stripped their comments without emptying them', () => {
    // Guards the guard. A moved file or a comment-stripper that ate the code
    // would make every assertion below pass over an empty string — the same
    // false positive as a gate reporting green for a suite it never ran.
    expect(NEW_CODE.length).toBeGreaterThan(500);
    expect(CURRICULUM_CODE.length).toBeGreaterThan(2000);
    expect(NEW_CODE).toContain('createJourney(');
    expect(CURRICULUM_CODE).toContain('saveCourseCurriculum(');
  });
});

describe('studio/journeys/new — the create failure says why', () => {
  it('routes the rejection through queryErrorMessage', () => {
    expect(NEW_CODE).toContain('queryErrorMessage');
    expect(NEW_CODE).toContain("from '$lib/remote/query-result'");
  });

  it('does NOT gate the message on `instanceof Error`', () => {
    // The whole defect: `HttpError` is not an `Error`, so this test discarded
    // every server-supplied reason the create path can produce.
    expect(NEW_CODE).not.toMatch(/instanceof\s+Error/);
  });

  it('never reads `.message` off the rejection directly', () => {
    expect(NEW_CODE).not.toMatch(/err\s*\.\s*message/);
    expect(NEW_CODE).not.toMatch(/\.error\?\.message/);
  });

  it('still falls back to the localised generic when there is no text', () => {
    // The fallback is not optional: `queryErrorMessage` returns the fallback for
    // an unrecognised shape, and `null` only for a null/undefined rejection —
    // which a `throw null` can still produce inside a catch.
    expect(NEW_CODE).toContain('m.studio_journey_new_toast_failed()');
  });
});

describe('curriculum editor — the save failure says why', () => {
  const save = body(CURRICULUM_CODE, 'async function handleSave');

  it('binds the rejection instead of discarding it', () => {
    expect(save).not.toMatch(/}\s*catch\s*{/);
    expect(save).toMatch(/catch\s*\(\s*err\s*\)/);
  });

  it('reads it through queryErrorMessage, never `err.message`', () => {
    expect(save).toContain('queryErrorMessage(err');
    expect(save).not.toMatch(/err\s*\.\s*message/);
  });

  it('leaves the draft dirty so a transient failure is still one press from a retry', () => {
    // `dirty` is set to false only inside `seed()`, which runs on the SUCCESS
    // path. A `dirty = false` in the catch or the finally would make a failed
    // save disable its own retry.
    const tail = save.slice(save.indexOf('catch'));
    expect(tail).not.toMatch(/dirty\s*=\s*false/);
  });
});

describe('curriculum editor — the read and picker failures say why', () => {
  it('derives the load error through queryErrorMessage', () => {
    expect(CURRICULUM_CODE).toMatch(
      /loadError\s*=\s*\$derived\(\s*queryErrorMessage\(/
    );
    expect(CURRICULUM_CODE).not.toMatch(/\.error\?\.message/);
  });

  it('offers a retry and a way back out INSIDE the failed-read arm', () => {
    // SLICED to the arm, and that is the difference between a real assertion and
    // a vacuous one: `curriculumQuery.refresh?.()` also appears in `handleSave`,
    // and `href="/studio/journeys"` in the breadcrumb — so a file-wide
    // `toContain` passed against the PRE-FIX single-paragraph arm. Measured: it
    // did. The whole editor is behind this arm, so with no link a creator who
    // arrived from a bookmark had only the browser's own controls.
    const arm = CURRICULUM_CODE.slice(
      CURRICULUM_CODE.indexOf('{:else if loadError}'),
      CURRICULUM_CODE.indexOf(
        '{:else}',
        CURRICULUM_CODE.indexOf('{:else if loadError}')
      )
    );
    expect(arm.length).toBeGreaterThan(100);
    expect(arm).toContain('{loadError}');
    expect(arm).toContain('curriculumQuery.refresh?.()');
    expect(arm).toContain('href="/studio/journeys"');
    expect(arm).toContain('role="alert"');
  });

  it('derives a picker error, and renders it BEFORE the empty arm', () => {
    expect(CURRICULUM_CODE).toMatch(
      /pickerError\s*=\s*\$derived\(\s*queryErrorMessage\(/
    );

    const errorArm = CURRICULUM_CODE.indexOf('{:else if pickerError}');
    const emptyArm = CURRICULUM_CODE.indexOf(
      '{:else if pickerOptions.length === 0}'
    );
    expect(errorArm).toBeGreaterThan(-1);
    expect(emptyArm).toBeGreaterThan(-1);
    // ORDER IS THE ASSERTION. Behind the empty arm the error arm is unreachable
    // whenever the read rejects, which is every time it matters.
    expect(errorArm).toBeLessThan(emptyArm);
  });
});

describe('curriculum editor — unsaved work is guarded', () => {
  const guard = body(CURRICULUM_CODE, 'beforeNavigate(');

  it('registers a beforeNavigate guard at all', () => {
    expect(CURRICULUM_CODE).toContain("from '$app/navigation'");
    expect(guard.length).toBeGreaterThan(40);
  });

  it('gates on the editor’s own dirty flag and cancels the navigation', () => {
    expect(guard).toMatch(/if\s*\(\s*!dirty\s*\)\s*return/);
    expect(guard).toContain('navigation.cancel()');
  });

  it('cancels a `leave` WITHOUT confirm(), and confirms every other type', () => {
    // A `confirm()` on the unload path is suppressed by the browser and returns
    // false immediately, so calling both asks the creator twice — once through a
    // dialog they never see.
    const leave = guard.slice(guard.indexOf("navigation.type === 'leave'"));
    const untilConfirm = leave.slice(0, leave.indexOf('confirm('));
    expect(leave).toContain("navigation.type === 'leave'");
    expect(untilConfirm).toContain('navigation.cancel()');
    expect(untilConfirm).toContain('return');
    // And the confirm branch still exists for an in-app navigation.
    expect(guard).toMatch(/confirm\(\s*'You have unsaved curriculum changes/);
  });
});
