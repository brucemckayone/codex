/**
 * User-Scoped Client State — clear on identity change
 *
 * ## The defect this exists to fix (Codex-1g5lh.17)
 *
 * Every piece of persisted client state in this app lives under a GLOBAL
 * storage key: `codex-following`, `codex-library`, `codex-playback-progress`
 * and friends carry no user id. Follow as user A, sign out, sign in as user B
 * in the same browser, and B reads A's map straight out of localStorage. For
 * follows that is worse than a cosmetic wrong label: `followingStore.get()`
 * feeds `isFollowing` into `useAccessContext`, so a stale `true` makes
 * follower-gated content read as unlocked, and `followingStore.has()` returning
 * true makes `_org/[slug]/+layout.svelte` SKIP the server hydration that would
 * otherwise correct it. The wrong value is therefore sticky, not transient.
 *
 * ## Why the pre-existing clear did not work
 *
 * A `clearClientState()` already existed here and already listed
 * `codex-following`. Its only caller is `routes/(auth)/login/+page.svelte`,
 * on mount, gated on `?logout=1`. That hook cannot work for the state that
 * actually matters, for two independent reasons:
 *
 *  1. **Wrong origin.** `routes/logout/+page.server.ts` redirects to
 *     `buildPlatformUrl(url, '/login?logout=1')` — always the BASE domain.
 *     Every `followingStore` call site is under `routes/_org/[slug]/`, which
 *     `hooks.ts` serves from `{slug}.<base-domain>`. localStorage is
 *     partitioned per ORIGIN, so clearing on the platform login page cannot
 *     reach the org subdomain's store. It never could.
 *  2. **Wrong trigger.** Sign-out is not the only identity change. A session
 *     can expire, or a different user can sign in, without the first user's
 *     tab ever running a logout handler.
 *
 * ## The primitive
 *
 * Rather than reacting to a sign-out EVENT, this module records WHO the
 * persisted state on this origin belongs to (`codex-state-owner`) and
 * reconciles that against the currently-authenticated user on every page
 * load — see `reconcileStateOwner`. A mismatch wipes the user-scoped state
 * before anything reads it. Because the check runs on whichever origin is
 * being loaded, using that origin's own `data.user`, it is immune to the
 * cross-origin problem above: the org subdomain corrects itself on user B's
 * first visit, with no cooperation needed from the platform origin.
 *
 * ## Why an owner marker instead of user-scoping the keys
 *
 * Putting the user id IN the key (`codex-following:{userId}`) would also give
 * isolation, and it needs no trigger to fire. It was rejected as the primary
 * mechanism because it does not reach the state that matters:
 *
 *  - Four of the seven user-scoped stores are TanStack DB collections whose
 *    `storageKey` is baked into a module-level `createCollection(...)` call
 *    evaluated at import time (`collections/library.ts`, `progress.ts`,
 *    `subscription.ts`, `dismissals.ts`). No user id exists at that point —
 *    the session cookie is `httpOnly` (`packages/urls/src/cookie-config.ts:42`)
 *    so the client cannot even read it synchronously. Re-keying them means
 *    turning every collection singleton into a factory and reworking every
 *    consumer that imports it.
 *  - `following.svelte.ts` has the same problem: its `$state` is seeded from
 *    localStorage at module init, before any layout runs.
 *  - Per-user keys grow without bound on a shared browser, and nothing would
 *    ever collect them.
 *
 * The owner marker gets key-scoping's real guarantee — a read can never see
 * another user's data — because the marker is verified on EVERY load rather
 * than only at a sign-out event, while staying a ~1 file change and bounding
 * growth to a single user's worth of state. What it does not give is
 * isolation between two users' state simultaneously (there is only ever one
 * user's state on an origin), which nothing here needs.
 *
 * ## In-memory copies must be reset too
 *
 * Clearing localStorage is not enough. `following.svelte.ts` holds a module
 * singleton `$state` seeded at import time, and the TanStack collections hold
 * their rows in `collection.state`. Both are evaluated when the bundle loads —
 * BEFORE any layout runs — so a storage-only wipe leaves the stale values
 * live in memory for the rest of the document's life. Modules that keep such
 * a copy register a reset via `registerUserScopedReset`, and
 * `clearUserScopedState()` runs every registered reset after removing the
 * keys.
 *
 * @see registerUserScopedReset — how a store opts in to being reset.
 * @see reconcileStateOwner — the identity-change hook; called from
 *   `routes/+layout.svelte`, which renders on every origin.
 */

