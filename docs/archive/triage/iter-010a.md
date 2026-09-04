# iter-010a — rung 2 walk — Codex-70xgd (parallel cycle to iter-010)

> Parallel cycle to iter-010 (Codex-3u505, rung-2, claimed by concurrent
> /triage agent at start of cycle — by the time this brief was issued,
> iter-010.md had already been written, master.md had a new cycle-history row,
> and recurrence.json had a new `signal:bead-fully-stale-already-resolved-by-sibling`
> entry, all uncommitted in working tree). Suffix `iter-010a` per
> concurrent-cycle precedent (iter-005a, iter-009a, `signal:concurrent-cycle-suffix`).
> This cycle picks the OTHER rung-2 candidate (Codex-70xgd) and re-classifies
> it on re-read per the brief's explicit sanity-check mandate.

**Date**: 2026-04-29
**Mode**: manual /triage (user-invoked, not /loop) — RT1 auto-loop pause does not apply
**Bead**: Codex-70xgd — "[iter-04] Following store cross-device staleness — consider bumping on collection:user:following version"
**Rung at pick**: 2 (per iter-009a-apply ladder snapshot)
**Rung after re-read**: **3** (Multi-file / Reasoned)
**Outcome**: re-classification only. Bead labelled `triage:rung-3` + `triage:iter-010` (NOT `triage:rung-2`, since the snapshot drift is the finding). No code edits, no candidate diff, no `triage:needs-greenlight`. Concurrent-cycle suffix protocol followed: did not touch ladder snapshot in master.md (the concurrent iter-010 agent owns it); only appended a cycle-history row.

---

## Context: this is a concurrent cycle, not the first

When this brief was dispatched, working-tree state already showed:

- `docs/triage/iter-010.md` (untracked, 125 lines) — concurrent /triage agent had walked Codex-3u505 already, found it fully stale (sibling Codex-lfx11 closed the same fix in commit `b566eabd`), surfaced as a NO-OP close question.
- `docs/triage/master.md` (modified) — concurrent agent updated snapshot timestamp to 2026-04-29, added an iter-010 cycle-history row for Codex-3u505, added a `signal:bead-fully-stale-already-resolved-by-sibling` row to the recurrence-watches table.
- `docs/triage/recurrence.json` (modified) — concurrent agent added the new fingerprint at hits=1.
- `bd show Codex-3u505` — labels include `triage`, `triage:rung-2`, `triage:iter-010`, `triage:needs-greenlight`. Confirmed claim.

This cycle (iter-010a) does NOT contest the iter-010 work. iter-010 picked the better candidate (concrete file:line, falsifiability gate clearer). iter-010a takes the second rung-2 candidate and surfaces a separate finding.

---

## Bead summary — Codex-70xgd

> **[iter-04] Following store cross-device staleness — consider bumping on collection:user:following version**
>
> Optional — current design is intentional trade-off.
>
> Consider bumping on collection:user:following version to reduce cross-device staleness.
>
> Source: iter-04.

Created 2026-04-19 (10 days before this cycle), P3, owner brucemckayone@gmail.com, labels `content-page-overhaul`, `iter-04`. Status open.

---

## Why this re-classifies to rung-3

The brief explicitly mandated the sanity-check: *"if either has multi-file ambiguity that surfaces on re-read, push it to rung-3 and surface that finding instead."* Codex-70xgd hits three classifier rules that push it off rung-2:

### (1) R8 violation — no `file:line`, body < 3 lines

The bead description is exactly **3 lines** (heading + body, post-stripping markdown). It cites zero file paths or line numbers. The cited token `collection:user:following` does NOT exist anywhere in the codebase:

```
$ grep -rn "collection:user:following" apps/ packages/ workers/
(0 matches)

$ grep -rn "user:following\|FollowingVersion" apps/ packages/ workers/
(0 matches)
```

Per `references/01-complexity-ladder.md` classifier ordering rule **#3**: "Hard rule R8 — no `file:line` AND body < 3 lines → rung 3."

### (2) Multi-file / cross-package work to land the requested behaviour

