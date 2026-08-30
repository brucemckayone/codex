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
 *
 * WP-Q added three more of the same kind:
 *
 *   6. THE COVER TILE COLLAPSING TO AN EMPTY BOX. 4 of the 7 seeded portals have
 *      no cover, so the FALLBACK is the common case, not the edge one — and an
 *      `{#if coverImageUrl}` with no `{:else}` looks fine in a screenshot of the
 *      org that does have covers.
 *   7. DELETE ACTING ON A PUBLISHED PORTAL. Deleting a live page leaves
 *      `courses.status` published with no sales page behind it — the course stays
 *      in /explore and in enrolled libraries while `/journeys/:slug` 404s, which
 *      is the exact divergence `cascadeCourseFromPage` exists to prevent. The
 *      list must route that press to the unpublish-first dialog, never to the
 *      delete.
 *   8. THE DIALOG'S `variant` GOING BACK TO A CONSTANT. It was hardcoded
 *      `destructive` when every act was one. Duplicate CREATES something; a red
 *      confirm button on it misdescribes the act, and a hardcoded attribute is
 *      invisible in a diff of the copy.
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

/**
 * The row's lifecycle group — so an assertion cannot drift onto a sibling group.
 * It now ends at `journey-row__manage` (WP-Q inserted that group between
 * lifecycle and nav); the group's own tests below cover Duplicate/Delete.
 */
function lifecycleGroup(): string {
  const open = ROUTE.indexOf('<div class="journey-row__lifecycle">');
  const close = ROUTE.indexOf('<div class="journey-row__manage">', open);
  if (open < 0 || close < 0) throw new Error('lifecycle group not found');
  return ROUTE.slice(open, close);
}

/** The row's EXISTENCE group — Duplicate + Delete. */
function manageGroup(): string {
  const open = ROUTE.indexOf('<div class="journey-row__manage">');
  const close = ROUTE.indexOf('<div class="journey-row__nav">', open);
  if (open < 0 || close < 0) throw new Error('manage group not found');
  return ROUTE.slice(open, close);
}

