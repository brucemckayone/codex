# 02 — Routing Rules

This file is the codified output of the recurrence ledger. When a routing pattern hits 3+ times within a 6-cycle window (mirrors `/denoise` §7 R7), it gets promoted from `recurrence.json` into a hard rule here. Promotion mechanics live in [`03-recurrence-promotion.md`](03-recurrence-promotion.md).

The classifier checks promoted rules **before** falling through to the ladder signals — they short-circuit classification.

## Promoted rules

### RT1 — `signal:auto-loop-skip-rung-2-plus` → pause /loop on /triage

- **Promoted in**: iter-004
- **Source pattern**: `signal:auto-loop-skip-rung-2-plus` from `recurrence.json`
- **Hits at promotion**: 3 (iter-002, iter-003, iter-004)
- **Iters of evidence**: iter-002, iter-003, iter-004
- **Verdict**: meta-rule (does not classify a bead — it gates the parent's loop scheduling)
- **Recipe**: When `/triage` runs in auto-loop (`/loop` invoking `/triage` with the policy override "skip rung 2+, only resolve rung 0/1"), and 3 consecutive cycles have produced rung-1 yield ≤ 1 each (i.e., 0 or 1 auto-resolved bead per cycle), **the parent must pause the /loop on /triage**. The parent surfaces a routing decision to the user with at least these options:
  - **(a)** Greenlight a specific rung-3 bead for this cycle (user names the bead).
  - **(b)** Switch the /loop to a different skill (e.g., `/denoise` to generate new findings, `/backend-dev` to wire planned functionality, `/design-system` for visual work).
  - **(c)** Stop the /loop entirely until the queue gains more rung-0/1 beads.
- **Why this rule exists**: The rung-1 yield curve is a direct signal of triage's auto-resolve productivity. iter-002 yielded 1 bead (Codex-fcdkk), iter-003 yielded 1 bead (Codex-y6x9j — and only because the brief manually flagged a misclassification), iter-004 yielded 0. Continuing /loop on /triage past this point burns prompt-cache windows + sub-agent compute on re-scans that produce nothing. The user's stated /loop policy ("get the easiest fixes that don't require human intervention") explicitly opts out of rung-2+ work, so the queue exhausting its rung-0/1 supply means the policy itself is satisfied — there is nothing left to do without changing the policy or the queue.
- **Exceptions**: 
  - If `/denoise` has run between two consecutive `/triage` cycles and produced new beads, the rule's window resets — the new beads may include rung-0/1 candidates that haven't been counted.
  - If the user explicitly invokes `/triage` (not via /loop), this rule does not fire — manual invocation already implies the user has decided to engage.
- **Bead examples**: n/a (this is a meta-rule about skill scheduling, not a bead-classification rule)

**Why**: Three cycles of evidence (iter-002, iter-003, iter-004) showed that the auto-loop /triage path quickly reaches a productivity floor once /denoise stops feeding mechanical findings. The skill's value is real but **bursty** — it works best as a drain pass after a /denoise wave, not as a continuously-running background process. Codifying RT1 prevents future /loop invocations from silently burning resources after the queue drains.

### Counter-example handling for RT1

If a `/triage` auto-loop cycle exits with `ok: false` AND the user later finds that the queue actually contained a rung-1 candidate the classifier missed (e.g., another Codex-y6x9j-style misclassification), record a counter-example under `recurrence.json` → `signal:auto-loop-skip-rung-2-plus.counter_examples[]`. Three counter-examples trigger a rule review.

---

### RT2 — `route:self:proof-test-path-mechanical-fix` → rung 1 auto-resolve

- **Promoted in**: iter-006 (cluster-defect team cycle)
- **Source pattern**: `route:self:proof-test-path-mechanical-fix` from `recurrence.json`
- **Hits at promotion**: 3 (iter-002 corrected 5 iter-012 tests; iter-005 corrected iter-027 F2; iter-006 cluster-team corrected iter-027 F1+F3+F4)
- **Iters of evidence**: iter-002, iter-005, iter-006
- **Verdict**: rung 1, action `auto-resolve` (or `team-resolve` when N≥2 sibling proof tests share the bug — see SKILL.md §13)
- **Recipe**: Beads describing scaffolding fixes inside `apps/web/src/__denoise_proofs__/iter-NNN/*.test.ts` (most commonly the 6→5 dotdot `repoRoot` resolution bug inherited from iter-012's template) auto-classify as **rung 1**, even when the bead's primary fingerprint is `denoise:*`-shaped. The fix is mechanical:
  - `repoRoot = resolve(__dirname, '../../../../../..')` → `resolve(__dirname, '../../../../..')` (6 dotdots → 5)
  - Often paired with `describe.skip(...)` → `describe(...)` un-skip when the bead's primary code-fix has been applied
  - When N≥2 sibling tests in the same iter cohort share the bug AND each carries an independent rung-1 code-fix recipe, eligible for **§13 cluster-defect agent team** (parallel sub-agents, atomic team commit).
- **Proof shape**: filesystem-existence assertion that the corrected `repoRoot` resolves to a real `package.json` + apps/web. The bead's primary proof test (which exercises the un-skip) inherits the path correction as a sidequest.
- **Exceptions**:
  - If the proof test cites a path that is NOT under `__denoise_proofs__/` (e.g., a normal feature test), this rule does NOT apply — the bead falls through to standard ladder classification.
  - If the bead's primary code-fix is rung-2+ (e.g., a multi-file refactor with no canonical helper to extract to), the path bug becomes a separate sidequest bead but the parent bead stays at its true rung — do NOT mechanically rung-1 a rung-3 bead just because its proof test has the path bug.
- **Bead examples**: Codex-fcdkk (iter-002, batch of 5), Codex-zhe80 (iter-005, single), Codex-w30gi + Codex-0n26b + Codex-mqyql.18 (iter-006, team)

**Why**: The 6-dotdot bug originated in iter-012's `__denoise_proofs__/` template and propagated to every subsequent iter cohort that copy-pasted the scaffold (iter-027 was the worst-affected: 4 of 4 proof tests inherited it). The classifier should NOT spend cognitive budget routing these as denoise-shaped findings — they are infrastructure-shaped misconfigurations, mechanically fixable by anyone who can count dotdots. RT2 codifies that intuition so future cycles auto-rung-1 the bead and proceed to fix without escalation.

**Lint candidate**: A pre-commit grep for `'../../../../../..'` (literally 6 dotdots) under `apps/web/src/__denoise_proofs__/` would prevent recurrence at the source. File as a separate bead via `bd create` if the cycle has spare budget.

### Counter-example handling for RT2

If a future cycle finds a `__denoise_proofs__/` test with the 6-dotdot pattern that is NOT mechanically fixable (e.g., the test was intentionally pointing 6 levels up because the fixture lives outside `apps/web`), record a counter-example under `recurrence.json` → `route:self:proof-test-path-mechanical-fix.counter_examples[]`. Three counter-examples trigger a rule review.

---

### RT3 — `signal:concurrent-cycle-suffix` → second-agent collision protocol

- **Promoted in**: iter-010a (promotion confirmed by user mid-cycle after sub-agent surfaced the queued-for-confirm flag)
- **Source pattern**: `signal:concurrent-cycle-suffix` from `recurrence.json`
- **Hits at promotion**: 3 (iter-005a, iter-009a, iter-010a — unanimous `action: meta-signal, user_chose: use-suffix`)
- **Iters of evidence**: iter-005a, iter-009a, iter-010a
- **Verdict**: meta-rule (does not classify a bead — it gates how a second concurrent cycle agent operates so it doesn't conflict with the first)
- **Recipe**: When a `/triage` cycle agent starts and detects another /triage cycle is already in flight, it adopts the **second-agent collision protocol**:
  1. **Detect collision** via working-tree state inspection: an untracked `docs/triage/iter-NNN.md` OR an uncommitted hunk in `docs/triage/master.md` / `docs/triage/recurrence.json` that cites `iter-NNN`. (`bd list --status=in_progress` is NOT a reliable signal because the first agent may not have claimed a bead yet.)
  2. **Adopt suffix** `[a-z]` for the iter ID — first collision becomes `iter-NNNa`, second `iter-NNNb`, etc. The suffix agent writes its own `docs/triage/iter-NNNa.md` decision log; it does NOT edit the first agent's `docs/triage/iter-NNN.md`.
  3. **Pick a non-conflicting bead** — re-read the first agent's iter doc (or its uncommitted contents) to identify the bead it has claimed, then pick the next-highest-priority candidate from the ladder that is NOT that bead. This prevents bead-claim collisions at `bd update --status=in_progress` time.
  4. **Do NOT touch master.md ladder counts** — the first agent owns the ladder snapshot mutation for its own resolved bead. The suffix agent only **appends** to (a) the cycle-history table (one new row), (b) the recurrence-watches table (only if it surfaces a new pattern), and (c) the `signal:concurrent-cycle-suffix` verdict_history.
  5. **Commit independently** — the suffix agent commits its artifact updates with `triage(iter-NNNa): <one-line summary>`. The first agent's commit and the suffix agent's commit are independent and can land in either order.
- **Why this rule exists**: Three cycles of evidence (iter-005a, iter-009a, iter-010a) showed the protocol works without friction: zero merge conflicts on shared artifacts (master.md / recurrence.json), zero bead-claim collisions, zero ledger collisions. The protocol started as ad-hoc guidance in iter-005's brief ("on doc-name collision adopt iter-NNNa.md suffix"), generalised in iter-009a (also surfaced `route:self:promoted-helper-missed-call-site` ledger bump without disturbing the first agent's ladder edit), and now hardens into a rule. Codifying RT3 means future briefs do not need to re-explain the protocol; the cycle agent reads RT3 and applies it on collision detection.
- **Exceptions**:
  - If the first agent's bead is `in_progress` but its iter doc is **not yet on disk** AND `bd sync --status` shows no pending changes, the suffix agent cannot reliably distinguish "no concurrent cycle" from "concurrent cycle in pre-write phase" — in that case, the suffix agent should pick conservatively (lowest non-empty rung that is NOT the in-progress bead, OR `{ok: false, reason: 'concurrent-cycle-detected-no-iter-doc-yet'}` if even that risks collision).
  - If the suffix agent's chosen bead would force a master.md ladder count edit (e.g., picked rung-1 and resolved it), it MUST coordinate with the first agent's commit by taking the latest master.md state before its own edit and explicitly noting in its iter-NNNa.md decision log which lines it touched. Two ladder-count edits in one cycle pair are allowed only if the agents resolve different rungs (no double-decrement of the same rung count).
- **Bead examples**: Codex-v5bzy (iter-005a — type-drift walk concurrent with iter-005's Codex-zhe80 mechanical fix), Codex-d3g6 (iter-009a — multi-file walk concurrent with iter-009's Codex-y63gl.14 perf fix), Codex-70xgd (iter-010a — rung-2-to-rung-3 reclassification concurrent with iter-010's Codex-3u505 close-as-duplicate)

**Why**: Concurrent /triage cycles are a side-effect of `/loop` invocations overlapping with manual `/triage` invocations, and of users re-firing the skill before a previous cycle's commits land. Without RT3, the second agent has to infer the protocol from prior iter docs each time, which is fragile and grows the cycle-agent prompt. RT3 codifies it once, lets the brief stay terse, and ensures the suffix-agent's behaviour is predictable across future cycles. The rule's load-bearing guarantee is **non-overlapping artifact edits** — each cycle's diff lives in its own file (`iter-NNNa.md`) plus appended-only rows in shared files (`master.md` cycle history, `recurrence.json` verdict_history), never in the same hunk as the first agent's diff.

### Counter-example handling for RT3

If a future cycle pair produces a merge conflict on master.md or recurrence.json, OR a bead-claim collision (both agents `bd update --status=in_progress` the same bead), record a counter-example under `recurrence.json` → `signal:concurrent-cycle-suffix.counter_examples[]`. Three counter-examples trigger a rule review — likely outcome: tighten the collision-detection clause to also inspect `bd list --status=in_progress --json | jq '.[].id'` before bead pick.

---

Future rules will be added here using this template:

```markdown
### RT<N> — <fingerprint> → rung <R>

- **Promoted in**: iter-NNN
- **Source pattern**: `<routing-pattern-id>` from `recurrence.json`
- **Hits at promotion**: N
- **Iters of evidence**: iter-A, iter-B, iter-C
- **Verdict**: rung <R>, action <auto-resolve|escalate-to-user|route-to-skill>
- **Recipe**: <one-line description of the standard fix or routing target>
- **Exceptions**: list of cases where the rule does NOT apply
- **Bead examples**: Codex-X, Codex-Y, Codex-Z

**Why**: <one-paragraph reason — usually citing the past incidents that motivated promotion>
```

## Rule numbering

Triage rules are prefixed `RT` (denoise uses bare `R`, so this avoids ambiguity):
- `RT1`, `RT2`, … in promotion order
- Each rule cites its source iter and the pattern fingerprint from the ledger

## Anticipated next promotions

RT1, RT2, and RT3 are now live. The following patterns are most likely to reach the 3-hit threshold next:

- `route:self:promoted-helper-missed-call-site` — currently 2 hits (iter-003 Codex-y6x9j, iter-009 Codex-y63gl.14). Closest to threshold; one more recurrence promotes. Recipe: when a perf/structural pattern established inline in component A is missed by later-arriving consumers B/C, extract to a shared helper as part of the rung-1 fix. Likely **RT4** candidate.
- `route:self:large-mechanical-css-token-sweep` — currently 1 hit (iter-008 Codex-mm0z9). Recipe: CSS token sweeps with byte-identical recipes and N≥50 sites auto-classify as rung-1 if (a) cited token exists in `apps/web/src/lib/styles/tokens/`, (b) sampled sites confirm uniform context, (c) replacement preserves visual equivalence at canonical density. Likely **RT5** candidate if more sweeps land.
- `signal:bead-fully-stale-already-resolved-by-sibling` — currently 1 hit (iter-010 Codex-3u505). Recipe: on rung-1/rung-2 pickup, cycle agent runs `git log -S '<distinctive phrase from bead description>'` before drafting any diff; if a sibling bead's commit already applied the fix, return zero-byte close-as-duplicate. Likely **RT6** candidate if shipped-under-sibling races recur.
- `signal:rung-2-to-rung-3-on-reread` — currently 1 hit (iter-010a Codex-70xgd). Recipe: rung-2 lane MUST be re-validated at pick time by running R8 + cross-package check; any bead failing either gate auto-bumps to rung-3. Promotion would harden the brief's "sanity check on re-read" clause into a default classifier behaviour.
- `route:design-system:ds-review-blocker` — `ds-review:*` blocker beads consistently route to `/design-system`. Awaiting first hit in /triage's ledger.
- `route:backend-dev:auth-touch` — beads citing `packages/security/` or `workers/auth/` consistently rung-4 escalate to `/backend-dev`. Awaiting first hit.
- `route:self:denoise-simplification-duplicate-utility-helper` — R14-fingerprinted beads consistently rung 1 mechanical dedupe. Awaiting first hit.

## Exception handling

When a rule has exceptions, the classifier checks the exception list before applying the rule's verdict:

```markdown
### Exceptions for RT<N>

- `<bead match condition>` → fall through to ladder signals (do not apply rule)
- `<bead match condition>` → escalate one rung higher than rule says
```

Exceptions are codified at promotion time and updated when a cycle hits a counter-example.

## Anti-patterns for promotion

Things that look like promotable patterns but should NOT promote:

- **One-off routing decisions**: a single bead that needs `/design-system` doesn't make a rule. 3+ hits required.
- **Fingerprint groupings that span rungs**: if `denoise:types:as-cast-without-guard` sometimes lands rung 1 and sometimes rung 4, that's not a rule — it's noise. Don't promote.
- **Patterns without bead-level evidence**: every promotion cites the bead IDs that drove it. No bead trail = no promotion.
- **High-volume noise**: if a fingerprint is common but always already-correct (e.g., a label that's auto-applied), don't promote a no-op rule.

## How rules age out

A promoted rule whose pattern hasn't fired in 12 cycles is flagged for review. If the underlying issue has been mitigated upstream (e.g., the denoise rule that surfaced it is itself promoted and fully effective), the routing rule may be retired with a `RETIRED:` prefix and a one-line note.

Retired rules stay in this file for audit trail; they just stop being checked by the classifier.
