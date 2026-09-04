# Triage — iter-001

> First run. Forced single-bead cycle via `--bead=Codex-ttavz.12`. No full-queue classify performed.

## Bead summary

- **ID**: Codex-ttavz.12
- **Title**: fix(web): auth.remote.ts:146 posts to /api/auth/forgot-password (typo) — silent password-reset failure
- **Priority**: P0 (BLOCKER, feature-availability)
- **Type**: bug
- **Owner**: brucemckayone@gmail.com
- **Status**: open
- **Parent**: Codex-ttavz (epic — Denoise security audits)
- **Cited file**: `apps/web/src/lib/remote/auth.remote.ts:146`
- **Entanglement**: Codex-ttavz.15 (F4 — orphan exports of forgotPasswordForm; zero consumers today)
- **Existing labels**: `denoise`, `denoise:apps-web`, `denoise:iter-003`, `denoise:new-fingerprint`, `denoise:security`, `denoise:test-shape-api-map`, `denoise:web-auth-remote-broken-endpoint`

The remote function POSTs to `/api/auth/forgot-password` (English spelling); BetterAuth's actual endpoint is `/api/auth/forget-password` (no `o`). Page-action route at `routes/(auth)/forgot-password/+page.server.ts:29` already uses the correct path. The remote function 404s silently because the form short-circuits to the anti-enumeration `{ success: true }` response — no email is ever sent through this codepath. Blast radius is contained today only because Codex-ttavz.15 means zero consumers exist; the moment anyone wires `forgotPasswordForm` up, password reset breaks platform-wide.

## Classification reasoning

Walked the classifier ordering in `references/01-complexity-ladder.md`:

| # | Rule | Result |
|---|------|--------|
| 1 | Promoted routing rule (references/02) | Skip — ledger empty on first run |
| 2 | R7 epic check | Skip — bead is `bug`, not `epic` |
| 3 | R8 file:line check | Pass — cites `auth.remote.ts:146` |
| 4 | High-impact path auto-rung-4 | Skip — `apps/web/src/lib/remote/` is NOT in the high-impact list (not `packages/security/`, not `apps/web/src/hooks*`) |
| 5 | Denoise fingerprint default rung | Skip — `denoise:web-auth-remote-broken-endpoint` is a NEW fingerprint (`denoise:new-fingerprint` label confirms); no entry in the table |
| 6 | Single-line, single-file, no ambiguity → rung 0 | **Fail on ambiguity**: bead description explicitly offers two valid approaches ("delete the orphan exports (preferred, page actions are canonical) OR wiring the components to use the remote functions and fix the typo"). Cannot land at rung 0 |
| 7 | 1–2 paths, fits known proof shape → rung 1 | **Fail**: the ambiguity in #6 also disqualifies rung 1 — the proof shape (string-equality on the URL constant) is well-defined for fix-typo, but is wrong if the fix is delete-orphan-exports. Resolver can't pick |
| 8 | 1–3 paths same package, requires judgement → rung 2 | **Match (initial)** — single package (`apps/web`), clear judgement call between two named approaches |

**Initial verdict: rung 2.**

Then waypoint #6 in `SKILL.md` §5 (high-impact rung-2 escalation):

> If a rung 2 bead touches `packages/security/`, `packages/database/schema/`, any `*-secrets*` file, or matches a `human-required` recurrence pattern → escalate to rung 3-style ask.

This bead doesn't touch `packages/security/` directly but carries `denoise:security` label, is P0 BLOCKER, and is structurally entangled with Codex-ttavz.15 (F4). The waypoint's intent — "high-impact rung-2 → ask, don't surface a one-PR diff" — applies. Escalate to rung 3.

**Final verdict: rung 3.** Rule that fired: **ladder-rule-8 (rung 2) + high-impact-rung-2-escalation (→ rung 3)**.

## Action taken

