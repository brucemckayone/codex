# UX polish — continuation prompt

Paste this whole file as the first message of a new chat.

---

We're continuing a UI/UX polish effort on the Codex platform. You are the **orchestrator**:
you hold the decisions and the merges; parallel subagents do the reading, writing, verifying
and reviewing. Seven rounds already shipped this way and merged to `dev` — read the pattern
and the constraints below before starting anything, because most of them were learned the
expensive way.

## Where things stand

`dev` is at `013e2d42` (PR #445, 109 files, +13558/−3551). Already polished and merged:

| Surface | What landed |
|---|---|
| Studio shell | `--container-studio` is a real token; the shell owns the content column — **pages must not declare an outer `max-width`** |
| Status surfaces | `styles/themes/status.css` — 12 semantic tokens that derive from the page they sit on; `Alert`/`Badge` consume them |
| `ui/PageHeader` | kicker + title + lede + meta + `headingLevel`; renders the page's single `<h1>`; `variant="compact"` → `<h2>` |
| Explore | filters URL-backed and server-applied; portals rail (Carousel); list view **deleted** |
| Creators | contact sheet; `seed-creators.ts` gives of-blood-and-bones 15 creators |
| Pricing | `ContentMarquee` catalogue with a pause control |
| Studio settings / team | validation surfaced; per-row accessible names |
| Studio monetisation / subscribers | Stripe-readiness prompt; repetition → hierarchy |
| Studio billing / payouts | fee ledger; transaction regrouping; 19 pills → 7 |

**Not yet touched** — candidates for the next rounds:

- Org space: `content/[slug]` (+ the player), `library`, `journeys`, `checkout`, `subscription`
- Studio: `analytics`, `brand` (the two-pane brand editor), `media`
- Platform: `discover`, `library`, `account`, `about`, `become-creator`, `(platform)/pricing`

The user's judgement from round 1: `studio/customers` and `studio/sales` "look good" — use
`customers` as the quality bar to match, not a target to change.

## The orchestration pattern that worked

One `Workflow` per work package, 7–8 agents, five phases:

```
Analyse   2–3 read-only analysts in parallel, each with a distinct lens.
          Schema-constrained briefs. They may NOT edit.
Implement ONE writer, in a pre-made git worktree you create yourself with
          `git worktree add` (NOT isolation:'worktree' — that gives each agent
          its own tree, which breaks a coherent branch). Guard the result:
            if (implResult == null) retry once under a DIFFERENT label, then abort.
          A null implement silently sent verify+review+repair at an empty diff
          once and burned four agents.
Verify    ONE browser agent. Quantitative only — measured numbers, not verdicts.
Review    2 adversarial reviewers with distinct lenses (design-system,
          a11y/domain). Tell them explicitly that ZERO findings is a valid result,
          and that every finding needs a concrete failure scenario.
Repair    ONE writer, same worktree. Tell it reviewers are sometimes wrong and to
          record its rejections with reasoning.
```

Round cadence: **2 worktrees at a time**, each on its own vite port. Merge each into an
integration branch, gate it, then cut the next round off the updated base so it can't inherit
stale shells.

## Hard constraints — every one of these cost something

**Destructive commands.** Never `pnpm db:seed` or `db:reset` (they TRUNCATE). Never `pnpm test`
from the repo root — `.env.test` points `DATABASE_URL` at the **dev** database and
`cleanupDatabase()` deletes `organizations`/`content`/`purchases` (bead `Codex-bsbf8`). The gate
is `pnpm --filter web test`. Put this in every subagent prompt; one agent was *instructed* to run
the full suite and only avoided wiping the DB by reading the config instead of obeying.

**Gate on what CI actually runs.** `pnpm build` + `pnpm --filter web test` is **not enough** —
neither typechecks. CI's `static-analysis` runs `pnpm check:ci`, both
`check:brand-boundary` gates, then `pnpm typecheck`. Four `ux-polish` push runs failed on
typecheck while my local gate was green. Run all four before pushing.

**i18n is single-owner per round.** Two worktrees regenerating `src/paraglide/` conflicts in a way
that strips keys → runtime 500s. Give one WP ownership of `messages/en.json`; the others report
keys for you to add. paraglide-js is **1.11.8 with NO plural support** — never ICU
`{count, plural, …}`; use a separate `_one` key plus a call-site ternary. Always confirm new keys
land in the **committed** `src/paraglide/messages/en.js` (force-tracked despite its directory
being gitignored) and that other branches' keys survived the recompile. Run a
called-vs-generated check — it caught a bug that both the build and 1661 tests passed, because
the calling code was unreachable with seed data.

**Contrast must be measured, twice.** Two "contrast fixes" this effort *lowered* contrast — one
across all six org × theme combos. Rules: measure before AND after in all six (3 orgs × 2
themes); use a canvas `fillStyle` + `getImageData` readback, because Chrome serialises
`color-mix()` as `oklab()` floats and a regex over `getComputedStyle` returns garbage ~1.0
ratios; resolve the **effective** background by walking ancestors until alpha > 250, because
`body` is transparent in this app; and check the **platform** path too if the component renders
outside `.org-layout` — a token that derives inside an org may be a hardcoded `#ffffff` at
`:root`.

**HTTP 200 is not "it works."** A filter returning 200 with zero results is broken. Assert
rendered output and persisted state.

**Dev servers.** One shared worker fleet from the main checkout (`pnpm dev`); each worktree runs
only the web app: `pnpm --filter web exec vite dev --port 30NN --strictPort`. `--strictPort` is
mandatory — without it vite silently auto-increments and squats a neighbour's port. Never let a
subagent run `pnpm dev`. Never kill a port belonging to a *running* workflow.

**Shared browser.** The chrome-devtools MCP browser is shared; agents measured each other's tabs
repeatedly. Each agent needs its own `isolatedContext` and must guard every `evaluate_script` on
`location.href`.

**e2e drift is the merge risk.** Before any PR to `dev`, audit all Playwright specs against the
diff — text locators especially, since changed i18n *values* break `getByRole(…, { name })`. A
static audit found **15 will-fail assertions** in one pass; the repo's own `apps/web/e2e/CLAUDE.md`
records that 12 of 22 commits in a prior PR were locator-drift fixes.

## Test data

| org | `creator@test.com` | `admin@test.com` |
|---|---|---|
| `studio-alpha` (#E11D48) | **owner** | admin |
| `studio-beta` (#2563EB) | **creator, NOT owner** | **owner** |
| `of-blood-and-bones` | — | owner is **`luzura@test.com`** |

Password `Test1234!`. Auth rate-limits at 5 logins / 15 min — cache Playwright `storageState`.
of-blood-and-bones is the fully-branded org (cream `#F6EFE6` light / `#200000` dark, Playfair,
token + dark overrides) and the only one with payout data. studio-alpha vs studio-beta is the
brand-neutrality pair. Currency is **GBP (£)**, never USD. No emoji in product UI.

## Open beads worth reading first

`Codex-bsbf8` (P1) test config can wipe dev data · `Codex-gvx03` (P1) raw Stripe error at source ·
`Codex-227yr` (P1) `ui/EmptyState` description fails AA and hardcodes `h3` · `Codex-dox8r` (P1)
server paginates payouts by a different unit than the page renders · `Codex-nx3g6` (P1)
`ui/Button` destructive/accent ink 3.77:1 · `Codex-gxe2p` (P1) `AudioWaveform`'s scoped rule beats
its consumer's `:global`, so audio cards paint across the whole cover · `Codex-rj4xm` (P1) ~320
raw status-palette consumers remain · `Codex-6rbbx` (P2) `studio/billing` copy still inline
English.

Also open and unaddressed: the `E2E Web Tests` CI job is **path-filtered and skipped on most dev
pushes**, which is how four stale assertions accumulated unnoticed. And `dev` is red on
`Ecom API Tests` — pre-existing, unrelated to this effort.

## How to start

Invoke the `design-system` skill first. Ask which surfaces to take, and ask design questions
before planning visual work rather than after. Two things I'd suggest: the shared-primitive beads
above (`EmptyState`, `Button`, `--color-text-muted`) are a natural **foundation round** because
several page rounds will otherwise route around them individually; and `content/[slug]` plus the
player is the largest untouched user-facing surface.
