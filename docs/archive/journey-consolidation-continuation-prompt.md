# Continuation — finish the journey-sections consolidation

Paste this whole file as the first message of a fresh session.

**Not in scope: the local transcoding dispatch.** Another agent owns that. If you
hit it, leave it and say so. Its handover is `docs/transcoding-local-dev-handover.md`
— read only if something you need blocks on it.

---

## Where you are

**Worktree:** `/Users/brucemckay/development/Codex-js-foundation`
**Branch:** `feat/journey-builder-unification` — **5 commits, UNPUSHED, no upstream**
**Base:** `dev@6c86d756` (verify with `git fetch origin dev`; if `dev` moved, merge or
rebase and re-run the gate before pushing)

**Re-read the tip before doing anything:** `git log --oneline -1`. Naming a stale tip
in a handover has bitten this programme repeatedly.

```
b5cf1da1 docs(transcoding): handover for the local dispatch investigation
3d4e10bf fix(journeys): the invite offers one dashboard link to a member, not four prices
70b6ab3e feat(builder): the generic array control — repeater, list, number and toggle
314c704e fix(journeys): the canvas applies the page's brand overrides too, scoped off the chrome
b1eeb659 feat(journeys): the builder canvas renders the real sections, axes and all
```

The dev fleet runs from this worktree (`lvh.me:3000` + nine worker ports, one
`turbo run dev` process tree). **Leave it up** — killing the web vite takes the whole
fleet. Do not `pnpm dev` anywhere else.

### What already shipped

PR **#446** merged to `dev` — 11 section types on nine design axes, 62 compositions,
six migrations, three P1s closed.

Then, on this branch:

- **The builder canvas renders the public components.** `render/SectionFrame.svelte`
  is new: one section's wrapper + component invocation, mounted by BOTH
  `SectionRenderer` (which keeps the array-level loop) and the studio canvas (which
  keeps its own loop because it interleaves per-block editing chrome). It resolves
  `variant` and `design` itself, so the two surfaces cannot resolve differently.
- **`render/builder-context.ts`** maps the admin curriculum + page draft to the
  `JourneySalesContext` the public sections expect.
- **Motion is gated** under `editable` via `RevealOptions.disabled`, threaded at all
  15 `use:reveal` call sites.
- **Brand overrides reach the canvas**, on a per-section `display: contents` wrapper
  rather than `.jbc-page` — see the trap below.
- **The generic array control** (`ArrayField.svelte`) — `list`, `repeater`, `number`
  and `toggle` all author now.

Measured in a browser on `studio-alpha/bone-deep`: 9/9 sections carry all nine
`data-jp-*` axes (was 0), 8 distinct compositions resolve (hero alone was 2), `--jp-*`
properties resolve to real values, 44 contenteditable fields, 0 elements stuck armed.

---

## Task 1 — decide: push now, or finish the deletion first

5 commits sit local. The gate is green. Nothing has been pushed and no PR exists.

Ask the repo owner which they want. Base any PR on **`dev`, never `main`** and check
the base on the created PR rather than trusting the default (`gh pr create --base dev`).
Prefer a **merge commit over a squash** — the commit messages carry which measurement
justified each change.

CI notes, both previously mistaken for failures:
- The workflow runs twice (push + pull_request). **Trust the `pull_request` run.** The
  push run gets **cancelled** by concurrency, and `gh pr checks` displays `cancelled`
  in its `fail` bucket. A `0s` duration next to `fail` is the tell — confirm with
  `gh run view <id> --json jobs`.
- **`Ecom API Tests` fails, and it is not yours.** `Codex-4y8pt` (P1, open) — `dev`
  has been red on it since 2026-07-31 with a byte-identical profile (223 mock errors,
  80 failed tests). `vi.mock('@codex/subscription')` omits `CourseSubscriptionService`
  in the three `workers/ecom-api/src/handlers/__tests__/subscription-webhook*` files.

---

## Task 2 — delete `render-edit/` (the real remaining work)

**24 files, 1,942 lines, and nothing mounts it.** Verified: every remaining reference
to `render-edit` in `apps/web/src` is a comment or internal to the directory itself.

