# Landing builder, phase 3: the org's page, every section with a purpose, freedom that stays good

Status: **ACCEPTED 2026-09-30.** The owner chose, verbatim option labels:
- D1 "Follow the org (Recommended)";
- D2 "Keep the drama, add a dial (Recommended)";
- D3 "Facets from a proven list (Recommended)";
- D6 "Fixes first, then brand (Recommended)".

D4 and D5 are still open. Written 2026-09-30 from three
read-only audits (bead Codex-61zsk.37). The evidence is in the session scratchpad:
- `p3-brand/findings-{1-3,4-6}.md`: 60 pages across 3 orgs, org site against sales page, plus
  shaders and players;
- `p3-research/findings.md`: Squarespace, Framer, Webflow, Wix Studio, Shopify, Canva, the course
  builders, Radix and Material 3;
- `p3-components/findings-{1,2,3}.md`: all 16 section types and 51 layouts, in 4 Styles at 2
  widths, 408 captures, measured.

## 1. The brief, in the owner's words

> "its most compoents really there is a level of desing polish that is missong from them its a
> lack of feeling like i can make it my own paired with a lack of thoughtfull design. feeling of
> controll. like styles ste testrictive i can mix and matxh styles"

> "every componet should have exceptionall purpose be beautiful and display its purpose well.
> like players could be better. we sre not using any of the shaders we have made the branding ones"

> "its a scence of more controll that always looks good and is styleable by the brand we have and
> is also overrideable giving me controll. mixing machong more freedom but always looking good."

> "we could mabye bring more of the orgs brandong i to this as it can be quite jarring going from
> sifferent branding to this quite ridged desing system"

## 2. What we found

**1. The sales page is built as a second design system from the same brand.** The org's site is
drawn from about 50 tokens its brand editor derives: surfaces, text greys, borders, button
colour, focus, shadows, label case, card behaviour, the shader haze. The page kit reads only the
raw inputs (colours, fonts, radius, density) and derives everything else again, itself. The
symptoms a visitor sees, walking from the org's site to a sales page:
- **Dark mode flips.** Of Blood & Bones stays light parchment in dark mode, but its sales pages
  turn near-black, and the button turns bright orange with a black label.
- **The org's shader haze disappears.** Every org page glows through it. Sales pages paint
  opaque over it, while the GPU still renders it underneath. Only Cinematic shows the shader by
  default. Two of the three orgs have no shader preset at all.
- **The small details all change.** Uppercase, letter-spaced labels become sentence case (the
  same line is uppercase on explore and checkout, but not on the sales page). 44px buttons become
  56px. Colour bands appear that the org's site never uses, and one Style even invents a second
  colour the org never chose.
- **The org's logo appears nowhere on the page.**

**2. Most sections show their structure, not their point.**
- **Headings shout and the content whispers.** In 48 of 51 layouts, most of a section's own
  words are body-sized, under headings 3–6× larger. The problem section's "that's me" signs are
  its smallest text. The transformation's payoff is no bigger than the pain. The benefits sit
  small under a huge headline.
- **One separating device per Style, used everywhere.** In Bold, a hairline sits under 139 of 220
  list items. That sameness is the "templated" feeling.
- **Empty promises reach visitors.** A hero with no picture shows the editor's placeholder shape,
  and it is live on Tending the Grief's first screen. A video section with no film still says "Two
  minutes, from me to you".
- **Free text contradicts live data.** "£15 per month … One payment, no deadline" sits side by
  side on a real page. Filed as P1 (Codex-61zsk.38).
- **Proof has no people.** Testimonials are text only.
- **Pictures can't be steered.** There is no focal point, so every frame crops blind.
- **Duplicates.** Video and preview are the same component. The story section retells the
  curriculum.

**3. The players are thin.** Every clip opens in a pop-up with play and mute only: no scrubber,
no captions, no poster. An audio preview would open as a blank video box. The platform's own
players already put the brand colour on play, progress and the waveform.

**4. Control is all-or-nothing.** A creator picks one of 8 whole Styles. The Style tab offers 2
colours and 2 fonts, although the data path already carries radius, density, dark colours and a
logo. Inside a layout, nothing can be tuned.