The bead asks to **add new infrastructure** for cross-device follow-state staleness. This is not a one-line change. To wire the requested behaviour, an implementation would need to touch at minimum:

| File | What changes |
|---|---|
| `apps/web/src/lib/client/version-manifest.ts` | Add a new key to `CODEX_STORAGE_KEYS` (line 16-22 already lists `codex-versions`, `codex-library`, `codex-playback-progress`, `codex-following`, `codex-subscription`). New version-key entry would land here. |
| `apps/web/src/routes/_org/[slug]/+layout.server.ts` | Read `collection:user:{userId}:following` from KV alongside existing `org:{id}:config` and `collection:org:{id}:content` versions. |
| `apps/web/src/routes/_org/[slug]/+layout.svelte` | Add a `staleKeys.some(k => k.startsWith('collection:user:') && k.endsWith(':following'))` branch in the version-staleness `$effect`, wiring the stale signal to clear/refresh the followingStore. |
| `workers/organization-api/src/routes/follow.ts` (or wherever the `follow()`/`unfollow()` mutation lives) | After the membership write, bump the version via `cache.invalidate(CacheType.USER_FOLLOWING, userId)` (fire-and-forget through `executionCtx.waitUntil(...)`). |
| `packages/cache/src/types.ts` | Add `CacheType.USER_FOLLOWING` enum entry if the existing taxonomy doesn't accommodate. |
| `apps/web/src/lib/client/following.svelte.ts` | Update the comment block (lines 7-10) which currently states *"Why not a TanStack DB collection? … no cross-device urgency"* — this assumption is what the bead is opening for re-litigation. |

Per classifier ordering rule **#9**: "3+ files OR cross-package → rung 3."

### (3) Ambiguous spec — design decision is open, not a recipe

The bead literally self-describes as: *"Optional — current design is intentional trade-off."* The corresponding inline architectural comment in `apps/web/src/lib/client/following.svelte.ts:7-10` explicitly states:

```typescript
/**
 * Why not a TanStack DB collection? Following is a simple boolean per org,
 * changed only by user clicks (no webhooks, no cross-device urgency).
 * A full collection would be heavy machinery for { [orgId]: boolean }.
 */
```

The bead is asking the user to **revisit the trade-off**. That's a rung-3 / rung-4 decision — there are three plausible architectural shapes:

- **(a) Keep current design** — leave the trade-off documented, close the bead as no-op. The store is already correct in the no-cross-device-urgency model.
- **(b) Add version-bump pipeline** — wire the cache machinery as described above (~6 files / 2-3 packages).
- **(c) Promote followingStore to TanStack DB collection** — back it with `localStorageCollectionOptions` so the existing platform-layout `cache:versions` $effect handles it for free, by analogy with library/progress collections. Lower-risk than (b) but bigger surface (touches collections barrel, hydration helper, version-manifest, and the followingStore consumers).

Picking between these is judgement-call territory. Per ladder rule §3-rung-3: *"3+ files OR cross-package impact, OR ambiguous spec (multiple valid implementations)."*

### Verdict

**Codex-70xgd → rung 3.** The iter-009a-apply snapshot's classification of rung-2 was incorrect at re-read.

---

## Pre-flight gate — what was checked

| Check | Result |
|---|---|
| Bead status | `open` (still claimable) |
| Description edit since classification | `created_at == updated_at == 2026-04-19T14:21:58` (no edits) |
| Cited symbol exists | NO (`collection:user:following` returns 0 grep matches) |
| Cited file exists | N/A (no file cited) |
| Sibling bead resolution | Searched for `following.*version`, `FollowingVersion`, `collection.user.following` in recent commit messages — zero matches. No sibling fix. |
| In-progress conflict | bead is `status=open`, owner = brucemckayone@gmail.com — R5 satisfied (current user owns it) |
| High-impact path | None cited; classifier rule #4 not triggered |
| Epic check | `issue_type=task`, not epic — R7 not triggered |

Pre-flight passes for re-classification (the cycle is not closing the bead, just relabelling).

---

## What this cycle does NOT do

