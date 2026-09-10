# 03 — Beauty amendment to the axis contract

**Status: APPROVED 2026-09-10.** `B1`–`B5` are amendments to `02-axis-contract.md` and
carry its authority. Two clauses were decided by the owner at approval time and the
decisions are recorded inline below (see B5 and the imagery note).

Raised because the previous pass made the eight looks *technically distinct* and the
owner's verdict was that they are **boring**. This doc argues that the contract itself
is the ceiling, states what it would take to lift it, and — importantly — says what
must NOT move.

---

## Why: the measured case

All figures measured in the builder canvas at a true 1440px section width
(`--jbc-k: 1`, no downscaling), reveals forced to their resting state, on
`of-blood-and-bones` / "Bone Deep". Every one of the eight presets' nine axes was
confirmed against `design-vocabulary.ts` before measuring — 8/8 match.

**M1 · Every look is a text stack on an empty stage.** The seeded hero uses the
catalogue's default variant `stage`, whose own hint in `section-catalog.ts` reads
*"Headline stack over an atmosphere layer"*. There is no atmosphere layer. Of the six
hero compositions only `split-media`, `full-bleed` and `poster` carry a media panel,
so `stage` can never show an image.

**M2 · The `media` axis cannot act.** Before content seeding: 0 `<img>`, 0 `<video>`,
0 `<picture>` across all 9 sections in all 8 looks. After attaching the org's only
ready video, the entire page renders exactly ONE `<img>` — the guide portrait — and it
computes to **0×0** in five of the eight looks. `media: bleed`, one of only four axes
that uniquely identify Candlelit, renders nothing at all.

**M3 · The atmosphere layer exists and is not mounted.** `lib/components/ui/ShaderHero/`
is a 60-file WebGL2 system (aurora, caustic, ink, mycelium, lenia, bismuth, frost,
including FBO sim/display pairs). The org brand already configures it:
`--brand-shader-preset: flow`, `intensity: 0.85`, `vignette: 0.45`, `grain: 0.08`. The
org layout and the auth pane mount it. **No page-builder component does** — stated in
the builder's own source at
`routes/_org/[slug]/studio/journeys/[id]/page/+page.svelte:455`. The hero's `bg` field
still tells the author *"Uses the org brand shader unless overridden in Brand & theme"*,
which is false; `bg` selects between three CSS glows (`ember` / `blood` / `still`).

**M4 · Typography is one family, one weight, four sizes.** Measured display size per
look: 32.4 / 47.52 / 51.84 / 86.4px — four values across eight looks, three of which
share 86.4px. Weight is `400` in all eight and family is `Archivo Black` in all eight,
because the brand's display face ships a single weight. Eyebrows span 14.04→18.36px:
a 4px range for the whole system.

**M5 · The `type` ladder inverts.** `expressive` renders **47.52px**, `balanced`
renders **51.84px** — so Open Air and Full Send, the two looks meant to be most
exuberant, have a *smaller* headline than Long Read and Signal. Cause: `--jp-display`
borrows `--text-5xl` (max `2.75rem`) for `expressive` and `--text-4xl` (max `3rem`) for
`balanced`. Independently measured and documented in `InviteSection.svelte` at three
viewports (30 / 48 / 44 / 80px at 1440). `--jp-heading-size` is monotonic; only
`--jp-display` inverts.

**M6 · The opening screen is mostly empty.** Hero content band as a fraction of hero
height, before content seeding: 27 / 42 / 30 / 24 / 39 / 25 / 29 / 28% — six of eight
under 31%. After seeding real copy: 43–70%. Copy fixed most of it; the rest is
composition.

**M7 · One page, two brand blues.** The accent/ember chain resolves `#0e27e1` (the
page-level `--brand-color` override) while `CtaLink` resolves `#4465FF` (the org
brand), because `--color-brand-primary` is only re-derived at `[data-org-brand]` scope
and a page-level override never reaches it. Visible in the Full Send hero: the eyebrow
pill and the CTA pill are different blues.

### Why the previous pass could not see any of this

It gated on **the number of CSS rules keyed on axis attributes** (39 → 320) and on each
look's documented "tell" being present. That metric is blind to M1–M7 by construction:
a look scores well by having many axis-scoped rules. Nothing in it can notice that the
stage has no atmosphere, that the ladder inverts, or that the page paints two blues.

---

## The amendments

### B1 — Every look gets an atmosphere layer, and `surface` is the seam

Mount the existing `ShaderHero` in the journey render tree, driven by the org brand's
own shader tokens, so the `stage` variant's promised atmosphere exists and the `bg`
field's hint becomes true.

**Keyed on `surface`, and only on values other than `media`.** That is not a
convenience — it is the Candlelit guard. Candlelit is the sole look with
`surface: media`; the other seven are `bare` (×2), `tint`, `panel` (×3) and `invert`.
So `[data-jp-surface]:not([data-jp-surface='media'])` selects exactly the seven looks
that have no atmosphere today and cannot reach Candlelit, without compounding
selectors by hand.

Per-surface intent, so the layer is characterful rather than uniform: `bare` gets grain
and a barely-there vignette; `tint` a slow drifting mesh; `panel` a flat plate with an
edge-lit gradient; `invert` the shader at full strength. Static-first per A40 — the
still frame is the baseline and motion is additive.

