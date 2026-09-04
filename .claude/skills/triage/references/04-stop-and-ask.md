# 04 — Stop and Ask

This skill is the family's only sibling that calls `AskUserQuestion` mid-cycle. The other skills (denoise, design-system, backend-dev, caching) embed deterministic decision frameworks; only `/fallow-audit`'s "await greenlight" is precedent for explicit pauses.

This file documents the question payload templates and the routing of user answers back into the cycle. The cycle agent **never** calls `AskUserQuestion` directly — it returns a payload, and the parent renders it. (R9.)

## Why the parent renders, not the sub-agent

Sub-agents have no UI surface. Their output is the structured summary they return to the parent — anything in the agent's "voice" is invisible to the user. If the cycle agent calls `AskUserQuestion`, the call silently fails and the cycle hangs. This is a hard constraint of the harness, not a stylistic choice.

The fix: the cycle agent returns `{needsUser: true, ...}` with the question payload baked in as data. The parent reads the payload, calls `AskUserQuestion`, then either acts on the answer directly or re-dispatches a follow-up cycle agent with the answer in its substitution block.

## Payload shape

The cycle agent returns:

```json
{
  "needsUser": true,
  "rung": 2 | 3 | 4,
  "beadId": "Codex-X",
  "beadSummary": "...",
  "question": "...",
  "header": "...",
  "options": [
    { "label": "...", "description": "...", "next": "<route-id>" },
    { "label": "...", "description": "...", "next": "<route-id>" }
  ],
  "context": {
    "filesAffected": ["..."],
    "diff": "...",
    "denoiseLabels": "...",
    "recurrenceMatches": ["..."]
  }
}
```

`question`, `header`, and `options[].label/description` map directly to the `AskUserQuestion` tool's params. `next` on each option is a route-id the parent uses to decide what to do with the answer.

## Templates

### Rung 2 — Greenlight a candidate diff

```json
{
  "needsUser": true,
  "rung": 2,
  "beadId": "Codex-X",
  "beadSummary": "Tighten validation on POST /content body — accept array of items, reject empty.",
  "question": "Apply this candidate diff?",
  "header": "Rung-2 diff",
  "options": [
    { "label": "Apply", "description": "Re-dispatch cycle agent in --apply mode to commit the diff.", "next": "apply" },
    { "label": "Skip", "description": "Mark bead as triage:rung-2,triage:needs-greenlight and move on.", "next": "skip" },
    { "label": "Reroute", "description": "Bump to rung 3 — diff isn't right, needs a different approach.", "next": "reroute" }
  ],
  "context": {
    "filesAffected": ["packages/validation/src/content.ts"],
    "diff": "<truncated diff body>",
    "denoiseLabels": "denoise:types:type-duplicate-cross-package",
    "recurrenceMatches": []
  }
}
```

Parent action: render via `AskUserQuestion`. On `apply` → re-dispatch cycle agent with `--apply --bead=Codex-X`. On `skip` → update bead labels, write to `master.md`, end. On `reroute` → re-dispatch cycle agent with `--rung=3 --bead=Codex-X`.

### Rung 3 — Multi-file approach choice

```json
{
  "needsUser": true,
  "rung": 3,
  "beadId": "Codex-Y",
  "beadSummary": "Move signed-URL generation from worker route to @codex/access service. 4 files, 2 packages.",
  "question": "How should we approach this refactor?",
  "header": "Rung-3 routing",
  "options": [
    { "label": "One PR (Recommended)", "description": "Cycle agent re-dispatches with explicit file list. Single commit.", "next": "one-pr" },
    { "label": "Split into N sub-beads", "description": "File 4 child beads via parallel bd create calls; this bead becomes the parent.", "next": "split" },
    { "label": "Spawn /backend-dev", "description": "Hand off — /backend-dev's service-layer guidance fits.", "next": "spawn-backend-dev" },
    { "label": "Defer", "description": "Mark triage:routing:defer and move on.", "next": "defer" }
  ],
  "context": {
    "filesAffected": ["workers/content-api/src/routes/stream.ts", "packages/access/src/services/access.ts", "packages/cloudflare-clients/src/r2.ts", "apps/web/src/lib/server/api.ts"],
    "denoiseLabels": "denoise:simplification:layer-leak",
    "recurrenceMatches": ["route:backend-dev:layer-leak (hits=2)"]
  }
}
```

Parent action: render via `AskUserQuestion`. On `one-pr` → re-dispatch cycle agent with `--mode=apply-multi --files=...`. On `split` → spawn parallel `bd create` Agent calls for each child. On `spawn-backend-dev` → end this cycle, instruct user to invoke `/backend-dev` next. On `defer` → label and end.

### Rung 4 — Design decision

