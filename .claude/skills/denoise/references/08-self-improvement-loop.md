# Reference 08 — Self-Improvement Loop

> Loaded by every `/denoise` cycle. Owns the recurrence-counting protocol, rule-promotion mechanic, master.md schema, and iter-NNN.md report template.

---

## §1 — Iteration template (`docs/denoise/iter-NNN.md`)

Every cycle produces one report at `docs/denoise/iter-NNN.md`. Use this template:

```markdown
# Iteration NNN — <phase> × <scope>

- **Cell**: <phase> × <scope>
- **Date**: YYYY-MM-DD
- **Mode**: delta | full
- **Since**: <git ref or timestamp>
- **Files churned**: N (`git log --since=...` produced)
- **Agent**: agents/audit-<scope>.md
- **Fallow JSON**: `/tmp/denoise-iter-NNN-fallow.json`
- **Typecheck baseline**: `/tmp/denoise-iter-NNN-typecheck-baseline.log`

## Findings

### F1 — <fingerprint>

- **Severity**: blocker | major | minor
- **File:Line**: `path/to/file.ts:123`
- **Description**: One-line summary
- **Proof test form**: <Catalogue row name>
- **Proof**: the assertion that would fail today, its `file:line`, and the command that shows it (NO test file — the staging directory is retired; the executable test lands with the fix, in `__tests__/regression/`)
- **MCP evidence**: <path or "n/a for static finding">
- **Bead**: Codex-XXXX (filed at step 7)

### F2 — ...

(Cap report at 600 lines. Splits indicate cell scope was too broad.)

## Summary

| Metric | Value |
|---|---|
| Total findings | N |
| Blocker | N |
| Major | N |
| Minor | N |
| Testability-bugs | N |
| Testability-bug rate | N% (R8 fires above 15%) |
| Beads filed | N |
| Recurrence promotions queued | N |

## Skill patches applied

- (none) | List of edits to SKILL.md, references/, or agents/ this cycle made (rule promotions, fabrication-check fixes, anti-pattern row additions)

## Next-cycle prep

- (none) | Items the next cycle should pick up (e.g., "promote `security:unsanitised-svg` to R9", "investigate consumer-graph effect on packages/<pkg>")
```

---

## §2 — Recurrence-counter protocol

`docs/denoise/recurrence.json` is the durable ledger. Schema:

```json
{
  "schema_version": 1,
  "last_updated": "2026-04-25T...",
  "patterns": {
    "<phase>:<anti-pattern-id>": {
      "hits": 4,
      "iters": ["iter-008", "iter-013", "iter-019", "iter-024"],
      "first_seen": "2026-04-02",
      "last_seen": "2026-04-22",
      "promoted": false,
      "rule_id": null
    }
  }
}
```

### Step-by-step (run at cycle step 7)

1. Read `docs/denoise/recurrence.json`
2. For each finding in this iteration's report:
   - Parse `fingerprint` field (e.g., `security:unsanitised-svg`)
   - If absent from `patterns`, add it with `hits: 1`, `iters: [<iter_id>]`, `first_seen: <date>`, `last_seen: <date>`, `promoted: false`, `rule_id: null`
   - If present, append `<iter_id>` to `iters`, increment `hits`, update `last_seen`
3. Update top-level `last_updated`
4. Write back the file
5. **Promotion check**: for each pattern, count `iters` that fall within the trailing 6 cycles (find the 6 most recent iter folders by mtime; pattern qualifies if 3 or more of those 6 contain it). If qualifies AND `promoted === false`, mark `promoted: true` and emit a "promotion queued" entry in the iter report's "Next-cycle prep" section.
6. **Single-hit security exception**: if `severity === 'blocker'` AND fingerprint starts with `security:`, immediately mark `promoted: true` regardless of hit count.

### Promotion mechanic (next cycle's prep)

The next cycle's first action is to apply queued promotions:

1. Open `.claude/skills/denoise/SKILL.md`
2. Find §1 Hard Rules table
3. Append a new row: `| **R<N>** | <description from anti-pattern row> | <severity> |` where N is the next available rule number (R9, R10, ...)
4. Above the table, add a citation comment: `<!-- R<N> promoted from iter-NNN, fingerprint <fingerprint> -->`
5. Update `recurrence.json` entry: set `rule_id: "R<N>"`, leave `promoted: true`
6. Note the promotion in the new cycle's iter-NNN.md "Skill patches applied" section

---

## §3 — Master.md schema (auto-managed)

`docs/denoise/master.md` is the status board. The cycle's step 7 updates three tables:

### Table A — 12-cell status board

