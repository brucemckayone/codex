---
name: design-system
description: >
  Design tokens, CSS architecture, Svelte 5 component patterns, Disney-principled
  motion, accessibility, performance, icons, testing, and brand-editor integration
  for the Codex SvelteKit app. Use whenever you create or modify UI, styles, tokens,
  animation, or visual primitives — or when extending the brand editor. Covers:
  @layer/@property/container queries/OKLCH/view transitions, Melt UI wrapping,
  composition-first component design, and a mandatory MCP verification gate before
  closing any visual work.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# Design System — Codex Platform

Master skill for every UI change in `apps/web/`. It encodes the established patterns so they
do not have to be re-explained on every task — tokens, components, motion, CSS architecture,
a11y, performance, icons, testing, MCP verification, and the full brand-editor chain.

The skill is **modular**: this entry point routes to the right reference. Open only what you need.

---

## 0. MCP Gate (read first, enforce always)

Before writing any Svelte/CSS code or closing any design-system task, four MCPs MUST be
available. If any is missing, **STOP** and tell the user — do not proceed with guessed
behaviour.

| MCP | Required for |
|---|---|
| `svelte` | Every `.svelte` change — `svelte-autofixer`, `get-documentation`, `list-sections` |
| `context7` | Every library/API question (Melt UI, SvelteKit, CSS Baseline status, PostCSS, Vitest, Playwright) |
| `chrome-devtools` | Every visual change — snapshot, screenshot, `lighthouse_audit`, console messages |
| `playwright` | Every user-facing interaction change — `browser_navigate`, `browser_snapshot`, screenshots |

See `references/09-mcp-verification.md` for the full pre-close workflow and the
change-type → MCP matrix.

---

## 1. When This Skill Applies

Open this skill when any of these are true:

- Creating or editing a Svelte component under `apps/web/src/lib/components/`
- Adding or changing a design token under `apps/web/src/lib/styles/tokens/` or `lib/theme/`
- Writing or modifying CSS (scoped, global, utility, or theme)
- Adding animation, transition, `@keyframes`, or a view transition
- Touching anything under `apps/web/src/lib/brand-editor/` or `_org/[slug]/+layout.svelte`
- Adding/using an icon, or changing `lib/components/ui/Icon/`
- Writing a component test, visual regression, or axe check
- Extending the brand editor (new token, hero layout, visibility flag, DB column)

If your change is purely backend (services, workers, endpoints, DB), load `/backend-dev` instead.
If you are wiring a TanStack DB collection, load `/tanstack-db`. If caching is the primary
concern, load `/caching`.

### Out of scope for `/design-system`

| Surface | Route to |
|---|---|
| GLSL source strings (`lib/components/ui/ShaderHero/shaders/*.ts`, any `.frag.ts`/`.vert.ts`) | `/shader-preset-pipeline` |
| Service-layer logic, Cloudflare Workers, Stripe, webhooks | `/backend-dev` |
| TanStack DB collections, live queries, hydration | `/tanstack-db` |
| Server-side KV caching, HTTP cache headers, localStorage invalidation | `/caching` |

If a file in your review batch has no Svelte / CSS / DOM surface (pure WebGL plumbing,
GLSL strings, worker-only code), flag the misroute and skip it — this skill covers the
rendered web surface, not the pipelines behind it.

---

## 2. Hard Rules (Non-Negotiable)

These rules are enforced across every visual layer. Each has a dedicated reference; internalise
these first.

