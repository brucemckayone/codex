# Brand Editor Redesign — implementation handoff

> Zero-context continuation prompt for a **fresh session**. Paste the "Kickoff" block below into a new Claude Code session in this repo. Everything needed is already scoped, approved, and scaffolded.

## Kickoff (paste this)

> Run `codex-epic-implement` for epic **Codex-cijzb** ("Brand Editor Redesign — difficulty-dial workspace + token consumption"). The plan is approved at `~/.claude/plans/kind-painting-bird.md`; design research is in `docs/design/brand-editor-ux-investigation.md` + `docs/design/brand-editor-mockups.html` (view via LAN, never an artifact). Start Phase 0 — the two ready WPs `Codex-cijzb.1` (WP-0.1) and `Codex-cijzb.2` (WP-0.2). Base the epic branch `feat/Codex-cijzb-brand-editor-redesign` on **dev** (not main). Ship Phase 0 as its own PR, then Phase 1.

## State at handoff (2026-07-19)

- **Approved plan:** `~/.claude/plans/kind-painting-bird.md` (full context, data model, surfaces, WP table, verification).
- **Beads:** epic `Codex-cijzb` + 10 WPs scaffolded with the dep chain wired. `.beads/` compacted (223 MB → 111 MB). Run `bd ready` — only `cijzb.1` + `cijzb.2` are unblocked.
- **No code written yet.** This was scope + scaffold only.
- **No DB migration** — Phase 0/1 add no columns; persistence (branding_settings + tokenOverrides/darkTokenOverrides/darkModeOverrides JSON) is reused unchanged.

## WP map + dependency chain

| WP | Bead | Ready? | Depends on |
|---|---|---|---|
| 0.1 Fix `--color-heading` reach + token cleanup | `cijzb.1` | ✅ ready | — |
| 0.2 CI import-boundary guardrail | `cijzb.2` | ✅ ready | — |
| 1.1 `/studio/brand` route + state | `cijzb.3` | blocked | 0.2 |
| 1.2 CSP `frame-ancestors` relax (self) | `cijzb.4` | blocked | 1.1 |
| 1.3 iframe live-preview canvas | `cijzb.5` | blocked | 1.2 |
| 1.4 postMessage CSS-var bridge | `cijzb.6` | blocked | 1.3 |
| 1.5 Control rail (difficulty-dial spine) | `cijzb.7` | blocked | 1.1 |
| 1.6 Fold logo + hero-text into rail | `cijzb.8` | blocked | 1.5 |
| 1.7 Guided (+ brand-from-logo) | `cijzb.9` | blocked | 1.5 |
| 1.8 Verification | `cijzb.10` | blocked | 1.3–1.7 |

## Locked decisions (do not re-litigate)

- **One tool, difficulty dial:** Guided → Studio Canvas → per-component Inspector (**future, not this epic**).
- **Live preview = real org routes in an iframe** on `/studio/brand`; edits applied via a **postMessage CSS-var bridge** (inert unless embedded same-origin). **Zero editor code in the customer bundle** — enforced by WP-0.2's CI grep gate.
- **Full token-consumption pass**, but verified small: the ONLY genuine gap is `--color-heading` (a CSS **specificity** problem — class titles beat the `:is(h1..h6)` org-brand rule). Fix `.card-title` + `.cc__title` → `var(--color-heading, var(--color-text))`. Other knobs already wired; drop vestigial `--color-text-heading` + `--card-media-*`.
- **Old UI retired:** `?brandEditor` overlay removed; old `studio/settings/branding` 301s to `/studio/brand`; logo + hero-text fold into the rail.
- **Brand-from-logo** colour extraction is in Phase 1 (WP-1.7), client-side.
- **CSP:** `svelte.config.js` `frame-ancestors 'none' → 'self'` (WP-1.2, security-reviewed). Same-origin confirmed — public + studio both on `{slug}.revelations.studio`.
- **Brand editing stays admin/owner** (studio SPA admits creator+; add a page-level admin/owner guard on `/studio/brand`).

## Gotchas

- Base on **dev**, not main (main is a stale release pointer). `git fetch` + verify base before branching.
- Reuse existing components: OKLCH picker, `FontPicker`, `BrandSliderField`, `LogoUpload`, `palette-generator`, and the 12 existing presets — don't rebuild.
- Repo static analysis is **biome only** (no eslint/dep-cruiser); WP-0.2 is a CI grep step in `.github/workflows/static_analysis.yml`, not a lint rule.
- Serve any preview to the user over LAN (`python3 -m http.server --bind 0.0.0.0`), never publish an artifact.
