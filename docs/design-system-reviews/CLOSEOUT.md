# Design System Skill — Loop Closeout

**Session ended**: 2026-04-18
**Cron job `15266419`**: terminated cleanly (was session-only anyway)
**Iterations completed**: 5 (iter-00 bootstrap + iter-02 through iter-05 via cron)

---

## What got built

### The `/design-system` skill (local-only; `.claude/skills/` is gitignored)

Location: `.claude/skills/design-system/` — NOT in git. Lives alongside `backend-dev/`,
`caching/`, `tanstack-db/`, etc. — all project skills follow this pattern.

Structure:
- `SKILL.md` — thin router with 12 hard rules (R12 added iter-04), MCP gate, decision tree, recursive-review workflow at §7
- `references/01-tokens.md` — raw → semantic → org-brand cascade; spacing scope cheat-sheet; legitimate-vs-anti-pattern fallback discipline
- `references/02-css-architecture.md` — cascade, `@custom-media`, modern features, Baseline-Widely proposals
- `references/03-components.md` — Svelte 5 runes, Melt UI wrapping, composition decision tree, `{className ?? ''}` trap, Skeleton Contract
- `references/04-motion.md` — **12 Disney Principles** with CSS/Svelte patterns; frame-rate-independent physics; Svelte transition directive reduced-motion bypass (bolded)
- `references/05-accessibility.md` — WCAG 2.2 AA, ARIA precedence, Disclosure/Accordion pattern, custom radiogroup keyboard contract
- `references/06-performance.md` — CWV, GPU-accel, module-scoped GPU caches, bounded enhancement fetches, defensive `getContext` null-checks
- `references/07-icons.md` — 67-icon `IconBase` system, UI-text glyphs are icons
- `references/08-testing.md` — Vitest custom mount, **two-tier a11y** (unit ARIA helpers + Playwright axe), snippet-based parent mount
- `references/09-mcp-verification.md` — mandatory close gate: Svelte + Context7 + Chrome DevTools + Playwright MCPs
- `references/10-brand-editor.md` — 6 integration paths (A–F); BrandEditorMount awareness; HERO_LAYOUTS third-copy note

### Commitable artifacts (`docs/design-system-reviews/` — in git)

- `001.md` through `005.md` — per-iteration audit summaries
- `CLOSEOUT.md` — this file

### Beads (auto-synced by daemon)

- **36 open review-originated beads**, all tagged `ds-review` + per-iter tags (`ds-review-iter-00/02/03/04/05`)
- Dependency edges added: `Codex-fyew` → `Codex-a4zc`, `Codex-aerq` → `Codex-y62l`, `Codex-2nl7` → `Codex-a4zc`
- Query via `bd list --label=ds-review` or `bd list --label=ds-review-iter-04`

---

## Headline findings across 5 iterations

| Pattern (recurrence count) | Primary bead(s) | Status |
|---|---|---|
| `--space-1-5` used outside `[data-org-brand]` scope | `Codex-lmex` (consolidated from iter-00/03/04) | **Open P1** — 14+ consumer sites depend on fix; elevated to SKILL.md R12 |
| Svelte `transition:fly/fade` bypasses reduced-motion | `Codex-9g9f`, `Codex-mfl7`, `Codex-vvsc` | **3 open P1** bugs; skill §2 warning bolded after 3rd recurrence |
| Missing `:focus-visible` rings | `Codex-meca`, `Codex-cc2n`, `Codex-iz1f` | **3 open P1** bugs; 4th recurrence suggests repo-wide lint check |
| Token-fallback anti-pattern at consumer sites | `Codex-gbwp`, `Codex-y6em` | Open; 123 instances caught in pricing page alone |
| Skill drift (code ahead of docs) | `Codex-a4zc`, patches in ref 10 | Consolidation bead open; skill patched iter-04 |
| Skill fabrication (docs claim API that never existed) | iter-05 `axeCheck` + TestWrapper | Skill patched iter-05; process step added to §7 |

---

## Skill evolution — 29 patches applied

