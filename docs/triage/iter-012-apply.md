# iter-012-apply — Codex-u498 (TWO apply passes on same parent)

> Codex-u498 went through two distinct apply phases. Both are documented here for audit completeness.
>
> 1. **First apply pass — Option A clarified to 4-agent execute team** (commit `8444d82c`, 2026-04-29 09:10): user clarified Option A to mean "4 sub-agents executing slices in parallel, confirming at end". Produced 19/21 pass + 2 fails + 3 partials + 1 expected-pending; filed 7 bug-discovery children dep-wired to parent. Documented in §A "First apply pass — execute variant".
> 2. **Second apply pass — Option B split-into-4-tracker-beads** (this cycle, 2026-04-29 PM): user explicitly chose Option B from the original walk's framing. Filed 4 verification-slice tracker beads (Codex-fofch / Codex-pf1ob / Codex-s5uy1 / Codex-i8y7k) dep-wired to parent. Documented in §B "Second apply pass — split variant".
>
> Both apply passes co-exist on the same parent because Option A's execute pass produced *defect discoveries* (the 7 bug children) while Option B's split pass produces *verification work-trackers* (the 4 slice children). Together they form the parent's full child-dependency graph (11 children + 1 closed `Codex-nn8l`).

---

## §B — Second apply pass: split into 4 tracker beads (current cycle)

> Apply pass for the walk-only iter-012 (commit `fbf4ff87`). User chose
> **Option B — Split into 4 child beads** at the routing question. This cycle
> creates the 4 verification-slice tracker beads, wires them as parent
> dependencies, and labels accordingly. No production-code edits. Codex-u498
> stays open as a tracker bead, blocked-on the 4 new children.

**Date**: 2026-04-29 (PM session)
**Mode**: auto / apply pass after Option B greenlight (no nested user prompt)
**Bead**: Codex-u498 — *[Nav Redesign] WP-10: Verification (DevTools + Playwright)*
**Rung**: 3 (Multi-file / Reasoned) — apply phase
**Outcome**: 4 child beads filed, parent stays `in_progress` as tracker.

### Cycle parameters

| Field | Value |
|---|---|
| Iter ID | `iter-012-apply` (second pass, split variant) |
| Bead | `Codex-u498` |
| User choice | **Option B — Split into 4 child beads** (greenlit this turn) |
| Walk-doc cite | `docs/triage/iter-012.md` (commit `fbf4ff87`) |
| Reference precedent | `docs/triage/iter-009a-apply.md` (one-PR Option A — different shape, different choice) |

### Pre-flight result

`bd show Codex-u498 --json` returned `status=open, owner=brucemckayone@gmail.com,
labels=[triage, triage:iter-012, triage:routing:apply-partial, triage:rung-3]`.
The `apply-partial` label is from the prior iter-012-apply execution (commit
`8444d82c`, see §A below). Per the brief, the user has now greenlit Option B
(the walk's framed split-into-tracker-beads decomposition). Re-claimed parent
`bd update Codex-u498 --status=in_progress` immediately so the tracker bead is
excluded from `/triage` picker eligibility while the 4 children drain.

### Created beads

| Child | Title | Assertions | i49f dep |
|---|---|---|---|
| **Codex-fofch** | `[Nav Redesign] WP-10.1: Desktop sidebar verification` | T-01, T-02, PW-01, PW-02, PW-07, PW-08 (6) | No |
| **Codex-pf1ob** | `[Nav Redesign] WP-10.2: Mobile verification` | T-04, T-05, PW-04, PW-05, PW-06 (5) | No |
| **Codex-s5uy1** | `[Nav Redesign] WP-10.3: Command palette verification` | T-03 (9 sub) + PW-03 (2) | No |
| **Codex-i8y7k** | `[Nav Redesign] WP-10.4: A11y, responsive, auth, transitions, brand-editor verification` | T-06, T-07, T-08, T-09, T-10, PW-09, PW-10, PW-11 (8) | YES (soft — see below) |

All 4 children created with `--type=task --priority=2 (P2)` per the walk's classification of the slice work as rung-2 mechanical Playwright spec authoring.

### Dependency edges

| Edge | Result |
|---|---|
| `bd dep add Codex-u498 Codex-fofch` | ✓ Added (parent blocked-on child 1) |
| `bd dep add Codex-u498 Codex-pf1ob` | ✓ Added (parent blocked-on child 2) |
| `bd dep add Codex-u498 Codex-s5uy1` | ✓ Added (parent blocked-on child 3) |
| `bd dep add Codex-u498 Codex-i8y7k` | ✓ Added (parent blocked-on child 4) |
| `bd dep add Codex-i8y7k Codex-i49f` | ✗ **CYCLE REJECTED** — Codex-i49f is already blocked by Codex-u498 (existing relationship), and adding `i8y7k → i49f` closes the loop `u498 → i8y7k → i49f → u498`. |

Cycle rejection on the 5th edge is **expected per the walk's F2 finding** — `_creators/+layout.svelte:12-13` legacy Header import is a Codex-i49f (WP-11) responsibility, but Codex-i49f's pre-existing blocker on Codex-u498 already encodes the "WP-11 ships after WP-10 verification" ordering. A second hard dep `i8y7k → i49f` would create a deadlock.

**Resolution**: applied label `triage:soft-dep-codex-i49f` to Codex-i8y7k and documented the coupling in the child's description (T-09 at 768px on `/creators` is expected-pending until Codex-i49f's WP-11 cleanup lands; mark as expected-pending, NOT a child-fail). Preserves audit trail without graph cycle. The soft-dep label may surface in future cycles for `bd ready` filtering refinements.

