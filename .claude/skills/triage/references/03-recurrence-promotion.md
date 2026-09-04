# 03 — Recurrence Promotion

The recurrence ledger (`docs/triage/recurrence.json`) tracks how often each routing decision recurs. When a pattern hits a threshold, the cycle agent promotes it to a hard rule in [`02-routing-rules.md`](02-routing-rules.md). This is how the skill learns over time.

This file documents the mechanics. It is read by the cycle agent in step 7 of every cycle (after a finding closes).

## Pattern fingerprint format

```
route:<target>:<signal>
```

Where:
- **target** is one of `self` (auto-resolve in /triage), `denoise`, `backend-dev`, `design-system`, `fallow-audit`, `defer`.
- **signal** is a kebab-case identifier for what triggered the routing decision: a denoise fingerprint, a label namespace, a path pattern, an issue-type quirk.

**Examples**:
- `route:self:denoise-types-as-unknown-as`
- `route:design-system:ds-review-blocker`
- `route:backend-dev:auth-touch`
- `route:defer:no-locator-and-thin-body`
- `route:self:denoise-simplification-duplicate-utility-helper`

## Ledger entry shape

```json
{
  "<fingerprint>": {
    "hits": 3,
    "iters": ["iter-001", "iter-002", "iter-003"],
    "rung_density": { "iter-001": 1, "iter-002": 1, "iter-003": 1 },
    "first_seen": "YYYY-MM-DD",
    "last_seen": "YYYY-MM-DD",
    "promoted": true,
    "rule_id": "RT3 (applied iter-004)",
    "beads": ["Codex-X", "Codex-Y", "Codex-Z"],
    "verdict_history": [
      {"iter": "iter-001", "rung": 4, "action": "escalate", "user_chose": "spawn /backend-dev"},
      {"iter": "iter-002", "rung": 4, "action": "escalate", "user_chose": "spawn /backend-dev"},
      {"iter": "iter-003", "rung": 4, "action": "escalate", "user_chose": "spawn /backend-dev"}
    ]
  }
}
```

`rung_density` counts how many beads in that iter matched the fingerprint (a single bead = density 1; 5 beads sharing the fingerprint in one cycle = density 5). High density signals a sweep candidate that triage shouldn't try to chew through one at a time.

`verdict_history` is the load-bearing field for promotion. A pattern only promotes if the *user* consistently chose the same routing — a divergent history (sometimes "spawn /backend-dev", sometimes "split", sometimes "defer") means there isn't actually a stable rule to learn.

## Promotion gate

A pattern is **eligible for promotion** when ALL of:

1. `hits >= 3` within a trailing 6-cycle window.
2. `verdict_history` is consistent — the same `action + user_chose` (or `action + auto-resolve` for rung 0–1) for at least the last 3 hits.
3. The pattern is NOT already promoted (`promoted: false`).
4. The cycle that's about to promote has visibility into all 3 hits (i.e., the third hit is the *current* cycle).

A pattern that's eligible promotes in the **next** cycle's prep step (mirrors `/denoise`'s "queued for iter-NNN+1 prep" pattern). This gives the cycle agent a chance to surface the proposed rule to the user before codifying.

### Security exception (first-sighting promotion)

Mirrors `/denoise`'s security exception. A pattern with `target=design-system` OR `target=backend-dev` AND signal mentions a high-impact path (`packages/security/`, `*-secrets*`, schema, auth) may promote on **first sighting** if:

- The user explicitly chose to route (not "defer", not "split").
- The fingerprint is not already covered by an existing rule.

This is the only fast-path promotion. All other patterns require 3 hits.

## Promotion procedure

When the cycle agent's step 7 detects an eligible promotion:

1. **Surface to user** via `AskUserQuestion`:
   ```
   Q: Promote routing pattern <fingerprint> to RT<N>?
      It has hit <hits> times across <iters>. Last 3 verdicts: <action + chose>.
      Options:
       a) Promote (Recommended) — codifies the rule in 02-routing-rules.md
       b) Watch — keep tracking, don't promote yet
       c) Reject — mark as `promoted: false, rejected: true` so it never promotes
   ```
2. **On `promote`**: append the rule to `02-routing-rules.md`, update `recurrence.json` with `promoted: true, rule_id: "RT<N> (applied iter-NNN)"`, and write a `### Skill patches applied` note in the cycle's `iter-NNN.md`.
3. **On `watch`**: leave `promoted: false`, but bump a `watch_count` field. After 3 watches with no promotion, surface again with stronger phrasing.
4. **On `reject`**: set `promoted: false, rejected: true, rejected_reason: <free text>`. The classifier will still match the fingerprint but will NOT use the rule — it falls through to ladder signals.

## Pattern aging

A pattern is **stale** if `last_seen` is more than 12 cycles ago AND `promoted: false`. Stale patterns are flagged in `master.md` for review and can be archived (moved to a `recurrence-archive.json` to keep the live ledger small).

A **promoted rule** that hasn't fired in 12 cycles is flagged for review in [`02-routing-rules.md`](02-routing-rules.md) (rule aging — see that file's "How rules age out" section).

## Counter-example handling

If a promoted rule fires but the user explicitly *rejects* its verdict (chooses a different action), record a `counter_example` entry:

```json
"counter_examples": [
  {
    "iter": "iter-007",
    "bead": "Codex-X",
    "rule_said": "rung 4, escalate to /backend-dev",
    "user_chose": "rung 1, auto-resolve",
    "note": "<free text>"
  }
]
```

3+ counter-examples for a single rule trigger a **rule review** prompt. The user can choose to:
- Add an exception to the rule.
- Demote the rule (move to `02-routing-rules.md` archive section).
- Keep as-is (counter-examples are noise, rule still right on average).

## Cycle-by-cycle update flow

In step 7 of each cycle:

1. Open `recurrence.json`. Locate or create the entry for the bead's fingerprint.
2. Increment `hits`, append current `iter` to `iters[]`, set `last_seen`.
3. If the bead resolved (rung 0–1), append to `verdict_history` with `action: "auto-resolve"`.
4. If the bead routed (rung 2–4), append to `verdict_history` with the user's chosen action.
5. Update `rung_density[current_iter]` (how many beads matched this fingerprint in this cycle — usually 1, but classify-step can detect higher densities).
6. Check promotion gate. If eligible, queue promotion for next cycle's prep.
7. Set `last_updated` at the top of the JSON.
8. Write back.

## Schema versioning

If the ledger schema changes (new fields, format breaks), bump `schema_version` and write a migration in `docs/triage/migrations/v<N>.md`. The cycle agent refuses to write to a ledger whose `schema_version` it doesn't recognise — return `{ok: false, reason: "ledger-schema-mismatch", expected: N, found: M}` and let the user run the migration.
