# Component work-package brief — the shared checklist

Every one of the seven component worktrees follows this. The WP prompt names your **types**, your
**exclusive file set** and your **vite port**; everything procedural is here so it is written once.

**Read first:** `02-axis-contract.md` (binding — all amendments), then
`00-design-language-research.md` §2.2/§2.3 (the nine axes and the CSS each value drives) and §3 (your
types' recommended compositions), then `01-component-audit.md` §B for your types' dossiers.

---

## The three stages, in order

Work them strictly in sequence. If you run out of room, **stop at a stage boundary** and report where
you stopped — never stop mid-stage, because a half-wired axis is worse than an unwired one.

### Stage 1 — wire all nine axes (the highest-leverage half)

Replace every hardcoded design decision in your components with the corresponding `--jp-*` read, per
research §2.3. Your audit dossier's "hardcoded aesthetic inventory" is the checklist — work it
line by line.

The mapping, in one table:

| What you find hardcoded | Replace with |
|---|---|
| `max-width` on the inner wrapper | `var(--jp-content-max)` |
| `max-width` on running body copy | `var(--jp-measure)` |
| `padding-block` literals, `clamp(2rem, 6cqw, 4.4rem)`-style | `clamp(calc(var(--space-8) * var(--jp-rhythm)), 6cqw, calc(var(--space-20) * var(--jp-rhythm)))` |
| `gap` literals | `calc(var(--space-6) * var(--jp-rhythm))` |
| section `background` | `var(--jp-sec-bg)` |
| decorative atmosphere opacity (glow / motes / vignette) | multiply by `var(--jp-sec-atmos)` — the 0/1 gate. Keep the markup; let it resolve to zero opacity outside `surface: media` |
| `border` width / colour | `var(--jp-edge-width)` / `var(--jp-edge-color)` |
| `box-shadow` | `var(--jp-edge-shadow)` |
| `text-align` | `var(--jp-text-align)` |
| `align-items` / `justify-items` | `var(--jp-align)` (logical `start`/`center`) |
| the display heading's `font-size` | `var(--jp-display)` |
| secondary heading `font-size` | `var(--jp-heading-size)` |
| display `line-height` / `letter-spacing` | `var(--jp-display-leading)` / `var(--jp-display-tracking)` |
| accent used as TEXT | `var(--jp-accent-text)` — **never** `--jp-ember` (measures 2.98:1 dark / 2.46:1 light) |
| accent used as a FILL | `var(--jp-accent-fill)` + `var(--jp-accent-on-fill)` for the ink on it |
| accent used as a BORDER/rule | `var(--jp-accent-edge)` |
| a glow / bloom | `var(--jp-accent-glow)` |
| entrance `transform` distance | `var(--jp-reveal-distance)` |
| entrance `duration` / `delay` step / easing | `var(--jp-reveal-duration)` / `var(--jp-reveal-stagger)` / `var(--jp-reveal-ease)` |
| media `aspect-ratio` | `var(--jp-media-aspect)` |
| media `border-radius` | `var(--jp-media-radius)` |
| media scrim gradient | `var(--jp-media-scrim)` |
| media inset / letterbox padding | `var(--jp-media-inset)` |

Rules while doing it:

- **Colour stays `--color-*`** (contract A11). The public sections speak semantic `--color-*`, which
  `.journey-palette--page` re-points onto the `--jp-*` ladder. Do NOT convert working `--color-*` reads
  into `--jp-*`. The only colour exception is the `--jp-accent-*` family, which exists precisely so
  `accent: none` is five declarations instead of a repo-wide replace.
- **Container queries, not viewport media queries** (A14). `.jp-sec` is the container. If your
  component has raw-px media queries (`ReelSection:876` `760px`, `ReelSection:890` `420px`,
  `InviteSection:510` `640px`), they become `@container` queries — not `--breakpoint-*` media queries.
- **No axis value may write a layout rule.** Axis values set custom properties only; your component's
  CSS reads them. This is what keeps the axis CSS at 38 rules and prevents a specificity war.

### Stage 2 — collapse the axis-in-disguise variants

A large share of today's 37 variants are axis values wearing composition names: `hero: minimal` is
`stage` + `density: compact` + `accent: none` + `motion: none`; prose `centered` vs `wide` differ only
in `align` and `width`; `introVideo: cinema` vs `simple` differ only in `media`. Research §3 marks each
as **E** (exists), **C** (collapse) or **N** (new).

Collapse the **C** rows. For each, write a stored-value migration so a page that currently stores the
retired variant keeps its exact current appearance — i.e. map the old variant id to
`{ newVariant, design: { …the axis values it encoded } }`. `resolveVariant` already falls back safely
for an unknown id, so the migration is about **not silently changing a published page**, not about
avoiding a crash.

### Stage 3 — add the new compositions

The **N** rows from research §3, in the order listed. Start each by reading the existing canvas
implementation if there is one (see below) — most layouts already exist.

---

## Port, don't invent (contract A12)

`render-edit/journey-sections.css` contains **full, working CSS for all 37 declared variants** —
`.jp-hero--split` (:274), `.jp-hero--minimal` (:308), `.jp-prose--centered/--statement/--wide/--twocol`
(:320-329), `.jp-video--simple/--split` (:372-375), `.jp-descent`/`.jp-stagegrid`/`.jp-stages`
(:380/:420/:428), `.jp-proof--stack/--spotlight` (:457-464), `.jp-guide--centered/--quote` (:483-496),
`.jp-faq--boxed` (:529), `.jp-invite--banner/--card` (:550-557).

F-B splits that file into per-type partials, so **you own a clean partial to port from.** Read it
before writing any layout. The variant design work is done; your job is to port it into the public
component and generalise it onto the axes.

Also implement `editable` and `onEdit` on your components (both already optional on the shared props
interface). This is the tree unification happening incrementally, per type. Consolidation then
repoints the canvas at your components and deletes the canvas twins — **you do not delete them
yourself.**

---

## Also yours, because the files are yours

- **Raw-value cleanup** (A18). Your types' raw `px` and hex/rgb occurrences. Highest value first:
  `rgba(0,0,0,·)` scrims/text-shadows and `#000` inside `color-mix` — these are the ones that break on
  a light-brand org. Replace with `color-mix(in oklab, var(--color-background) …)`.
- **Local `.sr-only` re-declarations** — use the global utility (`SectionSkeleton:48-58`,
  `MapSection:534-537`).
- **Inline `<svg>`** (A8) — the design system forbids it; use `Icon/*Icon.svelte` via `IconBase`.
  Icon-only buttons need an `aria-label`.
- **`:focus-visible` on every interactive element** (rule R14). Canonical:
  `outline: var(--border-width-thick) solid var(--color-focus); outline-offset: 2px`. Note `edge: none`
  and `edge: soft` remove borders but must **never** remove the focus ring.
- **The `coerce.ts` bridge one-liners** for your types, from the F-A report. This is the
  `Codex-tqr51` copy-loss fix reaching your components.

---

## Non-negotiable accessibility floors (research §5.1)

No axis value, no preset and no creator override may cross these. They are the acceptance criteria.

| Floor | Value |
|---|---|
| Body text contrast | 4.5:1 against its own surface. `--jp-faint` is for non-essential text ONLY |
| Large text contrast | 3:1 at ≥24px or ≥18.66px bold. `type: restrained` headings often do not qualify — they must clear 4.5:1 |
| UI / graphic contrast | 3:1 — accent edges, focus rings, spine and node graphics, any `--jp-line-*` acting as a meaningful boundary |
| Accent as text | Never `--jp-ember`. `accent: text` and `accent: glow` resolve to `--jp-ember-text` |
| Tap target | `var(--tap-target-min)` in EVERY `density` value, measured on the content box INSIDE any border |
| Body font size | `--text-base` floor. No axis may set body copy below `--text-sm`; `--text-xs` is metadata only |
| Reduced motion | Every `motion` value renders as `none`. `--jp-reveal-distance` must resolve to `0`, and keyframes must STOP, not merely speed up |
| Heading order | Independent of `type`. `type: monumental` must not promote a heading level — visual scale and document outline are separate |
| Text over media | Scrim mandatory. `media: bleed` is the only value shipping one; any composition placing text over media uses `bleed`, not `frame` |

---

## Verification — measured, not asserted (contract A10)

Before AND after, all six combinations: `of-blood-and-bones`, `studio-alpha`, `studio-beta` × light,
dark. `of-blood-and-bones` is the fully-branded org (cream `#F6EFE6` light / `#200000` dark, Playfair);
`studio-alpha` (#E11D48) vs `studio-beta` (#2563EB) is the brand-neutrality pair.

Surfaces: `http://<org>.lvh.me:3000/journeys/<slug>` — `of-blood-and-bones` has
`pricing-smoke-test` (11 sections, the golden page), plus `bone-deep`, `tending-the-grief`,
`ancestral-threads`, `return-to-the-shoreline`. `studio-alpha` has `bone-deep` and
`tending-the-grief` (seeded for exactly this purpose — it had none before). Builder:
`/studio/journeys/[id]/page`.

### FIRST: your section type may not exist on any page

Verified 2026-08-19 — the section coverage across every real page is incomplete, and **no page
anywhere contains a `guide` section.** What exists:

| Page | Sections |
|---|---|
| `of-blood-and-bones` / `pricing-smoke-test` | hero, introVideo, ache ×2, turn, reel, map, feel, proof, faq, invite — **no `guide`** |
| `of-blood-and-bones` / 4 others | 4 sections each |
| `studio-alpha` / `bone-deep`, `tending-the-grief` | hero, ache, map, invite only |

So before you can verify anything, **add your type's section to a page through the builder UI** at
`/studio/journeys/[id]/page` — not by writing to the database. Doing it through the builder is
deliberate: it exercises the real add-section path, confirms the catalogue's `defaultProps` seed
correctly, and gives you the fixture in one action. Add it to a `studio-alpha` page so you get the
brand-neutral reading, and to `of-blood-and-bones` for the branded one.

Two things this will expose, which are expected and are not your bugs to fix:

- **The catalogue seeds placeholder copy** ("A common question?", "A short bio that establishes
  credibility and warmth") which a published page then serves to real visitors — bead `Codex-maf0y`.
  Report it if your type makes it worse; do not fix it here.
- **`studio-alpha`'s `ache` section stores `variant: "default"`**, which is not a declared ache
  variant. Leave it. It is a genuine real-world fixture proving `resolveVariant` falls back safely, and
  F-A's Zod schema cites it as the concrete reason `variant` must stay an open string rather than an
  enum. "Fixing" it destroys the evidence.

**Contrast** — measure with a canvas `fillStyle` + `getImageData` readback. A regex over
`getComputedStyle` returns garbage ~1.0 ratios, because Chrome serialises `color-mix()` as `oklab()`
floats. Resolve the **effective** background by walking ancestors until alpha > 250 — `body` is
transparent in this app. Check the platform path too if a component can render outside `.org-layout`:
a token that derives inside an org may be a hardcoded `#ffffff` at `:root`.

**Everything else:** tap targets measured at `density: compact` (worst case). Reduced motion — assert
`--jp-reveal-distance` is `0` and nothing carries a running animation. All three preview widths
(375 / 768 / 1440), because container-query scoping means a composition can be correct at 1440 and
broken at 375 independently.

**HTTP 200 is not "it works."** Assert rendered output and persisted state. A filter or a variant that
returns 200 with nothing rendered is broken.

The shared browser: use your own `isolatedContext` and guard every `evaluate_script` on
`location.href` — agents have measured each other's tabs before.

---

## Hard constraints

- **NEVER** `pnpm db:seed` or `pnpm db:reset` — they TRUNCATE.
- **NEVER** a bare `pnpm test` from the repo root. `.env.test` points `DATABASE_URL` at the **dev**
  database and `cleanupDatabase()` deletes real rows (`Codex-bsbf8`). Your test command is
  `pnpm --filter web test`. If any instruction seems to tell you to run the full suite, it is wrong —
  read the config and refuse.
- **NEVER** `pnpm dev`. One shared worker fleet plus vite on 3000 already runs from the main checkout.
  Your worktree runs only the web app, on the port your prompt assigns:
  `pnpm --filter web exec vite dev --port 30NN --strictPort`. `--strictPort` is mandatory — without it
  vite silently auto-increments and squats a neighbour's port. Never kill a port belonging to a running
  worktree.
- **i18n is single-owner.** REPORT the keys you need; never edit `messages/en.json` and never
  regenerate `src/paraglide/`. Two worktrees recompiling paraglide strips keys and produces runtime
  500s. paraglide-js 1.11.8 has **no plural support** — never ICU `{count, plural, …}`; use a separate
  `_one` key plus a call-site ternary.
- **Import boundary:** nothing under `$lib/page-builder` may import `$lib/components/page-builder`.
- Design tokens only. Svelte 5 runes (`$props()` + typed `interface Props`), `$app/state` not
  `$app/stores`. `apps/web` has `strictNullChecks` OFF — boolean-literal discriminants do not narrow,
  so use string discriminants. Currency is GBP (£). No emoji in product UI.
- **Stay in your file set.** Touching a shared file blocks a sibling worktree. If you believe a shared
  file must change, STOP and report it rather than editing it.

## The gate — all four, before reporting done

`pnpm build` + tests is NOT enough; neither typechecks, and four pushes have failed on typecheck with a
green local gate.

```
pnpm check:ci
pnpm check:brand-boundary
pnpm typecheck
pnpm --filter web test
```

Then run `svelte-autofixer` (Svelte MCP) on every `.svelte` you modified and fix everything it flags —
it catches rune misuse that typecheck misses.

Commit on your branch. Do NOT push, do NOT open a PR, do NOT merge.

## MEASURED LESSONS FROM THE WT-3 PILOT — read before writing any CSS

Nine corrections from the first worktree that actually wired an axis to a component. Every one is
measured, and most of them would have cost you an afternoon each.

**1. Consume the shared spacing aliases; do not re-spell the clamp.**
`--jp-sec-pad-block`, `--jp-sec-pad-inline` and `--jp-sec-gap` already exist in `journey-design.css`.
They measure 81.66px at a 1361px container and 22.5px at 375. **They contain `6cqw` and are declared on
`.jp-sec`, so they MUST be read on a DESCENDANT** — an element is not its own query container, so
consuming them on the wrapper itself silently gives page-relative padding.

**2. `min-height` needs a different shape from the rhythm clamp.** Multiplying `100svh` by `vast`'s 1.6
asks for 128svh and hides the CTA. Use:
```css
min-height: min(100svh, calc(80svh * var(--jp-rhythm)));
```
Swept and measured: compact 516px (60svh) · regular 688px (80svh) · **airy 860px = exactly today's
100svh** · vast capped. `airy` landing on today's value is why the constant is 80. Reuse this for any
viewport-tall section.

**3. Gate the atmosphere with ONE `--jp-sec-atmos` declaration on the shared parent** — not per layer as
research §2.3 specifies. This is a correction to the research: the glow's opacity is *animated*, and a
keyframe beats a `calc()` on the same element. On the parent the two compose multiplicatively, so the
glow keeps breathing under `surface: media` and resolves to zero everywhere else.

**4. Never use `--jp-accent-fill` for a small decorative mark — use `--jp-accent-mark`.**
`--jp-accent-fill` is `transparent` at `accent: text` and `accent: edge`, so the pilot's trust dot,
motes and cue spark all vanished on two of five values. `--jp-accent-mark` was added for this and is a
real colour on all five. **WT-4 (spine + gate nodes), WT-5 and WT-7 (accent dots) all need it.**

**5. Divide `--jp-reveal-stagger` for anything staggering more than ~6 items.** It is calibrated for ~5
block beats; at `drift` it is 200ms, so a 10-word headline would take 3s to assemble against today's
800ms. The pilot divides by 3 for per-word kinetics.

**6. `.jp-reveal` / `data-jp-step` do NOT fit an above-the-fold entrance.** They are transition-based and
only arm when the `reveal` action adds `.reveal--armed` on scroll into view. A first-screen section
opens on mount. Drive your own keyframes from `--jp-reveal-duration` / `-stagger` / `-ease` /
`-distance` instead.

**7. Two CSS traps, both measured.** `cqh` silently falls back to the small viewport under
`inline-size` containment — use `vh`/`svh` and mean it. And **`aspect-ratio` plus a definite cross-size
is a blowout, not a constraint**: it gave the pilot a 1658px panel inside a 458px column, cropped by
`overflow: hidden` so it merely looked bland rather than broken. Fix with `width: 100%` +
`align-self: stretch` and let the grid row win.

**8. The contrast method needs a SETTLE after the theme flip.** Reading `getComputedStyle` immediately
after flipping returns the **pre-flip** value in both directions — plausible-looking numbers that are
quietly wrong. Add 2× `requestAnimationFrame` plus a ~260ms timeout. This is how the pilot discovered
that `of-blood-and-bones` has a **distinct dark brand (`#e1233b`)**; `04-contrast-baseline.md`'s
`#552e8e` is the LIGHT value only.

**9. Never import `EditableText` into `render/sections/*`.** It is **not SSR-safe**: it renders an empty
element and fills `textContent` from a Svelte action, and actions do not run during SSR. On the public
page that serves `<h1></h1>` and paints the headline in only after hydration — an SEO hole in the most
SEO-critical section. The canvas never noticed because the studio is `ssr = false`. Implement the
`editable`/`onEdit` seam as a spreadable `contenteditable` + `oninput` attribute bag over **real text
children**, and pin it with a test asserting the served markup contains real text.

**Also: expect stored variants to be the NEW ids.** Migration 0085 already ran. Check what your type's
pages actually store *before* assuming today's appearance is your default composition — every hero
stored `split-media` while rendering as `stage`, which is how a seed artifact nearly changed seven live
pages (contract A33).

**And a time-sink to avoid:** the builder's `[id]` route param is the **landing_page id, not the course
id**, and a `null` load spins on "Loading page…" forever with no error. Pre-existing (`Codex-4wcnv`),
reproduced on the base branch.

## Findings already banked for specific worktrees

Measured or verified during the foundation stages. Each is yours to fix if it names your worktree.

### WT-4 · map — `.descent__node` does not respond to the theme flip
`.descent__rn` measures **4.45:1 at 20px/400** against a 4.5 floor — and the effective background is
`.descent__node` at **`rgb(56,21,17)`, identical in light AND dark theme**. The ratio is the symptom;
the theme-invariant node surface is the cause, and no palette change can fix it (F-B1's `--jp-faint`
fix lifted it from 3.74 to 4.45 and stalled there). This is the open half of bead `Codex-rvkmc`.
Also: remove the 🔒 emoji from this section (no emoji in product UI).

### WT-2 · video — the raw-px breakpoints become CONTAINER queries
`ReelSection:876` (`760px`) and `ReelSection:890` (`420px`) are raw-px media queries. Per contract A14
they become `@container` queries, **not** `--breakpoint-*` media queries — `.jp-sec` is the container,
and the builder canvas renders sections inside a device frame narrower than the window, where a
viewport query reads the wrong number. Same for `InviteSection:510` (`640px`) in WT-7.
`ReelSection` is also the tree's largest component (935 lines) with 18 raw px + 6 rgb/hex, five blend
layers, 32 SVG rects, and it owns the `media: bleed` aspect↔scrim coupling.

### WT-1 · prose and WT-7 · invite — array props with NO editor at all
`feel.inclusions[]` (`FeelSection:46`) and `invite.offers[]` (consumed `InviteSection:124`) are read via
`asObjectArray` with no numbered-flat fallback, so a creator has **no way to author them** and they are
permanently empty. Both are central to those sections' purpose, not optional polish — each needs a
repeatable-field editor in `section-fields.ts`. Likewise `turn.points[]` (`TurnSection:46`) is read but
nothing writes it, so the roman-numeralled `arc` list is always empty.

### WT-7 · invite — the `price` field is deleted, not bridged
F-B2 removes it from `section-fields.ts`. Do not reintroduce an authored price string in any new
composition. Prices come only from `JourneySalesContext.offer`, and every composition must degrade to a
price-less CTA when `offer` is null (it is `.catch()`-guarded because the page is SEO-critical).

### All worktrees — the hardcoded editorial voice (`Codex-i9pzs`)
Seven renderers fall back to hardcoded English **editorial copy in one brand's voice**, which every
other org's page then publishes: `ReelSection:50` "This is what a descent looks like.",
`ProofSection:78` "What the ground gives back.", `IntroVideoSection:42` "Ninety seconds inside the
work.", `FaqSection:63` "The honest answers.", `InviteSection:57` "Begin the work.",
`HeroSection:66` "Begin the journey", plus "Go to your dashboard".

Fix ranked: **fall back to DATA** (`p.heading ?? context.course.title` — the creator's own words, which
`HeroSection` already does for its headline), else **let the element self-hide** (the `{#if}` guards
already exist), and use an i18n key **only** for genuinely generic chrome. A key holding "This is what a
descent looks like." has not fixed this — it has moved it. Genuinely generic and needing keys:
`ReelSection:65` "Preview", `InviteSection:70` "Join now", `MapSection:72` "Practice".

### All worktrees — verify the Candlelit claim for YOUR type
Existing pages were backfilled with the **Candlelit** preset on the assertion that it reproduces
today's appearance exactly. That assertion is **unverified** — it could not be checked before the axes
were consumed. As you wire your axes, compare your section's appearance under Candlelit against `dev`.
If it does not match, **adjust the Candlelit bundle and report it — never edit the page data.**

### Known-open and deliberately carried
`studio-alpha`'s CTA label on its own brand fill measures **4.43:1** at both poles and on all five
surfaces (`#E11D48` is OKLCH L=0.5858, just under the on-brand-ink 0.60 pivot, so the label resolves
near-white on a mid-lightness red; no pivot value fixes it). It is platform-wide — `--jp-on-ember`
mirrors `--color-text-on-brand`, so the same ratio hits every primary Button on that org — and is
tracked on bead `Codex-g7ipk`. It sits in `journey-design.test.ts`'s `KNOWN_OPEN` allow-list, which is
written to FAIL if the entry ever stops failing. **Do not attempt to fix it in a component worktree**,
and do not add anything to that allow-list without reporting it.

## Reporting

1. Gate results — actual output status for all four, not a claim.
2. Which stage you reached, and if you stopped early, exactly where and why.
3. Measured contrast before/after, all six combinations, for the text roles you touched.
4. Variants: which you collapsed (and the migration you wrote), which you added.
5. i18n keys needed — name + English value.
6. Anything contradicting the contract, with evidence. Being corrected now beats being corrected after
   merge. Reviewers are sometimes wrong too — if you reject a finding, record the reasoning.
7. Anything left undone, and why.

## ROUND 2 LESSONS — read these with the pilot's nine

### CORRECTIONS to the nine above

**Lesson 1's 375px figure is wrong.** `--jp-sec-pad-block` at a 375px container is **40px** —
the clamp's lower bound `calc(--space-8 * var(--jp-rhythm))` at `airy` — not the 22.5px raw
`6cqw` recorded. The 1361px figure (81.66px) is correct. Do not treat 22.5 as a target.

**Lesson 8's settle is too short.** 2× `requestAnimationFrame` plus a timeout **longer than
the longest `transition-duration` in the section**, not 260ms. With `background` on
`--jp-reveal-duration` (800ms at `drift`), a 280ms settle read a surface 4 contrast points
off its settled value — plausible-looking and wrong. Everything in round 2 was re-measured at
1200ms. This same artifact corrupted `04-contrast-baseline.md` (see contract A45).

**Lesson 7 gains a third trap: `auto-fit` needs a flexible max.** `minmax(min(16rem,100%),
24rem)` collapses to ONE track at 768px — a fixed max makes the repetition count resolve to 1.
Use `minmax(min(100%, 16rem), 1fr)`. It looks like a design choice, not a bug (contract A48).

### STOP YOUR VITE BEFORE `pnpm --filter web test`

WT-5's first gate reported **8 failures, 7 of them false.** With its dev server still running
the suite took **6384s instead of 142s (30×)** and the server's own module transport timed out
at 60s, producing failures indistinguishable from real assertion ones — `querySelector`
returning null, a mocked fetch seeing null, across `journey-palette.test.ts` (×3),
`org.remote.test.ts` and `explore/page.server.test.ts` (×4). All passed in isolation and in a
clean re-run.

**If you see failures in files you never touched, suspect this before you debug them.**

### A SECOND literal `<style` spelling anywhere in a component breaks the build

An opening-`style`-tag spelling in prose — HTML comment, JSDoc or CSS comment — makes
`vitePreprocess` pair the wrong opener with the real closing tag and hand postcss a stylesheet
beginning mid-sentence. The error is `[postcss] …vite-preprocess.css:1:3: Unknown word …`
pointing at line 1 of the *extracted* CSS, nowhere near the cause. One spelling is fine, which
is why `HeroSection.svelte:18` compiles today — it is one prose edit from 20 minutes lost.

### `grep -c` counts LINES, not occurrences

It lies on minified HTML. Use `grep -o … | wc -l`. The orchestrator reported "exactly one 🔒 is
served" from `grep -c`; WT-4 measured **12**, one per practice card. The same mistake nearly
had a live copy-loss defect recorded as "renders fine".

### Measure the state SSR EMITS, not only the settled one

`.descent__rn`'s recorded 4.45:1 was its **pre-lit dim** state. In the **lit** state the page
actually serves it measured **1.13:1** — the numeral was painting a raw brand token. State
matters as much as org × theme; a section with an enhancement pass has at least two.

### Verify what your tokens actually RESOLVE to, not what they are named

`--color-brand-accent` is `var(--brand-accent, var(--color-warning))` and no seeded org sets
`--brand-accent`, so it is the platform's **warning amber** everywhere (contract A47). A
plausible token name is not evidence of a plausible value.

### Section `<h2>` → `--jp-heading-size`. Decided once (contract A36)

`--jp-display` is the PAGE's display heading — the hero's `h1`, 80px at `monumental`. Every
other section's `h2` is `--jp-heading-size`, 48px, which is what they ship today. A card-scale
third rung is contract A44; do not invent a fourth way to derive it.

### `studio-beta` has no journey page and never has (contract A41)

Do not hunt for one. Re-point `--brand-color` / `--brand-color-dark` to `#2563EB` on a served
`studio-alpha` page and label the reading **emulated**.

### Continuous motion: make the STATIC layout the baseline (contract A40)

Do not animate-then-override. Put the ticker inside
`@media (prefers-reduced-motion: no-preference)`. An override-based fallback has to remember
every property the animation set, and WT-5's forgot the one (`flex: none`) that blocked
wrapping — while every motion probe read clean.

### "Wire all nine axes" means all nine that APPLY — `media` is conditional per type

Research §2.2 names the five types where `media` is meaningful — `hero`, `introVideo`, `reel`,
`guide`, `proof` — and says the rest "ignore it, exactly as they ignore a variant they do not
offer." `map` wired **eight** and was right to: `JourneyStageView` is
`{id, name, gloss, sortOrder, practices[]}` with no media reference at any depth, so there is
nothing for `--jp-media-*` to shape and claiming nine would have meant inventing a consumer.

**Do not manufacture a consumer to reach nine.** State in your component header which axes apply
and cite §2.2. Same discipline as WT-4 shipping `table` with 3 columns instead of the research's
4, because `minutes` and per-stage `access` have no field on the view model — a fourth column
would have been a control that renders nothing, which is the exact mistake
`SectionFieldDef.mediaSlot`'s own JSDoc exists to prevent.

### A "typographic" glyph can still be an emoji

WT-4 removed a `▶ ♪ ✎` content-type map alongside the lock emoji: **U+25B6 carries emoji
presentation on Apple platforms**, so a map that looked like typography was shipping an emoji
into product UI. If you are replacing emoji, check the replacement's presentation rather than
assuming a geometric-shape codepoint is safe. Use `Icon/*Icon.svelte` via `IconBase`.

---

## MEASURED LESSONS FROM ROUND 3 — read before writing any CSS

Round 3 wired `ache`/`turn`/`feel` (WT-1) and `invite` (WT-7). Both worktrees corrected the
orchestrator; both corrections are in this list. Full statements are amendments **A54–A62** in
`02-axis-contract.md`.

### The one that painted nothing on every published page (A54)

**Never compose an `--jp-edge-*` token into a larger value.** `--jp-edge-shadow` resolves to the
keyword `none` at `edge: none` (Candlelit, so all seven live pages) and at `edge: heavy`.
`box-shadow`'s grammar is `none | <shadow>#` — `none` cannot be one *item* of a comma list — so

```css
box-shadow: inset 0 0 0 2px var(--jp-accent-mark), var(--jp-edge-shadow);  /* evaporates */
```

is invalid at computed-value time and falls back to the initial `none`. Three rings vanished this
way — a recommended-tier ring, a card's only boundary on four of seven pages, and a sticky bar's
edge — **silently, because an invalid declaration does not error.** The same token family had
already been found from the other side: `--jp-edge-width` is a unitless `0` at `edge: none`, which
poisons `max()` and invalidates a `border` shorthand.

**An `--jp-edge-*` token is the whole value of its own property, or it is not used.** Want the axis
edge *plus* your own ring? The ring goes on `outline` with a negative `outline-offset`. WT-2 will
meet this the moment it layers emphasis on a video frame.

### Before applying A36, read the BASE COMMIT's `font-size` (A55)

A36 ("a section `<h2>` reads `--jp-heading-size`, NEVER `--jp-display`") was written from four
sections that all shipped `--text-3xl`/`--text-4xl`. `invite` shipped `--text-display`, so A36's
letter would have SHRUNK its heading **80 → 48px on seven published pages** — the same A3/D8 breach
A36 exists to prevent. A36 is now narrowed: **the test is what the element ships on `dev`, not its
tag name.** If you claim the exception, show the measured base-commit declaration, as WT-7 did.

And when you do port to the shared atom: **`.jp-sec__heading` carries `line-height` and
`letter-spacing` too** (A59). `invite`'s heading moved `--leading-tight` → `--leading-none` and
`-0.02em` → `--tracking-tighter` with its `font-size` byte-identical. A worktree that only diffs
`font-size` will report "Candlelit matches" and be wrong.

### Your type's stored variant is probably a seeder's literal (A56)

0087 rewrote a seeded `hero: split-media` back to `stage`. Round 3 found **the identical defect on
`invite`** — `seed-portals.ts:499` hardcoded `variant: 'card'`, all seven pages stored `card` while
rendering `pool`, and merging without migration `0089` would have flipped seven live pages to a
composition no creator ever chose or saw.

Two types, two seeders' literals, two silent flips averted. **This is a class of defect, and
checking for it is part of YOUR stage 2** — `introVideo`, `reel` and `guide` all have
seeder-written variants that have never been expressed. Query what the pages store, then compare
against what the DOM actually renders. `data-jp-variant="card"` on unmistakably pool markup is what
the evidence looks like.

The distinction that decides the fix, kept sharp because round 3 hit both cases at once:

- **seeder literal, never expressed** → migrate; restore what visitors have been seeing;
- **human choice, made in a builder where it visibly did something** → leave it and let it land.
  WT-1 correctly left the golden page's `turn`/`feel` section-level `{"align":"center",
  "width":"narrow"}`, so honouring them moves those two sections from a 68rem left-aligned
  two-column layout to a 48rem centred stack. **That is `Codex-qcgo3` landing, not a regression.**

By value alone the two are identical. Provenance is the entire test.

### `--jp-accent-edge` is unusable as a visible rule on a dark brand

Measured independently by both worktrees, on `of-blood-and-bones` dark, against a 3:1 graphic
floor: WT-1 got **2.05** at `accent: glow`; WT-7 got **1.27** at `glow` and **1.49 / 2.04 / 2.04**
at `text` / `fill` / `edge`. **Every value fails.** Both routed every visible accent rule to
`--jp-accent-mark` instead (5.00 dark / 10.47 light for WT-7; 6.04 / 14.62 for WT-1).

So: `--jp-accent-mark` for anything that must be SEEN — marks, rings, spines, ticks, rules.
`--jp-accent-edge` is decorative-only until someone raises its mixes. Do not carry a hardcoded
percentage onto it either (A37) — at `glow` it is already a 45% ember mix.

### Changing a palette token is THREE coupled edits (A57 corollary)

`journey-design.test.ts` computes contrast in a JS colour model and then asserts that model against
the stylesheet (`the colour model matches the CSS it claims to model`). So a palette change needs
the CSS, the model's derivation, **and** the formula assertion — all three, or the suite tells you
within a second. That guard is why the on-fill fix could be trusted: it re-measured 100
combinations at 8 poles rather than one element on one page.

Which is also the round's headline correction: **a token DOCUMENTED as a mirror of another is not a
mirror until both expressions are read side by side.** The journey on-fill ratio sat open for
three rounds on the claim that `--jp-on-ember` mirrors `--color-text-on-brand`. It never did —
different pivot, multiplier and, decisively, ceiling (`0.98` vs `1`), which is 4.45:1 vs 4.70:1.
Fixed, and `KNOWN_OPEN` is now empty.

**Do not read that as `Codex-g7ipk` being closed** — the earlier docs, including this brief at
line ~357, mis-filed the journey ratio under that bead. `Codex-g7ipk` is a separate open P1 about
`Button.svelte` / `FeatureCarousel.svelte` not consuming `--color-text-on-brand` at all, and it
carries its own trap. See A57.

### The `--jp-display` rung is non-monotonic (A58)

`type: expressive` renders a **smaller** display heading than `balanced` (28.0 / 35.2 / 44px vs
37.2 / 46.1 / 48px), because `--text-5xl` maxes at `2.75rem` and `--text-4xl` at `3rem`.
`--jp-heading-size` is fine. Reported, not fixed — it is a `tokens/typography` change with
consumers outside this tree. Expect it; do not "fix" it locally.

### Verification method — three corrections

1. **The public page redirects an entitled viewer to `/dashboard`.** The shared MCP browser carries
   a `creator@test.com` session, so `/journeys/<slug>` is only measurable in a **fresh, cookie-free
   context**. Add a `sectionCount === 0` guard that reloads once and re-measures — it caught a
   blank-render run in each worktree that would otherwise have been reported as real contrast.
2. **`--jp-sec-pad-block` is 40px at 375**, 46.08 at 768, 82.56 at 1440. This corrects round 2's
   22.5px figure. Note `airy` and `vast` **coincide** at 82.56 in a ~1376px container, because the
   clamp's `6cqw` middle term dominates — correct, not a defect.
3. **A53, third data point.** WT-1 measured load average **44.45** with a sibling's vite up and got
   4 failed tests + 2 failed suites, every one a timeout in files it never touched
   (`journey-palette`, `explore/page.server`, `collections/index`, `content.remote`); re-run in
   isolation, 61/61 green. The orchestrator's own full-suite run with only the shared fleet up, at
   load **26**, saw **170 files / 2094 tests, zero timeouts, 27s**. Confirmed load-dependent. Stop
   your vite, and if you see a timeout in an untouched suite, **re-run that file in isolation before
   reporting a failure — and report the load average.**

### A scrolling region must be focusable

WT-7's `table` composition overflows by design at 375px (four columns have a ~733px min-content
against a 330px content box) and scrolls rather than truncating. A scroll container with no
keyboard path is a WCAG 2.1.1 failure: Chrome gives no keyboard scrolling to a non-focusable
overflow box. It needs `tabindex="0"`, a `role="region"` and an accessible name — and
`svelte-autofixer` will flag `a11y_no_noninteractive_tabindex`, which is the documented exception
for scrollable regions. **Suppress at the one element, with the reasoning in the file**; do not
remove the behaviour.

### Two process notes that cost real time

- **`onEdit` must write back to the key the value was READ from** (A60). Alias lists are ordered,
  so always writing the canonical key corrupts a page storing the alias: it ends up holding both,
  the alias keeps losing, and **the creator's edit renders as nothing while the data grows a second
  copy.** Use a `readKey(keys, fallback)` helper and pin it with a test.
- **Verify a "pre-existing" i18n key against `en.json` before reporting it as one** (A62). Four of
  WT-1's seven claimed-existing keys did not exist, and its components imported paraglide not at
  all — the strings were inline English. Round 3 needed **twelve** keys, not eight. Quote the
  `en.json` line, or call it new.

### Follow the annotate-don't-drain precedent for your `render-edit` partial

Both worktrees annotated their canvas twin and CSS partial with a class-by-class port map and a
"consolidation deletes this" banner, and **left the rules in place**. Draining the partial now
would leave the builder canvas previewing **unstyled** sections until `JourneyBuilderCanvas` is
repointed (`Codex-eckbx`). A16 accepts a canvas that looks *different*; it does not accept one with
no styles. Record the genuine splits — WT-7's single `.jp-invite__offer` became two public classes,
and `.jp-invite--card`'s title shrink was deliberately NOT ported because that is the `type` axis.

### Still not built, and it blocks compositions

The generic array control (A29) remains undone, so `number`, `toggle`, `list` and `repeater` are
declared with no editor UI. `SectionEditor.svelte:78-81` writes `target.value` — a **string** — for
every control except `media`, so an array-fed field cannot be authored at all. **Seven of WT-1's
eighteen compositions are markup-complete and test-pinned but unreachable from the builder.** Do
not build a bespoke control; report what shape you need, and design every composition to degrade
gracefully to empty.

---

## MEASURED LESSONS FROM ROUND 4 — the last component round

Round 4 wired `introVideo`/`reel` (WT-2) and `guide` (WT-6), completing all 11 types. Both worktrees
corrected the orchestrator and each other; **every correction below is a measurement.** Full statements
are amendments **A63–A72** in `02-axis-contract.md`.

There is no round 5 of component work, so read these as **consolidation** and **future-WP** lessons
rather than as a next worktree's checklist.

### A correct diagnosis in a component header does not reach the next component (A64)

This is the most expensive lesson of the round and it is a *process* lesson, not a CSS one.

`InviteSection.svelte:1187-1196` measured, diagnosed and documented — correctly and completely, in
prose — that `--jp-edge-width` was a unitless `0`, that math on it invalidates the whole declaration,
and that the fix was one character in the axis file. It ended: *"until then, no component math touches
that token."*

Nobody swept the tree. `MapSection.svelte:1056` was already doing exactly that math, on four card
selectors, and kept doing it for a whole round — so `.descent__card` shipped with **no border at all**
on every published page, while its own comment claimed the `max()` *prevented* cards dissolving.
`dev@013e2d42` ships those cards with a real hairline, so it was a live regression, not a new look.

**If you diagnose a shared defect, the deliverable is a fix at the root or a red test — never a
paragraph.** A paragraph reaches the reader of that one file.

### Do not treat a self-check number as a target (A63)

The orchestrator handed both worktrees a `var(--jp-` read-count band (30–85, measured across the seven
already-wired components) as a "stage 1 is done" signal. WT-2 did something better: it **diffed defined
tokens against read tokens, one by one**, and found `--jp-accent-glow` had **no consumer anywhere** in
`ReelSection`. Since Candlelit is `accent: glow`, that was a bloom that never bloomed on 695 pages.

Its read count would have looked healthy either way. A band tells you whether you are in the right
order of magnitude; **an exhaustive token diff tells you what you missed.** Audit every unread token and
justify it — WT-2's legitimate ones were display/heading-size/leading/tracking (via `.jp-sec__heading`),
distance/stagger (via `.jp-reveal`), and `--jp-rhythm` (via the `--jp-sec-pad-block`/`-gap` aliases,
because reading it directly is the anti-pattern pilot lesson 1 forbids).

### A54 generalises: the mechanism is the KEYWORD, not the `--jp-edge-*` family (A63)

Three more axis tokens resolve to `none` — `--jp-accent-glow` (4 of 5 accent values),
`--jp-media-scrim` and `--jp-media-mask` (4 of 5 each). So
`background: var(--jp-media-scrim), var(--color-surface)` evaporates exactly as A54's three rings did,
and **that is a natural thing to write**, because layering a scrim over a surface is what the token is
for.

Any axis token that can resolve to a keyword must be the WHOLE value of its property. Never a list
item, never inside `min()`/`max()`/`clamp()`/`calc()`. Guard filed as `Codex-3kqqp`.

### The scrim is bottom-anchored, so half the aspect↔scrim coupling is unreachable by aspect (A68)

`--jp-media-scrim` is `to top`. It therefore protects **nothing at the top of the box at any aspect**,
and **a text block that wraps climbs out of it.** Neither is an aspect problem, so flooring the aspect
cannot fix either.

The rule that came out of it: floor the aspect (`min-height`), never override it per breakpoint — a
floor can only make the box taller, moving the fade further above the text, whereas a second
`aspect-ratio` can make it shorter. Then give over-media blocks the scrim **on their own box** with
`padding-block-start` as the fade lead-in, and give top-anchored chrome its own plate at **88%**, not a
glassy 55% (A39 applies to plates too).

### "Verify Candlelit" is two different checks, and only one is falsifiable (A66)

Every check through round 3 was a **fidelity** check: does the preset render what shipped? `guide` had
**zero rows in the database**, so there was no "today" to reproduce and fidelity was *undefined* — only
a **consistency** check was available. State which one you did. Both of Candlelit's known errors were
caught by fidelity, i.e. by someone noticing a mismatch against a real page, so **a type with no rows
has no tripwire** and needs the arithmetic done rather than the eye.

### Candlelit now needs a per-type escape hatch on four of nine axes (A65)

`width` (accepted at A51), `type` (grows `feel`'s h2 +8px, because `feel` ships `--text-3xl` where
`proof`/`faq` ship `--text-4xl`), `media` (letterboxes `guide`'s portrait to 21/9; `introVideo` wants
`frame` while `reel` and `hero` want `bleed`), `align` (`reel`'s editorial split).

**None can be fixed locally** — each fix is right for one type and a regression for another. And note
the evidence *for* the page-level default: `introVideo`'s `type` matched **byte-identically** at all
three widths. The override map is an escape hatch, not a replacement, and it must sit BESIDE the pinned
bundle or all 695 pages read as "Custom".

### Three measurement corrections, each of which changed a conclusion (A67)

1. **Type must be measured at real viewports.** `--text-*` carries a `vw` term, so a container
   constrained to 375px inside a 1440px window reports the **1440px** `font-size`. A first pass read
   48px at 375; the truth was 37.24px. A10's "constrain `.jp-sec`" is right for *container queries* and
   wrong for *type*.
2. **A10's ancestor walk cannot measure text over media at all.** Scrim and poster are
   absolutely-positioned **siblings**, so the walk returns the frame's base colour — it reported
   15.58:1 for a chip whose real backdrop is a plate. Use a **glyph-pixel diff** (shoot with text
   visible, shoot with `color: transparent`, sample only where ink landed). And `visibility: hidden` is
   the WRONG control: it removes the chip's own plate, which produced 7082 phantom glyph pixels and a
   reproducible-to-2dp ratio that was pure artefact.
3. **A third reveal state exists: armed-and-never-entered.** `reveal.ts` sets `opacity: 0` from JS and
   clears it only when an IntersectionObserver fires, so a below-the-fold section stays invisible
   indefinitely — 5–10 nodes were still armed after a scroll sweep on an 8078px page, and a crop behind
   one reads the page background as a plausible, stable, wrong ratio. Force `is-in`.

Plus: **the builder canvas loads curriculum stages asynchronously** — 20 descendants at a 2.5s settle,
**128 at 9s**. A46's settle is calibrated for the public page and under-reports canvas fidelity.

### Two amendments were simply wrong, and saying so was worth more than the code

- **A56's seeder claim is false for the video types (A69).** `seed-portals.ts` writes `variant` on
  exactly four types (`hero`, `ache`, `map`, `invite`). Neither video type appears, so there was no
  seeder literal to be an artifact of — a **clean negative**. The check was still right to run; 0087
  and 0089 were positives.
- **A22's "`Codex-maf0y` is latent, not live" is wrong (A70).** It reasons from `createDefaultSections`
  being dead code, but the placeholder reaches pages via the **add-section path**, which seeds
  `defaultProps`. Two published rows confirm it.

### Each bridge fix promotes one more placeholder from invisible to visible (A70)

A seeded placeholder is invisible while its type's bridge is broken, because the renderer reads the
canonical key and the row stores the alias. Wiring the bridge **makes it render.** Measured: 2
occurrences / 0 rendered → 3 / 1 on a published page. `faq` and `proof` went through this in rounds 2
and 3 without anyone noticing the pattern.

So `Codex-maf0y` is not "placeholders exist" — it is a **queue**, and the remaining types are future
leaks. Do not fix it renderer-side: a renderer already self-hides an *absent* field, a placeholder is
present-with-placeholder-content, and string-matching seed text breaks the moment the seed changes.

### The builder MIS-authors; it does not merely fail to author (A72)

`SectionEditor.svelte:183-231` has no branch for `repeater`/`list`/`number`/`toggle`, so all four fall
through a catch-all `{:else}` to `<input type="text">` and persist a **string** into array- and
number-shaped keys. A creator sees a field labelled "Credentials", types into it, it saves, and nothing
appears. `feel.previewDuration` is worse still — it substitutes a hardcoded 480s rather than vanishing.

**The renderer's correct behaviour is to read the DECLARED shape only and self-hide.** Do not accept the
string: a field with two sub-fields makes `{label: <whole string>}` a guess dressed as data, and
shipping the guess makes it a contract the eventual migration must preserve. WT-6 reverted a first pass
that had done exactly that; the fix was *deleting* code, because `asObjectArray` already returns
undefined for a non-array.

**And the sequencing is counter-intuitive.** `valueOf()` blanks non-strings, so once a field correctly
holds an array the text box renders **empty over real content** and a creator "filling in the blank"
destroys it. The catch-all must stop claiming these kinds **before or with** the real control.

### Annotate-don't-drain is now *more* strongly justified (A71)

The canvas applies **no page-level styling at all** — not the nine axes, and not
`landing_pages.brand_overrides`. So draining a `_*.css` partial would take the twin from *untreated* to
*unstyled*, which A16 explicitly will not accept. Keep the port map, the non-1:1 splits, and the
deliberately-not-ported rules in the partial.

### Process notes that cost real time

- **Every agent this round wrote its report as assistant text and never sent it.** The orchestrator had
  to reconstruct two of the three from git and the database. If you are a subagent: your report only
  exists if you *send* it.
- **A62 worked.** All six of round 4's i18n key claims were accurate, against four false ones in round
  3. Quote the `en.json` line or call the key new.
- **A cold worktree reports 235 svelte-check errors, not 65.** `src/paraglide/messages.js` is a
  gitignored build artifact; until the vite plugin compiles it, every `$paraglide/messages` import
  errors. Run `svelte-kit sync` and start vite once before believing any svelte-check number.
- **`lsof -ti:PORT | head -1 && echo OCCUPIED` false-positives** — the pipeline's exit status is
  `head`'s, not `lsof`'s. Same class as `$?` after a pipe to `tail`.
- **The login form does not match the obvious selector.** The email field is `type="text"` with
  `id="email"`, so `input[type="email"]` never matches — and each failed attempt extends the shared
  5-per-15-minute rate-limit window. Use `#email` / `#password` / `button[type="submit"]`, and cache
  `storageState`.
- **The add-section control is `.section-list__add` and its label is `" Add"` with a LEADING SPACE**, so
  `hasText:/^Add$/` does not match.
- **Put the substance in the commit SUBJECT.** WT-2 folded its compositions into a commit *body*, and
  the orchestrator — who gates on subjects — wrongly concluded stage 3 was outstanding and asked it to
  justify itself.
