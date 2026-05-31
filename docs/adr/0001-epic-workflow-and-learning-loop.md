# ADR-0001: The codex-* epic workflow and learning loop

- **Status:** accepted
- **Date:** 2026-05-31
- **Promoted from:** epic `Codex-9wkbs` (the bootstrap epic that built the family); plan
  `~/.claude/plans/ineed-you-checkout-nmeno-nmeno-ios-functional-cake.md`.

## Context

Codex had a capable *front half* for substantial work — `epic-cycle` (plan + scaffold + a per-WP
quality cycle) and `pr-review-agent-team` (9 reviewers) — but no *learning back half*. Quality lessons
evaporated between epics: there was no post-merge retrospective, no cross-epic consolidation, no audit
trail of whether a WP actually passed its gates, and no durable per-cycle lesson substrate. The sibling
iOS project (`nmemo`) had solved this with a closed six-skill loop. We wanted the same loop, tailored to
Codex's stack (Cloudflare Workers + SvelteKit + beads/Dolt + Neon + Stripe) and conventions.

## Decision

Adopt a single, self-contained family of six skills as Codex's **sole** epic + quality workflow:

```
codex-epic-create → codex-epic-implement → codex-review → codex-epic-retro → codex-crystalize
                          ↕ codex-epic-handoff (zero-context recovery)
```

- **codex-epic-create** — scope + scaffold (replaces epic-cycle Phase A).
- **codex-epic-implement** — a 10-stage gated per-WP cycle that writes a `bd audit` entry per stage
  (replaces epic-cycle Phase B). `SIMPLIFY`, `FALLOW`, and `VISUAL-VERIFY` are stages, not reviewers.
- **codex-review** — a condensed **5-reviewer** conformance swarm (silent-failure-hunter +
  scoping-security + backend-conformance + commerce-stripe + migration-safety), roster-driven, with a
  corroboration multiplier (replaces pr-review-agent-team's 21-candidate sprawl).
- **codex-epic-handoff** — read-only continuation prompts.
- **codex-epic-retro** — post-merge hardening: reads the audit trail, promotes lessons.
- **codex-crystalize** — cross-epic meta-consolidation up the promotion ladder.

Supporting decisions:
- **Lessons substrate is `bd remember`** (keyed per-skill), NOT per-skill `MEMORY.md` — `bd prime`
  bans MEMORY.md. Timestamped narrative lives in `docs/epics/retros/` + `docs/crystalizations/`.
- **Promotion ladder:** `retro → bd remember → SKILL.md §1 → docs/adr/ → CLAUDE.md`. This ADR is the
  first artifact at the `docs/adr/` rung.
- **Legacy skills are harvested then retired** (see Consequences), conditioned on complete harvest.

## Alternatives considered

- **Keep epic-cycle and *delegate* to denoise/design-system** instead of absorbing them — rejected:
  the user's end-state is a self-contained family; delegating to skills slated for deletion is incoherent.
- **Port nmemo's per-skill `MEMORY.md` verbatim** — rejected: conflicts with `bd prime`'s explicit ban
  and the account-fragmentation it warns about. `bd remember` + retro docs preserve the same semantics.
- **Keep all 21 candidate reviewers** — rejected by the user as "way too much"; condensed to 5 with
  delegation of the rest to cycle stages + generics.

## Consequences

- **Retirement (deferred, irreversible — confirm before deleting):** `epic-cycle`,
  `pr-review-agent-team`, `denoise`, `codebase-audit`, `fallow-audit`, and the workflow parts of
  `design-system` are superseded. They are **soft-deprecated now** and deleted only after the loop is
  proven on one real epic and harvest is verified complete. `caching` / `tanstack-db` / `backend-dev` /
  `stripe-best-practices` are likely kept as domain reference (harvested into reviewer briefs).
- **Audit discipline becomes load-bearing:** every implement stage + every review writes to
  `.beads/interactions.jsonl`; `audit-tally.sh` measures it; a partial tally is a drift signal.
- **The loop self-improves:** the 5-reviewer roster and the stage set are seeds — retro/crystalize grow
  them from recurrence, not hand-tuning.
- **Follow-on work (filed as beads):** anchor the `.gitignore` `skills/` over-match to `/skills/`
  (currently new skill files need `git add -f`); run the first real epic through the loop to populate
  `docs/crystalizations/ROLLING-INVENTORY.md`; complete the `denoise` reference harvest before deleting it.
