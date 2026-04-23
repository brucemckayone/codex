# Brand Editor Fix Implementation — Summary

**Session**: 2026-04-23
**Scope**: 10 bugs closed across 9 commits (1 P0 + 9 P1).
**Bead label**: `ds-review-iter-0{18,19,20,21,22,23,24,25}`.

This doc is the landing page for every bug the loop-driven investigation
fixed in one session. Each entry links to its commit, patch spec (where
written), root cause, fix, and tests. For the full investigation arc
(how the bugs were discovered), see `README.md` §6 iteration log.

---

## Headline

The user reported two bugs:

1. *"Font families are not saved. They're only there when editing; reload loses them."* — fixed by **`Codex-ja9zp` + `Codex-7afgp`** (commit `0a29dc7e`).
2. *"Two places can toggle light/dark; they're not synced."* — fixed by **`Codex-9u8wg` + `Codex-z91af` + `Codex-micw3`** (commits `b5d43243` + `de1907ad`).

While tracing those, the loop surfaced 5 additional bugs including a **P0 stored XSS** (`Codex-06ygy`), silent data loss on every preset click (`Codex-oqv3r`), a dark-mode feature that never worked for visitors (`Codex-lqvyy`), a dead Remove button (`Codex-ne00j`), and an intro-video race (`Codex-631mn`). All 10 are closed as of commit `5548e091`.

---

## Per-Bug Reference

### `Codex-06ygy` — P0 SVG XSS in logo upload