| Iter | Patches | Notable |
|---|---:|---|
| 00 | 3 | Spacing scope asymmetry, Svelte-transition gotcha, `{className ?? ''}` trap |
| 02 | 4 | Frame-rate-independent physics §4, GPU cache lifecycle, bounded fetches, SKILL.md out-of-scope routing |
| 03 | 5 | Stale line anchors, radiogroup keyboard contract, fallback-at-declaration rule, spacing scope cheat-sheet, Skeleton Contract §9 |
| 04 | **8** | **R12 hard rule** (biggest skill change); ref 10 drift fixes ×3; Disclosure pattern; UI-text glyph rule |
| 05 | **8+1** | Ref 08 major rewrite (axeCheck removal, real two-tier a11y, TestWrapper migration path); fabrication-check step added to §7 |

The loop's most valuable single output was the **R12 hard rule** (iter-04) — elevated after
the spacing-scope bug recurred in 3 separate iterations. Runners-up: fabrication-check
process step (iter-05), Skeleton Contract (iter-03).

---

## Known gaps (from the self-assessment)

Honestly named in case the loop resumes later:

1. **Skill never used for authoring.** Only reviewed. Primary-mode test missing.
2. **Fabrication check not run retroactively across all 10 refs.** Added as a future-iteration step.
3. **MCP verification gate is paper-only.** Never exercised in practice during the loop.
4. **Ref 06 (performance) under-exercised.** Three deferrals = actual batch-selection bias.
5. **Beads lack most dependency edges.** 3 added in closeout; more are possible.
6. **Skill is local-only.** `.claude/skills/` gitignored. Bus factor = 1 (this machine's disk).

---

## How to resume (zero-context handoff)

```bash
# 1. Verify skill still exists locally
ls .claude/skills/design-system/

# 2. Re-arm the cron (if desired — probably NOT at 30min anymore, 2-4h is healthier)
# Via /loop 2h <same prompt> OR /schedule <slash command>

# 3. Query outstanding work
bd list --label=ds-review --status=open                # 36 open today
bd ready --label=ds-review                             # what's workable right now

# 4. If starting a new iteration, follow SKILL.md §7:
#    - Pick 3-6 unreviewed files
#    - Spawn general-purpose agent with /design-system + structured finding shape
#    - Triage → beads → skill patches → NNN.md summary
```

---

## Recommended follow-up (priority order)

| # | Action | Cost | Unblocks |
|---|---|---|---|
| 1 | Promote `--space-1-5`, `--space-2-5`, `--space-3-5` to `tokens/spacing.css:root` | 10 min | Closes `Codex-lmex` + 14 silent failure sites |
| 2 | Retroactive fabrication check across refs 01/02/03/05/06/07/09/10 | 30 min (grep per cited API) | Prevents another iter-05-class surprise |
| 3 | Run the MCP verification gate once on a real change to prove it works | 30 min | Validates ref 09 isn't paper-only |
| 4 | Back up `.claude/skills/design-system/` outside the gitignored path (cp to `docs/skills-backup/`, or force-unignore) | 5 min | Bus-factor mitigation |
| 5 | Close the 5 audit-record P3 beads (`ryck`, `8vbg`, `7yh3`, `fltg`, `yx3a`) — they're records, not work | 2 min | Reduces open-bead noise |
| 6 | Drop cron cadence from 30min → 2-4h (if resuming) | trivial | Avoids diminishing-returns fatigue |

---

## Meta — what the loop taught us about skills

Three durable lessons, worth carrying to other skills:

1. **Dual-output is the rule** (beads + skill patch per finding). Codified in MEMORY.md.
2. **Bidirectional drift exists.** Skill can be ahead (iter-04) OR behind (iter-05) of code. Reviews catch both.
3. **Recurrence count earns stronger phrasing.** 3rd-recurrence bug → hard rule upgrade, not just another bead.

The loop is pausable here in good conscience. Five iterations, 36 actionable beads, 29 durable
skill improvements, one hard rule, one process step. Anything beyond this point is a
longer cycle — most of the Svelte/CSS surface has been audited once.
