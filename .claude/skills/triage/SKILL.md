---
name: triage
description: >
  Backlog-resolution skill for the Codex monorepo. Sibling to /denoise — denoise produces beads,
  triage consumes them. Picks one open bead per cycle, classifies it on a 5-rung complexity ladder
  (trivial → design-needed), and either auto-resolves the mechanical rungs or stops and asks the
  user on the design rungs. Sub-agent-per-cycle architecture keeps parent context bounded; only
  failures and user-prompts grow it. Self-improves via routing-pattern recurrence (3+ hits → hard
  rule). Use to chew through a backlog mindless-first without losing human oversight on real
  decisions.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# Triage — Backlog Resolution Loop

This skill picks **one open bead per cycle** off the bottom of a complexity ladder and either resolves it (rungs 0–1) or surfaces a focused decision prompt to the user (rungs 2–4). It mirrors `/denoise`'s machinery (single-cell-per-cycle, falsifiability gate, recurrence ledger, three-artifact state) but inverts its direction: denoise *creates* beads from code; triage *closes* beads by changing code or routing them.

The skill is intentionally **guided by default** — it is the family's only sibling that calls `AskUserQuestion` mid-cycle, and it does so by routing the question through the parent (sub-agents cannot surface UI to the user).

## §0 — When to invoke vs defer

Use `/triage` when ALL of:

- The open beads queue has stale items and a human wants the cheap wins drained without manually scanning 150 entries.
- You want to spend ~5–15 minutes on one bead and stop, **not** sweep the queue.
- The user is available to answer 1–2 questions if the picked bead lands at rung 3 or 4.

**Defer to a different skill when:**

- The bead is a `denoise:*`-tagged finding that hasn't been verified yet → `/denoise` is still the owner; let it close its own findings. **However**: a denoise:* bead with a cited proof-test path under `__denoise_proofs__/iter-NNN/` IS verification-complete and triage-eligible — denoise owns the verification phase, not the resolution phase. Look for the proof-test path in the description (or for a `describe.skip(...)` / `it.skip(...)` marker in the cited test) before excluding the bead. (Codified iter-005 after iter-004 over-filtered all denoise:* beads and missed Codex-zhe80, a clean rung-1 candidate.)
- The bead is `fallow-followup` → `/fallow-audit` already has the verification flow.
- The bead is design-system-shaped (`ds-review:*` label) → `/design-system` owns the recursive-review workflow.
- You actually want to start NEW work, not drain existing → just create a bead with `bd create` and route through the relevant skill directly.

If `/triage` picks a bead that should belong to another skill, it lands at rung 4 and asks the user to confirm a route to that skill — it never auto-claims work the family has explicitly delegated elsewhere.

## §1 — Hard rules

- **R1**: One bead per cycle. Never sweep. The single-cell-per-cycle rule is load-bearing — it is what keeps cycles reviewable and lets the recurrence ledger learn between cycles.
  - **R1 Exception (Cluster-Defect Agent Team)**: When N≥2 open beads share an identical fingerprint AND a byte-equivalent (or near-byte-equivalent) fix recipe AND target independent files, a single cycle MAY spawn N parallel sub-agents to fix all N in one team-cycle. See §13 for the protocol. A team-cycle counts as ONE cycle in the ledger (one row in master.md, one `verdict_history` entry in recurrence.json with `action: "team-resolve"`) — it does not violate the spirit of R1 because the fixes are mechanically interchangeable and the per-cycle review value of splitting them is zero.