### B2 — A real display scale, built brand-agnostically

1. **Fix the inverted rung journey-locally, not globally.** `--text-5xl` has seven
   consumers outside the journey system (pricing page ×3, `TopicCard`, `ProofSection`,
   and the clamp *ceilings* of `TodayStat` and the library page), so mutating the global
   token to fix `--jp-display` is a seven-surface change to unrelated pages. Re-point
   `--jp-display` at `expressive` to a rung between `--text-4xl` and `--text-display`
   inside `journey-design.css` instead: one integrator-owned file, zero blast radius.
2. **Widen the range.** Four display sizes across eight looks, three of them identical,
   is not a scale. `restrained` should read as quiet and `monumental` should be
   genuinely large.
3. **Contrast comes from the two faces every brand already has.** `--brand-font-heading`
   against `--brand-font-body`, plus case, tracking, optical size and italic. **Never
   weight** — the brand's display face ships one weight and asking for 700 faux-bolds
   it. **Never a hardcoded family** — that is what "brand-agnostic" forbids. The
   italic accent ending already present on the hero (`hero.accent`, set in brand colour)
   is the existing seam to build on.
4. **Reach the small type.** `--jp-body-size` exists (A44); the eyebrow reached the axis
   only recently. Chips, fact rows, captions and meta lines are most of most sections.

### B3 — Motion beyond arrival

The `motion` axis governs only entrance-on-scroll. Extend it to hover choreography and
scroll-linked transform, keyed per motion value so `none` really is none.
`prefers-reduced-motion` is honoured, and per A40 the static layout is the baseline that
motion enhances — not a fallback bolted on afterwards.

### B4 — Composition may be asymmetric

`align` and `width` currently produce centred or left-aligned stacks, so all eight looks
are one composition eight ways. Permit offset columns, deliberate overlap, and
full-bleed elements crossing a column, as axis-keyed options rather than per-section
inventions.

### B5 — `media: bleed` needs a hero that can bleed, and a real scrim

Two blockers, both prerequisites for B1/B4 to show imagery:

- **DECIDED: the `media` axis selects the hero composition.** `bleed` → `full-bleed`,
  `frame` / `inset` → `poster` or `split-media`, `none` → `stage`. The axis finally does
  what its name says, and the consequence is accepted deliberately: an axis may now
  change the composition an author picked, so the composition control and the `media`
  axis must not both silently claim the same decision — whichever the author set LAST
  wins, and the builder has to say so.
- Because imagery leans on atmosphere rather than photography (below), `full-bleed` with
  no still is not an empty state: the atmosphere layer fills the section and the copy
  sits over the scrim. That is the intended Candlelit-adjacent composition for `bleed`.
- `--jp-media-scrim` is `none` on four of five `media` values, so every composition
  putting text over media invents its own contrast floor. Every value needs a real scrim
  with a MEASURED contrast result — and now that a composition can be media-led without
  a photograph, the scrim must be measured over the atmosphere layer too, not only over
  an image.

### Imagery: atmosphere is the primary visual, photography is the exception

**DECIDED at approval.** The fixture org owns exactly one on-brief photograph; the rest
of its assigned stock (a graffiti mural, a rail of clothes hangers) actively fights a
somatic-practice brand. So the visual identity of these looks comes from the
brand-driven atmosphere layer (B1), and a photographic still is used only where one is
genuinely called for. This is not a fallback for missing assets — it is the direction:
brand-derived texture cannot go off-brief the way stock can, and it is the same lever
B1 already requires.

---

## What must NOT move

- **Candlelit is unchanged.** It is the one look the owner rates. B1's `surface != media`
  seam is chosen specifically so no atmosphere rule can reach it. Any change touching a
  Candlelit-shared axis (`type: monumental`, `align: center`, `density: airy`,
  `width: text`, `motion: drift`) must compound its selector to exclude it, and be
  verified by an axis-aware blast-radius check rather than asserted.
- **A19 frozen files stay frozen**: `render/reveal.ts`, `render/safe-href.ts`,
  `render/brand-overrides.ts`, `page-builder-store.svelte.ts`, `builder-save.ts`,
  `page-preview-bridge.ts`, `preview-protocol.ts`.
- **`CtaLink` keeps sole ownership of `.cta` colour** (`Codex-kdsuo`). M7 is a real
  defect, but re-routing the accent needs a measured contrast sweep at `accent: none`
  across the seeded brands and sign-off — not a section-local repaint.
- **`messages/en.json` stays single-owner.** Paraglide regeneration in a shared tree
  strips other writers' keys.
- **Contrast floors hold.** `04-contrast-baseline.md` is not relaxed to buy contrast-free
  prettiness.

---

## How this gets verified

**By looking.** Render all eight looks, screenshot them, and the owner judges. The
harness for that exists and is scripted: preset sweep, forced reveals, true 1440px
width, axis assertion per look.

Numeric gates are for **regression only**, never for quality:

- Candlelit renders identically to the pre-amendment commit (axis-aware diff).
- No dead custom properties — parse the registry, never grep for names.
- No raw colour literals in the section tree.
- Measured contrast at every `accent` and `media` value, on both theme poles.
- `--jp-display` is monotonic across the four `type` values, measured at 375 / 768 /
  1440 — the check M5 would have failed.
