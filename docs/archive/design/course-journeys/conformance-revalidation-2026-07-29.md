# Journeys/Portals Conformance — RE-VALIDATION, 2026-07-29

**Bead:** `Codex-a1tz6`. **Supersedes the matrix in** `conformance-audit-2026-07-24.md` (kept for the
audit trail; do not delete). **Base:** `dev` @ `61fd9731` (PRs #432/#433/#434/#435/#436 all merged).

## Why this document exists

The 2026-07-24 matrix could not simply be trusted or re-run:

1. **Its fixture no longer exists.** That audit walked Studio Alpha's "Rootwork" journey (landing
   page `68479fa3-0ec5-426c-b8ee-eed9249773ca`). The row is gone — wiped by a test suite's
   `cleanupDatabase` against the shared local `main` DB. Every route in its matrix
   (`/journeys/rootwork*`) is dead, and its screenshots are gone from the worktree.
2. **It predates five merged PRs**, and three of its eight rows were provably wrong.

**Fixture used here:** org `of-blood-and-bones` (`ddea4b84-…`), course
`408f94d0-5442-43d3-a56a-3491110962eb` ("ASSSS BLASTER FART KING"), landing page
`06b45e59-8058-475a-85b8-b0f717948640`, slug `pricing-smoke-test`, **published**.
Verified intact: **3 stages / 12 practices** (4 written + 3 video + 2 audio), 1 completed purchase
+ entitlement + enrolment for `luzura@test.com`.

**Method:** all 8 routes probed server-side for status, then walked in a real browser as the owner.
Structure extracted programmatically rather than by snapshot. Colour measured with a **calibrated**
OKLab→linear-sRGB→luminance converter (self-checked: white-on-black must return 21.00 — it did, for
both `rgb()` and `oklab()` inputs). Themes tested by flipping `data-theme` on `<html>` and comparing
resolved values.

**No fixture was mutated by this re-validation.**

---

## Re-validated matrix

| # | Surface | Route (current) | Prototype | 07-24 said | **07-29 verdict** | Changed? |
|---|---|---|---|---|---|---|
| 1 | Sell / landing | `/journeys/pricing-smoke-test` | `course-sell.html` | CLOSE, "6/11 sections" | **CLOSE** — 11 sections render; no light/dark (light pole only) | **YES** (section note void) |
| 2 | Checkout | `…/checkout` | `checkout.html` | MODERATE-GAP, "payment stubbed" | **CLOSE** — genuinely buyable, 4 tiered offers, "Choose your way in" | **YES — row was wrong** |
| 3 | Member dashboard | `…/dashboard` | `course-dashboard.html` | CLOSE | **CLOSE** + forced-dark confirmed (`Codex-4i8x5`) + brand-source split | **partly** |
| 4 | In-course | `…/practice/:slug` | `content-incourse.html` | CLOSE / video broken | **CLOSE** — "Mark complete" present; **light/dark already correct**; video CSP-blocked | **YES** (improved) |
| 5 | Studio index | `/studio/journeys` | `studio-journeys.html` | CLOSE, revenue missing | **CLOSE** — revenue now renders (`£25 · 30d`) | **YES** (revenue landed) |
| 6 | Page builder | `/studio/journeys/:id/page` | `builder.html` | CLOSE | **CLOSE** — #435 verified; 3 real deltas remain | **YES — row was wrong** |
| 7 | Curriculum editor | `…/curriculum` | `course-editor.html` | **MOCK-ONLY** | **CLOSE** — real editor on live DB data | **YES — row was flatly wrong** |
| 8 | Insights | `…/insights` | `reporting.html` | MAJOR-GAP | **MAJOR-GAP — reproduced** + route is orphaned | no (worse) |

---

## Row-by-row evidence

### 1 — Sell page: the "6/11 sections" note is void
Renders **11 `.jp-section` blocks** vs the prototype's **10 `<section>`s** (the prototype has
`intro, ache, turn, reel, descent, feel, proof, guide, faq, invite`). The 07-24 "6/11" figure was a
property of *Rootwork's authored content*, not a code capability — a different journey with fewer
blocks configured. On this fixture the page is section-complete.

**Palette fix (`Codex-gfg50`) verified.** `journey-palette.css` resolves `--jp-ink` →
`var(--brand-bg)` → `#FFFBEB`, giving cream paper with near-black auto-contrasted ink, and
`--jp-ember` → `#552e8e` (the page-level `primaryColor` override wins). Values are byte-identical
under dark and light, which the file documents as intentional: a sales page is a browsing surface and
must follow the background the creator chose.

