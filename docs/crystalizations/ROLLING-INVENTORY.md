# Rolling Cross-Cycle Inventory

Load-bearing knowledge that recurs across epics but has no single durable home yet. `codex-epic-retro`
appends recurring gaps here; `codex-crystalize` reads it and promotes 3+-cycle patterns up the ladder
(`docs/epics/conventions.md` §5), then trims what it promoted.

Each row: a gap/pattern, the cycles it has appeared in, an urgency tier, and its candidate home.

| Pattern / gap | Cycles seen | Urgency | Candidate home |
|---|---|---|---|
| _none yet — the loop hasn't run a full epic through retro yet_ | — | — | — |

> Seed note (Codex-9wkbs, the bootstrap epic that built the family): the family itself was built by hand,
> not via codex-epic-implement, so it has no stage audit trail. The first REAL epic run through the
> cycle will populate this inventory. Two latent items already known, to watch for on the first real run:
> 1. **`.gitignore` `skills/` over-match** — unanchored `skills/` ignores `.claude/skills/`; new skill
>    files need `git add -f`. Anchor to `/skills/` (WP-8 / a lint task). (seen: 1 — bootstrap)
> 2. **bd 1.0.4 CLI drift from nmemo scripts** — `--no-color` gone, use `--json`; audit `prompt`/`tool_name`
>    are top-level on tool_call. Captured in `docs/epics/conventions.md` §9. (seen: 1 — bootstrap)