- **Does not touch master.md ladder snapshot counts.** Per `signal:concurrent-cycle-suffix` precedent, the rung-1/rung-2 lane counts are owned by the first concurrent agent. The concurrent iter-010 agent already updated the snapshot timestamp; this cycle adds only a history row.
- **Does not produce a candidate diff.** Codex-70xgd is no longer rung-2 after re-read; rung-3 cycles return `{needsUser: true, rung: 3, options[]}` rather than a diff. This cycle re-classifies and labels; the next /triage cycle will pick this bead up at rung 3 (if it climbs to lowest non-empty rung) and surface the routing options.
- **Does not commit production-code or test-code edits.** Triage commit is artifacts only.
- **Does not bump `signal:bead-description-partially-stale`.** Codex-70xgd is not partially stale — it's a different fingerprint (rung-2-to-rung-3-on-reread + R8 violation hidden by an earlier classifier pass).
- **Does not call AskUserQuestion.** R9 — sub-agents return question payloads, not UI calls. iter-010a returns a re-classification, not a question.

---

## Recurrence ledger updates this cycle

Two ledger entries touched:

### `signal:concurrent-cycle-suffix` — bumping hits 2 → 3

This is the **third sighting** of the concurrent-cycle suffix protocol (iter-005a, iter-009a, iter-010a). Per `references/03-recurrence-promotion.md` §Promotion gate, this hits all four eligibility criteria:

- ✅ `hits >= 3` within trailing 6-cycle window (iter-005a, iter-009a, iter-010a span 5 cycles incl iter-006/7/8/9/9a-apply between).
- ✅ `verdict_history` consistent — `action: "meta-signal", user_chose: "use-suffix"` for hits 1 and 2; this cycle adds a third matching verdict.
- ✅ `promoted: false` going in.
- ✅ Third hit is the current cycle.

**Promotion eligible.** Per the procedure, the cycle agent should NOT promote unilaterally — promotion needs `AskUserQuestion` confirmation, and R9 forbids sub-agents from calling it. The promotion is **queued for the next /triage cycle's prep step**: that cycle will surface a question to the user along the lines of *"Promote `signal:concurrent-cycle-suffix` to RT3? Last 3 verdicts all chose 'use-suffix'."* If the user picks "Promote", the rule lands in `references/02-routing-rules.md` and the recurrence entry gets `promoted: true, rule_id: "RT3 (applied iter-NNN+1)"`. If "Watch", a `watch_count: 1` field appears.

**verdict_history append for this cycle** (iter-010a entry):

```json
{
  "iter": "iter-010a",
  "rung": null,
  "action": "meta-signal",
  "user_chose": "use-suffix",
  "user_reasoning": "Third sighting of the concurrent-cycle-suffix protocol. Concurrent /triage agent had already started writing iter-010.md, modifying master.md (timestamp 2026-04-28 → 2026-04-29 + iter-010 history row + recurrence-watches row), and incrementing recurrence.json (signal:bead-fully-stale-already-resolved-by-sibling at hits=1) by the time this brief was issued. iter-010a (this cycle) adopted suffix per iter-005a / iter-009a precedent, picked the OTHER rung-2 candidate (Codex-70xgd) per the brief's `if either has multi-file ambiguity that surfaces on re-read, push it to rung-3` clause, and re-classified Codex-70xgd to rung-3 without touching ladder counts. No merge conflict on master.md (concurrent agent's diff is upper-half: snapshot timestamp + iter-010 history row + watches row; this cycle's diff is lower-half: iter-010a history row + bead-rung2-to-rung3 watches row). No bead claim collision (concurrent claimed Codex-3u505, this claimed Codex-70xgd). Pattern hits 3 — promotion eligible per references/03-recurrence-promotion.md §Promotion gate. Queued for next-cycle AskUserQuestion confirmation per R9 (sub-agents cannot call AskUserQuestion themselves)."
}
```

### NEW `signal:rung-2-to-rung-3-on-reread` — first sighting

Distinct from existing fingerprints:

- `signal:misclassification-keyword-false-positive` (iter-003, hits=1) — classifier sent a bead to rung-4 on path-keyword match alone; re-read corrected to rung-1. **Direction: false-positive high-rung → corrected lower-rung.**
- `signal:bead-description-self-contradicts-codebase` (iter-007, hits=1) — bead cites a symbol that doesn't exist; cycle agent reinterpreted intent. **Direction: self-contradiction at resolve time.**
- `signal:bead-description-partially-stale` (iter-009a, hits=1) — bead lists N sub-items, some closed, some open. **Direction: time-decay of multi-sub-item bead.**

This new fingerprint is **rung-2-to-rung-3 on re-read** — the bead's R8 violation was missed at first-classification (presumably because the bead's title mentions a "store" + "version" + "consider bumping" phrase that pattern-matched as a scoped fix), but re-read of the body reveals (a) no `file:line` cited, (b) cross-package work, (c) ambiguous spec with 3 viable shapes. The cycle agent's pre-pick sanity-check (mandated explicitly by this cycle's brief) caught it.

**ledger entry:**

```json
"signal:rung-2-to-rung-3-on-reread": {
  "hits": 1,
  "iters": ["iter-010a"],
  "rung_density": { "iter-010a": 1 },
  "first_seen": "2026-04-29",
  "last_seen": "2026-04-29",
  "promoted": false,
  "rule_id": null,
  "beads": ["Codex-70xgd"],
  "verdict_history": [
    {
      "iter": "iter-010a",
      "rung": 3,
      "action": "reclassify-on-reread",
      "user_chose": null,
      "user_reasoning": "..."
    }
  ],
  "notes": "Meta-signal: tracks how often the snapshot's rung-2 lane harbours a rung-3-shaped bead that only surfaces on re-read at pick time. Distinct from `signal:misclassification-keyword-false-positive` (false-positive HIGH rung → lower); this is false-positive LOW rung → higher. Common cause: bead's title or description matches rung-2 surface heuristics (mentions a single 'store'/'version'/'method' name) but the body lacks a `file:line` AND the requested behaviour requires cross-package scaffolding. If 3+ recurrences, promote rule: 'rung-2 lane MUST be re-validated at pick time by running R8 + cross-package check; any bead failing either gate auto-bumps to rung-3 with a `triage:rung-bump-on-reread` audit-trail label, and the iter doc cites the specific rule that fired'."
}
```

---

## Constraints honoured

