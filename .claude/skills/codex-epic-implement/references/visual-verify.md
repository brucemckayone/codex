# VISUAL-VERIFY checklist (stage 6, UI WPs only)

The absorbed `design-system` MCP gate. UI correctness is **verified by RUNNING tools**, not by reading
code. Load this before implementing UI (stage 3) and gate on it at stage 6. Harvested from the
`design-system` skill + the design feedback corpus.

## The MCP gate (run, don't eyeball)
1. **Svelte MCP `svelte-autofixer`** on every changed `.svelte` — re-run until it reports clean. It
   catches Svelte 5 reactivity mistakes, deprecated syntax, and a11y issues the eye misses.
2. **`chrome-devtools` / `playwright` MCP** — snapshot the changed surface and drive the key
   interaction (`feedback_thorough_verification`: every UI WP verified end-to-end before close).
3. **Build gate** — `pnpm turbo run build --filter=web` must pass: catches orphan tags, `vite-plugin-dts`
   errors, and Svelte reactivity warnings that `typecheck` does not.

## Token & CSS rules (no exceptions)
- [ ] **Design tokens only** — no hardcoded px/hex/rem; no Tailwind. CSS custom properties throughout (`feedback_no_hardcoded_css`).
- [ ] OKLCH for colour; scoped `<style>`; container queries for responsive (not viewport media where a container fits).
- [ ] Dark/branded orgs: `color-mix(brand, transparent)` veils go invisible on dark brands — use ShaderHero for promotional surfaces (`feedback_css_gradient_dark_brand`). Promo surfaces needing fixed white use `hsl(0 0% 100%)` literal + comment, NOT `--color-player-*` (org-overridable) (`feedback_player_tokens_for_dark_overlays`).

## Svelte 5 / Melt UI
- [ ] `$props()`/`$state()`/`$derived()`; `$app/state` not `$app/stores`; `page.url` not `$page.url` (`feedback_svelte5_state`).
- [ ] Melt UI Switch/Tabs/Popover handlers are **idempotent** — early-return when `next === current` (they fire `onXChange` during mount/sync) (`feedback_melt_controlled_components`).
- [ ] TanStack DB hydration: never `liveQuery.data ?? ssrData` for session-cached collections — use a `hasHydrated` flag gated on `onMount` (`feedback_uselivequery_empty_array_fallback`).

## i18n (the dual-file trap — high-cost, narrow)
- [ ] Adding/removing message keys updates BOTH `messages/<lang>.js` AND the barrel `messages.js`; a half-update crashes at runtime with `__vite_ssr_import.foo is not a function` (`feedback_paraglide_two_generated_files`).
- [ ] Never `git restore` a generated message file in isolation — strips ambient keys → runtime 500 typecheck won't catch (`feedback_shared_generated_source`).
- [ ] All user-facing text via `$t()`.

## Design taste (Codex house style)
- [ ] NO "magazine/editorial/FT/Larsana" framing — ground in the Codex design system + tokens (`feedback_no_magazine_framing`).
- [ ] ContentCard: neutral palette, no per-type accent colours/coloured pills — aspect ratio + section layout carry the type signal (`feedback_neutral_card_palette`, `feedback_cards_look_like_their_type`).
- [ ] Sidebar/list cards transparent until hover; only hero/featured cards earn persistent chrome (`feedback_cards_transparent_by_default`).
- [ ] Layouts = positioning only — never hide elements; per-element visibility toggles (`feedback_hero_layout_design`).
- [ ] Hover is not a user gesture — no unmuted autoplay on hover; explicit click + mute-toggle (`feedback_hover_is_not_a_gesture`).

## a11y baseline
- [ ] Keyboard reachable; focus-visible; roles/labels; colour-contrast holds on branded palettes.
