---
name: codex-review
description: >
  Multi-agent conformance review for the Codex monorepo. Reads reviewer-roster.yaml and spawns a small
  swarm of Codex-specific reviewers (scoping-security, backend-conformance, commerce-stripe,
  migration-safety) plus silent-failure-hunter against a change-set, collates findings with a
  corroboration multiplier, and writes bd-audit entries. Invoked at the REVIEW stage of
  codex-epic-implement, or standalone against the working tree, a PR, or the full codebase. Emits
  findings only — never edits code (the implement cycle owns repair).
allowed-tools: Read, Grep, Glob, Bash, Agent, Skill, ToolSearch
---

# Codex Review — Conformance Swarm

The REVIEW stage of the `codex-*` epic family. A deliberately small swarm of reviewers that read a
diff and report Codex-specific conformance defects. Source of truth for *who reviews* is
`references/reviewer-roster.yaml`; this file is *how the swarm runs*.

See `docs/epics/conventions.md` for the family-wide bd-audit schema and bd 1.0.4 CLI notes.

---

## §0 — When to invoke vs defer

```
Use codex-review when:
  - codex-epic-implement reaches its REVIEW stage (stage 6) — invoked WITH a <wp-id> for audit
  - You want a conformance pass on the working tree   →  /codex-review
  - You want to review a PR                            →  /codex-review <PR#>
  - Periodic / pre-release full sweep                  →  /codex-review --full   (replaces codebase-audit)
  - Explicit file set                                  →  /codex-review --files <glob> [<glob>...]

Defer to (these are NOT this swarm — they are cycle STAGES or separate skills):
  - SIMPLIFY / FALLOW / VISUAL-VERIFY   — stages of codex-epic-implement, run before this
  - codex-epic-retro                    — post-merge hardening, reads the audit trail this writes
```

This skill **emits findings only**. It NEVER edits code — `codex-epic-implement` owns the repair loop.

---

## §1 — Hard Rules

| # | Rule | Why |
|---|---|---|
| R1 | The roster in `references/reviewer-roster.yaml` is the ONLY source of which reviewers exist. Never hardcode a reviewer list here. | The roster evolves via retro/crystalize; this file must not drift from it. |
| R2 | Spawn the matching reviewers IN PARALLEL — one message, multiple `Agent` calls. | Reviewers are independent; sequential spawning wastes wall-clock. |
| R3 | `silent-failure-hunter` CRITICAL findings are must-fix. Return to IMPLEMENT; do NOT litigate. | 100% real-bug rate (nmemo-confirmed). Treat as ground truth. |
| R4 | Corroboration multiplies severity: 2 reviewers same file+line → +1 tier; 3 → critical. | Independent agreement is the strongest signal. |
| R5 | Write `swarm-start` BEFORE spawning and `swarm-end` AFTER collation when invoked with a `<wp-id>`. | A stage that left no audit entry is a drift signal the retro flags. |
| R6 | A reviewer with no matching changed files is NOT spawned (per its `spawn.when_changed` globs). | Keeps a 5-reviewer roster cheap — a schema-only PR fires ~2, not 5. |
| R7 | Err toward inclusion on overlapping globs. Collation dedupes; double-spawning never double-counts. | Missing a reviewer is worse than a redundant one. |

---

## §2 — The roster & spawn logic

1. Read `references/reviewer-roster.yaml`.
2. Compute the change-set (see §3 step 1).
3. For each `agents[]` entry, decide spawn:
   - `spawn: always` → always spawn.
   - `spawn: { when_changed: [globs] }` → spawn iff any changed file matches any glob.
4. For each spawned reviewer:
   - **generic** (`subagent_type: pr-review-toolkit:*`, `spec: null`) → spawn that subagent directly with the change-set + the standard findings-format instruction (§5).
   - **bespoke** (`spec: agents/<id>.md`) → spawn `general-purpose` with the brief file's contents as the prompt body, plus the change-set and findings-format instruction.

The current roster (v2) — but ALWAYS re-read the file, do not trust this copy:

| id | type | spawn |
|---|---|---|
| `silent-failure-hunter` | generic (`pr-review-toolkit:silent-failure-hunter`) | always |
| `scoping-security` | bespoke (`agents/scoping-security.md`) | backend/db/security diffs |
| `backend-conformance` | bespoke (`agents/backend-conformance.md`) | routes/services/worker-utils diffs |
| `commerce-stripe` | bespoke (`agents/commerce-stripe.md`) | payment-path diffs |
| `migration-safety` | bespoke (`agents/migration-safety.md`) | schema/`*.sql`/drizzle diffs |

---

## §3 — Workflow

### Step 0 — Audit start (only if invoked with `<wp-id>` from codex-epic-implement)
```bash
bd audit record --kind=tool_call --issue-id=<wp> --tool-name=codex-review \
  --prompt="swarm-start: <N> agents, scope=<file-count> files"
```
Standalone invocations skip audit but still print the tally header.

