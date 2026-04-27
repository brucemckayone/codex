# iter-005a — rung 2 — Codex-v5bzy (parallel cycle)

> Parallel cycle to iter-005 (Codex-zhe80, rung-1, committed 731717da). Concurrent
> /triage agent claimed rung-1 work; this cycle picked the next-lowest non-empty
> rung (rung-2) per user policy 0–3. Suffix `iter-005a` per concurrent-agent
> safety §3 of brief.

## Bead

**Codex-v5bzy** — `bug(web): Spotlight.svelte creator-name always renders blank — type drift hides API mismatch`

- Priority: P1
- Type: bug
- Source: Tier 2.D investigation
- Related: Codex-mqyql.13 (ContentItem consolidation) — that bead's full close depends on this resolution.

## Classification reasoning

Bead body explicitly enumerates two reconciliation paths:

> (a) API is right — fix template to use `creator.name`; type extends ContentItem.
> (b) Template intent is right — extend canonical ContentItem to include `username/displayName/avatar`; verify upstream API actually returns them.

Per §3 ladder, rung-2 = "single-file or near-single-file but requires judgement: which approach is right". This is the textbook rung-2 case. Rung-1 ladder default would be `denoise:simplification:dup-content-item-shape` (rung 2 watch — explicitly noted in `references/01-complexity-ladder.md` denoise fingerprint table: "Watch pattern; needs review of which fields the shared shape keeps").

## Pre-flight gate

`bd show Codex-v5bzy --json` immediately before claim: `status=open`, `owner=brucemckayone@gmail.com`. After `bd update --status=in_progress`: status=in_progress, owner unchanged. Lock won. Concurrent /triage agent had not claimed this bead. Bead reverted to `open` after walk because rung-2 returns `needsUser` (no resolution this cycle).

## Read-only walk — evidence

### What Spotlight.svelte declares (lines 31-67)

```ts
interface SpotlightItem {
  id: string;
  title: string;
  slug: string;
  // ...
  creator?: {
    username?: string | null;
    displayName?: string | null;
    avatar?: string | null;
  } | null;
}
```

Template (lines 82-84):

```ts
const creatorName = $derived(
  item.creator?.displayName ?? item.creator?.username ?? ''
);
```

### What the API actually returns

Canonical `ContentItem` is derived from `getPublicContent`'s return type (`feed-types.ts:13-15`):

```ts
export type ContentItem = NonNullable<
  Awaited<ReturnType<typeof getPublicContent>>
>['items'][number];
```

The remote function returns `PaginatedListResponse<ContentWithRelations>` (api.ts:631), and `ContentWithRelations` (`packages/content/src/types.ts:73-81`) declares:

```ts
export interface ContentWithRelations extends Content {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
  // ...
}
```

**The API surfaces `creator.name`. There is no `displayName` or `username` field.** Both Spotlight fallbacks evaluate undefined → empty string.

### How other consumers reconcile this gap

`apps/web/src/routes/_org/[slug]/(space)/+page.svelte:551-554` (the page that *renders* Spotlight) maps the API's `creator.name` to ContentCard's `{username, displayName}` shape at the call site:

```svelte
creator={c.creator ? {
  username: c.creator.name ?? undefined,
  displayName: c.creator.name ?? undefined,
} : undefined}
```

The Spotlight call on line 573 (`<Spotlight item={section.items[0]} />`) does NOT do this mapping — it passes the raw `ContentItem` straight through. That is why Spotlight's creator name is blank while ContentCard's is not.

## Candidate diffs (sketches)

### Option (a) — fix Spotlight to consume the API surface

Net: ~3 lines, single-file (`apps/web/src/lib/components/content/Spotlight.svelte`).

```diff
   interface SpotlightItem {
     id: string;
     title: string;
     slug: string;
     description?: string | null;
     // ...
     creator?: {
-      username?: string | null;
-      displayName?: string | null;
-      avatar?: string | null;
+      name?: string | null;
+      // avatar field is NOT present on ContentWithRelations.creator —
+      // either drop the avatar feature or extend the API (option b).
     } | null;
   }
   // ...
-  const creatorName = $derived(
-    item.creator?.displayName ?? item.creator?.username ?? ''
-  );
+  const creatorName = $derived(item.creator?.name ?? '');
```