This was scoped as a tidy-up and is not one. Three things block it:

1. **The axis-contract tests assert over its CSS.** `journey-design.test.ts` checks all
   39 axis values against `render-edit/journey-sections.css` and its
   `journey-sections/_*.css` partials; `journey-palette.test.ts` asserts their
   `@import` ordering and that the `--jp-*` ladder is not restated there
   (`SECTIONS_CSS` at `journey-palette.test.ts:59`). Those guards encode the axis
   contract. **Rewriting them casually is how a meaningful guard turns vacuous** — the
   substrate they should now assert over is `journey-design.css` +
   `journey-sections-shared.css`, which `SectionFrame` imports.
2. **`canvas-public-parity.svelte.test.ts` imports from `render-edit`** (`CANVAS_COMPONENTS`
   and a registry-coverage case). Its premise is two trees. One characterisation case
   was already inverted this session; the rest needs re-pointing.
3. **Eight public sections carry provenance comments** naming
   `render-edit/journey-sections/_*.css` ("ported from", contract A12) — in
   `IntroVideoSection`, `FeelSection`, `InviteSection`, `GuideSection` and others.
   Update them in the same commit. Comments that point at deleted files are the exact
   drift fingerprint this programme keeps hitting; `render-edit`'s own two registries
   each described the OTHER module before this work started.

`Codex-eqcpz` ("7 of 16 builder-canvas variant modifier rules are dead at runtime") is
**superseded, not fixed** — with the canvas on the public tree, all 16 are dead and the
file goes. Close it against the deletion rather than fixing it.

---

## Task 3 — the beads board is out of sync with the code

All still `open` though the code has moved:

| bead | reality |
|---|---|
| `Codex-28ifd` P1 | **closed in substance** by `70b6ab3e` — all four control kinds build and author. Verify then close. |
| `Codex-6nrsk` P2 | **closed in substance** by `b1eeb659` + `314c704e` — the canvas emits all nine axes AND applies brand overrides. Verify then close. |
| `Codex-eqcpz` P2 | superseded by Task 2. |
| `Codex-eckbx` P2 | **its plan is stale and actively misleading.** The 2026-07-27 comment lays out W1–W8; W1–W4 are substantially built. A reader who trusts it will re-scope eight work items for roughly one. Update the comment before anyone picks it up. |

Do not close anything without reading the code — closed beads whose titles claim an
implementation have proven unreliable in this repo.

Still genuinely open and untouched: `Codex-9tze8` (Candlelit needs a per-type override
map, A51), `Codex-kdsuo` (journey primary CTA sits 0.16–0.20 above the AA floor),
`Codex-3kqqp` (add a test forbidding CSS math / list-composition on any axis token that
can resolve to a keyword — closely related to the `--jp-edge-width` class already fixed).

---

## Task 4 — the deferred decision: 11 types or 8

`Codex-eckbx`'s audit proposes collapsing the catalogue **11 → 8**
(`hero · prose · media · curriculum · proof · guide · faq · invite`), promoting
ache/turn/feel/reel's hard-coded layouts to selectable variants. PR #446 went the other
way and built out all 11 with 62 compositions.