**That intent has now been superseded by a user decision (2026-07-29): the visitor's light/dark
choice must be respected here too.** The two goals are not in conflict — see **Theme support**.

The triple-repeated `.journey-palette.journey-palette.journey-palette` selector (line 62) is
load-bearing — it buys back the specificity point lost when these rules left a Svelte `<style>`.
Do not "tidy" it.

### 2 — Checkout: row was wrong
Anonymous render is complete: `h1` = **"Choose your way in"** (the exact prototype heading the audit
called missing), four offer cards, and a real `startJourneyCheckout` remote form with a submit
button. Sell-page CTAs deep-link correctly:

```
?offer=purchase              £24.99
?offer=subscription-monthly  £27
?offer=subscription-annual   £270
?offer=tier%3A33f6c1a1-…     £15
```
plus two bare `/checkout` primary CTAs. Entitled users instead get "Go to your dashboard" ×4 +
"Continue →" — correct owned-state.

### 3 — Member dashboard: content close, palette confirmed broken
Live data throughout: 3 stages, 12 practices, `0 of 12 practices · 0% through`, per-stage `0/4`, 13
practice links. The 07-24 LOW note *"'Continue' doesn't name the lesson"* is **fixed** — the CTA now
reads "Soul Path Mentorship / Stage i · aergaerg · Reflection". No `role=tab` in-page tabs (07-24
LOW note stands).

**`Codex-4i8x5` reproduced at the named lines.** `dashboard/+page.svelte:190-199`:
```css
--portal-anchor: var(--brand-color, var(--color-primary-600));
--portal-bg:      oklch(from var(--portal-anchor) 0.15 calc(c * 0.3)  h);
--portal-surface: oklch(from var(--portal-anchor) 0.2  calc(c * 0.35) h);
--portal-text:    oklch(from var(--portal-anchor) 0.94 calc(c * 0.08) h);
```
Hardcoded lightnesses — dark surfaces, light text, unconditionally, identical in both themes. This
is `gfg50`'s exact bug shape, third copy. Worse than 4i8x5 records: the dashboard is **discarding a
per-theme background that already works one element up**. On the very same page, its `[data-org-bg]`
ancestor resolves `--color-background` to `#1A1207` in dark and `#FFFBEB` in light. The
`.journey-portal` derivation throws that away and re-derives from `--brand-color` instead.

**User decision 2026-07-29: the visitor's light/dark choice must be respected on all journey
surfaces, the sell page included.** See **Theme support** below.

**New finding (not on any bead): the brand source splits between surfaces.** `--brand-color`
resolves to `#552e8e` on the sell page (page-level override applied) but `#EA580C` on the dashboard
(org primary; the override is scoped to the landing-page artefact). Defensible scoping, but one
journey renders purple when you buy it and orange once you're inside.

### 4 — In-course: improved
Written practice renders prose correctly, with a 13-link stage rail, a "Here" marker on the current
practice, per-stage counts and a "Next practice" link. **The 07-24 note that only auto-complete
shipped is now wrong — an explicit "Mark complete" button is present**, matching the prototype.

The practice route declares **no palette tokens of its own** — no `.journey-portal`, no
`.journey-palette` — and is therefore the **only journey surface that already honours the visitor's
light/dark preference**, because it simply consumes the ambient `[data-org-bg]` tokens:

| | dark | light |
|---|---|---|
| `--color-background` | `#1A1207` | `#FFFBEB` |
| painted text colour | `oklch(0.9 0 0)` | `oklch(0.05 0 0)` |

It is **not** a fourth copy of the forced-dark derivation. Do not "fix" it — it is the reference
behaviour the other two surfaces should be brought up to. See **Theme support** below.

Video remains broken in dev, cause confirmed straight from the response CSP header:
`media-src 'self' blob: … http://localhost:4100 http://*.nip.io:4100` — no access-worker origin.
→ `Codex-8tku7`, unchanged.

### 5 — Studio index: revenue landed
`h1` = "Portals". Row reads **"3 stages · 12 practices · 1 enrolled · £25 · 30d"**. Confirmed in
source that `£25` is genuine 30-day revenue, not the price: `journeys/+page.svelte:19,50-53,153`
calls `listJourneyRevenue` (a separate authoritative query keyed by landing-page id) and renders
`{rev} · 30d`. **`Codex-9p47t` has landed; per-journey revenue is no longer null.**

Still open: filter tabs are status (All/Draft/Published/Archived) vs the prototype's type
(All/Journeys/Pages/Drafts). Row actions are only "Curriculum" + "Edit page" — no
publish/unpublish/archive/view-live (`Codex-c3lky`) **and no Insights** (see row 8).