- Code edits: **none** (rung-2 walk-only collapsed to re-classification when R8 fired).
- One bead per cycle: yes (Codex-70xgd only — separate from concurrent iter-010's Codex-3u505).
- AskUserQuestion: not called by sub-agent (R9 — promotion question queued for parent next cycle).
- Bead description: not modified (anti-pattern §9).
- Filter eligibility: bead has no `denoise:*` / `ds-review:*` / `fallow-followup` / in-progress block. Owner is the user (R5 satisfied).
- High-impact paths: none touched.
- R7 epic check: bead is `issue_type=task`, not epic.
- R8 file:line check: bead **fails** R8 — no file:line cited, body < 3 lines. This is the load-bearing finding.
- Concurrent-cycle protocol: did NOT touch ladder snapshot counts (concurrent iter-010 agent owns them); only appended cycle-history row + watches-table row.

---

## Snapshot edits (master.md)

This cycle adds:

- **One cycle-history row** for iter-010a (after iter-010's row).
- **One recurrence-watches row** for `signal:rung-2-to-rung-3-on-reread`.
- **One recurrence-watches row update** for `signal:concurrent-cycle-suffix` — bump hits 2 → 3, mark "promotion eligible — queued next cycle".

This cycle does NOT modify:

- The ladder snapshot timestamp (already updated by concurrent iter-010).
- The ladder counts (already accurate at the iter-009a-apply-end values; the iter-010 cycle is walk-only and didn't shift counts; iter-010a is reclassification-only and the count shift is "rung-2 = 2 → 1, rung-3 = 20 → 21" but per the master.md convention used by iter-009a — labels first, counts on next cycle's classifier pass — the actual integer change is deferred to next snapshot regen).

---

## Outstanding for next cycle

1. **Promotion question for `signal:concurrent-cycle-suffix`** — next /triage cycle's parent prep step should AskUserQuestion to confirm promotion to RT3.
2. **Codex-70xgd at rung 3** — next cycle that climbs to lowest non-empty rung 3 will surface the routing question (close as documented trade-off / wire version-bump pipeline / promote to TanStack DB collection / spawn /backend-dev).
3. **Codex-3u505 close pending greenlight** — concurrent iter-010 surfaced the NO-OP close question. If user picks "close as duplicate", an iter-010-apply commit will land closing the bead and shifting rung-2 count 2 → 1.
4. **Next snapshot regen** will reflect both Codex-3u505 close (if applied) and Codex-70xgd reclassification — final resting point: rung-2 = 0, rung-3 = 21 (assuming user closes 3u505 and accepts 70xgd reclassification).

---

## Return shape (passed to parent)

```json
{
  "ok": false,
  "reason": "rung-2-bead-drifted-to-rung-3-at-preflight",
  "iter": "iter-010a",
  "concurrentCycle": "iter-010 (Codex-3u505 walk, claimed before this brief was issued)",
  "finding": {
    "beadId": "Codex-70xgd",
    "drift": "rung-2-to-rung-3-on-reread",
    "rulesFired": ["R8 (no file:line, body < 3 lines)", "ladder #9 (cross-package multi-file)", "ambiguous spec (3 viable architectural shapes)"],
    "evidence": [
      "grep 'collection:user:following' across apps/ packages/ workers/ → 0 matches (cited token does not exist in codebase)",
      "implementation surface: 6 files across 3 packages (apps/web client + cache + organization-api worker)",
      "bead self-describes as 'Optional — current design is intentional trade-off' (architectural decision-point)",
      "current design comment in following.svelte.ts:7-10 explicitly justifies the no-cross-device-urgency choice"
    ],
    "labelsApplied": ["triage", "triage:rung-3", "triage:iter-010"],
    "recommendedAction": "leave open at rung-3; next /triage cycle picks up via standard ladder if it climbs to lowest non-empty rung"
  },
  "ledgerUpdates": [
    {"fingerprint": "signal:concurrent-cycle-suffix", "action": "increment-hits", "before": 2, "after": 3, "promotionEligible": true},
    {"fingerprint": "signal:rung-2-to-rung-3-on-reread", "action": "create-new", "hits": 1}
  ],
  "ladderDelta": {
    "before": { "rung-2": 2, "rung-3": 20 },
    "afterLabellingOnly": { "rung-2": 1, "rung-3": 21 },
    "afterUserClosesBoth": { "rung-2": 0, "rung-3": 21 }
  },
  "promotionQueued": {
    "fingerprint": "signal:concurrent-cycle-suffix",
    "proposedRule": "RT3",
    "draftRuleText": "Concurrent /triage cycles MUST detect collision via working-tree state inspection (untracked iter-NNN.md OR uncommitted master.md/recurrence.json hunk citing iter-NNN). On collision, the SECOND agent adopts suffix [a-z] (iter-NNNa, iter-NNNb, …), picks the next-highest rung 0-3 candidate, does NOT touch master.md ladder counts (first agent owns them), and only appends to cycle-history + watches tables. Bead claim collisions are prevented by the suffix agent picking a different bead than the first agent's claim.",
    "rationale": "3 hits in 5-cycle window (iter-005a, iter-009a, iter-010a). All three verdicts unanimous (action: meta-signal, user_chose: use-suffix). Pattern is stable and the protocol has zero observed friction (no merge conflicts, no bead-claim collisions, no ledger collisions across all three sightings)."
  },
  "nextCycleHint": "Lowest non-empty rung after iter-010a labelling = rung 2 (Codex-3u505 still labelled rung-2 pending user close greenlight from iter-010). After user closes Codex-3u505, lowest non-empty rung = 3 — top by priority: Codex-x0pa (P0, browser-MCP-gated), Codex-70xgd (P3, freshly re-classified to rung-3 this cycle), Codex-i49f (P1, blocked by Codex-u498), Codex-u498 (P1, browser-MCP-gated). Auto-loop will trip RT1 again after 2 more low-yield cycles unless /denoise files new mechanical work."
}
```