import { browser } from '$app/environment';

/**
 * localStorage key holding the id of the user the persisted state belongs to.
 *
 * Deliberately NOT in `USER_SCOPED_LOCAL_KEYS` — it is the marker, not the
 * state. `clearUserScopedState()` removes it explicitly so the invariant
 * "marker present ⇒ every listed key belongs to that user" always holds.
 */
export const STATE_OWNER_KEY = 'codex-state-owner';

/**
 * localStorage keys whose contents belong to the SIGNED-IN USER and must not
 * survive an identity change.
 *
 * Keep this list and `USER_SCOPED_SESSION_KEYS` as the single inventory of
 * user-scoped client state. Adding a new persisted store means adding its key
 * here (and registering an in-memory reset if it caches rows in a module
 * singleton).
 */
export const USER_SCOPED_LOCAL_KEYS = [
  /**
   * `client/version-manifest.ts` — the cache-version manifest. Its entries are
   * literally user-keyed (`user:{userId}:library`,
   * `user:{userId}:subscription:{orgId}`), so keeping it across an identity
   * change would make the staleness diff reason about the previous user.
   */
  'codex-versions',
  /**
   * `collections/library.ts` (via `library/schema-version.ts`) — everything
   * THIS user owns. The single biggest leak in the set.
   */
  'codex-library',
  /**
   * `library/schema-version.ts` — the schema stamp for `codex-library`. An
   * attribute of that payload, so it is cleared with it rather than left as an
   * orphan stamp describing data that no longer exists.
   */
  'codex-library-schema',
  /**
   * `collections/progress.ts` — THIS user's playback positions and course
   * completions. Worse than a display leak: `collections/progress-sync.ts`
   * flushes unsynced rows to the server through a remote function that derives
   * the user from the session cookie, so rows surviving into the next session
   * would be WRITTEN to the new user's account.
   */
  'codex-playback-progress',
  /** `collections/subscription.ts` — THIS user's per-org subscription state. */
  'codex-subscription',
  /**
   * `collections/dismissals.ts` — THIS user's dismissed CTAs and banners
   * (`subscribe-cta:{orgId}`, `creator-onboarding-checklist`). Was missing
   * from the pre-fix key list, so a new user inherited the previous user's
   * suppressed upsells and skipped the first-run checklist.
   */
  'codex-dismissals',
  /**
   * `client/following.svelte.ts` — which orgs THIS user follows. The reported
   * symptom, and an input to follower-gated access rendering.
   */
  'codex-following',
  /**
   * `components/search/CommandPaletteSearch.svelte` — THIS user's recent
   * search terms. A privacy leak to whoever signs in next, and was missing
   * from the pre-fix key list.
   */
  'codex-recent-searches',
] as const;

/**
 * sessionStorage keys that belong to the signed-in user.
 *
 * sessionStorage survives a same-tab navigation, and logout IS a same-tab
 * navigation (`utils/navigation.ts` `submitFormPost` does a native form
 * submit), so these genuinely carry across an identity change in one tab.
 * Nothing cleared sessionStorage before this module existed.
 */