**5. How others do it** (research). Builders that feel free but stay good share five moves:
- the brand is a few seed values that flow everywhere;
- dials move in **curated steps**, never free sliders;
- sections pick from **named colour themes** (Shopify and Podia work almost exactly like our
  schemes);
- **presets are a starting point**, fully overrideable, with a reset;
- safety comes **by construction**, not by checking afterwards.

Nobody automates taste; they guarantee mechanics and show good previews.

## 3. The model: four layers, each one proven

```
  ORG BRAND        the base: the org's own derived tokens, dark mode, shader, logo
     ↓
  STYLE            a treatment: type drama, rhythm, surfaces, motion, marks, layouts
     ↓
  PAGE             dials (curated steps) + facets you can swap between Styles
     ↓
  SECTION          layout, colour theme, spacing, and 2–3 designed controls inside it
```

### 3.1 The org's brand is the base layer: inherit it, don't re-derive it
- The kit's ground, bands, panels, text, borders, buttons, focus, radius, label case and shadows
  are taken from the org's derived tokens. The kit's contrast maths becomes a safety net: it
  moves a colour only where a proven floor would fail, instead of being the source.
  (Mapping table: `p3-brand/findings-4-6.md` §6.)
- **Dark mode follows the org.** Whatever the org's site does in dark mode, its sales page does
  too (decision D1).
- **The shader is part of the brand.** When the org has one, every Style's hero and closing ask
  default to showing it (decision D4). The haze the org's site has can show through the page too.
  The org's logo gets a slot.
- **What a Style still owns:** layouts, the display type's drama and rhythm, surfaces and their
  devices, motion and signature interactions, marks, and which sections get colour bands.

The result: the page reads as a page of the org's site. A Style changes how it is arranged and
paced, not whose it is.

### 3.2 Mix and match: facets, from an allow-list
A Style becomes a named bundle of four **facets**:
- **Type**: display drama, rhythm, case;
- **Surface**: bands, cards, separating devices;
- **Motion**: entrances, signature interactions;
- **Marks**: decoration.

A creator picks a Style, then may swap any facet for another Style's version. For example,
Bold's type with Soft's surfaces, or Studio's marks on Clean.

**The guarantee:** only combinations the automated matrix has proved appear in the menu (contrast
under the brand sweep, and the headline fit at every length). The menu IS the allow-list, so a
creator can't reach an ugly combination. This widens the research's narrower suggestion (one
Marks dial) to answer "mix and match" directly, and it keeps the reason the old nine free axes
failed out of reach: nothing is free, everything is a proven pick.

**The honest cost:** today each Style's CSS is one bundled sheet. Splitting it into facets is a
refactor, so it starts with a spike that measures it (§6).