- Attached labels: `triage`, `triage:rung-3`, `triage:iter-001` via `bd update --add-label=...`. Did NOT attach a routing label — user has not picked a route yet.
- Did NOT close the bead (R3: rung 3 never auto-resolves).
- Did NOT edit source code (rung 3 produces no diff).
- Returned `{needsUser: true, rung: 3, ...}` payload to parent for `AskUserQuestion` rendering.

## Question payload returned

**Question**: How should we resolve this typo + entanglement with F4 (Codex-ttavz.15)?

**Header**: Rung-3 routing — auth.remote forgot-password

**Options** (4):

1. **Delete orphan exports (Recommended)** — Drop `forgotPasswordForm` (and any other zero-consumer remote exports flagged by Codex-ttavz.15) entirely. Page-action route at `(auth)/forgot-password/+page.server.ts:29` is canonical and correct. Closes both .12 and .15 in one PR. `next: delete-orphan`
2. **Fix typo, keep export** — Change line 146 to `/api/auth/forget-password`. Leaves Codex-ttavz.15 (orphan-exports) open as separate work. `next: fix-typo`
3. **Wire components AND fix typo** — Adopt the remote function as the canonical path, wire UI to it, fix the typo. Larger blast radius; needs test of the actual reset-email loop. `next: wire-and-fix`
4. **Spawn /backend-dev** — Hand off — this entangles with BetterAuth surface area (`packages/constants/src/security.ts:79-84` rate-limited paths) and warrants the service-layer skill. `next: spawn-backend-dev`

## Recurrence ledger increments

Created pattern `route:pending:codex-ttavz-12-auth-remote-broken-endpoint` (hits=1, verdict_history=[]). Will populate `verdict_history` once the user picks a route in the next cycle. This is mostly a ledger-exercise on first run; the real recurrence interest is the underlying fingerprint `denoise:web-auth-remote-broken-endpoint`, which has no other instances yet.

## Next-cycle prep

When the user picks a route, the parent should re-dispatch `/triage` as follows:

| User choice | Next cycle |
|---|---|
| `delete-orphan` (Recommended) | `--bead=Codex-ttavz.12 --rung=2 --apply --include=Codex-ttavz.15` — single PR; resolver agent confirms zero consumers via `fallow` and removes both orphan exports + delete the .15 bead's parent |
| `fix-typo` | `--bead=Codex-ttavz.12 --rung=1 --apply` — string-equality proof test on the URL constant; commit + close .12; .15 stays open as separate work |
| `wire-and-fix` | Spawn `/backend-dev` — too large for `/triage` to apply mechanically |
| `spawn-backend-dev` | End cycle; user invokes `/backend-dev` with .12 + .15 + the BETTERAUTH_RATE_LIMITED_PATHS context |

In all cases, attach `triage:routing:<route>` label on the routed bead in the next cycle. The recurrence ledger entry will pick up the chosen verdict in `verdict_history`.

## Artifacts touched

- `docs/triage/master.md` — ladder snapshot replaced (single-bead footnote), cycle history row added.
- `docs/triage/recurrence.json` — new pending pattern entry.
- `docs/triage/iter-001.md` — this file.

No source code edits (R3 enforced). No git push (R4 enforced). No unrelated denoise iter-030 files staged.

---

## Routing resolved (2026-04-27)

User picked **`spawn-backend-dev`** with note:

> "Yeah, spawn the backend dev to actually fix it. If it's not wired up, we're obviously going to need that functionality for the reset password and forgot password stuff."

**User's mental model**: the remote functions are the planned architecture, not dead code. Their orphan-ness is the bug, not the wiring path. The right fix is to wire them up (so `forgotPasswordForm`, `registerForm`, `resetPasswordForm` are actually called from the auth pages) AND fix the typo in `auth.remote.ts:146`.

**Why this matters for the recurrence ledger**: my recommendation was "delete orphan exports" based on `feedback_minimal_ux_change.md` and the page actions being canonical *today*. The user has roadmap context (planned functionality) that the skill cannot infer from labels or fingerprints. R3 (rungs 3–4 never auto-resolve) caught this — auto-deletion would have removed planned functionality.

