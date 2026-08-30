/**
 * Portals list — row lifecycle controls (Codex-c3lky · WP-H).
 *
 * WHY STRUCTURAL ASSERTIONS OVER A RENDERED COMPONENT. Same reasoning as the
 * builder's own `__tests__` (see builder-top-bar.test.ts): this route is inside
 * the `ssr = false` studio subtree and every row it draws comes from a live
 * `query()`, which dies on `app.hooks` when unmocked. The behaviour that CAN be
 * exercised — the read-then-write, the cascade path, the error forwarding — is
 * covered as real behaviour in `portals-lifecycle.remote.test.ts` beside this
 * file. What is left here is the wiring that is silent when it breaks:
 *
 *   1. A DESTRUCTIVE ACTION THAT DOES NOT ASK. Unpublish and Archive take a live
 *      page down AND remove it from the library of everyone enrolled. If the
 *      confirm gate is ever inverted or dropped, nothing visibly breaks — the
 *      button just becomes immediate.
 *   2. `?preview=1` FALLING OFF THE VIEW-LIVE LINK. The public sell page
 *      redirects an ENTITLED visitor to the course dashboard, and an org owner is
 *      always entitled, so without the param the creator silently lands on the
 *      dashboard and concludes their sales page is broken (O11). Measured on this
 *      fixture: with the param, 4 `[data-section-type]`; without it, a redirect
 *      to `/journeys/<slug>/dashboard` and 0.
 *   3. `err.message` CREEPING BACK IN. SvelteKit rejects with an `HttpError`
 *      whose text is at `body.message` and which has NO top-level `message`, so
 *      the direct read is `undefined` for EVERY failure and the alert renders as
 *      an empty box (Codex-xo3bl) — a green-looking failure.
 *   4. A PAGE-WIDE PENDING FLAG. One boolean would disable every row's controls
 *      while one write was in flight, which reads as the page having frozen.
 *   5. "Are you sure?" REPLACING THE COPY. The register these panels set is: say
 *      what it does, say what happens, name what survives (O22).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');

/**
 * The route with every COMMENT stripped.
 *
 * Load-bearing: this file's own doc comments quote the anti-patterns they warn
 * against ("never `err.message`"), so a raw substring search for one finds the
 * warning and fails on correct code. The same shape as counting `grep` LINES and
 * calling it occurrences.
 */
function codeOnly(): string {
  return (
    ROUTE
      // Svelte / HTML comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // JS + CSS block comments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // whole-line JS comments
      .replace(/^\s*\/\/.*$/gm, '')
  );
}

/** The row's lifecycle group — so an assertion cannot drift onto the nav group. */
function lifecycleGroup(): string {
  const open = ROUTE.indexOf('<div class="journey-row__lifecycle">');
  const close = ROUTE.indexOf('<div class="journey-row__nav">', open);
  if (open < 0 || close < 0) throw new Error('lifecycle group not found');
  return ROUTE.slice(open, close);
}

/** The nav group — the pre-existing Feature / Curriculum / Insights / Edit row. */
function navGroup(): string {
  const open = ROUTE.indexOf('<div class="journey-row__nav">');
  const close = ROUTE.indexOf('</ol>', open);
  if (open < 0 || close < 0) throw new Error('nav group not found');
  return ROUTE.slice(open, close);
}

/** The `requestStatus` function body — the confirm gate. */
function requestStatusBody(): string {
  const match = ROUTE.match(
    /function requestStatus\([^)]*\):\s*void\s*\{([\s\S]*?)\n {2}\}/
  );
  if (!match) throw new Error('requestStatus not found');
  return match[1];
}

/** The `confirmCopy` derivation — every dialog string the page can show. */
function confirmCopySource(): string {
  const start = ROUteIndex();
  const end = ROUTE.indexOf('\n  });', start);
  if (end < 0) throw new Error('confirmCopy end not found');
  return ROUTE.slice(start, end);
}
function ROUteIndex(): number {
  const i = ROUTE.indexOf('const confirmCopy = $derived.by(');
  if (i < 0) throw new Error('confirmCopy not found');
  return i;
}

