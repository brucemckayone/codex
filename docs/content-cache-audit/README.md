# Content Mutation Cache Integrity (Codex-c01do)

Sibling epic to the subscription cache audit (`docs/subscription-cache-audit/`).
Where that epic closed the subscription-lifecycle invalidation gaps, this one
closes the **content-mutation** invalidation gaps: content update (access-config
edits), unpublish, delete, publish, membership role changes, and follow/unfollow.

## The gap

`libraryCollection` in `apps/web/src/lib/collections/library.ts` is localStorage-
backed. Each entry carries per-item access metadata (`accessType`, `priceCents`,
`minimumTierId`). The per-user library version key
`COLLECTION_USER_LIBRARY(userId)` only bumped on:

- Purchase webhook (ecom-api)
- Subscription lifecycle events (`packages/subscription/src/services/subscription-invalidation.ts`)

Content mutations did **not** bump the per-user key. As a result:

- Creator edits a content item's accessType (free → subscribers)
- User's library UI on another device still shows the old accessType until
  the next `visibilitychange → invalidate('cache:versions')` roundtrip

Access decisions at click time are always live (server-side), so this is
**UX drift, not a security bug**. But per `feedback_dont_defer_cache_issues`
cache gaps warrant proactive target solutions.

## Design — Option A (per-user fanout) + existing revocation (Option D)

We evaluated four options:

| Option | Trade-off | Chosen? |
|---|---|---|
| **A — Per-user fanout** | Precise, O(N) KV writes where N = users with access. Cap required for unbounded audiences. | ✅ Yes |
| **B — Per-org library version** (`org:{orgId}:library`) | Cheap (1 write), but noisy for content-heavy orgs. | Future work |
| **C — SSE/WebSocket broadcast** | Real-time, large architectural shift. | Parked |
| **D — `AccessRevocation` KV block-list** | Already live for subscription lifecycle. Complements rather than replaces A. | ✅ (already in place) |

### Fanout cost analysis

Per-mutation fanout size (realistic platform-scale reasoning):

| Access mode | Fanout set | Typical size |
|---|---|---|
| `team` | org management roles | 5–50 |
| `subscribers` | active subs at org | 100s–1000s |
| `paid` / hybrid | purchasers ∪ subs | dozens–hundreds |
| `followers` | org followers | can be very large |

Option A is fine for bounded sets. For `followers` content, the union can
exceed any reasonable cap, so `invalidateContentAccess` defaults
`includeFollowers: false` and applies a hard cap
(`DEFAULT_MAX_LIBRARY_FANOUT = 500`). Above the cap we log + skip per-user
fanout and rely on the visibility-change roundtrip.

## Implementation summary

Helper location: `packages/content/src/services/content-invalidation.ts`.

| Entry point | Scope | Callers |
|---|---|---|
| `invalidateContentAccess(args)` | Per-content fanout + catalogue | content-api content.update/publish/unpublish/delete |
| `invalidateOrgMembership(args)` | Single user | organization-api members.{invite,update-role,remove}, followers.{follow,unfollow} |

Each entry point follows the `subscription-invalidation.ts` pattern:
- Fire-and-forget via `waitUntil`
- Swallow KV failures through an optional `logger`
- ValidationError on missing required ids (no silent no-op)

See:
- `packages/content/src/services/content-invalidation.ts`
- `workers/content-api/src/routes/content.ts` (`fanContentInvalidation`)
- `workers/organization-api/src/routes/members.ts` (`bumpUserLibrary`)
- `workers/organization-api/src/routes/followers.ts` (`bumpUserLibrary`)

## Test matrix

### Unit (`packages/content/src/services/__tests__/content-invalidation.test.ts`)

- Catalogue bumps fire unconditionally
- Org-collection bump skipped for personal content (`organizationId === null`)
- Per-user union across purchases + subscribers + management
- Deduplication when a user is in multiple sources
- `includeFollowers` opt-in adds followers
- Fanout cap — above the cap, bumps are skipped and a warning is logged
- KV rejections swallowed via `.catch`
- `waitUntil` called synchronously per bump
- `ValidationError` on missing/empty `contentId`
- Membership helper: positive + negative + ValidationError paths
- Exports stable `DEFAULT_MAX_LIBRARY_FANOUT = 500`

### Integration (out of scope for PR 1)

The worker route layer re-uses existing integration test infrastructure for
content-api / organization-api. Adding KV-assertion tests there is tracked
as a follow-up bead — the helper itself is fully unit tested and the route
wiring is a one-line call.

### Manual / E2E

- Admin edits content accessType → subscribed user's library reflects the
  new value after one invalidate roundtrip, no page reload
- Admin toggles content subscription-inclusion → user's library card
  updates within a few seconds without reload
- Existing subscription-lifecycle tests still green (no double-bumps, no
  missed bumps)

## Files changed (PR — Codex-c01do)

| File | Change |
|---|---|
| `packages/content/src/services/content-invalidation.ts` | **new** — shared helpers |
| `packages/content/src/services/index.ts` | export new helpers |
| `packages/content/src/index.ts` | re-export from package root |
| `packages/content/src/services/__tests__/content-invalidation.test.ts` | **new** — 15 unit tests |
| `workers/content-api/src/routes/content.ts` | new `fanContentInvalidation` helper; wire into update/publish/unpublish/delete |
| `workers/organization-api/src/routes/members.ts` | new `bumpUserLibrary` helper; wire into invite/update-role/remove |
| `workers/organization-api/src/routes/followers.ts` | new `bumpUserLibrary` helper; wire into follow/unfollow |
| `docs/caching-strategy.md` | document new invalidation triggers |
| `docs/content-cache-audit/README.md` | **new** — this file |

## Open follow-ups

- Consider adding Option B (per-org library version) alongside Option A for
  follower-heavy orgs where the cap is routinely hit.
- Add KV-level integration tests for content-api + organization-api routes
  asserting that the version keys are bumped after each mutation.
- Playwright cross-device spec mirroring `apps/web/e2e/account-subscription-cancel.spec.ts`.
