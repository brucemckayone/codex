# Triage — Master Status Board

> Generated and maintained by the `/triage` skill. Do not edit by hand outside of dismissing items.
> See `.claude/skills/triage/SKILL.md` for the workflow.

## ⚠️ Promoted routing rules

| Rule | Promoted | Source pattern | Verdict |
|------|----------|----------------|---------|
| RT1 | iter-004 | `signal:auto-loop-skip-rung-2-plus` | After 3 consecutive auto-loop /triage cycles with rung-1 yield ≤ 1, parent should pause /loop and surface a routing decision to the user. |
| RT2 | iter-006 | `route:self:proof-test-path-mechanical-fix` | Beads describing path/import/byte-mechanical fixes inside `apps/web/src/__denoise_proofs__/iter-NNN/` are auto-rung-1 (mechanical scaffolding fixes, not finding-resolutions). NEW iter cohorts of `__denoise_proofs__/` tests must inherit the corrected 5-dotdot `repoRoot` path: `resolve(__dirname, '../../../../..')`. The 6-dotdot mistake (resolves to `~/development/`, not the repo) is auto-fix material for any cycle that un-skips the test — file as a sidequest within the parent bead's commit, not as a separate bead. Lint candidate: grep `__denoise_proofs__/` for `'../../../../../..'` (6 dotdots). |

See `.claude/skills/triage/references/02-routing-rules.md` for full rule definitions.

---

## Ladder snapshot

<!-- LADDER START -->

_Snapshot timestamp_: 2026-04-27 (iter-006: cluster-defect team closed F1/F3/F4 → rung-1 drained; concurrent iter-005a-apply closed rung-2 Codex-v5bzy)
_Eligibility filter_: excludes `denoise:*` only when **no** proof test path is cited — beads with cited proof tests in `__denoise_proofs__/` ARE resolution-ready and triage-eligible (per iter-005 correction). Excludes `ds-review*`, `fallow-followup` (owned by other skills) and 4 in-progress beads + Codex-ttavz.12 (routed iter-001) + closed beads (Codex-fcdkk iter-002, Codex-y6x9j iter-003, Codex-zhe80 iter-005, Codex-v5bzy iter-005a-apply, Codex-w30gi+Codex-0n26b+Codex-mqyql.18 iter-006).

| Rung | Count | Top by priority |
|------|-------|-------------------|
| 0 — Trivial | 0 | — |
| 1 — Mechanical | 0[^iter006-r1] | — |
| 2 — Scoped | 0 | — |
| 3 — Multi-file | 21 | Codex-x0pa (P0), Codex-6axi0 (P1), Codex-i49f (P1), Codex-u498 (P1), Codex-d3g6 (P1) |
| 4 — Design-needed | 5 | Codex-ev3k (P1 epic), Codex-cbbet (P2 epic), Codex-zp30d (P2), Codex-r4woq (P2 epic), Codex-84b53 (P2 epic) |

[^iter006-r1]: iter-006 was the FIRST cluster-defect agent-team cycle (R1 exception). 3 parallel sub-agents resolved F1 (Codex-w30gi)/F3 (Codex-0n26b)/F4 (Codex-mqyql.18) — all sharing the iter-002 `repoRoot` 6→5 dotdot path bug plus each bead's distinct rung-1 code-fix recipe. 14 proof assertions pass across the 3 tests. `route:self:proof-test-path-mechanical-fix` promoted to **RT2** after 3rd hit. Rung 2 cleared by concurrent iter-005a-apply (Codex-v5bzy). Backlog now exclusively rung-3+ work — auto-loop /triage will start tripping RT1 again unless /denoise files new mechanical beads.

<!-- LADDER END -->

---

## Cycle history

