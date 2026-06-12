# Rolling Cross-Cycle Inventory

Load-bearing knowledge that recurs across epics but has no single durable home yet. `codex-epic-retro`
appends recurring gaps here; `codex-crystalize` reads it and promotes 3+-cycle patterns up the ladder
(`docs/epics/conventions.md` §5), then trims what it promoted.

Each row: a gap/pattern, the cycles it has appeared in, an urgency tier, and its candidate home.

| Pattern / gap | Cycles seen | Urgency | Candidate home |
|---|---|---|---|
| Stage bd-audit trail not emitted by the implement cycle (retro's primary data source absent) | 1 — Codex-69t7c (bootstrap had none by design) | High | codex-epic-implement automation / conventions §3 — tracked in Codex-3l73h |
| Nullable scope/FK column silently breaks `eq()` filters (money loss) | 1 — Codex-69t7c WP5 | High | codex-review scoping reviewer — distilled in `bd remember implement/nullable-orgid-breaks-eq-drain` |
| False-confidence tests (replica schema / conditional assertions / unseeded IDOR) slip TEST, caught at REVIEW | 1 — Codex-69t7c (4 instances: WP8, WP11) | Med | codex-epic-implement TEST-stage gate — distilled in `bd remember implement/tests-must-be-able-to-fail` |
| PR base-branch stranding (WP PR merged into a sibling WP branch, not trunk) | 1 — Codex-69t7c WP9 (#280→#283 re-land) | Med | codex-epic-implement SHIP-stage gate |
| bd 1.0.4 CLI drift from nmemo scripts | 2 — bootstrap + Codex-69t7c | Med | conventions §9 + `bd remember implement/bd-104-cli-drift` (promote to a gate at 3) |
| `.gitignore` `skills/` over-match — `.claude/skills/` is ignored (new skill files need `git add -f`) | 2 — bootstrap + Codex-69t7c | Med | anchor `skills/` → `/skills/` in `.gitignore` (a lint task) |

> Seed note (Codex-9wkbs, the bootstrap epic that built the family): the family itself was built by hand,
> not via codex-epic-implement, so it has no stage audit trail. The first REAL epic run through the
> cycle will populate this inventory. Two latent items already known, to watch for on the first real run:
> 1. **`.gitignore` `skills/` over-match** — unanchored `skills/` ignores `.claude/skills/`; new skill
>    files need `git add -f`. Anchor to `/skills/` (WP-8 / a lint task). **Recurred in Codex-69t7c
>    (now seen: 2 — promoted into the table above):** `git stash -u` reported `.claude/skills` ignored;
>    didn't bite (the SKILL.md files were already tracked), but the misconfig persists.
> 2. **bd 1.0.4 CLI drift from nmemo scripts** — `--no-color` gone, use `--json`; audit `prompt`/`tool_name`
>    are top-level on tool_call. Captured in `docs/epics/conventions.md` §9. **Recurred in Codex-69t7c
>    (now seen: 2 — promoted into the table above):** `bd audit` has no query subcommand (only `record`/`label`),
>    `bd create` title is positional, and auto-export `git add` fails on the gitignored `.beads/issues.jsonl`.