export const USER_SCOPED_SESSION_KEYS = [
  /**
   * `components/subscription/HealthBanner.svelte` — dismissal of a banner
   * about THIS user's failing payment. Inheriting it hides a new user's own
   * payment problem.
   */
  'codex:subscription-banner-dismissed',
  /**
   * `brand-editor/brand-editor-store.svelte.ts` — THIS user's UNSAVED brand
   * draft. Restore is gated on `restored.orgId === orgId`, so the leak is
   * narrow (two users of the same org, same tab) but it is one user's unsaved
   * work shown to another.
   */
  'codex:brand-editor',
  /** `page-builder/page-builder-store.svelte.ts` — same shape as above. */
  'codex:page-builder',
] as const;

/**
 * Keys deliberately NOT cleared, recorded here so the decision is reviewable
 * and a future audit does not "helpfully" add them. Wiping a device
 * preference on sign-in is its own regression.
 *
 *  - `theme` (`theme.svelte.ts:20`) — light/dark belongs to the screen, not
 *    the account. It is also mirrored into a non-`httpOnly` `theme` cookie for
 *    SSR; clearing one side desyncs them and produces a first-paint flash.
 *  - `codex-player-prefs` (`VideoPlayer/preferences.ts:3`) — volume / muted /
 *    playbackRate belong to the speakers. Clearing this un-mutes the next
 *    person at whatever volume the default is.
 *  - `codex-payout-rail-count:{hostname}`
 *    (`studio/payouts/CreatorBreakdownRail.svelte:63`) — a skeleton ROW COUNT
 *    kept to avoid layout shift, keyed by studio hostname. It describes the
 *    org's creator count, which any operator of that studio can see anyway.
 *    Clearing it only reintroduces the layout shift it exists to prevent.
 *  - `codex:brand-studio-mode:{orgId}`
 *    (`brand-studio/guided/brand-studio-mode.ts:29`) — guided vs advanced
 *    editor mode. Org-keyed and only reachable behind org-admin auth; a wrong
 *    value costs one click, whereas clearing it resets a deliberate choice
 *    every time a colleague signs in on the same machine. The closest call in
 *    this list — it is arguably a per-user preference — and it is left alone
 *    because the cost of being wrong is a click and the cost of clearing is
 *    silently undoing an explicit choice.
 */
export const DEVICE_SCOPED_KEYS_NOT_CLEARED = [
  'theme',
  'codex-player-prefs',
  'codex-payout-rail-count:*',
  'codex:brand-studio-mode:*',
] as const;

type UserScopedReset = () => void;

/**
 * Reset callbacks for stores that keep an in-memory copy of user-scoped
 * state. A `Set` so a module that is somehow evaluated twice (HMR) does not
 * register the same function twice.
 */
const resets = new Set<UserScopedReset>();

/**
 * Register a callback that drops a module's in-memory copy of user-scoped
 * state. Called at module scope by every store that caches rows outside
 * localStorage.
 *
 * Registration is intentionally push-based rather than a hard-coded list here:
 * a store's reset only needs to run if that store's module was actually
 * loaded, and if it was not loaded there is no in-memory copy to reset —
 * removing the storage key is sufficient. It also avoids this module importing
 * the collections, which would invert the dependency direction.
 *
 * @returns an unregister function (for tests and HMR disposal).
 */
export function registerUserScopedReset(reset: UserScopedReset): () => void {
  resets.add(reset);
  return () => resets.delete(reset);
}

/** Test seam: drop every registered reset. */
export function __clearUserScopedResetsForTest(): void {
  resets.clear();
}

function removeKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage blocked (privacy mode / quota) — nothing to clear, and a
    // throw here must not take the page down.
  }
}

/**
 * Wipe every user-scoped store on this origin: persisted keys first, then the
 * in-memory copies via the registered resets, then the ownership marker.
 *
 * Order matters. The resets are run AFTER the keys are removed because a
 * TanStack DB reset deletes rows through the collection, which writes through
 * to localStorage — doing it the other way round would leave a freshly-written
 * empty payload behind instead of no key at all. The owner marker goes last so
 * that a throw part-way through cannot leave a marker claiming state that was
 * only half-cleared.
 *
 * Safe to call when already clean. Never throws.
 */
