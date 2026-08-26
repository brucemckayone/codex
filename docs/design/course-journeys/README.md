# Guided Journeys / Course Landing — design capture & productization spec

**Status:** design capture. §1–6 (the design work, map model & learnings) are current;
**§7 (productization/data-model) is superseded** — see the authoritative backend spec
[`SPEC.md`](./SPEC.md) (v2) and the front-end→backend→design-system bridge
[`FRONTEND-MAP.md`](./FRONTEND-MAP.md). The prototype has since grown to **13 surfaces +
a user-flow/friction map** ([`./prototype/flows.html`](./prototype/flows.html)).
**Prototype:** [`./prototype/`](./prototype/) — static, self-contained HTML/CSS/JS.
**Purpose of this doc:** preserve the design work and its learnings. *Why* the sales page
looks the way it does lives here; *what to build* lives in SPEC.md + FRONTEND-MAP.md.

Built with "Of Blood and Bones" (a somatic brand, course = *Rootwork*) as the worked
example, but every string, colour, and section is meant to become creator-supplied.

---

## 1. Viewing the prototype

It's plain static files (no build). Per house convention, serve over the LAN:

```bash
cd docs/design/course-journeys/prototype
python3 -m http.server --bind 0.0.0.0 8848
# then open http://<lan-ip>:8848/course-sell.html
```

Key files:

| File | What it is |
|---|---|
| `course-sell.html` | **The sales page** (the seller) — the main artifact. Assembled from `sections/*.frag.html`. |
| `course-dashboard.html` | **The journey dashboard** (the practical member view). |
| `course-data.js` | The single `window.COURSE` object both surfaces render from. |
| `fresh.css` | The prototype's design tokens + atoms (a *stand-in* for the real Codex tokens). |
| `sections/*.frag.html` | One self-contained fragment per page section (style + markup + IIFE). |
| `sections/_head.html`, `_foot.html` | Assembly shell. `cat _head + fragments + _foot > course-sell.html`. |
| `sections/BRIEF.md` | The shared design brief every section was built against. |
| `index.html`, `1-threshold` … `4-descent` | The earlier divergent concept exploration (see §3). |

---

## 2. The core idea: one course, two surfaces

A course/journey is **one dataset rendered two ways**:

- **Sales preview** (public, not purchased) — optimizes for *desire*: story, scope,
  proof, a free taste, one price. This is the seller.
- **Journey dashboard** (member, purchased) — optimizes for *momentum*: resume, what's
  next, progress. A playlist rail + working pane.

They share `course-data.js` so the lesson list can never drift between them. This is
the crux of the productization: **the creator authors the course once; the platform
renders both surfaces.**

---

## 3. How we got here (exploration trail — worth keeping)

1. Rejected: a "hub of many journeys" drawn as node-and-edge diagrams (8 variants).
   Lesson: a topology diagram is a *designer's* goal, not the visitor's.
2. Reframed around **purpose**: a first-touch page should lead with *person → feeling
   → next step*, not structure. Four fresh concepts explored (`index.html`):
   **Threshold** (editorial), **Body** (felt-sense map), **Intake** (one question),
   **Descent** (cinematic scroll). → **Descent won.**
3. The Descent became a single-course landing; then rebuilt section-by-section to
   award-level polish; then the map was re-modelled (see §5) and video added.

---

## 4. Anatomy