describe('portals list — lifecycle row actions', () => {
  it('offers every transition the bead asked for, each gated on the row status', () => {
    const group = lifecycleGroup();
    // Published → take it down or shelve it, and see it.
    expect(group).toContain("{#if j.status === 'published'}");
    expect(group).toContain("'draft', 'Unpublish', 'Unpublishing…'");
    // Archived → a way BACK. An archive with no un-archive is a one-way door.
    expect(group).toContain("{:else if j.status === 'archived'}");
    expect(group).toContain("'draft', 'Restore', 'Restoring…'");
    // Draft (the else) → publish.
    expect(group).toContain("'published', 'Publish', 'Publishing…'");
    // Archive on an already-archived row is a no-op, so it is not offered.
    expect(group).toContain("{#if j.status !== 'archived'}");
    expect(group).toContain("'archived', 'Archive', 'Archiving…'");
  });

  it('renders View live ONLY inside the published branch, with ?preview=1', () => {
    const group = lifecycleGroup();
    const anchor = group.match(/<a[\s\S]*?<\/a>/);
    expect(anchor).not.toBeNull();
    const tag = anchor?.[0] ?? '';
    expect(tag).toContain('href="/journeys/{j.slug}?preview=1"');
    expect(tag).toContain('target="_blank"');
    expect(tag).toContain('rel="noopener"');

    // It must sit BEFORE the first `{:else`, i.e. inside the published arm — a
    // draft has no live page and the link would 404.
    const publishedArm = group.slice(
      group.indexOf("{#if j.status === 'published'}"),
      group.indexOf('{:else if')
    );
    expect(publishedArm).toContain('?preview=1');

    // And nowhere else in the row.
    expect(navGroup()).not.toContain('?preview=1');
  });

  it('confirms the two destructive transitions and NOT the two forward ones', () => {
    const body = requestStatusBody();
    // Publishing, and any move off `archived`, act immediately.
    //
    // Matched to the CLOSING PAREN, not by substring: a mutant that appends
    // `|| to === 'draft'` — which is exactly how Unpublish would lose its
    // confirm — still CONTAINS the shorter condition, so `toContain` here is a
    // guard that cannot fail. Verified by running that mutant.
    expect(body).toMatch(
      /if \(to === 'published' \|\| j\.status === 'archived'\) \{/
    );
    expect(body).toContain('void applyStatus(j.id, to)');
    // Everything else — unpublish, archive — opens the dialog first.
    expect(body).toContain('confirmOpen = true');
    // The dialog must be the ONLY route to those two: no direct applyStatus call
    // after the early return.
    const afterReturn = body.slice(body.indexOf('return;'));
    expect(afterReturn).not.toContain('applyStatus');
  });

  it('names the real consequence in the confirm copy — never "Are you sure?"', () => {
    const copy = confirmCopySource();
    expect(copy).not.toMatch(/are you sure/i);
    // The non-obvious half: the course cascade removes an unpublished portal from
    // an enrolled member's library, because `courses.status` gates the enrolled
    // shelves and the course dashboard.
    expect(copy).toContain('loses it from their library');
    // …and what survives it, so the creator is not guessing.
    expect(copy).toContain('progress are kept');
    expect(copy).toMatch(/nothing is deleted/i);
    // A draft never resolved publicly, so its archive copy must not claim it did.
    expect(copy).toContain('so nothing changes for visitors');
    // Three distinct cancel labels — a cancel button that says the wrong thing is
    // its own hazard.
    expect(copy).toContain("cancelText: 'Keep it published'");
    expect(copy).toContain("cancelText: 'Leave it in Draft'");
  });

  it('tracks pending per ROW, not per page', () => {
    // An id-bearing record, not a boolean.
    expect(ROUTE).toContain(
      'let statusPending = $state<{ pageId: string; to: PageStatus } | null>(null)'
    );
    // Every lifecycle button gates its own row.
    const group = lifecycleGroup();
    const disabled = group.match(/disabled=\{[^}]*\}/g) ?? [];
    expect(disabled.length).toBeGreaterThanOrEqual(4);
    for (const attr of disabled) {
      expect(attr).toBe('disabled={statusPending?.pageId === j.id}');
    }
  });

  it('reads every failure through queryErrorMessage, never err.message', () => {
    expect(ROUTE).toContain('statusError = queryErrorMessage(');
    // The whole file: an `HttpError` has no top-level `message`, so any such read
    // is dead code that renders an empty alert.
    const code = codeOnly();
    expect(code).not.toMatch(/\berr\.message\b/);
    expect(code).not.toMatch(/\.error\?\.message\b/);
    // Announced, not merely painted.
    expect(ROUTE).toContain(
      '<p class="journeys__action-error" role="alert">{statusError}</p>'
    );
  });

  it('stays a LIST of rows and token-only — no card grid, no hardcoded colours', () => {
    // The prototype (docs/design/course-journeys/prototype/studio-journeys.html)
    // is a row list, and the studio shell owns the column width.
    expect(ROUTE).toContain('<ol class="journeys__rows" role="list">');
    expect(ROUTE).not.toMatch(/grid-template-columns/);
    // Every colour comes from a token; a literal hex would pin one org's palette
    // into shared studio chrome.
    const styles = ROUTE.slice(ROUTE.indexOf('<style>'));
    expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
