# Journeys/Portals Conformance Audit — 2026-07-24

**Bead:** `Codex-a1tz6` (P2 conformance). **Method:** live Playwright walk of all 8 shipped
surfaces (authed as owner `creator@test.com`) vs `docs/design/course-journeys/prototype/*.html`.
Demo: Studio Alpha, Rootwork journey (landing-page id `68479fa3-0ec5-426c-b8ee-eed9249773ca`).
Every surface passed the **390px** overflow check (zero horizontal overflow). "Portals" display
label correctly applied in studio (titles/h1/"New portal"); routes + ids stay `journeys`.
Screenshots/snapshots: `01-sell.png … 08-insights.png` (+ `*.snapshot.md`) in the main worktree root.

## Matrix (conformance per surface)

| # | Surface | Route | Prototype | Conformance |
|---|---|---|---|---|
| 1 | Sell / landing | `/journeys/rootwork` | `course-sell.html` | CLOSE |
| 2 | Checkout | `/journeys/rootwork/checkout` | `checkout.html` | MODERATE-GAP (partly by-design) |
| 3 | Member dashboard | `/journeys/rootwork/dashboard` | `course-dashboard.html` | CLOSE |
| 4 | In-course | `/journeys/rootwork/practice/:slug` | `content-incourse.html` | CLOSE / video broken |
| 5 | Studio index | `/studio/journeys` | `studio-journeys.html` | CLOSE |
| 6 | Page builder | `/studio/journeys/new` + `/:id/page` | `builder-new.html` + `builder.html` | CLOSE (exceeds in places) |
| 7 | Curriculum editor | `/studio/journeys/:id/curriculum` | `course-editor.html` | MOCK-ONLY |
| 8 | Insights | `/studio/journeys/:id/insights` | `reporting.html` | MAJOR-GAP (metrics never render) |

## New HIGH-severity defects (not previously tracked)

1. **Insights metrics broken** — `getJourneyInsights` returns `{"error":{"message":"Course not
   found"},"status":500}` as a **500-in-a-200** for a valid published journey. Likely cause: the
   insights remote passes the **landing-page id** where `getInsights` expects the **course id**
   (`courses.subjectId`). Fix: `apps/web/src/lib/remote/journey-insights.remote.ts` (+ service
   lookup). → bead **Codex-xo3bl** (insights).
2. **Insights silent failure** — on that rejection the panel shows 7 perpetual "Loading metric"
   skeletons; no error/empty state, no console error. Violates the platform's no-silent-failure
   rule. Fix: rejection handling in `insights/+page.svelte` / `JourneyInsightsPanel`. → same bead **Codex-xo3bl**.
3. **In-course video broken (dev)** — HLS `master.m3u8` served from `localhost:8787` (access
   worker) is not in the CSP `media-src` allowlist (`localhost:4100`, `*.nip.io:4100`, r2,
   revelations.studio) → "Playback error." Affects all dev HLS. Fix: add the access-worker origin
   to `media-src`, or serve dev HLS from an allowlisted origin. → bead **Codex-8tku7** (CSP media-src).

## MED / by-design / config

- **Sell (MED):** renders 6/11 prototype sections (ache, turn/pillars, how-it-feels, guide/bio,
  FAQ hidden/unpopulated — all block types exist in the builder). Confirm intended per-journey config.
- **Sell (MED):** intro-video + reel render as empty gray boxes (no poster imagery).
- **Sell (LOW-MED):** intro-film aria-label "Play the 1800-second intro film" contradicts the
  "Ninety seconds…" heading — a duration data/label bug. → quick-fix bead **Codex-3tmt1**.
- **Checkout (HIGH, by-design):** payment stubbed ("connected with the monetization release");
  no tiered "Choose your way in" offers, no order summary. Tracked with WP-6 monetization.
- **Dashboard (LOW):** in-page tabs replaced by org sidebar; "Continue" doesn't name the lesson.
- **In-course (LOW):** shipped uses auto-complete; prototype's explicit "✓ Mark complete" +
  course-completion state not surfaced.
- **Studio index (MED):** filter tabs are status (All/Draft/Published/Archived) vs prototype's
  type (All/Journeys/Pages/Drafts). Card shows "6 enrolled" where prototype shows revenue "· 30d"
  → addressed by **Codex-9p47t** (revenue batch read).
- **Builder (MED):** `/new` offers 2/4 types (Course, Landing page; no Retreat/Bundle — future
  page types per D1). Edit lacks Pricing + SEO panels + "Ready to publish?" checklist. Preview
  toggle *exceeds* prototype (Tablet/Fluid, Light/Dark, side-by-side, full-screen).
- **Curriculum (HIGH):** disconnected mock (hardcoded `stages` at `curriculum/+page.svelte:48`,
  mock Save, server load fetches nothing) → full-stack WP **Codex-03cwh** (planned).
- **Insights (MED, by-design):** prototype "journey funnel" omitted; Traffic provenance shown as
  "not captured yet" (documented, not a defect).

## Disposition
- Revenue badge gap → **Codex-9p47t** (building this session).
- Curriculum mock → **Codex-03cwh** (planned; `curriculum-editor-wp.md`).
- New defects → beads filed (see below). Sell-config + builder-type + checkout items are
  design/monetization decisions for the user, not silent fixes.