**Bead state after routing**:
- Labels added: `triage:routing:backend-dev`, `triage:needs-design`
- Status: still `open` (owner remains brucemckayone — they'll work it under `/backend-dev`'s guidance)
- Final label set: 12 labels (7 denoise + 5 triage)

**Recurrence ledger updates**:
- `route:pending:codex-ttavz-12-auth-remote-broken-endpoint`: `verdict_history[0]` populated with `action=route, user_chose=spawn-backend-dev, user_reasoning=<quoted above>`.

---

## Skill self-improvement signals

Two patterns surfaced this iter that should accumulate toward future hard rules:

### Signal 1 — Underspecified rung-3 payloads (`signal:underspecified-payload-rung-3`)

The first `AskUserQuestion` render returned "im going to need more info on the task whats the issue". The payload had: 4 options with descriptions, denoise labels, blast-radius context, recurrence matches. **It did NOT include code excerpts.** The parent had to manually read 4 files and surface the actual diff before the user could decide.

If this recurs 3+ times across cycles, promote a hard rule in `references/04-stop-and-ask.md`:

> Rung-3 payloads MUST embed (a) a 5–15 line excerpt of the broken code, (b) the working comparator if one exists, and (c) the canonical reference (constants file, schema, etc.). Description-only payloads are insufficient.

Recorded in `recurrence.json` as a meta-signal pattern.

### Signal 2 — `bd update --label=...` syntax does not work

The cycle agent's brief and `SKILL.md` §6 both reference `bd update <id> --label="..."` for attaching labels. **This syntax prints help and does NOT attach labels.** The correct syntax is `bd label add <id> <label>` (one label per call).

Apparently the cycle agent's earlier invocation succeeded somehow (the bead has the agent's intended labels) — likely the agent figured out the right syntax internally without reporting the correction. The brief and SKILL.md still teach the wrong syntax to future cycles.

**Skill patches needed (apply post-cycle, before next `/triage` invocation)**:
- `.claude/skills/triage/SKILL.md` §6 — change `bd update <id> --label="..."` to `bd label add <id> <label>` (one per call) in the canonical example.
- `.claude/skills/triage/agents/triage-classify.md` — same fix.
- `.claude/skills/triage/agents/triage-resolve-mechanical.md` — same fix.
- `.claude/skills/triage/SKILL.md` §4 step 6 — clarify that `bd update --status=in_progress --owner=<route>` should only be used when `<route>` resolves to a real beads user identifier; otherwise leave owner alone and rely on the routing label.

These are R7-style skill patches (mirrors `/denoise`'s rule promotion mechanism). They're not promoted rules — they're correctness fixes. Applied as part of this cycle's commit.

---

## Schema correction (post-cycle)

`recurrence.json`'s `rung_density` field was misinterpreted on first write — the cycle agent set `iter-001: 3` (the rung number). Per `references/03-recurrence-promotion.md`:

> `rung_density` counts how many beads in that iter matched the fingerprint (a single bead = density 1; 5 beads sharing the fingerprint in one cycle = density 5).

Corrected to `iter-001: 1` (one bead matched). Note added in the pattern's `notes` field for future cycles.

---

## Next-cycle prep

The user has chosen to invoke `/backend-dev` to do the actual wiring + typo fix. That's a separate skill workflow with its own SKILL.md, MCP gates, and commit conventions. `/triage` exits cleanly here.

When `/backend-dev` lands its fix and closes Codex-ttavz.12 (and probably Codex-ttavz.15 in the same PR, since wiring removes the orphan-ness), the next `/triage` invocation will:
1. Notice `bd sync` head moved → re-classify the queue (or just the affected beads).
2. Update `recurrence.json` `verdict_history` only when triage *itself* picks a bead with this fingerprint again — no automatic increment from another skill's closure.
3. The pattern `route:pending:codex-ttavz-12-auth-remote-broken-endpoint` may need a renaming once we know whether the underlying fingerprint (`denoise:web-auth-remote-broken-endpoint`) recurs elsewhere.