### Step 1 — Scope
```bash
.claude/skills/codex-review/scripts/scope-changeset.sh            # working tree (default)
.claude/skills/codex-review/scripts/scope-changeset.sh --pr <PR#> # gh pr diff
.claude/skills/codex-review/scripts/scope-changeset.sh --full     # whole repo (sweep)
.claude/skills/codex-review/scripts/scope-changeset.sh --files <glob>...
```
Emits one repo-relative path per line, filtered to reviewable types (`.ts`, `.svelte`, `.css`, `.sql`,
`.json` config, `messages/*.js`), excluding `dist/`/`build/` (per `feedback_audit_grep_dist_contamination`).

### Step 2 — Bypass pre-check
```bash
.claude/skills/codex-review/scripts/detect-bypass.sh   # last 20 commits, or --range main..HEAD
```
Flags `--no-verify`, signed→unsigned regressions, unexpected merges. Empty output == clean. Any finding
is reported as a HIGH in the report's preamble.

### Step 3 — Spawn the swarm (parallel)
Per §2. Each reviewer prompt MUST include:
- the change-set file list,
- "Read each file fully; restrict greps to `src/`, exclude `dist/`",
- the structured-findings format (§5),
- "You emit findings only. Do not edit code."

### Step 4 — Collate
- Normalise each finding to `{ reviewer, severity, file, line, rule_ref, what, why, evidence, fix }`.
- Dedupe on `file:line` — if ≥2 reviewers flag the same line, MERGE into one finding listing all
  reviewers, then apply R4 (2 → +1 tier, 3 → critical).
- Apply R3: any `silent-failure-hunter` CRITICAL is locked must-fix.
- Sort: critical > high > medium > low > nit; group by file then line.

### Step 5 — Report
Emit the §5 markdown. If invoked from a WP, also leave the report inline for the implement cycle to act on.

### Step 6 — Audit end (only if `<wp-id>`)
```bash
bd audit record --kind=tool_call --issue-id=<wp> --tool-name=codex-review \
  --prompt="swarm-end: <C>C/<H>H/<M>M/<L>L/<n>nit; <one-line action summary>"
```

### Step 7 — Memory hygiene
If a finding is a genuinely new defect *type* not previously seen, after the cycle:
```bash
bd memories review                      # check it isn't already recorded
bd remember --key "review/<slug>" "<the new pattern + how to catch it>. Added <date> (<PR>)."
```

---

## §4 — Severity guide

| Severity | Meaning | Examples |
|---|---|---|
| **critical** | Data exposure, money loss, data corruption, prod-breaking | Unscoped query; non-idempotent transfer; FK migration that breaks cleanup; swallowed error hiding a failed write |
| **high** | Security/correctness risk, architectural violation | Missing auth policy; ad-hoc `createDbClient` in a route; hand-written migration SQL |
| **medium** | Convention violation, latent issue | Missing `PaginatedResult`; non-GBP literal; N+1 in a cold path |
| **low** | Minor / style | Inconsistent error message shape |
| **nit** | Optional polish | Naming |

Repair policy (enforced by `codex-epic-implement`, surfaced here): critical/high MUST be fixed before
SHIP; medium fixed unless explicitly `wontfix`-with-reason; low/nit when cheap.

---

## §5 — Report format & findings schema

Each reviewer returns a JSON array of findings:
```json
[{
  "reviewer": "scoping-security",
  "severity": "critical",
  "file": "packages/content/src/services/content-service.ts",
  "line": 45,
  "rule_ref": "SCOPE-001",
  "what": "findFirst filters by id only — no creator scope.",
  "why": "Cross-tenant data exposure: any creator can read another's content by id.",
  "evidence": "where: eq(content.id, id)",
  "fix": "and(eq(content.id, id), scopedNotDeleted(content, creatorId))"
}]
```

Collated report (markdown):
```
# codex-review — <scope> (<N> files)
Reviewers: <id:findings count, …> | bypass-check: clean|<flags>

## 🔴 CRITICAL (<n>)
### <file>:<line> — <what>   [reviewers: scoping-security, silent-failure-hunter]  rule SCOPE-001
WHY: <why>
EVIDENCE: `<evidence>`
FIX: `<fix>`

## 🟠 HIGH (<n>)
…
## 🟡 MEDIUM … 🟢 LOW … ⚪ NIT …
```

---

## §6 — Anti-patterns

- ❌ Hardcoding the reviewer list in this file instead of reading the roster.
- ❌ Spawning reviewers sequentially.
- ❌ Editing code from this skill (it emits findings; the cycle repairs).
- ❌ Arguing with a `silent-failure-hunter` CRITICAL.
- ❌ Spawning every reviewer regardless of the diff (ignore `when_changed`).
- ❌ Greps that include `dist/`/`build/` (ghost API pointers from stale `.d.ts`).

---

## §7 — Examples / triggers

- `/codex-review` — conformance pass on the working tree.
- `/codex-review 270` — review PR #270.
- `/codex-review --full` — pre-release sweep (the `codebase-audit` replacement).
- Called by `codex-epic-implement` stage 6 with the WP id, which threads audit entries.

---

## Related
- `references/reviewer-roster.yaml` — who reviews (source of truth).
- `references/roster-rationale.md` — why these 5, what each absorbs.
- `agents/*.md` — the bespoke reviewer briefs.
- `docs/epics/conventions.md` — bd-audit schema, gate, promotion ladder.