### 3.3 Page dials: a few, in steps
Five dials, three steps each, every step in the test matrix:
- **Type drama:** calmer · the Style · louder. Louder stays inside the proven fold fit.
- **Spacing:** compact · the Style · airy.
- **Motion:** still · gentle · full. Reduced-motion users always get still.
- **Corners:** the brand's own · the Style's bend · softer.
- **Colour:** brand only (the org's quiet surfaces) · the Style's bands · bolder bands.

Every dial has "use the Style's" as its reset.

### 3.4 Ownership inside a section
Each section gets 2–3 designed controls, never free CSS:
- which element leads;
- alignment;
- where the picture sits;
- the lead item;
- marks or icons for benefits;
- a face for each testimonial;
- a focal point on every picture (tap to set). This is the broadest single control.

## 4. Every section with a purpose

**Five changes that lift the most:**
1. **No placeholder and no empty promise on a public page** (a kit-wide rule, copied from the
   gallery). It fixes Tending the Grief's live hero.
2. **A middle type size** for the element that does each section's job: the sign, the benefit,
   the after-line, the credential, the stat label. It lifts about ten sections at once.
3. **The ask travels with its offer:** every button shows its own price and billing line. A single
   offer gets a "what's included" list built from the course. It fixes the live contradictions
   (Codex-61zsk.38).
4. **Faces on proof:** an optional photo per testimonial, with initials as the fallback.
5. **A focal point on every picture.**

**Plus one change per section** (from the audit; S under a day, M 1–3 days):

| Section | The one change | Effort |
|---|---|---|
| Hero | recompose as type when there is no picture; an automatic facts line ("6 stages · 24 practices · £49") | S |
| Video | hide it until there is a film; a speaker and length line | S |
| Problem | the signs at the list's size, straight under the sentence | S |
| Story | make scroll immersive (a large sticky frame, the active step at heading size); tell the member's arc, not the syllabus | S–M |
| Text | the picture supports the words, not leads them | S |
| Transformation | the payoff is the loudest line in every layout; the toggle opens on "after" | S |
| Benefits | a creator-chosen mark (icon or figure) per benefit | M |
| Curriculum | stage summaries that open on phones (half the height) | S |
| Preview | a sample of the course, not a second film: kind, length, and an audio frame | M |
| Gallery | a lightbox, so you can look closer | S–M |
| Instructor | a monogram when there is no portrait | S |
| Testimonials | faces (above) | M |
| Stats | Bold's big numerals in every Style, with labels that read as claims | S |
| Pricing | a single offer gets two columns and a "what's included" list | S–M |
| FAQ | "Still wondering? Ask me" as the closing row | S |
| CTA | the price and billing line beside the button | S |

**Players:** build the sales-page player on the platform's own VideoPlayer and AudioPlayer, with
a poster frame, a scrubber, captions, brand chrome and a real audio frame. Carry the clip's kind
and length through the data. Decision D5: play in place, or in a better pop-up.

**Shaders:**
- the org's shader around framed pictures;
- a page-level shader preset or intensity (needs one new channel to the org layout);
- a still frame of the shader in the editor's thumbnails;
- an editor nudge for orgs with no preset.

All of it with one canvas, measured.

## 5. Fix now, whatever the decisions

These are live and outside the phase:
- **Codex-okfrf (P1):** the org HOME hero is white on light parchment (about 1.1:1) on orgs
  without a shader.
- **Codex-61zsk.38 (P1):** pricing and CTA small print contradict the price shown.
- **The hero placeholder** on Tending the Grief's public first screen (the "no empty promises"
  rule, hero part).
- **Codex-h3ipg (P2):** the owner sees "Purchase to watch" on their own free content (to check).

## 6. The plan, in order

| Phase | Work packages | Why this order |
|---|---|---|
| **3a: it's the org's page** | B1 the kit on the org's derived tokens (surfaces, text, buttons, focus, label case, shadows, radius), with the dark-mode rule. B2 shader defaults and haze. B3 a brand-fidelity test (the page measured against the org, not only "no literal colours"). | Removes the jarring feeling, and changes the tokens everything else sits on. |
| **3b: every section earns its place** | C1 no empty promises. C2 the middle type size and separating devices by role. C3 offers told honestly. C4 faces, marks and focal points. C5 the per-section changes. C6 players. | Builds on 3a's tokens; the biggest visible lift. |
| **3c: make it mine** | D0 a facet spike (measure the refactor). D1 page dials. D2 facet mix-and-match. D3 controls inside sections. D4 the editor UI for all of it. | Needs 3a and 3b stable underneath. Dials first, facets after the spike. |

Each work package: one agent, gated, one commit, as in phase 2. As rough sizes, 3a is about 3
agent tasks, 3b about 6, and 3c about 5.

## 7. Decisions for the owner
- **D1. Dark mode:** follow the org's own outcome (a light-parchment org stays light), or have
  the brand editor derive a real dark ground for every org?
- **D2. Display type:** keep the Styles' big expressive headlines (phase 2's look), or bring
  headings closer to the org's own scale?
- **D3. Mix and match:** facets swapped between Styles from a proven allow-list (§3.2), or page
  dials within one Style first, with facets later?
- **D4. Shader:** when the org has one, should every Style's hero and closing ask show it by
  default?
- **D5. Players:** play the intro film in place on the page, or keep a pop-up with full controls?
- **D6. Order:** 3a (brand) first as proposed, or the visitor-facing fixes (§5 and C1) first as a
  quick win?