| Cell | Last run | Open findings | Open testability-bugs | Last checked | Next due |

- `Last run`: most recent iter where this cell was audited (e.g., `iter-024 (2026-04-18)`)
- `Open findings`: count of beads with this cell's labels still open (`bd list --label=denoise:<scope> --label=denoise:<phase> --status=open --type=bug | wc -l`)
- `Open testability-bugs`: same as above but additionally filtered by `denoise:testability-bug`
- `Last checked`: most recent date the churn check ran (even if cell was skipped)
- `Next due`: `due (churn detected)` | `skipped (no churn)` | `manual` | `due (force)`

### Table B — Recurrence ledger

Auto-synced from `recurrence.json`. Render every pattern with `hits >= 1`. Promoted patterns show `**PROMOTED → R<N>**` in the Status column.

### Table C — Testability-bug rate (R8 watch)

Append-only per cycle:

| Iter | Total findings | Testability-bugs | Rate | R8 fired? |

R8 fires when rate > 15%. When it fires, the cycle's iter-NNN.md report MUST contain a meta-warning AND the next cycle's prep MUST include a "justify each testability-bug" audit.

---

## §4 — Stop criterion (cell-level fidelity signal)

When the same cell produces three consecutive cycles with:
- Zero new findings (all listed are recurrence increments OR documented FPs from `/fallow-audit`)
- Zero recurrence increments (every fingerprint is already at hit count > 0 from prior cycles)

The cell has reached **fidelity** — the references describe the code accurately. Master.md flags it. Subsequent cycles for that cell drop to longer cadence (monthly full-mode only) until churn triggers a re-audit.

This mirrors `/backend-dev` §7's stop criterion. It's how the loop knows to stop expanding rather than infinitely accumulating.

---

## §5 — Fabrication check (cycle 0 of every cell)

`/design-system` iter-05 discovered a fabrication: a reference cited an `axeCheck` API that didn't exist. The same risk applies here — references' anti-pattern tables cite specific symbols, file paths, helper names. If those drift, the references become misleading.

**Cycle 0 protocol** (first time a cell is audited, OR every 6 cycles for a cell):

1. For each anti-pattern row in the loaded references:
   - Grep the codebase for the cited symbol (e.g., `sanitizeSvgContent`, `scopedNotDeleted`, `workerAuth.sign`)
   - If grep returns 0 hits, the reference is stale — file `denoise:doc-rot:<reference>:<row>` as a finding
   - The fix is to update the reference, not the code

2. Document the fabrication-check pass in the iter-NNN.md report's preamble:
   ```
   ## Fabrication check
   - 12 anti-pattern rows cited
   - 12 verified live in codebase
   - 0 stale (or: N stale, see findings F<x>)
   ```

3. Stale references are treated as `denoise:doc-rot` findings — they get the same Catalogue walk and proof-test gate as code findings. The proof test for doc-rot is typically a grep assertion: "this symbol exists at this path", which fails when the reference's claim is false.

---

## §6 — Iter-NNN numbering

To prevent collisions when multiple operators run cycles on different branches:

```bash
ITER_NUM=$(ls docs/denoise/iter-*.md 2>/dev/null | wc -l)
ITER_ID="iter-$(printf '%03d' $((ITER_NUM + 1)))"
```

Reserve the number by creating an empty placeholder commit:

```bash
touch docs/denoise/${ITER_ID}.md
git add docs/denoise/${ITER_ID}.md
git commit -m "denoise: reserve ${ITER_ID}"
```

This way, two operators starting cycles in parallel won't both produce `iter-027.md`. The first to commit wins; the second's reservation will fail and they pick `iter-028`.

(For Phase A, this is over-engineering — the user is the only operator. The reservation logic graduates to importance once `/schedule` fires nightly and there's risk of overlap.)

---

## §7 — Skill-level patches recorded here

When the cycle modifies the skill itself (rule promotion, fabrication fix, anti-pattern row addition), the change is logged in two places:

1. The iter-NNN.md report's "Skill patches applied" section (transient, per-cycle)
2. A `<!-- patched from iter-NNN -->` comment next to the change in the source file (durable, in the file)

The dual-record protects against losing context: future maintainers reading SKILL.md or a reference can trace any unfamiliar rule back to the iteration that introduced it.

---

## §8 — Cross-links

- `SKILL.md` §7 — high-level workflow that depends on this protocol
- `/design-system` SKILL.md §7 — recurrence-loop precedent this skill mirrors
- `/backend-dev` §7 — stop-criterion precedent
- `docs/denoise/recurrence.json` — durable pattern ledger
- `docs/denoise/master.md` — status board this protocol updates
