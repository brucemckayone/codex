# iter-010a-promote — RT3 codification

> **Type**: parent-driven rule promotion (no bead resolved)
> **Trigger**: `iter-010a`'s structured return flagged `signal:concurrent-cycle-suffix` as promotion-eligible
> **Outcome**: RT3 codified; 1 commit lands master.md + this doc

## What happened

The user invoked `/triage` manually after `iter-009a-apply` had drained the rung-3 bead `Codex-d3g6`. The cycle dispatched a sub-agent which collided with an in-flight concurrent /triage cycle:

- **iter-010** — concurrent agent already mid-walk on `Codex-3u505` (a rung-2 candidate). Walk produced a zero-byte diff (the bead's described fix had already shipped under `Codex-lfx11` / commit `b566eabd` one day after filing). Recommended `close-as-duplicate` with greenlight framing.
- **iter-010a** — this cycle's sub-agent. Detected the collision via working-tree state inspection (untracked `iter-010.md` + uncommitted `master.md` hunk). Adopted `iter-010a` suffix per the precedent established in iter-005a / iter-009a. Picked the OTHER rung-2 candidate (`Codex-70xgd`). On re-read, `Codex-70xgd` failed R8 (no `file:line`, body 3 lines, cited token `collection:user:following` returns 0 grep matches across `apps/`/`packages/`/`workers/`) and fell into a multi-package architectural-tradeoff shape — re-classified rung-2 → **rung-3 + needs-design**.
- **iter-010 (reconciled)** — concurrent agent's apply phase, ran without a user gate because the diff was zero-byte (audit-trail cleanup, not code change).
- **iter-010-apply** — yet another concurrent agent's apply phase, ran AFTER the user greenlit option (a) close-as-duplicate. Found the bead already closed by the reconciliation pass; idempotent re-close. Cited "RT3 promoted" preemptively in its master.md row — that was inferred from the queue marker, not a real codification.

iter-010a's structured return flagged the queue:

```json
{
  "fingerprint": "signal:concurrent-cycle-suffix",
  "hits": 3,
  "iters": ["iter-005a", "iter-009a", "iter-010a"],
  "promotion_eligible": true,
  "promotion_queued_for": "next-/triage-cycle parent prep step",
  "draft_rule_text": "..."
}
```

Per **R9** (sub-agents never call `AskUserQuestion`), the cycle agent could not codify the rule itself. The parent surfaced the question.

## Promotion question (parent → user)

```
Promote `signal:concurrent-cycle-suffix` to RT3? Pattern hit 3× unanimously
(iter-005a, iter-009a, iter-010a) — concurrent /triage cycles already detect
collisions via working-tree state and adopt `[a-z]` suffix without friction.
Promotion would codify the protocol in references/02-routing-rules.md.

Options:
  - Promote as-is (Recommended)
  - Promote with edits
  - Defer — wait for 4th hit
  - Reject — keep informal
```

**User chose**: `Promote as-is (Recommended)` (no edits).

## What got written

### `.claude/skills/triage/references/02-routing-rules.md` (gitignored — local only)

Added RT3 section after RT2 with full structure:

- **5-step recipe**: collision detection (working-tree inspection) → suffix `[a-z]` adoption → non-conflicting bead pick → no master.md ladder edits → independent commit
- **Why this rule exists**: 3 cycles of evidence with zero observed friction; codifying lets future briefs stay terse
- **Exceptions**: (1) concurrent cycle in pre-write phase where iter doc not yet on disk → suffix agent picks conservatively or returns `{ok: false, reason: 'concurrent-cycle-detected-no-iter-doc-yet'}`; (2) suffix agent forced to ladder-edit (e.g., picked rung-1 and resolved it) MUST coordinate via latest master.md state and explicitly note the touched lines
- **Bead examples**: Codex-v5bzy, Codex-d3g6, Codex-70xgd
- **Counter-example handling**: future merge conflicts on master.md/recurrence.json or bead-claim collisions land under `counter_examples[]`; 3 trigger rule review

Also reshuffled the "Anticipated next promotions" section since RT3 is now taken:

- **RT4 candidate (closest)**: `route:self:promoted-helper-missed-call-site` (2 hits — iter-003 Codex-y6x9j, iter-009 Codex-y63gl.14). One more recurrence promotes.
- **RT5 candidate**: `route:self:large-mechanical-css-token-sweep` (1 hit — iter-008 Codex-mm0z9)
- **RT6 candidate**: `signal:bead-fully-stale-already-resolved-by-sibling` (1 hit — iter-010 Codex-3u505)
- **RT*-?**: `signal:rung-2-to-rung-3-on-reread` (1 hit — iter-010a Codex-70xgd)
- Demoted: the prior list's `route:design-system:ds-review-blocker`, `route:backend-dev:auth-touch`, `route:self:denoise-simplification-duplicate-utility-helper` are still anticipated but currently 0-hit in the /triage ledger

### `docs/triage/recurrence.json` (committed in `ba834a61` by concurrent iter-010-apply agent)

Marked `signal:concurrent-cycle-suffix`:

```json
{
  "promoted": true,
  "rule_id": "RT3 (applied iter-010a-promote)"
}
```

The promotion-flag landing in iter-010-apply's commit is incidental — that agent's commit happened to be in flight when the parent's edits to `recurrence.json` landed in the working tree, and `git add docs/triage/` swept them up. The audit trail still cites the correct iter (`iter-010a-promote`) via the `rule_id` field.

### `docs/triage/master.md` (this commit)

- **Promoted-rules table**: appended RT3 row
- **Cycle history table**: appended `iter-010a-promote` row
- **Recurrence watches table**: updated `signal:concurrent-cycle-suffix` row from `**3 (PROMOTION ELIGIBLE)**` → `3 (PROMOTED RT3)`

## Why this counts as a "cycle" (and not just a parent edit)

The skill protocol §4 step 8 says "rung-3-4 cycles commit only the artifact updates". A promotion pass is structurally that shape: no bead state changes, no code edits, just the three artifact files. It's worth a row in the cycle-history table because future audits should be able to trace WHERE RT3 came from — `git log --oneline | grep iter-010a-promote` will land here.

## Recurrence ledger updates

- `signal:concurrent-cycle-suffix.promoted = true` ✓
- `signal:concurrent-cycle-suffix.rule_id = "RT3 (applied iter-010a-promote)"` ✓
- No new fingerprints introduced this pass

## §13 protocol gap reminder

The routing-rules.md edit lands in a gitignored path (`.claude/skills/triage/references/`). The cycle agent's structured return shape STILL doesn't have a `localOnlyFilesChanged` field (gap noted from iter-006). Future cycles that touch gitignored skill-internal files should explicitly call this out so the parent's commit message and audit trail reflect that meaningful work happened off the public repo. Not blocking this promotion; flagging for the §13 cleanup pass.

## Next-cycle hint

Backlog state after iter-010 (closed Codex-3u505 + reclassified Codex-70xgd) plus this RT3 promotion:

- Rung 0: 0
- Rung 1: 0
- Rung 2: 0
- Rung 3: 21 (top: Codex-x0pa P0, Codex-6axi0 P1 blocked, Codex-i49f P1, Codex-u498 P1, Codex-70xgd P3 needs-design)
- Rung 4: 5

Lowest non-empty rung is 3. **RT1 will fire** if the next /triage cycle is auto-loop — three consecutive low-yield cycles are imminent unless `/denoise` files new mechanical work. Manual /triage invocations (like this one) bypass RT1 — user has implicitly accepted the design-decision shape of remaining work.

The user has stated forward-momentum preference recently ("don't push to stop"); a sensible next move on /triage is either (a) escalate the rung-3 P0 (Codex-x0pa) to a routing question, (b) spawn `/denoise` to refresh the mechanical lane, or (c) close the session and resume after `/denoise` runs.