| Iter | Date | Rung | Bead | Action | Outcome |
|------|------|------|------|--------|---------|
| iter-001 | 2026-04-27 | 3 | Codex-ttavz.12 | routed to /backend-dev (wire-up planned functionality) | bead remains open with labels triage:routing:backend-dev + triage:needs-design; user will invoke /backend-dev next session to wire forms + fix typo |
| iter-002 | 2026-04-27 | 1 | Codex-fcdkk | mechanical: corrected `repoRoot` path in 5 iter-012 proof tests (6→5 dotdot levels) | closed; tests collect cleanly + repoRoot now resolves to actual repo root (verified via node fs check) |
| iter-003 | 2026-04-27 | 1 | Codex-y6x9j | mechanical: replaced inline slug-resolve+invalidate block in `workers/organization-api/src/routes/settings.ts` with existing `invalidateOrgSlugCache` helper from `@codex/worker-utils` (R14). Re-classified from rung-4 (iter-002) to rung-1 — earlier classifier matched a `.env` regex on description text; reread shows pure mechanical helper-extract. | closed; F2-dup-slug-resolve-invalidate proof test extended to include settings.ts and passes (1/1); existing settings.test.ts passes (24/24); typecheck clean |
| iter-004 | 2026-04-27 | n/a | (none) | re-scanned rung-3 P2 (15 beads) + P1 (5 beads) clusters per iter-003 misclassification precedent; all confirmed-not-rung-1. Recurrence `signal:auto-loop-skip-rung-2-plus` hit 3rd time → **promoted to RT1**. | `ok: false`, no rung 0/1 work auto-resolved; new hard rule codified |
| iter-005 | 2026-04-27 | 1 | Codex-zhe80 | mechanical: replaced inline `interface SocialLinks` and `interface ContentItem` declarations in `apps/web/src/lib/components/ui/CreatorCard/CreatorCard.svelte` with `import type { ContentItem, SocialLinks } from './types'` (canonical sibling exports the identical shapes). Also fixed the proof test's `repoRoot` path (6→5 dotdots, same shape as iter-002's iter-012 fix) and un-skipped `describe.skip` → `describe`. Brief over-rode iter-004's denoise:* filter — denoise-tagged beads with cited proof tests are resolution-ready. | closed; F2 proof test passes 5/5; identified F1/F3/F4 sibling proof tests have the SAME path bug → iter-006 agent team queued |
| iter-005a | 2026-04-27 | 2 | Codex-v5bzy | parallel cycle to iter-005 (concurrent agent claimed rung-1 Codex-zhe80; this cycle picked next-lowest non-empty rung per user policy 0–3). Read-only walk produced two candidate-diff sketches: (a) narrow Spotlight's creator type to `{name?}` matching the canonical `ContentWithRelations.creator` shape (~3 lines, 1 file, single-package); (b) extend canonical `ContentWithRelations.creator` to include `username/displayName/avatar` plus content-api JOIN (~30+ lines, 3+ files, cross-package, possibly rung-4 if user schema lacks the columns). Bead labelled `triage:rung-2` + `triage:needs-greenlight` + `triage:iter-005`. | needsUser; bead reverted to `status=open` for next cycle. Awaiting user choice between option (a) / (b) / skip / reroute. |
| iter-005a-apply | 2026-04-27 | 2 | Codex-v5bzy | apply pass after user greenlight on option (a). Narrowed `SpotlightItem.creator` to `{name?: string \| null}`, rewrote `creatorName` derivation to `item.creator?.name ?? ''`, pruned now-unreachable `<AvatarImage>` block (the `avatar` field is no longer on the type; AvatarFallback initial-letter avatar takes over — no UX regression vs pre-fix because the entire creator block was hidden anyway), and removed unused `AvatarImage` import. Proof test added at `apps/web/src/lib/components/content/Spotlight.svelte.test.ts` asserting (1) creator name renders for `{name: 'Jane Doe'}`, (2) block hidden when name is null, (3) block hidden when creator is absent. | closed; proof test passes 3/3; web typecheck clean for Spotlight (pre-existing iter-029 F3 typecheck error unrelated, committed in ead3f9db). |
| iter-006 | 2026-04-27 | 1 (TEAM) | Codex-w30gi + Codex-0n26b + Codex-mqyql.18 | **First cluster-defect agent-team cycle (R1 exception per §13).** 3 parallel sub-agents fixed the shared `repoRoot` 6→5 dotdot bug across F1/F3/F4 iter-027 proof tests + each bead's distinct rung-1 code-fix recipe. F1: replaced 2 inline `STUDIO_ROLES` triples with `useStudioAccess()` composable (SidebarRail.svelte + SidebarRailUserSection.svelte). F3: extended `$lib/server/content-detail.ts` with `EMPTY_SUB_CONTEXT` + `DENIED_ACCESS_RESULT` constants; both content detail loaders now spread these. F4: 1-line text edit in gitignored `references/05-domain-web.md` (`loadFromServer()` → `hydrateIfNeeded()`). Pattern `route:self:proof-test-path-mechanical-fix` promoted to **RT2** after this cycle. | closed (3 beads); 14 proof assertions pass (6+4+4); §13 prototype validated — surface gaps: (1) need `localOnlyFilesChanged` field for gitignored fixes, (2) recipe wording "ensure-or-create" instead of "create" when helper may already exist. |

---

## Recurrence watches

| Pattern | Hits | First seen | Beads | Notes |
|---------|------|-----------|-------|-------|
| `route:self:proof-test-path-mechanical-fix` | 3 (PROMOTED RT2) | iter-002 | Codex-fcdkk, Codex-zhe80, Codex-w30gi, Codex-0n26b, Codex-mqyql.18 | Promoted iter-006 after the cluster team-fix cycle. RT2 codified in `references/02-routing-rules.md`. |
| `signal:over-filter-denoise-tagged-rung-1` | 1 | iter-005 | Codex-zhe80 | iter-004's cycle agent filtered out all denoise:*-tagged beads, missing this rung-1 candidate. Corrected iter-005. iter-006 confirmed correction held — F1/F3/F4 surfaced via the corrected filter. Stays at hits=1 (no recurrence). |
| `signal:cluster-defect-team-fix-eligible` | 2 | iter-005 | Codex-zhe80 (parent), F1/F3/F4 (siblings, executed iter-006) | iter-006 was the prototype agent-team cycle — protocol worked. One sighting from threshold (3); if iter-007+ produces another team cycle, promote. |

---

## Stop criteria

A cycle exits early without producing a triage decision if:

- The open backlog is < 10 beads (use `bd ready` directly instead).
- `bd sync` is dirty / out of sync — risk of misclassification.
- The current user has > 0 in_progress beads claimed in another agent — wait for that work to land.

A bead is removed from the ladder if:

- It is closed by another skill or by hand.
- It is reassigned to another owner via `bd update`.
- It moves to `in_progress` under another agent.

---

## Notes

The master board is updated in step 7 of every cycle. It is the source-of-truth for what `/triage` will pick next; if the snapshot diverges from the actual `bd` state, the next cycle's classify step refreshes it.

Diff with denoise's `master.md`: triage doesn't track 12 cells (denoise's matrix). It tracks 5 rungs (the complexity ladder). Cycle history rows include the bead ID resolved or escalated, not just the cell.