### 6 — Page builder: #435 verified, three real deltas remain
Top bar is now 4 children, and the `<select>` is `flex: 0 0 auto` at **106px** — the unconstrained
fill-available basis is gone. Measured every control's true line-box count via
`Range.getClientRects()`: **all exactly 1 line**, `View live ↗` = 103×40px, bar does not overflow,
no document overflow. The `r4zzu` regression is genuinely fixed.

(`jb__doc` reports 2 client rects, which is *not* a wrap — it is `white-space: nowrap` containing a
text node plus a replaced `<input>`; the title is inline-editable, which exceeds the prototype.)

Remaining deltas vs `builder.html`, **for a1tz6 to decide**:
- **No "Studio." brand home link** (`hasStudioBrandLink: false`).
- **No "Insights" artswitch tab** (`hasInsightsLink: false`) — nav has only Curriculum + Sales page.
- Status is a `<select>` where the prototype shows a gold uppercase pill badge.
- 49px bar vs prototype 52px; `--radius-full` vs prototype's 9px/7px rounded rects.
- We *exceed* on device options (3: Desktop/Tablet/Mobile vs prototype's 2).

### 7 — Curriculum editor: the 07-24 row was flatly wrong
Not a mock. All **3 DB stage names** and all **12 DB practice titles** render live, with `Save`,
`Add a practice`, numbered stage cards ("01 aergaerg … 4 practices") and a `ce__insp` inspector
pane. This false row is what seeded `Codex-03cwh` (since verified and closed).

**Legibility — now measured, instrument calibrated.** Two real WCAG AA failures, both
opaque-on-opaque:

| Text | fg → bg | Size/weight | Ratio |
|---|---|---|---|
| "Select a practice to see its contents" | `oklch(0.55 0 0)` → `#1A1207` | 15px/400 | **3.82** |
| Studio rail "Studio" label (×16) | `oklch(0.55 0 0)` → `#1A1207` | 13px/500 | **3.82** |
| "Of Blood & Bones" (×32) | `oklch(0.610874 0 0)` → `#1A1207` | 15px/600 | 4.90 ✓ |
| "Save" | `oklch(0 0 0)` → `#FB923C` | 15px/600 | 9.28 ✓ |

Both failures come from the same muted-grey token on the dark studio chrome and appear in the studio
rail as well as the curriculum pane, so this is a **platform-wide muted-text issue, not a journeys
conformance delta**. It needs its own bead; fixing it inside a1tz6 would be mis-scoped.

**Discarded measurement:** the `Portals` nav pill reported 1.00, but its background is a 15%-alpha
layer that my effective-background walk returned *uncomposited*. That number is an artifact of
skipping alpha compositing, not a finding. (This is exactly the trap that produced the bogus 1.0 /
1.13 figures previously — any contrast number over a translucent background needs compositing first.)

### 8 — Insights: reproduced, and the route is orphaned
Reproduced exactly on the new fixture: **7 perpetual "Loading metric" skeletons** (28 skeleton
nodes), zero metrics rendered, **no error state and no console error** — a textbook silent failure.
`Codex-xo3bl` unchanged and still P1.

**New, and worse than 07-24 recorded: the route has no entry point anywhere in the app.**
`/studio/journeys/[id]/insights` is fully implemented (`+page.svelte` importing `getJourneyInsights`
plus a whole `$lib/components/studio/journey-insights` directory), but a repo-wide search for
hrefs/`goto` to it returns **nothing**. The studio index row offers only Curriculum + Edit page; the
builder top bar (`page/+page.svelte:369`) links only Curriculum. It is reachable only by typing the
URL. Note the sequencing: linking it before `xo3bl` is fixed would surface a permanently-loading page.

---

## Theme support (light/dark) across the three journey surfaces

**User decision, 2026-07-29:** the visitor's light/dark preference must be respected on every journey
surface, including the landing/sell page. This supersedes the "must not force dark" reasoning written
into `journey-palette.css`, which delivered *the creator's background* but gave up *the visitor's
theme*. Those are two independent axes and both can be satisfied.

### The machinery already exists and already works

`tokens/org-brand.css` carries a two-pole brand background and switches on theme:

```css
[data-org-bg]                     { --color-background: var(--brand-bg, white); }
.dark [data-org-bg],
[data-theme='dark'] [data-org-bg] { --color-background: var(--brand-bg-dark, var(--brand-bg, #1a1a2e)); }
```

Measured on `of-blood-and-bones`, **both poles are populated**: `--brand-bg: #FFFBEB`,
`--brand-bg-dark: #1A1207`, and `[data-org-bg]` flips correctly between them. So this is **not a new
feature** — it is two surfaces declining to use working infrastructure.

### Current state

| Surface | Honours visitor theme? | Why |
|---|---|---|
| Sell / landing | **No** — cream in both | `--jp-ink: var(--brand-bg, …)` reads only the **light** pole; no theme branch exists |
| Member dashboard | **No** — dark in both | private `--portal-*` ladder off `--brand-color` at hardcoded lightnesses |
| In-course | **Yes** ✅ | no bespoke palette; consumes ambient `[data-org-bg]` tokens directly |

### Fix shape

**Sell page — a one-input change.** Every rung of the ladder (`--jp-heading`, `--jp-text/dim/faint`,
`--jp-ink-2/3/4`, all four hairlines, `--jp-atmos-veil`) is derived from `--jp-ink`'s **own
lightness** via auto-contrast. The file says so itself: *"This is the ONE input the whole ladder hangs
off, which is what makes light and dark both correct with no branch."* The author built it to flip
from a single input and then never wired that input to the theme. Adding a dark branch for `--jp-ink`
alone makes headings, text, insets, hairlines and the atmosphere veil all correct at once:

```css
/* same triple-class specificity as the base rule — see the SPECIFICITY note in the file */
.dark .journey-palette.journey-palette.journey-palette,
[data-theme='dark'] .journey-palette.journey-palette.journey-palette {
  --jp-ink: var(--brand-bg-dark, var(--brand-bg, var(--color-background)));
}
```

Note both selectors are required: the theme init script sets `data-theme` **and** a `.dark`/`.light`
class on `<html>`, so a rule keyed on only one of them will be beaten by an org-brand rule keyed on
the other.

**Dashboard — delete the private ladder.** Adopt `.journey-palette` + `.journey-palette--page`
instead of the bespoke `--portal-*` derivation. That is what `gfg50` set out to achieve ("the ONE
derivation, shared by every journey surface") and the dashboard was simply never migrated. It also
**dissolves the brand-source split** in one move: surfaces would come from `--brand-bg`/
`--brand-bg-dark` and `--brand-color` would be left doing what it should — the ember accent only.

### Verification requirement

`jsdom` implements neither `oklch()` nor `color-mix()` and returns custom properties as their raw
declared string, so a jsdom test will pass against a still-broken palette. Colour must be asserted in
a real browser, and the theme must be flipped by setting **both** `data-theme` and the
`.dark`/`.light` class — flipping only the attribute leaves `.dark [data-org-bg]` matching and
silently reports "theme-invariant" for a surface that is in fact theme-correct. (That error was made
and corrected during this very re-validation; it is what originally made row 4 look broken.)

---

## Net change vs 2026-07-24

**Rows that were wrong and are now corrected:** 2 (checkout), 6 (builder), 7 (curriculum) — as the
bead predicted. Row 1's "6/11 sections" note is also void (it was per-journey content, not code).

**Improvements found that no bead recorded:** checkout offer grid + "Choose your way in"; dashboard
"Continue" now names the practice/stage/type; in-course "Mark complete"; studio-index 30-day revenue.

**Still-open, correctly-tracked:** `Codex-xo3bl` (insights), `Codex-8tku7` (CSP media-src),
`Codex-c3lky` (index row actions), `Codex-4i8x5` (dashboard forced-dark), `Codex-3tmt1` (aria
duration), `Codex-5xedi` (dead `JourneyCanvasToolbar.svelte`).

**New findings from this pass:**
1. **Light/dark is unimplemented on 2 of 3 journey surfaces**, while the two-pole
   `--brand-bg`/`--brand-bg-dark` infrastructure exists and works. Sell page reads only the light
   pole; dashboard forces dark off `--brand-color`; in-course is already correct. (See **Theme
   support**.) → user decision: respect the visitor's choice everywhere.
2. **Insights route is orphaned** — implemented, zero entry points. (Row 8.)
3. **Brand source splits across surfaces** — page override on sell, org primary on dashboard;
   dissolved for free by migrating the dashboard onto `journey-palette.css`. (Row 3.)
4. **Platform-wide muted-text AA failure** at 3.82:1 on dark studio chrome — not journeys-specific. (Row 7.)

**Method correction worth keeping:** flipping only `data-theme` is an insufficient theme flip in this
codebase (the init script also sets a `.dark`/`.light` class, and `org-brand.css` keys rules on both).
An incomplete flip reports a theme-correct surface as "theme-invariant" — it made row 4 look broken
here before being caught.
