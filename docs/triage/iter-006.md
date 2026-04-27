# iter-006 — rung 1 — TEAM (Codex-w30gi + Codex-0n26b + Codex-mqyql.18)

> **First cluster-defect agent-team cycle.** Exercises the §13 protocol added to SKILL.md in iter-005. R1 exception explicitly authorized by user: "if we have related beads like that that are sharing a bug path an agent team would make sense to address them — ok do 1 then 2a and improve the skill to handle this sort of thing."

## Cluster

Three open beads sharing the same `route:self:proof-test-path-mechanical-fix` fingerprint (6→5 dotdots in `repoRoot` resolution inside `apps/web/src/__denoise_proofs__/iter-027/*.test.ts`). Each bead also carries an independent rung-1 code-fix recipe.

| Bead | Rung | Code-fix recipe | Files |
|------|------|-----------------|-------|
| Codex-w30gi (F1) | 1 | Replace 2 inline `STUDIO_ROLES = new Set(...)` triples with `useStudioAccess()` composable | SidebarRail.svelte, SidebarRailUserSection.svelte, F1 proof |
| Codex-0n26b (F3) | 1 | Extend `$lib/server/content-detail.ts` with `EMPTY_SUB_CONTEXT` + `DENIED_ACCESS_RESULT` constants; both loaders import + spread | content-detail.ts, org loader, creators loader, F3 proof |
| Codex-mqyql.18 (F4) | 1 | 1-line text edit: `loadFromServer()` → `hydrateIfNeeded()` in `references/05-domain-web.md` line 145 | F4 proof + (gitignored) reference doc |

Shared sidequest: `repoRoot = resolve(__dirname, '../../../../../..')` → `'../../../../..'` in all three proof tests.

## Team spawn

3 parallel `Agent` calls in one message. Each agent received:
- Its bead ID and recipe
- The list of OTHER beads in the team + their files (so it could detect-and-skip)
- Files it MAY edit / MUST NOT edit (explicit allow/deny lists)
- Step-by-step protocol per SKILL.md §13: pre-flight gate → claim → apply → proof → labels → close → return

Each agent worked in its own context window. Parent context grew by ~30 lines (3 structured summaries) after all 3 returned.

## Per-agent results

### Agent 1 — Codex-w30gi (F1 SidebarRail)

- **Status**: ok
- **Proof**: `F1-sidebar-rail-studio-roles-dup.test.ts` — 6/6 passing
- **Files changed**: SidebarRail.svelte, SidebarRailUserSection.svelte, F1 proof test
- **Discovery**: none — clean execution per recipe
- **agentId**: a4ba6a9baa6dffff9

### Agent 2 — Codex-0n26b (F3 content detail loaders)

- **Status**: ok
- **Proof**: `F3-content-detail-loader-dup.test.ts` — 4/4 passing
- **Files changed**: org loader, creators loader, content-detail.ts, F3 proof test
- **Discovery**: `apps/web/src/lib/server/content-detail.ts` ALREADY existed (with related `loadAccessAndProgress`, `loadSubscriptionContext`, `handlePurchaseAction` helpers). Agent extended it instead of creating a duplicate. Bonus correctness: `DENIED_ACCESS_RESULT` typed as full `AccessAndProgress` — added `readyVariants: null` so denial path structurally matches success path. Consumers now see `null` instead of `undefined` for that field.
- **agentId**: ab63830711cbba37c

### Agent 3 — Codex-mqyql.18 (F4 doc-rot)

- **Status**: ok
- **Proof**: `F4-doc-rot-loadFromServer.test.ts` — 4/4 passing
- **Files changed**: F4 proof test (committable)
- **localOnlyFilesChanged**: `.claude/skills/denoise/references/05-domain-web.md` (gitignored — fix landed on disk only)
- **Discovery**: confirmed only ONE occurrence of `loadFromServer` in the doc (no sibling references), so the 1-line fix is genuinely complete
- **agentId**: a28dd3bb1d0130040

## Aggregate proof gate

All 3 proof tests pass: 6 + 4 + 4 = 14 assertions across 3 test files. The `route:self:proof-test-path-mechanical-fix` fingerprint promoted to RT2 after this cycle (3 hits across 3 distinct iters in <6-cycle window).

## Recurrence increments

- `route:self:proof-test-path-mechanical-fix` → hits=2→3, +iter-006, +Codex-w30gi/Codex-0n26b/Codex-mqyql.18. **PROMOTED to RT2.**
- `signal:cluster-defect-team-fix-eligible` → hits=1→2 (sighting confirmed by execution), +iter-006. One sighting from threshold; if iter-007 produces another team-cycle, promote.
- `signal:over-filter-denoise-tagged-rung-1` → unchanged (no re-occurrence — iter-005 fix held).

## Skill §13 — lessons from prototype run

The protocol worked as designed. A few notes for the next §13 revision:

1. **`localOnlyFilesChanged` field needed.** Codex-mqyql.18's target file (`.claude/skills/denoise/references/05-domain-web.md`) is gitignored. The agent landed the fix locally, the proof test verified it locally, but the team commit doesn't contain that change. The §13 return shape should include a `localOnlyFilesChanged: [...]` field so the parent can record the on-disk vs git-history divergence in the iter doc. **Action: amend SKILL.md §13 in a follow-up cycle.** Suggested: rename "atomic commit shape" to "atomic working-tree shape" and explicitly carve out gitignored sites as "local-only fixes" with a one-line iter-doc note.

2. **Existing-file discovery.** Agent 2's brief said "CREATE `content-detail.ts`" but the file already existed. The agent correctly extended instead of duplicating. §13's recipe shouldn't be prescriptive about file creation when the helper might already exist — wording should be "ensure constants exist in `<file>`, creating if absent."

3. **Per-agent proof gate scaling.** Each agent ran its own `pnpm exec vitest` (3 separate invocations, ~5 sec each). On larger team sizes this becomes coordination overhead. For team sizes ≥3, consider letting the parent run all proof tests in one `vitest` invocation after agents return. Risk: a per-agent failure isn't isolated. Acceptable trade-off for N≥4.

4. **R5 (no stealing) held without coordination.** Each agent's pre-flight gate read `bd show --json` independently; none of the 3 beads were claimed by anyone else. The "list other beads in team" hint in the brief was useful only for the file-allow/deny list, not for bead-claim coordination. Confirmed: parallel claim across distinct beads is race-free as long as agents don't share a bead.

## Atomic commit shape

Per §13 default-to-(a), parent produces ONE team commit covering 8 versioned files + 3 artifact files. The doc fix on the gitignored reference is noted in the commit body (not staged).

## Spillover

Each iter-027 proof test had the same path bug; iter-005 already fixed F2; iter-006 fixed F1/F3/F4. No more iter-027 proof tests remain. The pattern's promotion (RT2) means future iter cohorts under `__denoise_proofs__/iter-NNN/` will be auto-rung-1 if they ship with the same path bug — classifier should grep for `'../../../../../..'` (6-dotdot) and auto-fix as part of any cycle that touches such a test.