**Commit**: `cbd7dbf8` · **Patch spec**: [`06ygy-patch.md`](./06ygy-patch.md) · **Bead**: [`Codex-06ygy`](# "closed")

Logo upload path wrote raw SVG buffers to R2 with 1-year `Cache-Control`, violating `packages/image-processing/CLAUDE.md:64` ("MUST sanitize ALL SVG uploads with `sanitizeSvgContent()` — unsanitized SVGs are XSS vectors"). The JSDoc on `uploadLogo` claimed sanitization was handled upstream by `validateLogoUpload()`, but that function had zero callers anywhere in the repo.

**Fix** (`packages/platform-settings/src/services/branding-settings-service.ts`):
- Call `sanitizeSvgContent()` inside `uploadLogo` for `image/svg+xml` MIME types before `r2.put`.
- Split `Cache-Control` by MIME: SVG gets 1 hour (fixed filename means updates must propagate), raster keeps 1 year.
- Update JSDoc to reflect actual invariants.

**Tests** (5 added — `feedback_security_deep_test.md` required positive + negative paths): `<script>` stripped; on-* event handler attributes stripped; legitimate SVG content preserved; 1-hour cache-control for SVG; 1-year regression guard for raster.

**Isolation verified**: Agent P (iter-025) audited all upload endpoints. Only logo accepts SVG — `SUPPORTED_IMAGE_MIME_TYPES` at `packages/validation/src/image.ts:20-25` excludes SVG; only `ALLOWED_LOGO_MIME_TYPES` opts in. Single-endpoint fix; no sibling P0s.

---

### `Codex-lqvyy` — P1 darkModeOverrides never rendered for non-editor visitors

**Commit**: `af423e86` · **Patch spec**: [`lqvyy-patch.md`](./lqvyy-patch.md) · **Bead**: [`Codex-lqvyy`](# "closed")

Half-shipped feature. Orgs that set dark-mode color overrides saw them in the editor preview (via `injectBrandVars` `$effect`) but **regular visitors reloading in dark mode saw the LIGHT palette**. The SSR render path in `+layout.svelte` had no `$derived` parse of `data.org.brandFineTune.darkModeOverrides` and no `style:--brand-*-dark` bindings. CSS fallback chain (`var(--brand-color-dark, var(--brand-color, ...))`) silently fell back to the light value.

**Fix**:
- New pure-function parser `apps/web/src/lib/brand-editor/parse-dark-overrides.ts` (+6 tests) handling null/undefined/malformed JSON safely.
- Export from `$lib/brand-editor` barrel.
- `+layout.svelte` adds one `$derived` call + 4 per-field `$derived` + 4 `style:--brand-*-dark` bindings on `.org-layout`.

**Why it works SSR**: `$derived` runs in the server render pass — dark colors arrive in the initial HTML, no FOUC.

---

### `Codex-oqv3r` — P1 applyPreset wipes user fine-tunes

**Commit**: `f69d5534` · **Bead**: [`Codex-oqv3r`](# "closed")

Silent data loss on every preset click. `brand-editor-store.svelte.ts:210-214` wholesale-replaced `state.pending.tokenOverrides` with the preset's subset. No preset sets `shadow-scale`, `body-weight`, `hero-hide-*`, `surface-*`, `interactive-*`, `focus-*`, etc. — 30+ keys that users configure through fine-tune panels. Every preset application silently deleted all of them.

**Fix** (single spread change):
```ts
// Before
state.pending.tokenOverrides = preset.tokenOverrides
  ? { ...preset.tokenOverrides }
  : {};

// After — merge; preset keys win on conflict, user fine-tunes preserved
state.pending.tokenOverrides = {
  ...(state.pending.tokenOverrides ?? {}),
  ...(preset.tokenOverrides ?? {}),
};
```

**Pattern**: general-purpose anti-pattern flagged in iter-020 — any `Record<string, unknown>` that's replaced wholesale from a subset source is almost always wrong. Candidate for skill R15 (tracked in `Codex-v4wao`).

---

### `Codex-9u8wg` + `Codex-z91af` — P1 editor theme preview leaks global `<html data-theme>`

**Commit**: `b5d43243` (paired) · **Beads**: [`Codex-9u8wg`](# "closed"), [`Codex-z91af`](# "closed")

Root of the user's "light/dark sync" complaint. The editor's Light/Dark toggle called `setThemePreview()` which wrote `document.documentElement.setAttribute('data-theme', …)` — the SAME attribute `theme.ts` owns for persisted user preference. Clicking the editor toggle leaked "dark preview" into a state meant to track "user wants dark globally":

1. Sidebar `ThemeToggle` icon went stale (its local `$state` didn't update).
2. User clicked sidebar toggle to fix the icon → that path DID persist (localStorage + cookie) with the preview value.
3. Editor session ended → `close()` restored captured `originalTheme` to `<html>`, DOM now disagreed with localStorage.
4. Next reload → cookie wins, user flashed to a theme they didn't pick.

**Fix**:
- `setThemePreview` now scopes to `.org-layout[data-editing-theme]` via a **different attribute name**. `<html data-theme>` is untouched.
- `org-brand.css` gets parallel selectors: `[data-editing-theme='dark'][data-org-brand]` alongside existing `[data-theme='dark'] [data-org-brand]` (and same for `data-org-bg`).
- `close()` drops the `data-editing-theme` attribute. The `originalTheme` capture/restore dance is dead code — removed.
- `open()` seeds `editingTheme` from current `<html data-theme>` so editor opens viewing the palette the user is actually in.

z91af closed automatically: with 9u8wg landed, there's nothing for `close()` to restore.

---

### `Codex-micw3` — P1 ThemeToggle has no reactive subscription

**Commit**: `de1907ad` (rename + store) · **Bead**: [`Codex-micw3`](# "closed")

Defense-in-depth. `ThemeToggle.svelte` had local `$state<Theme>('light')` initialised once in `onMount`, mutated only by its own `handleToggle`. Every sibling instance (sidebar, studio sidebar, mobile nav, mobile bottom sheet — 4 concurrent mount points) tracked theme independently. Clicking one did NOT update the others' icons.

**Fix**:
- Renamed `apps/web/src/lib/theme.ts` → `theme.svelte.ts` (required for runes in a `.ts` module).
- Added module-level `themeState = $state({ theme: Theme })` as the single reactive source of truth.
- `setTheme` atomically updates DOM attr + classList + localStorage + cookie AND `themeState.theme`.
- `ThemeToggle.svelte` consumes via `$derived(themeState.theme)` — every instance auto-updates when any one fires `toggleTheme`.

Only one consumer of `$lib/theme` existed, so the rename was low-blast-radius.

---

### `Codex-ne00j` — P1 dead Logo Remove button

**Commit**: `de1907ad` · **Bead**: [`Codex-ne00j`](# "closed")

Remove button only cleared editor-side preview state (`brandEditor.updateField('logoUrl', null)`) — the DB was never touched. `updateBrandingCommand`'s Zod schema has no `logoUrl` field (grep confirmed zero matches), so Save omitted it. Next reload showed the "removed" logo again.

**Fix** (`apps/web/src/lib/components/brand-editor/levels/BrandEditorLogo.svelte`):
- Wire the Remove button through the existing `deleteLogo` remote command (which hits `DELETE /branding/logo`, hard-deletes R2 object, clears DB column).
- Await the server delete BEFORE mutating editor state.
- Show inline error if the delete fails; loading state while in-flight.

---

### `Codex-ja9zp` + `Codex-7afgp` — P1 font/color persistence race

**Commit**: `0a29dc7e` (paired) · **Beads**: [`Codex-ja9zp`](# "closed"), [`Codex-7afgp`](# "closed")

Root cause of the user's font-persistence complaint.

**ja9zp** (worker): `invalidateBrandAndCache()` in `workers/organization-api/src/routes/settings.ts:166` ran all three invalidations inside `waitUntil(Promise.all([...]))`:
1. `updateBrandCache(BRAND_KV brand:{slug})`
2. `CACHE_KV` orgId version bump
3. `CACHE_KV` slug version bump (after DB lookup)

HTTP 200 returned before these completed. Clients reloading within the ~50–200ms race hit the stale slug-keyed CACHE_KV entry — which is the one `/public/:slug/info` reads. Fonts (and every other branding field) appeared to revert.

**Fix**: promote the slug invalidation out of `waitUntil` — `await` it inline. BRAND_KV warm + orgId-version bump stay fire-and-forget. All 5 call sites in `settings.ts` updated to `await invalidateBrandAndCache(...)`. Cost: +5–50ms on branding writes (one DB + one KV), acceptable for correctness.

**7afgp** (client): After `updateBrandingCommand` resolved, `BrandEditorMount.svelte` never told SvelteKit the org layout data was stale. The layout registers `depends('cache:org-versions')` but nobody invalidated that key. Users had to manually reload.

**Fix**: call `invalidate('cache:org-versions')` from `$app/navigation` after save succeeds. Wrapped in `.catch()` — the save is already committed, so if the invalidation fails the worst case is pre-fix behaviour (manual reload).

**Why paired**: either alone is insufficient. ja9zp alone → KV fresh but layout doesn't re-run. 7afgp alone → layout re-runs but re-fetches from potentially-stale KV. Together → invalidation sync, client triggers re-run, re-run reads fresh data, user sees new branding immediately.

---

### `Codex-631mn` — P1 intro video invisible until cache flush

**Commit**: `5548e091` · **Bead**: [`Codex-631mn`](# "closed")

After uploading an intro video, `linkIntroVideo` wrote `introVideoMediaItemId` but left `introVideoUrl` null (media wasn't `ready` yet). The lazy auto-finalize lived inside `getIntroVideoStatus()` — but only the editor polls that endpoint. If the user closed the editor before transcoding completed, no one polled, `introVideoUrl` stayed null, the intro-video button was absent on all future page loads.

**Fix** (`packages/platform-settings/src/services/branding-settings-service.ts`):
- Extract the auto-finalize logic into a private `maybeHealIntroVideoUrl()` helper.
- Call it from `get()` ONLY when the healing condition is met (`mediaItemId` linked AND `introVideoUrl` null).
- Zero cost in the happy path; orgs without intro video OR with a resolved URL never hit the helper.

**Trade-off**: Option A (webhook-driven finalize) would be architecturally cleaner but requires threading media-id → org relationship through the RunPod webhook, which doesn't currently exist. Self-healing on read covers the bug without new reverse-lookup infrastructure. Option A remains valid as a future proactive layer.

---

## Cross-Cutting Patterns

### "JSDoc is not a contract"

`Codex-06ygy` was caused by a JSDoc claim — "validation handled by `validateLogoUpload()` before calling this method" — that no code actually implemented. `validateLogoUpload` had zero callers. Zero callers. The JSDoc was aspirational; the code shipped the XSS vector.

**Rule for future**: security-critical upstream assumptions must be enforced at the consumer (or via branded types that carry proof of validation), not documented in prose. See `Codex-7m2kd` for the proposed skill rule R15.

### "`$derived` runs in SSR; `$effect` does not"

`Codex-lqvyy`'s fix and `Codex-wcwpw`'s scope refinement both hinge on this. Values needed for first paint MUST come from `$derived` (or `$derived.by()`), not `$effect`. iter-023 Agent K's proposed skill rule: *"if `org-brand.css` reads it, `+layout.svelte` must bind it via `style:` — not via an `$effect`-based injection"*. Tracked in `Codex-688ax`.

### "Partial Record update should merge, not replace"

`Codex-oqv3r`'s fix is four characters (`...obj, `). The bug was caused by treating a preset's subset of keys as if it expressed the full valid state. The safe default for Record merging when the source is a partial subset: `{ ...existing, ...incoming }`. Tracked in `Codex-v4wao`.

### "Multiple concurrent instances need shared reactive source"

`Codex-micw3`'s fix generalises: any component rendered multiple times concurrently (ThemeToggle in 4 mount points) must read from a shared reactive source, not local init-once state. The rune store at `theme.svelte.ts` is the canonical pattern.

### "Fire-and-forget `waitUntil` is a race when the producer also reads the same cache"

`Codex-ja9zp` proved this costs user-visible correctness. Rule of thumb: invalidations of caches on the reload-critical path should be AWAITED, not `waitUntil`'d. `Codex-uw05n` (logo upload shares the same pattern) is now unblocked by this fix's pattern — the same refactor would close it.

---

## Verification Playbook

Manual smoke test for each closed bug (run after merging):

| Bug | Steps to verify |
|---|---|
| `06ygy` | Upload an SVG logo with `<script>alert(1)</script>` — assert stored R2 response has no `<script>`. |
| `lqvyy` | Set a dark primaryColor override in brand editor. Close editor. Open fresh tab in dark mode at the org subdomain. Assert primary color matches override (not the light value). |
| `oqv3r` | Set fine-tune heading-color to a distinctive value. Apply any preset. Assert heading-color survives. |
| `9u8wg` + `z91af` | Open brand editor in light mode. Toggle editor to Dark preview. Click sidebar ThemeToggle. Close editor. Assert: localStorage theme = whatever sidebar chose; DOM `<html data-theme>` matches; no flash of wrong theme on reload. |
| `micw3` | Render a page with multiple ThemeToggle instances (e.g. sidebar + mobile nav in dev tools mobile view). Click one. Assert all icons update in sync. |
| `ne00j` | Upload a logo. Click Remove. Save. Reload. Assert logo is absent. |
| `ja9zp` + `7afgp` | Open brand editor. Change font family. Save. Do NOT reload manually. Assert the new font is visible within ~200ms of save completing. |
| `631mn` | Upload intro video. Close editor before transcoding completes. After ~3 minutes, reload the org landing page. Assert the intro video button appears. |

---

## What's Still Open (follow-up work)

**P2** — worth landing but not urgent:
- `Codex-57d8a` — SidebarRail logo placeholder (blank gap when `logoUrl` null)
- `Codex-uw05n` — Logo upload cache race (now unblocked by ja9zp pattern; same fix shape)
- `Codex-wcwpw` — tokenOverrides FOUC (shader/hero keys arrive post-hydration); scope refined per `Codex-peqvl` — it's now just shader + CSS-var keys, not hero-hide
- `Codex-mdg94` — Fine-tune panel audit (confirm values route to tokenOverrides)
- `Codex-g49b4` — 6 write-orphaned DB columns (textColorHex etc.); data migration + column drop
- `Codex-wwedk` — FEATURE: per-theme shader + full tokenOverrides (design doc written at [`per-theme-tokens-design.md`](./per-theme-tokens-design.md), recommends Option B parallel column)

**P3** — skill patches + nitpicks:
- `Codex-v4wao` — R15 "partial Record update" anti-pattern in reference 10
- `Codex-7m2kd` — R15 "SVG upload sanitization" anti-pattern in reference 10
- `Codex-688ax` — "`style:` binding required for every `--brand-*` token" cross-reference rule
- `Codex-ac2o8` — Minimal presets should explicitly set `shader-preset: 'none'`
- `Codex-9225y` — Correct `token-registry.json` (6 tokens misclassified as zero-consumer)
- `Codex-peqvl` — Refine `Codex-wcwpw` description (hero-hide-* is SSR-rendered, not FOUC)
- `Codex-rwci4` — `injectBrandVars` writes useless `--color-hero-hide-*` (preview-session noise)
- `Codex-dnjrn` — Onyx preset coherence (Luxury with 1.01 hover + 0.7 iridescence)
- `Codex-mo3ib` — Deleted intro video HLS never cleaned from R2
- `Codex-fopbo` — `BRAND_KV` vs `CACHE_KV` consolidation audit
- `Codex-ag8l8` — Font CSS value format inconsistency (live preview vs SSR)
- `Codex-zv85e` — Draft `11-theming.md` + `11-multi-tenancy.md` skill references

---

## Session Arc

- **Investigation phase** (iter-018 → iter-025): 8 loop iterations, 13 agents (11 sonnet + 2 haiku), ~1.3M tokens. Produced the pipeline README, token registry JSON (168 tokens), per-theme design doc, lqvyy patch spec, 06ygy patch spec, and 8 iteration audits.
- **Implementation phase**: 9 commits landed 10 bugs. Test coverage scaled with risk (5 security tests, 6 parser tests, zero for the one-line preset fix).
- **Cron**: `470ab382` (session-scoped, 20-min recurring) stopped before implementation to prevent agent drift mid-patch.

Full arc documented in `README.md` iteration log (§6).