### Sales page (`course-sell.html`), in scroll order
| Section | Role | Fragment |
|---|---|---|
| Hero | Outcome promise + single CTA, cinematic | `hero.frag.html` |
| Intro film | Guide-to-camera sell video (mock frame) | `introvideo.frag.html` |
| The ache | Empathy hook — names the pain, pinned scrollytelling | `ache.frag.html` |
| The turn | Pain→promise pivot + the five-stage arc | `turn.frag.html` |
| See it in motion | Practice-preview video (mock frame) | `reel.frag.html` |
| **The descent map** | The curriculum (see §5) | `map.frag.html` |
| Feels like | Sensory copy + audio taste + "what's inside" | `feel.frag.html` |
| Proof | Testimonials (the #1 conversion driver) | `proof.frag.html` |
| The guide | Credibility + meet-the-guide video | `guide.frag.html` |
| FAQ | Objection handling (accordion) | `faq.frag.html` |
| The invitation | Price + risk-reversal + final CTA | `invite.frag.html` |

Conversion structure follows researched best practice: hero → name pain → promise →
*curriculum they can visualize* → **social proof** → guide credibility → risk-reversal
→ repeated CTA → FAQ. A persistent floating CTA keeps "begin" one tap away.

### Dashboard (`course-dashboard.html`)
Left **playlist rail** (stages as groups; lessons with done ✓ / current ● / upcoming ○;
per-stage + overall progress bar) + **working pane** (current lesson, media, "why now",
mark-complete / next, up-next). Stacks on mobile.

---

## 5. The map model (a key IA decision)

**Sequential gates, concurrent practices.** The five *stages* are sequential gates
(you settle one ground before the next opens — a bottleneck); the *practices within a
stage* are a concurrent pool you move among freely. Rendered as a **vertical descent**:
an ember spine with a gate node per stage, each stage's practices laid out side by side.

Why it matters for the data model: this shape **matches the schema instead of fighting
it**. A stage = a category (a *set* of content with no intrinsic order); only
stage→stage is sequential. The earlier single snaking path forced a fake global
`sort_order` across all lessons; the gated model needs none.

(Superseded prototypes of the map — the 8 hub diagrams and the single serpentine — are
described here for history but were replaced by the gated-concurrent vertical map.)

---

## 6. Reusable design learnings

- **Purpose-first, structure-second.** Lead with the person's feeling and next step;
  demote topology to a supporting role.
- **Token-driven sectioned architecture.** Each section = its own markup + scoped CSS
  (namespaced) + an IIFE managing only its own DOM, all on a shared token layer. This
  is what let 8 agents design 8 sections in parallel with zero merge conflict, and it's
  how a creator could later toggle/reorder/skin sections independently.
- **Edge-routing, not centre-splines**, for any "path through boxes" (see the old
  serpentine bug): route connectors in the gutters between cards with one intentional
  turn per row; never spline through node centres (overshoots at reversals).
- **CSS-first motion, always degradable.** `@supports (animation-timeline: scroll())`,
  `IntersectionObserver`, `position: sticky`, scroll-linked SVG stroke — **no GSAP, no
  libraries, no external assets.** Honour `prefers-reduced-motion` everywhere (show
  final state). This is mandatory anyway under Codex's Artifact/CSP model.
- **Fill space with intention.** The recurring failure was tiny content in a void and
  inconsistent type scale. Every full-viewport moment must be inhabited with confident,
  *related* type sizes.
- **Media as honest placeholders.** Video/audio are CSS/SVG "poster" frames with mock
  playback and a visible "no real playback" state — real assets drop into the frames.

---

## 7. Productization spec — fitting this into Codex

> ⚠️ **Superseded (kept for history).** This section is the v1 mapping (course = typed
> `category`, gating via `accessType`/`minimumTierId`). The v2 model **replaced** it with a
> dedicated `courses` table, `course_stages`/`stage_practices`, and a **unified entitlements
> layer** (`canView` vs `canEnterCourse`). Read [`SPEC.md`](./SPEC.md) §4–§7 for the real
> model and [`FRONTEND-MAP.md`](./FRONTEND-MAP.md) for the surface→component mapping. The
> paragraphs below are retained only to show how the thinking evolved.

### 7.1 Data model (net-new — no course/journey entity exists today)
A course/journey is a new curation entity. Suggested mapping onto existing primitives
(see root `CLAUDE.md` + `packages/database`):

| Concept | Maps to / needs |
|---|---|
| **Journey / Course** | NEW table (`courses`?): title, slug, kicker, lede, price note, org/creator scope, brand overrides, ordered list of stages, published state. Closest existing primitive is `categories` but a course needs its own row + section content. |
| **Stage** | A `category` (name, slug, gloss/description, `sortOrder`) — stages ARE ordered (the gates). M2M to content via `content_categories`. |
| **Practice / lesson** | A `content` row (`contentType` video/audio/written → practice/audio/reflection; `tags`; `thumbnailUrl`; `shaderPreset`). Unordered within a stage. |
| **Free taste** | `content.accessType = 'free'` (the one open door). |
| **Locked** | `accessType = 'paid'/'subscribers'` + `minimumTierId` (gates the rest). Membership = subscription. |
| **Progress** (dashboard) | Derived from existing `videoPlayback` resume-state / a per-user completion record → done/current/upcoming. |
| **Sell videos** (intro, reel, guide) | New media fields on the course: `introVideoId`, `previewVideoId`, `guideVideoId` (+ poster). Use the existing media pipeline (`@codex/content` MediaItemService, R2, transcoding). |
| **Testimonials** | New lightweight table (quote, name, context, avatar seed) scoped to course/org. |
| **Guide bio / FAQ / section copy** | Course-level authored fields (jsonb blocks or dedicated columns). |

### 7.2 What the creator customizes (the "for all users" surface)
Editable in a studio editor (reuse patterns from the brand editor — `/studio/brand`):
- **Copy** for every section (hero promise, ache beats, turn statement, stage names +
  glosses, feel copy, guide bio, FAQ, invitation).
- **Sections on/off + reorder** (the fragment architecture already makes each section a
  standalone unit — this is the payoff).
- **Brand skin**: the whole page is token-driven, so it inherits the org's brand via the
  existing `--brand-*` → OKLCH derivation (`org-brand.css`) and `ShaderHero` presets.
  A creator's course automatically looks like *their* brand, not "Of Blood and Bones".
- **Media**: upload intro / preview / guide videos + posters (existing upload pipeline).
- **Pricing / access**: which practice is the free taste, tier gating.
- **Testimonials & FAQ**: add/edit entries.

### 7.3 Rendering in Codex (SvelteKit, `apps/web`)
- **Two routes / surfaces:**
  - Public sales page → SSR + streaming (`+page.server.ts`, await hero for SEO, stream
    proof/map) at the org/creator's course URL. SEO-significant → keep SSR.
  - Member dashboard → behind auth; fits the studio SPA pattern (`ssr = false`) or a
    normal authed route; instant navigation between lessons.
- **Sections → Svelte components.** Port each `*.frag.html` to a component driven by
  props from the course record. Keep the "each section self-manages its motion" rule.
- **The map → one data-driven component** (`DescentMap.svelte`): input = stages[] with
  their content[]; render gates + concurrent cards; free/locked from `accessType` /
  `minimumTierId`; progress overlay on the dashboard variant.
- **Caching:** course config is read-heavy, rarely-mutating → `VersionedCache`
  (version-bump on edit), not TTL. (Cf. the fee/platform-settings learning.)
- Content page URLs via `buildContentUrl(page.url, content)`.

### 7.4 Open decisions (resolve before building)
- Does a "course" get its own entity, or is it a typed `category` + course-metadata row?
- Are stages global (the five somatic stages) or fully creator-defined per course?
  (Prototype assumes creator-defined names; the 5-count is not load-bearing.)
- Prerequisite gating (finish stage N to open N+1) vs pure payment gating — the map
  shows a "gate" but the prototype only encodes free-vs-locked.
- Personal (creator, orgless) courses vs org courses (cf. creator-vs-org surfaces).

---

## 8. Picking this up
Tracked as beads epic `Codex-2pryk` (see `bd list`, search "course journeys"). When ready
to build, run the `codex-epic-create` skill against **[`SPEC.md`](./SPEC.md) v2 +
[`FRONTEND-MAP.md`](./FRONTEND-MAP.md)** (not this doc's §7) to break it into WPs — the
FRONTEND-MAP already sequences them (data model → entitlements resolver → sales renderer →
dashboard → studio builder → reporting). Do NOT ground the prototype's `fresh.css` tokens
into the app — re-implement on the **real** Codex tokens (`apps/web/src/lib/styles/tokens/`);
`fresh.css` and the neutral `--st-*` studio chrome are only faithful stand-ins for capturing
the design.