**Tradeoff**: Aligns with the canonical type already widely used. **Loss**: avatar URL would no longer be plumbed (the template line 284 `<AvatarImage src={item.creator?.avatar ?? undefined} ...>` would always fall back to the initial-letter avatar). Not a regression vs. today — today the avatar code is unreachable because `creatorName` is always empty (line 280 `{#if creatorName}` gate is always false), so the avatar block never renders anyway.

### Option (b) — extend canonical ContentItem to include the richer creator shape

Net: ~30 lines minimum, cross-package (`packages/content/src/types.ts` + content-api worker query joins + Spotlight type narrowing). The richer shape implies:

1. Add `username/displayName/avatar` fields to `ContentWithRelations.creator` (or a new `creator` projection type).
2. Wire the content-api `/api/content/public` query to JOIN the `users` table for `username`, `displayName`, and `avatar_url` columns (verify columns exist on the user schema).
3. If columns don't exist, schema migration territory → escalates to **rung 4**.
4. ContentCard call site at +page.svelte:551-554 becomes the no-op pass-through; Spotlight unchanged.

**Tradeoff**: Restores avatar feature + display-name nuance. **Cost**: cross-package change spanning packages/content, workers/content-api, and the apps/web call site. Adjacent risk: every other ContentWithRelations consumer (admin analytics, library, discover) now has a wider creator object — confirm none assumes the narrow shape.

### Diff summary

- **Option (a)**: 1 file, ~3 lines net, single-package — the bug ships at end of this cycle.
- **Option (b)**: 3+ files, ~30+ lines, cross-package — needs query-join verification and possible schema check; could escalate to rung 4 if `users.username/displayName/avatar_url` aren't on the canonical schema. Worth confirming via `packages/database/src/schema/users.ts` before commit.

## Files affected

- Always: `apps/web/src/lib/components/content/Spotlight.svelte`
- Option (b) only: `packages/content/src/types.ts`, `workers/content-api/src/routes/public-content.ts` (or wherever the query lives), and a possible schema check.

## Recurrence increments

- `signal:type-drift-template-vs-api` → NEW pattern, hits=1. Tracks the case where a component declares a richer optional type than its API actually returns, hiding the mismatch behind nullish-coalescing chains. Codex-v5bzy is the first sighting; if `Codex-mqyql.13` (ContentItem consolidation) surfaces 2+ more, promote to a watch rule.
- `signal:concurrent-cycle-suffix` → NEW pattern, hits=1. Tracks the iter-005a suffix path. If 3+ recurrences, promote rule "concurrent agents must publish iter-NNN[a-z] suffix and never overwrite the original".

## Action returned

```json
{
  "needsUser": true,
  "rung": 2,
  "iter": "iter-005",
  "beadId": "Codex-v5bzy",
  "beadTitle": "bug(web): Spotlight.svelte creator-name always renders blank — type drift hides API mismatch",
  "beadSummary": "SpotlightItem declares creator: {username?, displayName?, avatar?} but the canonical API (ContentWithRelations.creator) returns {id, email, name: string|null}. Both template fallbacks always evaluate undefined → creatorName === '' on every render. Other consumers (ContentCard at +page.svelte:551-554) work around this by mapping creator.name → {username, displayName} at the call site; Spotlight is the only consumer that doesn't.",
  "diffSummary": "Option (a): 1 file, ~3 lines — narrow Spotlight's creator type to {name?} and rewrite the derivation. Option (b): 3+ files, ~30+ lines — extend ContentWithRelations.creator with username/displayName/avatar plus content-api query JOIN; possible schema migration if those user columns don't exist (would escalate to rung 4).",
  "filesAffected": ["apps/web/src/lib/components/content/Spotlight.svelte", "[option b only] packages/content/src/types.ts", "[option b only] workers/content-api/src/routes/public-content.ts"],
  "lineCount": 3,
  "options": ["apply-option-a", "apply-option-b", "skip", "reroute"]
}
```

(`lineCount` reports option (a) since that's the in-cycle-applicable path; option (b) is ~30+ lines and may escalate to rung 4 on schema check.)