| Rule | Why | Reference |
|---|---|---|
| Never hardcode values that a token exists for — colors, spacing, radius, shadows, durations, z-index | Single source of truth; org branding depends on it | `01-tokens.md` |
| Svelte 5 runes only — `$props()` with `interface Props`, no `export let` | Codebase is Svelte 5.55 end-to-end | `03-components.md` |
| Composition first — wrap base components (Button, Input, Dialog); variants (`data-variant`) for visual tweaks only | Avoids duplicating behaviour; keeps tree-shaking clean | `03-components.md` |
| Melt UI for behaviour primitives (dialog, dropdown, tabs, accordion, tooltip, popover) | Already wrapped; a11y + keyboard handling for free | `03-components.md` |
| Scoped `<style>` with BEM-ish names + `data-*` variant attributes — never class concatenation | Consistent selector shape; Melt UI `[data-state]` friendly | `03-components.md` |
| `prefers-reduced-motion` is inviolable — never hardcode duration/ease, always use motion tokens | `motion.css` collapses durations to 0.01ms on reduce; bypass = a11y regression | `04-motion.md` |
| No `<svg>` inline inside components — use `Icon/*Icon.svelte` via the `IconBase` wrapper | Every icon-only button needs `aria-label`; inline drifts | `07-icons.md` |
| Propose Baseline-Widely upgrades in PR; never silently migrate one file | `@layer`, `@property`, `light-dark()` adoption is all-or-nothing per repo | `02-css-architecture.md` |
| Run `svelte-autofixer` (Svelte MCP) on every modified `.svelte` before closing | Catches rune misuse that typecheck misses | `09-mcp-verification.md` |
| Extend before creating new components | New primitive only when existing + variants + props genuinely cannot express the need | `03-components.md` |
| Use `@custom-media` breakpoint tokens — `@media (--breakpoint-md)`, `@media (--below-md)` | postcss-custom-media expands at build; single source of truth | `02-css-architecture.md` |
| **R12**: System-scope components (brand editor panel, settings drawers, auth pages, `+error.svelte`, any component that may render OUTSIDE `.org-layout`) MUST NOT consume `[data-org-brand]`-scope-only tokens — `--space-1-5`, `--space-2-5`, `--space-3-5`, any `--brand-*` token without a `:root` fallback | Caught in iter-01, iter-03, iter-04, iter-06 — the single most recurrent bug class; tokens resolve to `unset` outside the ancestor, silently breaking layout | `01-tokens.md` "Spacing scope cheat-sheet" |
| **R13**: Components that forward an optional `class` prop to a root element MUST use `{className ?? ''}` (or equivalent guard) — passing `{className}` alone stringifies `undefined` into the DOM `class` attribute when the prop is omitted. **Inverse (iter-08)**: if a composed primitive does NOT expose a `class` prop, that's a composition seam — either add one (preferred) or leave a comment explaining why callers can't style it. Silent omission blocks layout / variant adjustments from the call site | Silent DOM pollution + missing composition seams; surfaced in iter-00, iter-04, iter-06 (forwarding), iter-08 (omission on all 4 color-picker primitives) — promoted from reference detail to hard rule on the 3rd recurrence per §7 | `03-components.md` §6 "The `{className ?? ''}` trap" |
| **R14**: Every interactive element (`<button>`, `<a>`, `<input>`, custom widgets with `tabindex`) MUST have a `:focus-visible` rule in scoped CSS. Canonical: `outline: var(--border-width-thick) solid var(--color-focus); outline-offset: 2px`. Zero-`:focus-visible` selectors is a WCAG 2.4.7 fail — UA defaults are inconsistent (often absent on dark surfaces, often weak on coloured buttons) | Surfaced in iter-03 (`Codex-cc2n`), iter-04 (`Codex-iz1f`, 5 selectors), iter-07 (`Codex-bynn`, `Codex-meca`), iter-09 (3 separate selectors across BrandEditorPanel, Header, Home) — 4-iteration recurrence promoted to hard rule per §7. Ref 05 §3 carries the canonical implementation | `05-accessibility.md` §3 "Focus Visibility" |
| **R15**: Any upload handler that accepts `image/svg+xml` (directly in `allowedMimeTypes`, or via a wildcard that admits SVG) MUST run the bytes through `sanitizeSvgContent()` from `@codex/validation` BEFORE the R2 write. Acceptable forms: (a) call `sanitizeSvgContent()` directly on the buffer, (b) delegate to `ImageProcessingService` which handles sanitisation internally, or (c) call `validateImageUpload()` with `sanitizeSvg: true`. Worker-level MIME validation (`multipartProcedure.validateFiles`, `binaryUploadProcedure`) is a string check only — magic numbers and content sanitisation are consumer responsibilities. JSDoc claims that "upstream validation runs" MUST be verified by the consumer, not trusted | Surfaced in iter-024 (`Codex-06ygy`, stored-XSS via logo upload, P0). Promoted on single incident due to security-asymmetry: one violation already shipped and the explicit package-level rules exist (`packages/validation/CLAUDE.md` "MUST use `sanitizeSvgContent()` for ALL SVG uploads"; `packages/image-processing/CLAUDE.md:64`). Canonical fix commit `cbd7dbf8`; canonical consumer reference: `packages/image-processing/src/service.ts:360-366` | `10-brand-editor.md` §13 "Anti-Patterns" + `packages/validation/CLAUDE.md` |
| **R16**: Every iter-NNN bead close MUST be preceded by a successful `pnpm build --filter='./packages/*' --filter=web` (≈1m on a cold workspace, ≈10s warm). `pnpm dev` lazy-compiles Svelte/TS per route and silently passes (a) orphan closing tags in `.svelte` files, (b) `vite-plugin-dts` diagnostic errors — gated since Codex-76zya by the `afterDiagnostic` hook in `config/vite/package.config.ts` + `worker.config.ts` (NOT a `failOnError` flag — that does not exist in `vite-plugin-dts` 4.5.4), and (c) Svelte 5 reactivity warnings (`state_referenced_locally`, `unused_export_let`, unused CSS selectors). Production build is the only step that compiles the full component tree | Surfaced in iter-016 (commit `a4e7422f` shipped three orphan `</content>` tags across RevenueChart, CustomerTable, MemberTable that compiled fine in dev because no session hit `/studio` before merge). Promoted on single incident due to silent-ship asymmetry + cheap verification cost. The `afterDiagnostic` gate's first catch (`af6c894c`) was a missing `stripe` dep in `@codex/test-utils` that had been silently shipping broken `.d.ts` to every consumer | `09-mcp-verification.md` §1.5 "Build Verification Gate" |