- **R2**: Every closed bead has either (a) a passing proof test (rung 0–1) or (b) a quoted user greenlight in the iter doc (rung 2). Rung 3–4 cycles **route or split** beads; they do not close them.
- **R3**: Rungs 3–4 NEVER auto-resolve. Stop. Ask. Route. This is the load-bearing rule for the user's stated requirement that human input gates real decisions.
- **R4**: Mechanical fixes auto-apply to the working tree only. `git push` always requires explicit user confirm — even on rung 0 trivial fixes.
- **R5**: A bead is ineligible if `status=in_progress` and `owner != current user`. Do not steal claimed work.
- **R6**: Recurrence ledger updates every cycle. 3+ hits of a routing pattern within a 6-cycle window promotes to a hard rule in `references/02-routing-rules.md`. (Mirrors `/denoise` §7 R7.)
- **R7**: Epics never resolve in a single cycle. They either delegate to an unblocked child at a lower rung, or escalate to rung 4 ask.
- **R8**: Bead descriptions that don't cite `file:line` (or equivalent locator) auto-classify as rung 3. The classifier cannot mechanically resolve what it cannot point at.
- **R9**: The cycle agent's structured return value MUST be one of three shapes (`{ok: true, autoResolved: true, ...}`, `{needsUser: true, ...}`, `{ok: false, ...}`). The parent renders the result; sub-agents NEVER call `AskUserQuestion`.
- **R10**: **Behavioural test gate before close (rung 0–1).** Grep-based / structural proof tests confirm the *shape* of a fix landed; they do NOT verify behavioural correctness. Before closing a rung-0 or rung-1 bead, the cycle agent MUST satisfy ONE of:
  - (a) An existing behavioural test (vitest unit, integration, or component test) imports the touched symbol(s) and exercises the changed code path. Run it; it must pass.
  - (b) No behavioural test exists for the touched code → the cycle agent WRITES a new behavioural test as part of the fix commit. Test must cover the public surface of the touched symbol(s) at minimum (positive cases + null/undefined/edge inputs). The new test must pass.
  - (c) The fix has no testable behaviour (pure docs, gitignored config, comment-only edits, dead-import removal). The iter doc records this exception with one sentence justifying it.
  
  Pure-function refactors and helper extractions are case (b) — write the unit test for the pure functions; the consumers are correct by construction. UI/component fixes that change rendering are case (b) — mount via `$tests/utils/component-test-utils.svelte` (Svelte 5 pattern) and assert the rendered output. Path-bug fixes in proof-test scaffolding are case (c) — the corrected `repoRoot` resolution IS the test of the path. (Codified iter-006 after the user pointed out: "part of this skill should be that we are writing tests when fixing things — if not that should be part of verification before closing when possible.")

## §2 — Decision tree (parent's first ~30 seconds)

```
/triage invoked
│
├─ Read docs/triage/master.md → next iter ID, ladder snapshot age
│
├─ Optional flags:
│    --rung=N        force a rung
│    --bead=Codex-X  force a specific bead (skips classify)
│    --apply         second-pass after greenlight (rung 2 follow-up)
│    --mcp=force     run MCPs even on non-denoise beads
│    --mode=auto     (FUTURE) skip rung-2 greenlight prompts; rung 3–4 still stop
│
├─ Spawn ONE Agent call (subagent_type=general-purpose)
│    Prompt embeds: iter ID, snapshot age, flags, link to .claude/skills/triage/SKILL.md
│
├─ Receive structured summary. Branch on shape:
│    {ok: true, autoResolved: true, ...} → print 1-line summary, end
│    {needsUser: true, ...}              → invoke AskUserQuestion with payload, route on answer
│    {ok: false, reason, ...}            → surface full reason, end
│
└─ Done. Parent context grew by ~3 lines (success) or ~20 lines (escalation).
```

Routing the question through the parent is the load-bearing trick. The cycle agent does all the heavy reading/classifying/editing in its own context; the parent only sees the summary.

## §3 — The 5-rung complexity ladder

| Rung | Name | Examples | Cycle action |
|------|------|----------|--------------|
| 0 | Trivial | Typo, single-string fix, comment cleanup, dead import | Auto-fix → proof test → ask user before commit |
| 1 | Mechanical | Unused export delete, simple dedupe, lint fix, label add, `as unknown as` removal where guard exists | Auto-fix via bounded sub-agent → proof test → commit |
| 2 | Scoped | Single-file logic change, simple service method, validation tweak, test stub → real assertion | Produce diff → `AskUserQuestion` greenlight → second cycle applies |
| 3 | Multi-file / Reasoned | Refactor across 3+ files, cross-package impact, ambiguous spec | Stop. `AskUserQuestion` with approach options A/B/C |
| 4 | Design-needed | New schema, UX choice, security/auth boundary, multi-system work, epic | Stop. `AskUserQuestion`. Route to domain skill |

Full classifier rules and per-rung proof-test shapes live in [`references/01-complexity-ladder.md`](references/01-complexity-ladder.md). Read it on first invocation and any time the recurrence ledger gets a new pattern.

## §4 — Cycle (sub-agent-per-cycle, 8 steps)

The cycle agent runs in its own context window and returns one structured summary to the parent. The parent's context only grows by that summary.