### Labels applied

#### Children (each gets all 4)

- `nav-redesign`
- `wp-10`
- `triage:from-split`
- `triage:iter-012-apply`

(Codex-i8y7k additionally gets `triage:soft-dep-codex-i49f`.)

#### Parent (Codex-u498)

- `triage:routing:split-into-4` (load-bearing routing label going forward)
- `triage:tracker`
- `triage:iter-012-apply` (already on bead from §A; idempotent re-add)

`triage:routing:apply-partial` from §A remains on the bead — captures the audit history that this parent had two distinct apply phases.

### Parent disposition

Codex-u498 stays `status=in_progress` as a tracker bead. Eligibility filter on `/triage` picker excludes `in_progress` beads, so the parent automatically disappears from the pick list and re-emerges (via `bd ready`) once all children close.

The 7 pre-existing bug-children from §A (Codex-nwlhm, Codex-rf1l9, Codex-1k9ns, Codex-onjxy, Codex-peuan, Codex-usqgu, Codex-95vdy) remain wired as Codex-u498 dependencies — they capture defects discovered during §A's 4-agent execute pass and should drain independently of the 4 verification-slice tracker beads filed this cycle. Total parent dependencies: 11 (1 closed Codex-nn8l + 7 §A bug children + 4 §B verification-slice tracker children).

### Recurrence ledger updates

#### NEW: `signal:user-chose-split-into-children` (hits=1)

First sighting at iter-012-apply (split variant). Distinct from `signal:cluster-execute-heterogeneous-slices` (which captures 4-agent verification team executing in-session) — this fingerprint captures the user's deliberate split-into-tracker-beads choice rather than execute-now choice. iter-011 walked Codex-x0pa with the same Option B framing but the user has not yet answered iter-011's question; if iter-011's eventual user answer also chooses split, this fingerprint reaches hits=2.

#### Bumped: `signal:bead-is-test-plan-execution` verdict_history extended