```json
{
  "needsUser": true,
  "rung": 4,
  "beadId": "Codex-Z",
  "beadSummary": "Add 'enterprise' tier to MembershipRole enum. Touches schema, API, UI.",
  "question": "This is a design decision. What's the path?",
  "header": "Rung-4 design",
  "options": [
    { "label": "Spawn /backend-dev", "description": "Schema-first design — the data shape drives everything else.", "next": "spawn-backend-dev" },
    { "label": "Spawn /design-system", "description": "UX-first design — the role surface in the UI drives the schema.", "next": "spawn-design-system" },
    { "label": "Split into 3 beads", "description": "Schema bead, API bead, UI bead — sequential dependencies.", "next": "split-3" },
    { "label": "Defer", "description": "Not the right time. Label triage:routing:defer and move on.", "next": "defer" }
  ],
  "context": {
    "filesAffected": ["packages/database/schema/membership.ts", "..."],
    "denoiseLabels": "",
    "recurrenceMatches": []
  }
}
```

Parent action: same as rung 3 routing.

### Pre-commit confirm (rung 0–1)

```json
{
  "needsUser": true,
  "rung": 1,
  "beadId": "Codex-W",
  "beadSummary": "Remove `as unknown as` cast in workers/auth/src/index.ts:135 — Zod parser already at boundary.",
  "question": "Commit this fix?",
  "header": "Rung-1 commit",
  "options": [
    { "label": "Commit", "description": "git add + commit + close bead. Does NOT push.", "next": "commit" },
    { "label": "Hold", "description": "Leave fix in working tree. Commit later.", "next": "hold" },
    { "label": "Revert", "description": "Discard the fix. Bead stays open.", "next": "revert" }
  ],
  "context": {
    "filesAffected": ["workers/auth/src/index.ts"],
    "diff": "<truncated diff>",
    "denoiseLabels": "denoise:types:as-unknown-as",
    "recurrenceMatches": ["route:self:denoise-types-as-unknown-as (hits=2)"]
  }
}
```

Parent action: on `commit` → run the commit, attach `triage:rung-1,triage:iter-NNN` labels via `bd update`, then `bd close`. On `hold` → label and end without committing. On `revert` → `git checkout -- <files>` after explicit second confirm (R4 + revert is destructive).

### Ambiguous classification

```json
{
  "needsUser": true,
  "rung": 2,
  "beadId": "Codex-V",
  "beadSummary": "Confidence between rung 1 and rung 2 — fix is mechanical but touches a service method.",
  "question": "Which rung should we treat this as?",
  "header": "Classifier ambiguity",
  "options": [
    { "label": "Rung 1 (auto-resolve)", "description": "Confidence in mechanical fit; let resolver agent attempt with proof gate.", "next": "rung-1" },
    { "label": "Rung 2 (review diff)", "description": "Surface candidate diff first, then commit.", "next": "rung-2" },
    { "label": "Skip", "description": "Mark uncertain, move on.", "next": "skip" }
  ],
  "context": {
    "filesAffected": ["..."],
    "denoiseLabels": "...",
    "recurrenceMatches": []
  }
}
```

### Epic with no eligible children

```json
{
  "needsUser": true,
  "rung": 4,
  "beadId": "Codex-EPIC",
  "beadSummary": "Epic 'Subscription multi-tier' has 7 children, all blocked.",
  "question": "How to proceed?",
  "header": "Epic stuck",
  "options": [
    { "label": "Pick a blocked child", "description": "Override R5 — work on a blocked bead anyway. Triage will surface dependencies.", "next": "pick-blocked" },
    { "label": "Split into more children", "description": "File spinout beads to break the dependency chain.", "next": "split" },
    { "label": "Defer epic", "description": "Mark triage:routing:defer on the epic and skip in future cycles.", "next": "defer" }
  ],
  "context": {
    "filesAffected": [],
    "blockedChildren": ["Codex-A", "Codex-B", "..."],
    "denoiseLabels": "",
    "recurrenceMatches": []
  }
}
```

## Routing the user's answer back

Each option's `next` field maps to a parent action. The mapping is documented in `SKILL.md` §4 "Parent action on summary" — but the cycle agent doesn't need to know what `next` means. It just sets the right value, and the parent's logic table dispatches.

This separation is intentional: the cycle agent owns *what to ask*, the parent owns *what to do with the answer*.

## Ordering and recommendation

Per `AskUserQuestion` tool docs:
- 2–4 options per question.
- Recommended option goes first with "(Recommended)" appended to the label.
- Be explicit about consequences in the description.

## When to suppress an option

Don't include an option if it's irrelevant to the bead. Example:
- Rung 2 with no `denoise:*` label → no `denoise` route option.
- Rung 4 epic → no `apply` option (epics don't apply).
- Rung 1 fix where typecheck already passes → no `revert` option (nothing to revert except the fix itself, which is the `revert` semantics anyway — keep but rename description).

## Anti-patterns

- Embedding the diff inline in `question`. Diffs go in `context.diff`, not the question text — keeps the question scannable.
- Using emoji or markdown in `label` strings. Plain text only — `AskUserQuestion` renders chips.
- More than 4 options. The tool caps at 4. If you need 5, the bead is misclassified or the question is misframed.
- Free-text fields. Always use options. The user can pick "Other" for free-text in the UI; the cycle agent shouldn't anticipate it.
- Asking "is this okay?" — that's never a useful question. Ask what to *do*, not whether to *proceed*.