export function clearUserScopedState(): void {
  if (!browser) return;

  for (const key of USER_SCOPED_LOCAL_KEYS) removeKey(localStorage, key);
  for (const key of USER_SCOPED_SESSION_KEYS) removeKey(sessionStorage, key);

  for (const reset of resets) {
    try {
      reset();
    } catch {
      // One store failing to reset must not stop the others. The persisted
      // copy is already gone, so the worst case is a stale in-memory value
      // for the life of this document.
    }
  }

  // Belt-and-braces: a reset that writes through to storage (TanStack DB
  // `delete`) can recreate its key with an empty payload. Remove again.
  for (const key of USER_SCOPED_LOCAL_KEYS) removeKey(localStorage, key);

  removeKey(localStorage, STATE_OWNER_KEY);
}

/**
 * Outcome of a `reconcileStateOwner` pass. Returned rather than logged so the
 * branch is unit-testable and so a caller can observe it.
 *
 * - `unavailable`  — SSR or blocked storage; nothing happened.
 * - `anonymous`    — no authenticated user this load. Deliberately a no-op:
 *                    see the note in `reconcileStateOwner`.
 * - `unchanged`    — the marker already names this user; state is theirs.
 * - `claimed`      — state of UNKNOWN provenance was cleared and the marker
 *                    written. Covers first-ever sign-in on this origin AND
 *                    every browser that already holds pre-fix state.
 * - `switched`     — the marker named a DIFFERENT user. State cleared, marker
 *                    rewritten. This is the branch that fixes the reported
 *                    bug.
 */
export type StateOwnerOutcome =
  | 'unavailable'
  | 'anonymous'
  | 'unchanged'
  | 'claimed'
  | 'switched';

/**
 * Reconcile the persisted client state on this origin against the
 * currently-authenticated user, clearing it when it belongs to someone else.
 *
 * Call this SYNCHRONOUSLY from the root layout's script body — not from
 * `onMount`. Svelte runs child `onMount` callbacks before the parent's, so an
 * `onMount` here would fire AFTER `_org/[slug]/+layout.svelte` has already
 * asked `followingStore.has()` whether to hydrate from the server. Running in
 * the root layout's init puts the reconcile before every descendant's init and
 * before every `onMount` in the tree, which is the ordering the fix needs.
 *
 * ### Why `userId == null` does not clear
 *
 * A null user is NOT a reliable sign-out signal. `hooks.server.ts:61-69`
 * catches a failed session lookup and sets `locals.user = null`, so an
 * auth-worker blip is indistinguishable at the client from a real sign-out.
 * Clearing on it would flash an empty library at a still-signed-in user and
 * could drop playback progress that had not yet flushed. Correctness for the
 * reported bug does not need it: the `switched` branch is deterministic and
 * fires on the new user's very first load. The definitive sign-out signal
 * (`/logout` → `?logout=1`) still calls `clearUserScopedState()` directly on
 * the origin it lands on.
 *
 * @param userId the authenticated user's id for this load (`data.user?.id`).
 */
export function reconcileStateOwner(
  userId: string | null | undefined
): StateOwnerOutcome {
  if (!browser) return 'unavailable';

  let stored: string | null;
  try {
    stored = localStorage.getItem(STATE_OWNER_KEY);
  } catch {
    return 'unavailable';
  }

  if (!userId) return 'anonymous';
  if (stored === userId) return 'unchanged';

  clearUserScopedState();
  try {
    localStorage.setItem(STATE_OWNER_KEY, userId);
  } catch {
    // Marker could not be written (quota/blocked). The state was still
    // cleared, so this load is correct; the next load simply repeats the
    // clear as `claimed` rather than short-circuiting on `unchanged`.
  }

  return stored === null ? 'claimed' : 'switched';
}