---

## 3. Reference Router (Decision Tree)

Most tasks need 2–4 references, not all 10. Route by intent:

```
What are you doing?
│
├─ Adding/changing a token (color, spacing, font, radius, shadow, motion, z-index)
│    → 01-tokens.md  (+ 02 if it involves cascade/theme interaction)
│    → 10-brand-editor.md  (if org-brandable)
│
├─ Writing CSS architecture (cascade, @media vs @container, @layer question, modern feature adoption)
│    → 02-css-architecture.md
│
├─ Creating/editing a Svelte component
│    → 03-components.md  (+ 05 for a11y + 08 for tests)
│    → 07-icons.md  (if it uses icons)
│
├─ Animation, transition, keyframe, view transition, interaction micro-motion
│    → 04-motion.md  (+ 06 if it runs in a hot path)
│
├─ ARIA, focus, keyboard, contrast, screen reader, reduced-motion
│    → 05-accessibility.md
│
├─ Slow render, CLS, bundle size, shader/canvas cost, image optimisation
│    → 06-performance.md
│
├─ Adding, authoring, or consuming an icon
│    → 07-icons.md
│
├─ Writing a component unit test, visual regression, or axe a11y test
│    → 08-testing.md
│
├─ Verifying UI before closing a task (mandatory)
│    → 09-mcp-verification.md
│
├─ ANY brand editor work (new token, hero layout, visibility flag, editor panel, DB column)
│    → 10-brand-editor.md  (+ 01 always, + 02 for CSS work, + 03 for new UI controls)
│
├─ Theming (light/dark tokens, <html data-theme>, ThemeToggle, editor preview scope)
│    → 11-theming.md  (+ 01 for underlying tokens, + 10 if touching brand editor preview)
│
└─ Multi-tenancy (subdomain routing, org slugs, branding SSR delivery, cross-org navigation)
     → 12-multi-tenancy.md  (+ 10 for branding integration, + 11 for theme + brand interaction)
```

---

## 4. Reference Index

