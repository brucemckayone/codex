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
