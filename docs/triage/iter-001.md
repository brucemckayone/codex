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