Hits stays at 1 (same bead per `signal:type-drift-template-vs-api` precedent — multiple verdict_history entries on the same bead don't increment the 3-distinct-bead promotion threshold). New verdict_history entry: `{iter: "iter-012-apply", rung: 3, action: "apply-as-split", user_chose: "B", team_size: 4, team_beads: [Codex-fofch, Codex-pf1ob, Codex-s5uy1, Codex-i8y7k], user_reasoning: "Matches team's per-flow E2E convention; insulates blast radius; only .4 gates on i49f."}`.

#### Audit-only append: `signal:concurrent-cycle-suffix` (post-promotion)

Verdict_history extended with this cycle to confirm RT3 stayed clean across iter-011 + iter-011a + iter-011b + iter-011c + iter-012 + iter-012-apply across the same bead-pickup window. RT3 already promoted in iter-010a-promote; this append is documentation-only.

### Constraints honoured (§B)

- ✅ Read-only on production code (only `docs/triage/` and bd state edits)
- ✅ No nested agents spawned
- ✅ Codex-u498 description NOT modified
- ✅ No bead closes (children-first; parent stays in_progress as tracker)
- ✅ All `bd create` and `bd dep add` calls run in parallel where possible
- ✅ R3 honoured (rung-3 work never auto-resolves to close)
- ✅ Cycle detection on the i8y7k → i49f edge correctly rejected (no graph cycle introduced)

### Ladder impact (§B delta)

- Rung 2: 0 → 4 (4 new P2 tracker beads filed)
- Rung 3: 28 (Codex-u498 stays at rung-3 as tracker, in_progress so excluded from picker)

### Files touched

- `docs/triage/iter-012-apply.md` — appended §B alongside preserved §A
- `docs/triage/master.md` — cycle-history row appended for iter-012-apply (split variant); ladder snapshot updated
- `docs/triage/recurrence.json` — `signal:user-chose-split-into-children` NEW + `signal:bead-is-test-plan-execution` verdict_history extended + `signal:concurrent-cycle-suffix` audit-only append

### Commit (§B)

Single commit lands `docs/triage/iter-012-apply.md` + `docs/triage/master.md` + `docs/triage/recurrence.json`. Subject: `triage(iter-012-apply): rung-3 — split Codex-u498 into 4 children per user greenlight`. No push (R4 honoured). No `bd close` on parent (children must close first).

---

## §A — First apply pass: 4-agent execute team (preserved from prior session)

> Apply phase after iter-012's walk + user greenlight on Option A "One bundled verification PR" (clarified to mean: 4 parallel sub-agents, each owning one slice, confirming at the end). User explicitly waived per-PR commit/atomicity discipline ("no production app, hardening phase").

### Cycle parameters (§A)

- **Iter ID**: iter-012-apply (first pass, execute variant)
- **Bead**: Codex-u498 — *[Nav Redesign] WP-10: Verification (DevTools + Playwright)*
- **Mode**: cluster-execute team (R1 exception variant — heterogeneous slice recipes, single fingerprint family)
- **Rung**: 3 (apply phase, walk landed in iter-012's `fbf4ff87`)
- **Date**: 2026-04-29 (AM session)
- **Predecessor commit**: `fbf4ff87` (iter-012 walk + early-claim)

### Team protocol (§A)

User clarification on iter-012's AskUserQuestion answer: chose **Option A (One bundled verification PR)** but ALSO instructed: "we can have 4 subagents doing each separately confirming at the end i dont care about commit pr structurs right now there is no production app we are in the process of hardening so its no big deal".

Interpreted as a hybrid: parallelism of Option B (4 sub-agents) + apply-now-don't-split-beads of Option A (no child epics, just verification execution). Closest skill analog: §13 cluster-defect agent team (R1 exception), but recipes are NON-byte-equivalent (sidebar checks ≠ mobile checks ≠ palette checks ≠ a11y checks). NEW team-cycle shape recorded as `signal:cluster-execute-heterogeneous-slices` candidate (not yet filed in recurrence ledger pending pattern recurrence).

### Slice ownership (§A)

| Slice | Agent ID | Checks | Surface |
|---|---|---|---|
| 1 — Desktop sidebar | a378…ef31 | T-01, T-02, PW-01, PW-02, PW-07, PW-08 | platform + studio-alpha rail at desktop viewports |
| 2 — Mobile (375x812) | a2cd…9c46 | T-04, T-05, PW-04, PW-05, PW-06 | bottom nav + bottom sheet |
| 3 — Command palette | ae51…c428 | T-03 (9 sub) + PW-03 | palette open/close/debounce/scope |
| 4 — A11y / auth / transitions / responsive / brand-editor | a6fe…376e | T-06, T-07, T-08, T-09, T-10, PW-09, PW-10, PW-11 | cross-cutting concerns |

Each agent ran chrome-devtools + playwright MCPs in its own browser session (no overlap). Total wall time ~12 min (longest slice 4 at 11.5 min). Parent context grew by ~4 structured returns (one per slice).

### Aggregate result (§A)

**21 checks → 19 pass-or-deferred + 2 hard fails + 3 partials.** Bead's "All must pass before WP-11" gate **not met** — Codex-u498 stays open with 7 dependency child beads blocking close.

| Slice | Pass | Fail | Partial | Pending-WP-11 | Beads filed |
|---|---|---|---|---|---|
| 1 — Desktop sidebar | 6/6 | 0 | 0 | 0 | 1 (P3 polish) |
| 2 — Mobile | 5/5 | 0 | 0 | 0 | 0 |
| 3 — Command palette | 11/11 | 0 | 0 | 0 | 1 (P3 bug) |
| 4 — A11y / etc | 4/8 + 5/6 sub | 2 | 3 | 1 | 5 (2× P2, 2× P3, 1× P4) |
| **Total** | **19** | **2** | **3** | **1** | **7** |

### Findings detail (§A)

#### Hard fails (2)

**1. Codex-nwlhm (P2 bug)** — Platform `/` does not render auth state in SidebarRailUserSection.

After login, `/discover` and `/library` show authenticated avatar + name + email + dropdown menu (Account/Library/Studio/Log out). `lvh.me:3000/` still shows the unauth Sign In link. Same browser session, same cookie, two different render paths producing two different user states. Likely cause: platform marketing home does not propagate `locals.user` to `SidebarRailUserSection`. Real bug, not test infra — the kind of cross-cutting issue only end-to-end browser MCP catches.

**2. Codex-rf1l9 (P2 bug)** — Nav redesign components ignore `prefers-reduced-motion`.

`SidebarRail*`, `MobileBottomNav`, `MobileBottomSheet`, `CommandPalette`, `CommandPaletteSearch` have no `@media (prefers-reduced-motion: reduce)` blocks. `StudioSidebar*` does — copy that pattern. WCAG 2.3.3 (Animation from Interactions) implicated. Mechanically a 30-line CSS addition.

#### Partials (3) — captured as P3 task beads

**3. Codex-peuan (P3)** — Arrow-key navigation within rail not implemented (Tab works fine, ArrowDown/Up don't move focus). Spec T-10 says "arrow keys work within rail". Roving-tabindex pattern needed.

**4. Codex-1k9ns (P3)** — Studio sidebar uses 64→260 hover-expand instead of always-expanded per spec T-07. May be spec drift (design unified rail behaviour) rather than implementation bug — bead requests product/design clarification before fix lands.

**5. Codex-95vdy (P4 cosmetic)** — Dropdown menu item "Log out" vs spec "Sign Out". Minor wording alignment.

#### Polish bead (1)

**6. Codex-onjxy (P3)** — `--rail-width-expanded: 240px` literal in `SidebarRail.svelte:154` should hoist into `tokens/layout.css` for brand-editor density-tier overrides. Single consumer, no current functional impact.

#### Cross-org bug (1)

**7. Codex-usqgu (P3 bug)** — `CommandPaletteSearch.svelte:124-127` does naive `goto('/content/{slug}')` and 404s when palette returns foreign-org content (cross-subdomain). Should use `buildContentUrl(page.url, content)` per CLAUDE.md "Common Developer Tasks → Content page URLs".

This is the **third** missed-call-site of an established-helper pattern → recurrence promotion-eligible.

#### Expected pending Codex-i49f (1)

**T-09.creators-768** — `apps/web/src/routes/_creators/+layout.svelte:12-13` still imports legacy `Header/UserMenu` + `Header/MobileNav`. WP-11 (Codex-i49f) cleanup will migrate to new `SidebarRail` + `MobileBottomNav`. Deferred to Codex-i49f scope per F2 of iter-012's walk doc.

### Bead state changes (§A)

- **Codex-u498**: status `in_progress` → `open` (apply ended partial, not closed). Labels: + `triage:routing:apply-partial`. Now blocked by 7 child beads. (§B re-claimed status `open` → `in_progress`.)
- **Codex-nwlhm** (NEW, P2 bug): platform root auth state regression
- **Codex-rf1l9** (NEW, P2 bug): reduced-motion a11y regression
- **Codex-peuan** (NEW, P3 task): arrow-key nav
- **Codex-1k9ns** (NEW, P3 task): studio sidebar always-expanded spec deviation
- **Codex-onjxy** (NEW, P3 task): rail width token hoisting
- **Codex-usqgu** (NEW, P3 bug): palette cross-org goto
- **Codex-95vdy** (NEW, P4 task): log out vs sign out wording
- 7× `bd dep add Codex-u498 <child>` — all 7 children block Codex-u498's close

### Recurrence ledger updates (§A)

#### Bumped: `route:self:promoted-helper-missed-call-site` (hits 2 → 3, PROMOTION ELIGIBLE)

Third distinct bead, third distinct helper missed at a new call site:

- iter-003 / Codex-y6x9j: `invalidateOrgSlugCache` missed at `settings.ts`
- iter-009 / Codex-y63gl.14: `pollConfig` (cadence) missed at `ImmersiveShaderPlayer` + `ShaderPreview`
- iter-012 / Codex-usqgu: `buildContentUrl` missed at `CommandPaletteSearch.svelte:124-127`

All three: established helper documented in CLAUDE.md OR promoted via denoise R-rule, then a later-arriving consumer ships without inheriting it. Cleanly meets §3 promotion-gate: hits ≥ 3 ✓, verdict_history consistent (all `auto-resolve` rung-1 fixes) ✓, was `promoted: false` going in ✓. **Queued for next /triage cycle's parent prep step** — RT4 codification candidate (mirrors RT3 promotion path in iter-010a-promote).

Draft RT4 rule text:

> When a perf/structural pattern is amortised inline in component A and component B/C are introduced later that share the underlying expensive call (`getShaderConfig`, `audio.getAnalysis()`, `goto()` for cross-subdomain routing, etc.), the introducing PR MUST extract or consume the existing helper before merge. Denoise filters that flag bare expensive calls in render loops or naive `goto()` calls when `buildContentUrl()` is in scope would catch this earlier. Lint candidate: AST-grep for `goto(\`/content/${...}\`)` patterns and route-level mutation hot paths that bypass canonical helpers.

#### Bumped: `signal:bead-is-test-plan-execution` (verdict_history extended, §A)

iter-012-apply added an `auto-resolve-partial` entry tagged `apply-option-a-team-execute`. Hits stays at 1.

#### NEW: `signal:cluster-execute-heterogeneous-slices` (hits=1, §A)

First sighting. Distinct from §13's cluster-defect team-fix (byte-equivalent recipes) — here the slice recipes are NON-byte-equivalent. Common shape: a single test-plan-execution bead where the natural decomposition is by viewport/context axis, not by file-locality. If 3+ recurrences (other verification-only beads in nav-redesign / auth-perf / analytics epics), promote rule covering the variant.

#### NEW: `signal:apply-phase-partial-children-block-parent` (hits=1, §A)

First sighting. Apply phase ended with N child beads filed and parent left open with `triage:routing:apply-partial`, dependency-wired to all N children.

### Surface gaps captured for skill self-improvement (§A)

1. **Cluster-execute heterogeneous slices** — §13's cluster-defect protocol assumes byte-equivalent recipes. Verification-execution clusters have heterogeneous recipes but a shared fingerprint family. §13 needs a sub-section codifying this variant.
2. **Apply-partial routing** — no `triage:routing:apply-partial` precedent existed before §A; iter-009a-apply closed cleanly, iter-010-apply closed cleanly. First time the apply phase produces a non-close outcome that's also not a hard-stop. Skill should codify: "rung-3 apply phases MAY end with parent-stays-open + N children filed; the routing label `triage:routing:apply-partial` is the audit trail."

### Commit (§A)

`triage(iter-012-apply): rung-3 apply — Codex-u498 verification 4-agent team (19/21 pass, 7 child beads filed)` (commit `8444d82c`).
