# Retro: Codex-69t7c — Creator Studio Monetisation (single-account Connect + Earnings hub + orgless pipeline)

**Merged:** 2026-06-12  ·  **WPs:** 11/11 (PRs #272–283)  ·  **Audit:** 0/11 WPs have a stage/swarm trail — `audit-tally.sh` reports *"no codex audit entries"* (all **missing**). This retro was reconstructed from git topology + fix-commit messages + PR bodies + `bd show`.

> First real epic through the codex-* loop. The quality gates clearly fired (review caught 2 money CRITICALs + 6 further defects before merge); the *instrumentation* (bd-audit) did not. Read both halves below accordingly.

---

## What worked

- **`codex-review` is demonstrably load-bearing.** Across 5 WPs it caught, pre-merge: 2 money CRITICALs (WP5 orgless drain), a security test that proved nothing (WP8 replica schema), silent error-handling (WP9), a wrong-amount creator email (WP10), and can't-fail E2E assertions (WP11). The epic's close reason names each — the swarm earned its place in the loop.
- **Review → fix → regression-test loop closed.** Almost every `fix(payouts): WP… review —` commit *added the regression test that proves the bug is dead* (WP5 +6 incl. a negative ledger-fail test; WP10 +2 amount guards; WP11 unconditional `toHaveLength` + a real seeded IDOR row). The "bug becomes a test" intent held.
- **Commit discipline was the de-facto audit trail.** One PR per WP, conventional commits, and *detailed fix-commit bodies* carried enough signal that this retro was fully reconstructable despite the empty bd-audit log. This is what saved Stage 1.
- **Deferral hygiene (items 1–3).** WP5's non-blocking residuals were parked in `Codex-2f3wk` with an owner instead of rushed into the money-critical PR.
- **Pre-production clean schema redesign (WP1 keystone, no migration)** kept the blast radius of a userId-centric Connect rewrite contained.

## What didn't  *(WP + evidence)*

1. **bd-audit trail never emitted (all 11 WPs).** `audit-tally.sh Codex-69t7c` → *"no codex audit entries — cycle not run, or audit discipline skipped."* `.beads/interactions.jsonl` holds 6 uncommitted rows, none of them `stage-N`/`swarm-*`. Conventions §3 designates this as the retro's primary data source, and codex-epic-implement **R2 already mandates** a `bd audit record` on every stage EXIT — so this is an *enforcement* gap, not a missing rule. → **Codex-3l73h** (P1) proposes automating emission rather than restating R2.
2. **WP9 PR base-branch stranding.** PR #280 was merged into `feat/Codex-69t7c.8` instead of `dev`, leaving WP9 off `dev`; required cherry-pick re-land **#283** (and a paraglide `messages/en.json` ↔ `messages.js` re-sync). Evidence: #283 body. Pure process waste + a real runtime-crash risk (`paraglide-two-generated-files`).
3. **False-confidence tests slipped the TEST stage, caught only at REVIEW.** WP8 (#279, `b54c38b2`): IDOR tests used *inline replica* Zod schemas instead of importing the real `@codex/validation` ones. WP11 (#282, `d6d9c02a`): `if (payoutRows.length > 0)` guards made assertions pass vacuously on 0 rows; the IDOR test seeded no real foreign row. → `bd remember implement/tests-must-be-able-to-fail`.
4. **Money-critical NULL-`eq` drain class reached PR.** WP5 (#278, `2a011911`): orgless `creator_payout.organizationId = NULL` was invisible to both `resolvePendingPayouts` (`eq(organizationId, orgId)` never matches NULL) and `sweepUnresolvedPayouts` (`!group.organizationId` skip) → creator money stranded. Caught at REVIEW, not IMPLEMENT/TEST. → `bd remember implement/nullable-orgid-breaks-eq-drain`.
5. **Severity mismatch in a residuals bead.** `Codex-2f3wk` item 4 — orgless content (`org = NULL`) with `minimumTierId` set **bypasses the tier/subscription gate** (the `orgId`-null path skips `hasSubscriptionAccess`) — is an *access-control bypass* bundled with three trivial cleanups under one P2. Pre-existing, but exposed by WP5.
6. **`audit-tally.sh` path drift in the skill's own docs.** Stage 1 + Related say `scripts/audit-tally.sh`, but it lives at `.claude/skills/codex-epic-retro/scripts/audit-tally.sh`; invoked from repo root it silently misfires (no such file), so a retro could falsely conclude the script is missing.

### Bug-class lineage (origin → caught → fixed → test?)

| Defect | WP / PR | Caught by | Fix commit | Became a test? |
|---|---|---|---|---|
| Orgless payouts stranded: `eq(orgId)`/`!group.orgId` exclude NULL in drain **and** sweep | WP5 #278 | codex-review (CRITICAL ×2) | `2a011911` | ✅ +6 (positive NULL-scope drain + negative) |
| Real money moved, ledger insert failed at `obs.warn` (silent) | WP5 #278 | codex-review | `2a011911` | ✅ surfaced-with-errorId test |
| IDOR tests used replica schemas → proved nothing | WP8 #279 | codex-review | `b54c38b2` | ✅ import real `@codex/validation` |
| Remote error paths swallowed, no propagation test | WP8 #279 | codex-review | `b54c38b2` | ✅ +3 error-propagation tests |
| Earnings load `catch` returned success/`null` sentinels | WP9 #280→#283 | codex-review | `61770937` | ◑ UI retry states + errorId logging |
| `payout-released` email summed `organization_fee` → wrong £ | WP10 #281 | codex-review | `f5591068` | ✅ +2 amount-gate regression guards |
| Vacuous payout-row assertions + unseeded IDOR | WP11 #282 | codex-review | `d6d9c02a` | ✅ unconditional `toHaveLength` + real seeded row |

## Hardenings applied

- `bd remember` **`implement/nullable-orgid-breaks-eq-drain`** — when a NOT-NULL scoping/FK column gains a NULL case, grep every query/drain/cron/group-by filtering on it; `eq(col,value)` silently drops NULL rows. (money-critical)
- `bd remember` **`implement/tests-must-be-able-to-fail`** — TEST-stage gate: import the real SUT/schema (no replicas), unconditional assertions (no `if(x>0)` guards), prove each test can fail, seed a real foreign row in authz/IDOR tests.
- `bd create` **Codex-3l73h** (P1, owner brucemckay) — decide and implement: enforce per-stage `bd audit record` emission in `codex-epic-implement` **or** adopt the git commit trail as the substrate (+ update conventions §3 / `audit-tally.sh`).
- `bd create` **Codex-up7bx** (P1, `security`/`access`) — orgless `minimumTierId` tier-gate bypass, split out of `Codex-2f3wk` item 4 (breadcrumb left on 2f3wk).
- SKILL.md edit — `codex-epic-implement` §1 **R9**: PR base MUST be trunk; verify at SHIP (the WP9 stranding gate).
- SKILL.md edit — `codex-epic-retro` Stage 1 + Related: `audit-tally.sh` path corrected to `.claude/skills/codex-epic-retro/scripts/audit-tally.sh`.

## Surfaced for user decision

**Resolved this session (user-approved, applied above):**
- ✅ `codex-epic-implement` SKILL.md §1 **R9** — PR base must be trunk; verify at SHIP (WP9 #280 stranding).
- ✅ `codex-epic-retro` SKILL.md Stage 1 + Related — `audit-tally.sh` path corrected to `.claude/skills/codex-epic-retro/scripts/audit-tally.sh`.
- ✅ `Codex-2f3wk` item 4 split out to **Codex-up7bx** (P1, `security`/`access`) with a breadcrumb back on 2f3wk.

**Still deferred (by decision):**
- **ADR 0002** — draft only once Codex-3l73h's audit-substrate decision is actually made (an ADR records a decision; this one is still open).
- **TEST-stage gate promotion** — `implement/tests-must-be-able-to-fail` is a SKILL.md §1 candidate but has 1 cycle of evidence; hold at `bd remember`, let `codex-crystalize` promote if it recurs.

## Recurrence (→ ROLLING-INVENTORY)

- **Stage bd-audit trail not emitted by the implement cycle** — seen: 1 (Codex-69t7c; bootstrap had none by design). Urgency High. → tracked in Codex-3l73h.
- **False-confidence tests (replica schema / conditional assertions / unseeded IDOR) slip TEST, caught at REVIEW** — seen: 1 (Codex-69t7c, 4 instances). Urgency Med.
- **PR base-branch stranding (WP PR merged into a sibling WP branch, not trunk)** — seen: 1 (Codex-69t7c WP9). Urgency Med.
- **Nullable scope/FK column silently breaks `eq()` filters (money)** — seen: 1 (Codex-69t7c WP5). Urgency High.
- **bd 1.0.4 CLI drift** recurred (cycle 2): `bd audit` has no query subcommand; `bd create` title is positional; auto-export `git add` fails on the gitignored `.beads/issues.jsonl` mirror. (Bootstrap seed item #2.)