### Cycle agent steps

1. **Classify (if stale).** If `master.md` snapshot is older than current `bd sync` head OR `--mode=full` is set, dispatch a nested `Explore` agent over `.beads/issues.jsonl` to refresh ladder positions. Write back to `master.md`. (Brief: [`agents/triage-classify.md`](agents/triage-classify.md).)
2. **Pick bead.** Default: lowest non-empty rung, then `(priority DESC, age DESC)`. Honour `--rung=N` and `--bead=X` flags. Apply R5 (skip in_progress-and-not-mine), R7 (epic → child), R8 (no file:line → rung 3).
3. **Pre-flight gate.** Re-read the bead via `bd show <id> --json` to confirm it is still open and the description hasn't been edited since classification. If drift detected → re-classify just this bead.
4. **Branch on rung.**
   - **Rung 0–1** → spawn nested resolver agent ([`agents/triage-resolve-mechanical.md`](agents/triage-resolve-mechanical.md)). Allowlist: Read, Edit on cited files, Bash for `pnpm test` and `bd update`. Proof-test gate is mandatory.
   - **Rung 2** → produce a candidate diff (Read-only walk, no Edit). Package as `{needsUser: true, rung: 2, beadId, diff, summary, options: ['apply', 'skip', 'reroute']}` and return to parent.
   - **Rung 3–4** → return `{needsUser: true, rung, beadId, question, options[]}` with bead summary + 2–4 routing options. Never auto-resolve.
5. **Verify** (rung 0–1 only). Run the MCP gate per the bead's denoise cell labels — same matrix as `/denoise` §3 (security × apps/web → playwright + chrome-devtools; types × any → mcp__ide__getDiagnostics; performance × apps/web → chrome-devtools Lighthouse; simplification → static, no MCPs). Skip MCPs for beads without denoise labels unless `--mcp=force`.
6. **Update bead.** Attach labels via `bd label add <id> <label>` (one label per call — `bd update --label=...` does NOT work, prints help). Canonical sequence: `bd label add <id> triage`, then `bd label add <id> triage:rung-N`, then `bd label add <id> triage:iter-NNN`, then `bd label add <id> triage:routing:<route>` if routed. On rung 0–1 success, also `bd close <id>`. On rung 3–4 routing, leave `status=open` and `owner` unchanged unless `<route>` resolves to a real beads user identifier — the routing label is sufficient handoff signal.
7. **Update artifacts.**
   - `docs/triage/master.md` — ladder snapshot row + cycle history row.
   - `docs/triage/recurrence.json` — increment pattern hits; if a pattern crosses 3-hit / 6-cycle threshold, write the rule into `references/02-routing-rules.md` and flag the parent's summary so it gets noticed.
   - `docs/triage/iter-NNN.md` — one-page decision log: bead summary, classification reasoning, rung, action taken, proof or greenlight evidence, recurrence increments.
8. **Commit + return.** Rung 0–1 success: commit `triage(iter-NNN): rung-N — <one-line summary>`. Rung 2 candidate: no commit yet (parent will re-dispatch with `--apply` after greenlight). Rung 3–4: commit only the artifact updates with `triage(iter-NNN): rung-N — escalated to user`. Then return the structured summary to the parent.

### Parent action on summary