**The repo owner explicitly deferred this** (asked for "unify the contract only,
W1–W3"). Do not start it unprompted. It carries a jsonb migration over published pages
plus an explicit-`anchor` change (W5), because DOM ids currently derive from `type` and
any collapse breaks bookmarked `#<type>` anchors.

---

## Task 5 — housekeeping

- Sibling worktrees `Codex-js-video` (`feat/journey-sections-video`) and
  `Codex-js-guide` (`feat/journey-sections-guide`) are merged and finished — removable
  with `git worktree remove` plus their branches. **Do NOT remove
  `Codex-js-foundation`** — the shared fleet runs from it.
- One dev-data oddity worth a look, not yet filed: **101 `media_items` rows sit at
  status `uploading`** and 2 at `uploaded`, all from 2026-07-27. Probably stale test
  data; confirm before touching, and note the transcoder agent may care.

---

## The gate

From the worktree root. All four must be green before any push.

```bash
pnpm check:ci
pnpm --filter web check:brand-boundary && pnpm --filter web check:brand-boundary:test
pnpm typecheck --force
pnpm --filter web test
```

Expected, measured at `b5cf1da1`:

| gate | expect |
|---|---|
| `check:ci` | **0 errors**, 179 warnings, 5 infos (1441 files) |
| both brand-boundary | **0** / **0** (222 public files, 11 node-test pass) |
| `pnpm typecheck --force` | **0** — 57/57 tasks, **0 cached** |
| `pnpm --filter web test` | **0** — **175/175 files** |
| `svelte-check --threshold error` | exit 1, **exactly 65 errors, 0 in journey code** — `dev`'s pre-existing baseline, NOT a regression. Do not "fix" it. |

- **`--force` is not optional.** A cached `FULL TURBO` is not a gate that ran — confirm
  `0 cached`.
- **Capture the real exit code.** `$?` after a pipe to `tail` measures `tail`. Redirect
  to a file and read `$?` on the next line.
- **`check:ci` reports biome FORMAT diffs as errors, not warnings.** Two commits this
  session tripped it. Run `pnpm exec biome check --write <changed files>` before
  committing; a pre-commit hook also applies it, so re-verify after.

---

## Traps, all paid for once already

**Never a bare `pnpm test` from the repo root.** `.env.test` points `DATABASE_URL` at
the **dev** database and `cleanupDatabase()` deletes real rows. The gate is
`pnpm --filter web test`.

**Never `pnpm db:seed` or `pnpm db:reset`** — they TRUNCATE. Local migration is
`pnpm db:local:gen` / `pnpm db:local:migrate`. Note CLAUDE.md names a root
`pnpm db:migrate` that does not exist.

**Page brand overrides must not land on `.jbc-page`.** `tokenOverridesToCssVars` maps
any non-`--brand-` key to `--color-<key>`, so a page's overrides can re-point
`--color-surface*` / `--color-border*` — the tokens the in-canvas block tags and
selection toolbar read. That is why the canvas takes the base `journey-palette` class
and not `--page`, and why the brand declaration sits on a per-section
`display: contents` wrapper with the chrome as its sibling. Verified: 9 wrappers, zero
chrome inside any of them.

**Whatever emits `data-jp-*` must import the axis substrate.** Mid-session the markup
moved to `SectionFrame` while the CSS imports stayed on `SectionRenderer` — the canvas
would have got attributes with no rules. `journey-palette.test.ts` now guards the
RELATIONSHIP (derives the emitter from its markup) rather than a filename.

**`svelte-check` and `tsc` disagree.** A `<script module>` type export passes
svelte-check and fails `tsc` with TS2614 — co-locate such types in a `.ts`.

**`apps/web` has `strictNullChecks` OFF.** Boolean-literal discriminants do not narrow;
use string discriminants.

**Two vite instances cause phantom test timeouts.** An unrelated project
(`abg-app/studio`, port 5273) may be running. If a suite you did not touch times out,
re-run that file in isolation before believing it.

**Zsh, not bash.** Unquoted globs in `--include=*.css` get expanded by the shell —
quote them.

**Concurrency:** `turbo` runs with concurrency 1 against the shared local Neon because
`cleanupDatabase()` wipes across packages.

---

## Reference

- Programme spec: `docs/design/journey-sections/` — start `README.md`, then
  `CONTINUE-consolidation.md`. **`02-axis-contract.md` is BINDING.**
- Contrast baseline: `docs/design/journey-sections/04-contrast-baseline.md` (12
  combinations, zero failures).
- Builder audit + the unify verdict: `docs/audits/journeys-2026-07/builder-and-components.md` §A.
- Test credentials: `creator@test.com` / `Test1234!` — owns `studio-alpha`.
  `of-blood-and-bones` is owned by `luzura@test.com` (password unknown), which blocks
  browser checks on the only page that has brand overrides stored.
- Builder canvas URL: `http://studio-alpha.lvh.me:3000/studio/journeys/4664e6ce-8285-4e69-9034-ba81189fce12/page`
  (that id is the **landing page** id, not the course id — the route takes the page).
- Public page: `http://studio-alpha.lvh.me:3000/journeys/bone-deep`
