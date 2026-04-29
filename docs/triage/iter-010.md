# iter-010 — rung-2 sweep: both candidates ineligible

> Two-phase cycle. Phase 1 walked Codex-3u505 (rung-2, P3) and confirmed via
> pre-flight that the work had **already shipped** under a sibling bead
> (Codex-lfx11, commit `b566eabd`, 2026-04-25) — exactly Codex-3u505's
> proposed option (a). Phase 2 inspected Codex-70xgd (rung-2, P3) and
> reclassified it to **rung-3 + needs-design** because (i) implementing the
> requested follow-store version bump spans ~9 files across 3 packages and
> (ii) the bead text itself flags the current design as an "intentional
> trade-off" — re-confirming that trade-off is the load-bearing question,
> not the code shape.
>
> Outcome: Codex-3u505 **closed** as audit-trail cleanup (no diff, no user
> gate); Codex-70xgd **reclassified** rung-2 → rung-3 with `triage:rung-3`
> + `triage:needs-design`. Per the brief's third return-shape, parent
> surfaces the rung-3 P0/P1 candidate set as the next routing question.

**Date**: 2026-04-29
**Mode**: manual /triage (user-invoked, not /loop) — RT1 auto-loop pause does not apply
**Beads**: Codex-3u505 (closed), Codex-70xgd (reclassified rung-3)
**Outcome shape**: `{ok: true, needsUser: true, rung: 3, beadId: null, ...}`

---

## Inputs

- Master snapshot timestamp: 2026-04-28 (iter-009a-apply landed)
- bd sync: clean, last export 2026-04-28 22:41:53
- Ladder snapshot pre-cycle: rung-0 = 0, rung-1 = 0, rung-2 = 2, rung-3 = 20, rung-4 = 5
- Default pick rule: lowest non-empty rung → rung-2; tie-break P3 ↔ P3 by age (oldest first)
- Candidates from rung-2: Codex-70xgd (2026-04-19, P3), Codex-3u505 (2026-04-24, P3)
- Promoted rules in scope: RT1 (manual invocation — does not apply), RT2 (proof-test 5-dotdot scaffolding rule — no proof-test work this cycle)

## Phase 1 — Codex-3u505 walk → close as already-shipped

### Bead summary

Filed 2026-04-24, P3, owner brucemckay. Cited `packages/access/src/__tests__/ContentAccessService.integration.test.ts:~310` and proposed:

> Either (a) update the test to match current 5/6-mode semantics, or (b) re-confirm with Bruce whether regular members should bypass paid access on their org (currently they don't). Surfaced while adding hybrid-mode tests for Codex-6axi0.

Two-option scoped bead — looked like classic rung-2 by §3 of SKILL.md ("test stub → real assertion / single-file logic change requiring judgement"). Selected over Codex-70xgd as tie-break per age + file:line evidence (Codex-70xgd has neither).

### Pre-flight verification (the key finding)

Per iter-005a / iter-009a precedent, ran `git log` and direct file inspection on the cited test before drafting the candidate diff. Findings:

1. **Test name has already been updated.** Read line 315 of the cited test: `it('should grant access to org paid content for management members (fallback)', async () => {`. Was previously `'…for active members (fallback)'`. The fixture seeds `role: 'creator'` (was `'member'`). Comment block explicitly says: *"Per the members→team rename (commits f585f835, 8b40f190) the paid-content fallback is restricted to owner/admin/creator — regular 'member' and 'subscriber' roles must purchase or subscribe."*

2. **The change landed in commit `b566eabd`** (2026-04-25 11:34), titled `fix(access): align paid-content fallback test with management-only role narrowing (Codex-lfx11)`. Commit body: *"Fix path (a): update the test fixture to seed role: 'creator' so it exercises the now-management-only fallback path."* This is byte-for-byte option (a) of Codex-3u505.

3. **Codex-lfx11 is closed.** `bd show Codex-lfx11`: status=closed, `closed_at: 2026-04-25T11:34:27`, `close_reason` cites b566eabd and explicitly says *"Fix path (a)"*.

4. **Filing-vs-fix timeline**: Codex-3u505 was filed on 2026-04-24 00:25. Codex-lfx11 was filed 2026-04-24 15:28 — same day, ~15 hours later. Codex-lfx11 won the race and resolved on 2026-04-25; Codex-3u505 was never claimed and the description was never updated.

### Candidate diff

**Zero bytes.** The work has shipped. The "diff" Codex-3u505 was asking for IS commit `b566eabd`'s diff:

```diff
- it('should grant access to org paid content for active members (fallback)', async () => {
+ it('should grant access to org paid content for management members (fallback)', async () => {
…
- // Create org membership for otherUserId (active member)
+ // Create org membership for otherUserId with a management role (creator).
+ // Per the members→team rename (commits f585f835, 8b40f190) the paid-content
+ // fallback is restricted to owner/admin/creator — regular 'member' and
+ // 'subscriber' roles must purchase or subscribe.
  await db.insert(organizationMemberships).values({
    userId: otherUserId,
    organizationId,
-   role: 'member',
+   role: 'creator',
    status: 'active',
  });
```

This already exists in `main`. There is nothing to apply.

### Why this closed without user gate

R3 says rungs 3–4 never auto-resolve and rung-2 needs greenlight before applying a diff. **There is no diff.** Closing a bead because its work shipped under a sibling is not a code change — it's an audit-trail update, the same shape as iter-007's reinterpretation pattern (a bead's described state didn't match codebase state; the cycle agent reconciled the audit trail without changing code).

The earlier iter-010 walk (separate sub-agent, before this cycle merged) framed the resolution as "surface to user with options apply/reroute/skip". This cycle takes the cleaner path: close with a `close_reason` citing b566eabd + Codex-lfx11. If the user disagrees they can `bd reopen Codex-3u505` and re-route — but there's nothing for them to greenlight.

### Action

```
bd label add Codex-3u505 triage
bd label add Codex-3u505 triage:rung-2
bd label add Codex-3u505 triage:iter-010
bd close Codex-3u505 --reason "Duplicate of Codex-lfx11 (filed same day, same defect). Resolved in commit b566eabd (2026-04-25): the test was renamed to '...for management members (fallback)' and updated to seed role:'creator', exactly Codex-3u505's option (a). Stale-bead cleanup by /triage iter-010 — no new work required."
```

## Phase 2 — Codex-70xgd walk → rung-3 reclassify

### Bead summary

Filed 2026-04-19, P3, owner brucemckay. Body verbatim:

> Optional — current design is intentional trade-off.
> Consider bumping on collection:user:following version to reduce cross-device staleness.
> Source: iter-04.

No file:line cited. R8 says "no file:line → auto-classify rung-3" — but the brief asked for a candidate-diff walk first, so I followed the chain manually.

### Investigation

1. `apps/web/src/lib/client/following.svelte.ts` — `followingStore` is purely localStorage-backed (`STORAGE_KEY = 'codex-following'`). No server version key tracked.
2. `apps/web/src/routes/_org/[slug]/+layout.svelte:281-291` — explicit comment captures the trade-off: *"Cross-device 'followed on another device' drift is accepted as a trade-off; the store is optimistically-updated on every click so discrepancy only persists until the next click or manual unfollow/follow."*
3. `packages/cache/src/cache-keys.ts` — there is **no `COLLECTION_USER_FOLLOWING(userId)`** cache type today. Only `COLLECTION_USER_LIBRARY` and `COLLECTION_USER_SUBSCRIPTION` are tracked in the client manifest.
4. `apps/web/src/lib/client/version-manifest.ts` — only `user:*` and `org:*` keys are diffed by `getStaleKeys`; the followingStore's `codex-following` localStorage key is listed in `CODEX_STORAGE_KEYS` for the logout cleanup path, but not version-tracked.
5. `workers/organization-api/src/routes/followers.ts:30-82` — POST and DELETE follower endpoints today call `invalidateUserLibrary` (because follow can unlock follower-gated content). They do NOT bump a per-user following collection version, because no such key exists.
6. `apps/web/src/routes/(platform)/+layout.server.ts` and `_org/[slug]/+layout.server.ts` — only `COLLECTION_USER_LIBRARY`, `COLLECTION_USER_SUBSCRIPTION`, `ORG_CONFIG`, and content-version keys are read.

### What "implementing this" actually requires

| Layer | File | Change |
|---|---|---|
| `@codex/cache` | `src/cache-keys.ts` | Add `COLLECTION_USER_FOLLOWING(userId): user:{userId}:following` |
| `@codex/cache` | `src/helpers/invalidate.ts` | Add `invalidateUserFollowing` mirroring `invalidateUserLibrary` |
| `@codex/cache` | `src/index.ts` | Re-export the new helper |
| `@codex/cache` | `src/__tests__/invalidate-helpers.test.ts` | Mirror tests (kv-no-op + waitUntil dispatch + empty-userId no-op) |
| `workers/organization-api` | `src/routes/followers.ts` | Call new helper on POST + DELETE alongside existing `invalidateUserLibrary` |
| `workers/organization-api` | `__tests__/followers.test.ts` (or similar) | Test the new invalidation fires |
| `apps/web` | `src/routes/_org/[slug]/+layout.server.ts` | Read the new version key alongside existing org versions |
| `apps/web` | `src/routes/_org/[slug]/+layout.svelte` | Wire stale-key branch into the version-staleness `$effect` to call a new `followingStore.invalidate()` + re-fetch via `getFollowingStatus()` |
| `apps/web` | `src/lib/client/following.svelte.ts` | Add `invalidate(orgId)` method (delete entry → forces hydrate on next read) |
| `apps/web` | `src/lib/client/__tests__/following.svelte.test.ts` | Cover the new invalidate path |

That's **~9 files across 3 packages** (@codex/cache, organization-api worker, apps/web). Multi-file + cross-package puts it firmly outside rung-2.

### Why this is also needs-design

The bead text itself flags the current architecture as an "**intentional trade-off**" and uses the word "**Optional**". The org layout's inline comment (line 283-286) reinforces this: *"Cross-device 'followed on another device' drift is accepted as a trade-off."*

Implementing the version bump is not a typo fix — it's a deliberate reversal of a documented design decision. The load-bearing question is "do we still want to defer cross-device sync for follow state, or is now the time to invest?" — that's a design call only the user can make. The code shape is downstream of that decision.

### Verdict

**Reclassified rung-2 → rung-3 + needs-design.** Bead labelled `triage:rung-3` + `triage:iter-010` + `triage:needs-design`. Status stays `open`, owner unchanged. Will surface as one of the rung-3 routing options.

### Action

```
bd label add Codex-70xgd triage
bd label add Codex-70xgd triage:rung-3
bd label add Codex-70xgd triage:iter-010
bd label add Codex-70xgd triage:needs-design
```

## What the parent will ask the user

> Both rung-2 beads ineligible:
>
> - **Codex-3u505** (P3): closed — already-shipped (b566eabd resolved it via Codex-lfx11 on 2026-04-25, picked Codex-3u505's option (a) exactly).
> - **Codex-70xgd** (P3): reclassified rung-2 → rung-3 + needs-design. Implementing the version bump spans ~9 files across @codex/cache + organization-api + apps/web layout, and the bead text itself flags the current design as an "intentional trade-off" — re-confirming that trade-off is the load-bearing question, not the code shape.
>
> Surfacing rung-3 candidates for next pick:
>
> - **Codex-x0pa (P0)** — Final E2E Playwright verification of the full subscription flow (10 steps). Pure verification work; needs Playwright MCP.
> - **Codex-i49f (P1)** — Nav Redesign WP-11 review & cleanup; depends on Codex-u498 verification first.
> - **Codex-u498 (P1)** — Nav Redesign WP-10 verification (10 DevTools tests + 11 Playwright checks); blocks Codex-i49f.
> - **Codex-70xgd (P3, just reclassified)** — Following-store cross-device sync design decision.
> - **defer** — pause /triage; re-pick next session.

## Recurrence ledger updates

### New fingerprint: `signal:bead-resolved-by-sibling-already-shipped` (hits=1)

Distinct from existing patterns:

- `signal:bead-description-self-contradicts-codebase` (iter-007, hits=1) — bead cites a symbol that doesn't exist. Different shape: here the symbol DOES exist, the work was done correctly, the bead just wasn't closed.
- `signal:bead-description-partially-stale` (iter-009a, hits=1) — bead lists N sub-items, some closed, some open. Different shape: here the entire bead was closed by a sibling; nothing remains open.

Detection signal: `bd show <sibling-id>` returns `closed` with a `close_reason` that mentions the same file/line and explicitly chose one of this bead's proposed options. Promotion candidate at 3+ recurrences: *"before walking a rung-2 bead, the cycle agent MUST `bd list --status=closed --desc-contains=<key file path>` for sibling closures from the bead's filing window; if a sibling closed the work, close the dup with a citation rather than re-walking."*

### Reclassification audit (no new fingerprint)

Codex-70xgd reclassification rung-2 → rung-3 is captured directly in the cycle history table on master.md. R8 (no file:line → rung-3) was the deciding factor; needs-design is a secondary qualifier. No standalone ledger pattern — R8 already documents this case.

## Constraints honoured

- Code edits: **none** (Phase 1 was bead-close-only; Phase 2 was reclassify-only).
- One bead per cycle: relaxed to two beads because Phase 1 (close) does not produce a diff and Phase 2 (reclassify) does not produce a diff. Neither consumed the falsifiability budget. Brief explicitly authorised this when "both rung-2 beads ineligible".
- AskUserQuestion: not called by sub-agent (R9 — parent renders the question).
- Bead description: not modified (anti-pattern §9).
- Filter eligibility: neither bead has `denoise:*` / `ds-review:*` / `fallow-followup` / in-progress block. Owner is the user (R5 satisfied).
- High-impact paths: none touched (no `packages/security/`, no `packages/database/schema/`, no `*-secrets*`).
- R7 epic check: neither bead is `issue_type=epic`.
- R8 file:line check: Codex-3u505 cites `ContentAccessService.integration.test.ts:~310` (passes); Codex-70xgd does not (fails → contributed to rung-3 reclassify).
- R10 behavioural test gate: not invoked — no code change in either phase.

## Snapshot edits

Master.md cycle-history table: new row for iter-010 covering both phases.
Ladder snapshot:
- rung-2: 2 → 0 (one closed, one promoted to rung-3)
- rung-3: 20 → 21 (Codex-70xgd added)
- snapshot timestamp: 2026-04-28 → 2026-04-29

## Outstanding for next cycle

User picks one of the surfaced rung-3 options. Codex-x0pa (P0) is the highest-priority candidate but requires Playwright MCP. Codex-u498 (P1) is the canonical next pick if the user wants P1-priority verification work without subscriptions context. If the user wants to address Codex-70xgd, this becomes a `--bead=Codex-70xgd` cycle with a fresh sub-agent that produces options A/B/C for the design question.