| Summary shape | Parent does |
|---|---|
| `{ok: true, autoResolved: true, ...}` | Print 1-line summary. End cycle. |
| `{needsUser: true, rung: 2, diff, ...}` | Show diff summary, invoke `AskUserQuestion(apply/skip/reroute)`. On `apply` → re-dispatch cycle agent with `--apply --bead=X`. On `skip` or `reroute` → update bead + master.md and end. |
| `{needsUser: true, rung: 3, options[]}` | Invoke `AskUserQuestion` with the 2–4 returned options. On user choice → route (e.g., spawn `/backend-dev`, split via parallel `bd create` agents, defer). |
| `{needsUser: true, rung: 4, options[]}` | Same as rung 3, but options skew toward "spawn `/backend-dev`", "spawn `/design-system`", "split epic into N children", "defer". |
| `{ok: false, reason, partialState?}` | Surface full reason. Verbose context preserved (intentional — that's when humans need detail). End cycle. |

## §5 — Stop-and-ask waypoints

`AskUserQuestion` is invoked from the parent only. Sub-agents return question payloads as data. The full taxonomy is in [`references/04-stop-and-ask.md`](references/04-stop-and-ask.md). Summary:

1. **Rung 3 entry** — "This bead touches N files across M packages. Pick approach: (a) one PR, (b) split into N sub-beads, (c) defer / spawn `/backend-dev`."
2. **Rung 4 entry** — "This bead requires a design decision. Surface options A/B/C with one-line tradeoffs."
3. **Rung 2 greenlight** — "Apply this diff? (a) apply, (b) skip, (c) reroute."
4. **Pre-commit on rung 0–1** — single confirmation summarising the diff before commit (R4).
5. **Ambiguous classification** — classifier confidence low between two adjacent rungs → ask which rung the user wants applied.
6. **High-impact rung 2 escalation** — if a rung 2 bead touches `packages/security/`, `packages/database/schema/`, any `*-secrets*` file, or matches a `human-required` recurrence pattern → escalate to rung 3-style ask.
7. **Epic with no eligible children** — "Epic <id> has no unblocked children at rungs 0–3. Split, pick a blocked child, or defer?"

Otherwise: deterministic. The skill family's preference for self-service decisions still holds for rungs 0–1.

## §6 — Beads label scheme

Verified against the existing namespace (`denoise:*`, `ds-review:*`) — no collision.

```
triage                          # universal — every cycle attaches this
triage:rung-0 … triage:rung-4   # ladder position at time of cycle
triage:iter-NNN                 # cycle attribution
triage:routing:denoise          # handoff target
triage:routing:backend-dev      # handoff target
triage:routing:design-system    # handoff target
triage:routing:fallow-audit     # handoff target
triage:routing:self             # /triage will continue cycling this in a future invocation
triage:needs-design             # rung 4 marker; persists until resolved
triage:needs-greenlight         # rung 2 awaiting user diff approval
triage:cluster-fix              # closed as part of an R1-exception team-cycle (see §13)
```

Canonical attach (one call per label):

```
bd label add <id> triage
bd label add <id> triage:rung-1
bd label add <id> triage:iter-001
```

`bd update --label=...` is rejected (prints help). `bd label add` is additive and does not strip existing labels.

## §7 — Recurrence ledger

`docs/triage/recurrence.json` mirrors `docs/denoise/recurrence.json` schema:

```json
{
  "schema_version": 1,
  "last_updated": "YYYY-MM-DD",
  "patterns": {
    "<routing-pattern-id>": {
      "hits": 3,
      "iters": ["iter-001", "iter-002", "iter-003"],
      "rung_density": { "iter-001": 1, "iter-002": 1, "iter-003": 1 },
      "first_seen": "YYYY-MM-DD",
      "last_seen": "YYYY-MM-DD",
      "promoted": true,
      "rule_id": "RT3 (applied iter-004)",
      "beads": ["Codex-A", "Codex-B", "Codex-C"]
    }
  }
}
```

Pattern IDs use kebab-case prefixes: `route:<target>:<signal>` (e.g. `route:backend-dev:auth-touch`, `route:self:as-unknown-as-fingerprint`, `route:design-system:ds-review-label`). Promotion rules (3+ hits / 6-cycle window, security exception for first-sighting blockers) are documented in [`references/03-recurrence-promotion.md`](references/03-recurrence-promotion.md).

## §8 — Reference router

Load on demand, not all at once.

| File | Owns | Load when |
|------|------|-----------|
| [`references/01-complexity-ladder.md`](references/01-complexity-ladder.md) | 5-rung definitions, classifier signals, per-rung proof-test shapes | Always (every cycle agent reads this) |
| [`references/02-routing-rules.md`](references/02-routing-rules.md) | Promoted routing rules (3+ hits → hard rule), exception lists | Always (classifier checks rules before falling through to ladder) |
| [`references/03-recurrence-promotion.md`](references/03-recurrence-promotion.md) | Pattern IDs, promotion gate, security/blocker exception, rule-numbering scheme | When a recurrence reaches threshold (step 7 of cycle) |
| [`references/04-stop-and-ask.md`](references/04-stop-and-ask.md) | Question payload templates, options-array shapes, escalation triggers | When the cycle agent is about to return `{needsUser: true, ...}` |

[`agents/triage-classify.md`](agents/triage-classify.md) is the brief for the read-only classifier sub-agent.
[`agents/triage-resolve-mechanical.md`](agents/triage-resolve-mechanical.md) is the brief for the bounded-edit resolver sub-agent.

## §9 — Anti-patterns

Things this skill must never do, with reasons:

- **Sweep the backlog.** Tempting on first run because the ladder is empty. R1 forbids it — classify-only first run, then one bead per cycle thereafter.
- **Auto-resolve a rung 2 bead "because the diff is small".** Surfacing diffs to the user is the falsifiability gate for rung 2; bypassing it makes the skill indistinguishable from `/denoise` and erodes the human-in-the-loop guarantee.
- **Sub-agent calls `AskUserQuestion`.** Sub-agents have no UI surface. The cycle agent must return a question payload and let the parent render it. Violating R9 manifests as silent question loss.
- **Edit a bead's description.** The skill labels and closes/updates status, but never rewrites bead bodies — that erodes audit trail. To split work, file new beads via `bd create` and link via dependencies.
- **Auto-classify based on title alone.** Titles are noisy. Classifier reads description + labels + dependencies + (if cited) the file at `file:line`.
- **Push without confirm.** R4 is non-negotiable, even on rung 0. The Session-Close Protocol still holds: stage → commit → push needs the human in the loop.

## §10 — When NOT to invoke

- **CI is red.** Resolve the failure first; `/triage` will commit on top and may obscure the regression.
- **Active multi-agent work in progress.** The MEMORY.md note caps live agents at 2; if /denoise or /design-system is mid-cycle, queue triage for after.
- **Backlog is < 10 open beads.** Triage's value is sorting; below 10 items, just read `bd ready --json` and pick by hand.
- **Working in a worktree that doesn't have a clean `bd sync`.** The classifier reads `.beads/issues.jsonl`; an out-of-sync state will misclassify.

## §11 — First-run bootstrap

On the very first `/triage` invocation:

1. `docs/triage/master.md` exists but the ladder section is empty (initial state below). `docs/triage/recurrence.json` is `{}` shell.
2. Step 1 (classify) always runs because snapshot is empty.
3. Classify dispatches over the full open queue (today: ~150 beads). Output: ladder rows + cycle-history table seeded with `iter-001`.
4. Step 2 picks the lowest non-empty rung — almost certainly rung 0 or 1, since classifier defaults conservative.
5. Cycle proceeds normally.

After the first cycle, `master.md` carries the ladder snapshot forward and only re-classifies on `bd sync` head change.

## §12 — Future graduations

- **`/schedule` integration**: once the recurrence ledger has matured (~10 cycles, 3+ promoted routing rules), `/triage` becomes a candidate for scheduled autonomous runs. Until then, manual-fire only.
- **`--mode=auto`**: skip the rung-2 greenlight prompt and apply diffs without confirm. Will require a stable recurrence ledger and a per-cell confidence threshold. Out of scope for v1.
- **Cross-skill recurrence**: if `/triage` repeatedly routes to `/backend-dev` for the same fingerprint, that's signal `/denoise` should promote a hard rule. Cross-pollination is intentional but manual for now.

## §13 — Cluster-defect agent teams (R1 exception)

When the recurrence ledger or a same-cycle observation surfaces N open beads with:

- The same fingerprint (e.g., `simplification:dup-content-item-shape`, `route:self:proof-test-path-mechanical-fix`)
- An identical or byte-equivalent fix recipe
- Independent target files (no overlapping edits between beads)

…a single cycle MAY resolve all N in parallel via an agent team. This is the only sanctioned way to violate R1.

### Detection signals

The cluster is real when ANY of:

1. `recurrence.json` shows `hits ≥ 2` for a routing pattern AND `bd list --status=open` returns ≥2 more beads matching the same fingerprint.
2. While resolving a single bead, the cycle agent discovers a sibling defect (e.g., un-skipping its proof test reveals an inherited path bug also present in N other proof tests) AND the user authorizes the cluster fix in the same conversation.
3. A new denoise iteration files N beads in one batch with the same fingerprint label (e.g., all four iter-027 F1/F2/F3/F4 tests sharing the same `repoRoot` path bug).

### Eligibility gate

Every clustered bead must independently classify as rung 0 or rung 1 by the standard ladder rules. A cluster spanning multiple rungs is NOT eligible — split into per-rung cycles. Beads at rung 2+ never join a team (R3 holds: human-greenlight gate is per-bead).

### Team spawn protocol

The parent issues a single message containing N parallel `Agent` tool calls (`subagent_type=general-purpose`). Each agent receives:

- The bead ID it owns (single bead — never multi-bead per agent)
- The exact fix recipe (byte-precise diff or transformation)
- The proof test path
- The list of OTHER beads in the same team (so agents can detect-and-skip if their bead changed status mid-flight)
- The fingerprint (for the recurrence ledger entry the parent will write)

### Per-agent contract

Each sub-agent independently:

1. **Pre-flight gate**: `bd show <id> --json`. Abort with `{ok: false, beadId, reason}` if status≠open or owner has changed.
2. **Claim**: `bd update <id> --status=in_progress`. Re-read; abort if claim lost.
3. **Apply**: edit cited file(s) per recipe. Stage only those files.
4. **Proof**: run the proof test; must pass. On fail, abort with full output.
5. **Label**: `bd label add <id> triage` → `triage:rung-N` → `triage:iter-NNN` → `triage:cluster-fix`.
6. **Close**: `bd close <id>` (use `--force` only if blocked by an open epic, the standard /triage workaround).
7. **Return**: `{ok: true, beadId, filesChanged: [...], commitHash?}` or `{ok: false, beadId, reason, partialState?}`.

### Atomic commit shape

TWO valid options — the parent picks based on fix homogeneity:

- **(a) Single team commit**: parent collects all changes from all agents and produces ONE commit `triage(iter-NNN): rung-N team — fixed N beads sharing <fingerprint>` with all bead IDs in the body. Use when fixes are byte-identical (e.g., same path bug across N test files).
- **(b) Per-agent commits**: each agent commits its own files with `triage(iter-NNN): rung-N team[k/N] — Codex-X <one-line>`. Use when each bead's fix is a distinct recipe sharing only a fingerprint family (e.g., N different denoise:simplification beads that all happen to be rung-1).

Default to (a) when in doubt — atomicity is friendlier to revert.

### Recurrence ledger entry (singular)

The ledger records ONE team-cycle entry covering all N beads:

```json
{
  "<fingerprint>": {
    "hits": <existing + 1>,
    "iters": [..., "iter-NNN"],
    "rung_density": { ..., "iter-NNN": N },
    "verdict_history": [
      ...,
      {
        "iter": "iter-NNN",
        "rung": 1,
        "action": "team-resolve",
        "team_size": N,
        "team_beads": ["Codex-X", "Codex-Y", "..."],
        "user_chose": null,
        "user_reasoning": "<why a team was used>"
      }
    ]
  }
}
```

`rung_density[iter-NNN] = N` (not 1) so promotion thresholds reflect the actual scale of the cluster.

### Failure mode

If K of N agents fail, the parent must:

1. Surface the K failed beads with their failure reasons.
2. Ensure the (N-K) succeeded beads are properly closed and committed.
3. Reset the K failed beads' status to `open` (failed agents must NOT leave beads stuck in `in_progress`).
4. Record the K failures in `iter-NNN.md`'s decision log alongside the N-K successes.

A partial team-cycle is still a valid cycle — record it honestly. Don't auto-retry the K failures within the same cycle; surface them as a follow-up question to the user.

### Anti-patterns specific to teams

- **Don't team-fix interdependent sites.** If agent A's fix changes a function that agent B's fix imports, they cannot run in parallel. Sequence them in normal multi-cycle pattern.
- **Don't team-fix design-needed beads.** R3 still holds — multi-bead clusters at rung 3+ require user routing, not parallel agents.
- **Don't grow team size beyond ~5 agents.** Coordination cost scales superlinearly past that, and so does merge-conflict risk on artifact files. Split into multiple cycles if N>5.
- **Don't use teams to skip falsifiability.** Each agent runs its own proof test; the cluster does NOT share a single proof. A byte-identical fix must still pass the proof per file.
- **Don't team across heterogeneous proof shapes.** If bead A's proof is a `pnpm test` invocation and bead B's is a `chrome-devtools__lighthouse_audit`, they're not a cluster — split into separate cycles even if the code fix looks identical.

---

> Generated and maintained alongside the `/triage` skill. The skill is sibling to `/denoise` and shares its three-artifact discipline: `docs/triage/master.md` (status), `docs/triage/recurrence.json` (ledger), `docs/triage/iter-NNN.md` (per-cycle log).