| # | File | Scope | Length |
|---|---|---|---|
| 01 | [tokens.md](references/01-tokens.md) | Raw tokens (13 files), semantic themes, org-brand OKLCH derivation, token prefix table | Medium |
| 02 | [css-architecture.md](references/02-css-architecture.md) | Cascade order, `@custom-media`, modern CSS in use, Baseline-Widely proposals, `:global()` rules | Long |
| 03 | [components.md](references/03-components.md) | Svelte 5 runes, Melt UI wrapping, composition decision tree, scoped styles, forwarding patterns | Long |
| 04 | [motion.md](references/04-motion.md) | Motion tokens, 12 Disney Animation Principles → CSS/Svelte, View Transitions, reduced-motion | Long |
| 05 | [accessibility.md](references/05-accessibility.md) | WCAG 2.2 AA baseline, ARIA precedence, `sr-only`, focus, touch targets, forms | Medium |
| 06 | [performance.md](references/06-performance.md) | CLS, GPU-accel, `content-visibility`, `contain`, `will-change`, shader throttling | Medium |
| 07 | [icons.md](references/07-icons.md) | 67-icon `IconBase` system, `currentColor`, decorative vs semantic, adding new icons | Short |
| 08 | [testing.md](references/08-testing.md) | Vitest custom mount helper, `TestWrapper`, axe helpers, Playwright visual regression | Medium |
| 09 | [mcp-verification.md](references/09-mcp-verification.md) | **MANDATORY** pre-close gate across 4 MCPs + change-type matrix | Medium |
| 10 | [brand-editor.md](references/10-brand-editor.md) | Full 6-path integration guide (base column, token override, editor level, hero layout, visibility flag, hero element) | Long |
| 11 | [theming.md](references/11-theming.md) | `theme.svelte.ts` single-owner contract, three-source read order, reactive subscription pattern, scoped `[data-editing-theme]` preview, anti-patterns from Codex-9u8wg / Codex-micw3 / Codex-z91af | Medium |
| 12 | [multi-tenancy.md](references/12-multi-tenancy.md) | `hooks.ts` reroute, `extractSubdomain`, `RESERVED_SUBDOMAINS_SET` two-layer guard, flat namespace, branding SSR delivery, `buildOrgUrl` cross-origin navigation, `[data-org-brand]` gate semantics, Codex-wcwpw SSR tokenOverrides rule | Long |

---

## 5. How to Add a New Component — 30-second version

```
1.  Verify no existing component + variants + props can express the need (03-components.md decision tree)
2.  Read the nearest peer component (e.g., Button.svelte) to match patterns
3.  Write <script lang="ts"> → interface Props extends HTML*Attributes → $props()
4.  Variants via data-variant="…"; sizes via data-size="…"; never class concatenation
5.  Scoped <style> using ONLY design tokens (var(--color-*), var(--space-*), etc.)
6.  :focus-visible outline with var(--color-focus) + var(--border-width-thick)
7.  Export from apps/web/src/lib/components/ui/index.ts barrel
8.  Write unit test (08-testing.md) — mount helper + state/variant assertions
9.  Run svelte-autofixer (Svelte MCP) on the file — fix everything it flags
10. Chrome DevTools MCP screenshot + Lighthouse audit before closing
```

---

## 6. Future Scope (not yet covered)

- **Transactional emails** — current email templates live in `@codex/notifications`. When this
  skill extends to cover them, a new `11-emails.md` will mirror the component reference with
  email-specific constraints (inline styles, table layouts, no JS).
- **Bundle budget numbers** — no committed per-route JS ceiling yet. `06-performance.md`
  teaches how to measure via Lighthouse; numbers will be pinned once measured.

---

## 7. Recursive Review Process (self-improvement loop)

This skill is **self-improving**. A `/loop` cron (currently every 30 minutes) re-enters this
prompt and runs a review pass against a fresh batch of recently-changed frontend files.
Each pass creates detailed beads tasks for findings, and any durable guidance surfaced
gets folded back into these references — so the next pass is sharper.

### Per-iteration workflow

When the cron fires (or when the user asks to "run a design-system review"):

1. **Pick an unreviewed batch** (3–6 files):
   ```bash
   git diff --name-only main -- 'apps/web/src/**/*.svelte' 'apps/web/src/**/*.css' 'apps/web/src/**/*.ts' \
     | grep -v 'test\|stories'
   ```
   Cross-check against `docs/design-system-reviews/*.md` — skip files already reviewed unless
   they've changed since last review. Batch target is small so density stays high.

2. **Spawn a review subagent** (general-purpose, not pr-review-toolkit — we want control over
   the prompt). The prompt MUST:
   - Invoke `/design-system` via the Skill tool
   - List the files under review (paths + "new" / "modified")
   - Require findings in the structured shape: *File · Rule violated · What's wrong · Suggested fix · Severity*
   - Force the agent to cite skill rules by number (R1–R11) or reference section (e.g. `04-motion.md §2`)
   - End with a "Skill evaluation" section: what references pulled weight, what felt redundant,
     any rules unclear or missing
   - Instruct the agent NOT to call MCPs during the audit (MCPs are a close-time tool; static
     inspection + `git diff` is enough for review)