/** The cover tile's markup. */
function coverBlock(): string {
  const open = ROUTE.indexOf('<div class="journey-row__cover"');
  const close = ROUTE.indexOf('<div class="journey-row__main">', open);
  if (open < 0 || close < 0) throw new Error('cover block not found');
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

/** The `requestDelete` function body — the published-page gate. */
function requestDeleteBody(): string {
  const match = ROUTE.match(
    /function requestDelete\(j: \{[\s\S]*?\}\): void \{([\s\S]*?)\n {2}\}/
  );
  if (!match) throw new Error('requestDelete not found');
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

  it('offers Duplicate and Delete in a group of their own, gated per ROW', () => {
    const group = manageGroup();
    expect(group).toContain("? 'Duplicating…'");
    expect(group).toContain("      : 'Duplicate'");
    expect(group).toContain("? 'Deleting…'");
    expect(group).toContain("      : 'Delete'");

    // An id-bearing record, not a boolean — one write must not freeze the list.
    expect(ROUTE).toContain(
      "let managePending = $state<{\n    pageId: string;\n    kind: 'duplicate' | 'delete';\n  } | null>(null)"
    );
    const disabled = group.match(/disabled=\{[^}]*\}/g) ?? [];
    expect(disabled.length).toBe(2);
    for (const attr of disabled) {
      expect(attr).toBe('disabled={managePending?.pageId === j.id}');
    }

    // These MUTATE, so they are buttons. A link would be followable, prefetchable
    // and middle-clickable.
    expect(group).not.toMatch(/<a[\s>]/);
  });

  it('renders Delete on a PUBLISHED row and routes it to the unpublish-first dialog', () => {
    // Rendered unconditionally on purpose: hiding it leaves a creator hunting for
    // a control that exists on other rows, and a `disabled` button explains
    // itself only to a pointer. The BRANCH is what makes it safe.
    const group = manageGroup();
    expect(group).not.toContain('{#if j.status');

    const body = requestDeleteBody();
    // Matched to the closing brace of the ternary arm, not by substring: a mutant
    // that inverts the test still CONTAINS the shorter string.
    expect(body).toMatch(
      /action: j\.status === 'published' \? 'unpublish-first' : 'delete',/
    );
    // And the delete request must never reach `applyDelete` directly — the dialog
    // is the only route to it.
    expect(body).not.toContain('applyDelete');
    expect(body).toContain('confirmOpen = true');
  });

  it('derives the dialog variant instead of hardcoding destructive', () => {
    // Duplicate CREATES something. A red confirm button on it is a lie about the
    // act, and the old hardcoded attribute would not show up in a copy diff.
    expect(ROUTE).toContain("variant={confirmCopy?.variant ?? 'destructive'}");
    expect(ROUTE).not.toContain('variant="destructive"');
    const copy = confirmCopySource();
    expect(copy).toContain("variant: 'primary' as const");
    expect(copy).toContain("variant: 'destructive' as const");
  });

  it('names what a duplicate does NOT copy, and what a delete does not take', () => {
    const copy = confirmCopySource();
    // The whole reason duplicate asks at all: "duplicate portal" reads as
    // "duplicate the journey", and the copy shares one course with the original.
    expect(copy).toContain('It does NOT copy the course');
    expect(copy).toMatch(/price is not copied/i);
    // Delete: the constraint, then what survives, then that it is one-way.
    expect(copy).toContain('A live portal cannot be deleted');
    expect(copy).toMatch(/their purchase and their progress are kept/);
    expect(copy).toMatch(/no Restore for a delete/);
    // Same register as the rest — never the empty question.
    expect(copy).not.toMatch(/are you sure/i);
  });

  it('does not tell a plain landing page about a course it has not got', () => {
    // `subjectType` rides on the confirm target precisely so the copy can branch.
    // Copy that asserts a curriculum a page does not have is the same defect as a
    // missing warning, in the other direction.
    const copy = confirmCopySource();
    expect(copy).toContain("const isCourse = t.subjectType === 'course'");
    // The course-specific sentences must sit on the `isCourse` side of a ternary,
    // so each of the three branches offers both wordings.
    const branches = copy.match(/description: isCourse\s*\n?\s*\?/g) ?? [];
    expect(branches.length).toBe(3);
  });

  it('renders the cover tile with a typographic fallback, never an empty box', () => {
    const block = coverBlock();
    // 4 of the 7 seeded portals have no cover, so the fallback is the COMMON case.
    expect(block).toContain('{#if j.coverImageUrl}');
    expect(block).toContain('{:else}');
    expect(block).toContain('{coverInitial(j.title)}');
    // A real <img>, lazily loaded, with an empty alt — the title is right beside
    // it and the tile is decoration.
    expect(block).toContain('src={j.coverImageUrl}');
    expect(block).toContain('alt=""');
    expect(block).toContain('loading="lazy"');
    expect(block).toContain('aria-hidden="true"');

    // The plate is a background on the CONTAINER, so it paints in both states —
    // a slow or 404'd CDN object degrades to the tile, not to a white gap.
    const styles = ROUTE.slice(ROUTE.indexOf('<style>'));
    expect(styles).toMatch(/\.journey-row__cover \{[\s\S]*?background-image:/);
    // Token-derived brand colour, never a literal — the studio inherits the org
    // brand and a fixed hue would pin one org's palette into shared chrome.
    expect(styles).toContain('oklch(from var(--color-brand-primary)');
    // Ink that reads on a dark plate in BOTH themes (measured 7.34–7.73:1 min
    // across the three fixture orgs, identical light and dark).
    expect(styles).toContain('color: var(--media-glyph)');
  });

  it('keeps ONE confirm mechanism and ONE error channel for the row writes', () => {
    // A second dialog, or a toast used for a failure, is how two mechanisms drift
    // apart. Exactly one `<ConfirmDialog`, and every failure lands in the same
    // `role="alert"` paragraph class the lifecycle actions already use.
    expect(ROUTE.match(/<ConfirmDialog/g)?.length).toBe(1);
    expect(ROUTE).toContain('manageError = queryErrorMessage(');
    expect(ROUTE).toContain(
      '<p class="journeys__action-error" role="alert">{manageError}</p>'
    );
    // The toast is for the SUCCESS of a create — it names what was made, which
    // the dialog cannot because it is gone by then.
    expect(ROUTE).toContain('toast.success(');
    expect(codeOnly()).not.toMatch(/toast\.error\(/);
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