3. **Triage findings into beads**:
   | Severity | Type | Priority |
   |---|---|---|
   | Blocker (breaks prod) | `--type=bug` | `--priority=0` |
   | Major (a11y, perf regression, visible bug) | `--type=bug` | `--priority=1` |
   | Minor (style/consistency) | `--type=task` | `--priority=2` |
   | Nitpick | — skip, don't noise-pollute beads |
   | Skill improvement (meta) | `--type=task` + patch the reference AND record as audit | `--priority=3` |

   Every bead title starts with `[ds-review-iter-NN]` where `NN` is the iteration number.
   Add a label (`bd update <id> --labels=ds-review,ds-review-iter-NN`) so retrospectives can
   query throughput.

4. **Fold durable guidance into the skill**. If the review surfaces a pattern-level learning —
   a good practice to codify or a bad one to guard against — patch the relevant reference
   immediately. Each patch should cite the source iteration in a comment (`<!-- added from
   iter-NN: ... -->`) so future maintainers can trace the reasoning.

5. **Write an audit summary** at `docs/design-system-reviews/NNN.md` (3-digit iteration
   number, zero-padded). Template:
   ```markdown
   # Iteration NNN — YYYY-MM-DD
   Files reviewed: <paths>
   Findings: blocker=X major=Y minor=Z nitpick=W
   Beads created: <IDs with one-line titles>
   Skill patches applied: <reference + short note per patch>
   Skill evaluation notes: <what worked, what to add next>
   ```

6. **Signal the loop to continue or pause**. If three consecutive iterations produce zero
   major findings, suggest dropping cadence to weekly or pausing the loop — diminishing
   returns. User makes the call via `CronDelete` or re-arming at a longer interval.

### Fabrication check (added from iter-05)

Before closing an iteration that patches a reference, **grep the repo for every API,
export, or file path the reference cites** and confirm each has real consumers:

```bash
# For each claim like "import { foo } from '$bar'" the reference makes:
grep -rn 'foo' apps/web/src/ packages/
```

Zero matches = the claim is either fabricated or stale. Fabrications (iter-05 caught
`axeCheck` in ref 08) require a rewrite; stale claims (iter-04 caught the `+layout.svelte`
render branches) require pointer updates. Either way, catching a fabrication is free if
you just run the grep — catching it after another agent tries to use the API costs them a
failed edit cycle.

### Termination conditions

- User runs `CronDelete <id>` explicitly
- Runtime session ends (cron is in-memory — dies with the session; re-arm on restart if wanted)
- 7-day auto-expiry fires (cron's built-in sunset)
- Three consecutive zero-major-finding iterations → propose pause

### Labels + search

All review-originated beads share the `ds-review` label. Per-iteration labels nest under it
(e.g. `ds-review-iter-01`). Retrospectives:
```bash
bd search ds-review                                      # all review findings
bd list --label=ds-review-iter-03                        # one iteration's output
bd list --label=ds-review --status=open                  # still-open debt
```

### Why this is part of the skill, not a separate runbook

A separate runbook invites drift — agents following the runbook might miss that the skill
itself is what's being improved. Documenting the loop *inside* the skill means every fire
re-reads the workflow alongside the rules it's enforcing. The process is self-describing.

---

## 8. How References Stay Accurate

Each reference cites **file paths + line anchors** rather than embedding copies of code that
drift over time. Example: "See `apps/web/src/lib/components/ui/Button/Button.svelte:36-50`
for the canonical variant pattern."

If a reference disagrees with current code, the **code is authoritative** — update the
reference at that point rather than working around it.

Each reference ends with a **"When to re-verify"** list tied to specific source files — read it
before relying on a doc after significant refactors.

---

## 9. Cross-Load These Skills

- **`/brand-editor`** — redirect stub; content now lives in `references/10-brand-editor.md`
- **`/backend-dev`** — when your UI change needs a new API endpoint, remote function, or service method
- **`/tanstack-db`** — client-side collections, live queries, mutations, hydration
- **`/caching`** — KV cache-aside, client localStorage invalidation, version manifests
- **`/shader-preset-pipeline`** — adding/tuning WebGL shader presets under `ui/ShaderHero/`
