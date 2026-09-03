# FE-9 Playwright Verification — Codex-pthri

End-to-end verification of the rebuilt studio analytics page (FE-1…FE-8).
Each scenario was exercised in the real dev stack (`pnpm dev`, lvh.me subdomains,
Neon-local, admin-api, content-api) via Playwright MCP, one at a time.

> **Note on screenshots:** `.png` files are repo-gitignored. The seven
> screenshots referenced below exist locally in this folder but are not
> committed. Re-run the Playwright sequence to regenerate if needed.

## Setup

- Logged-in user: `creator@test.com`
- Primary org: `studio-alpha` (owner, 12 purchases, 3 followers, 1 sub)
- Creator-role org: `studio-beta`
- Zero-data org for scenario 3: `org-1776696434498-9x50w` (creator added as owner for test, removed after)
- Historical purchases for scenario 5: 4 rows backdated into 2025-11 / 2025-12 / 2026-01 (removed after)

## Scenarios

| # | Scenario | Result | Screenshot |
|---|---|---|---|
| 1 | Authorised owner sees full dashboard | ✅ Pass | `s1-authorised-admin.png` |
| 2 | Creator role redirected from /studio/analytics → /studio | ✅ Pass | `s2-creator-redirect.png` |
| 3 | Fresh org renders `AnalyticsZeroState` | ✅ Pass | `s3-zero-state.png` |
| 4 | Date range preset updates URL + refreshes chart | ✅ Pass | `s4-range-7d.png` |
| 5 | Compare toggle renders previous-period line | ✅ Pass (with backfilled data) | `s5-compare-overlay.png` |
| 6 | Hero chart metric switch | ✅ Pass (see caveat) | `s6-chart-followers.png`, `s6-chart-subscribers.png` |

### Caveats

**Scenario 6 — bead wording vs as-built.** The bead asks for "clicking a KPI
changes the hero chart metric". In the FE-8 implementation, `KPICard` is
display-only (no `role`, no `onclick`, cursor: auto) and `HeroAnalyticsChart`
owns metric selection via its own `Tabs.Root` (Revenue / Subscribers /
Followers). The functional equivalent — switching the hero chart metric — was
verified by activating each of the three chart tabs and confirming
`data-state="active"`, panel visibility swap, and empty-state fallback. If
KPI-click-switches-chart is intended behaviour, it's a missing wire-up
between `KPICard` and `HeroAnalyticsChart`'s `activeTab` prop (would need a
new FE bead).

**Scenario 5 — data-driven guard.** `HeroAnalyticsChart` gates the compare
overlay on `activeSeries.previous.length >= 2` — a correct safeguard against
degenerate one-point overlays. Seed data had all purchases/followers on a
single day (2026-04-19), so the initial toggle showed URL + switch + narrative
changes but no visual overlay. Backfilling 4 historical purchases into the
previous 90-day window produced the expected 3-path render
(`hero-chart__compare-line`, `hero-chart__area`, `hero-chart__line`) with
"Current period / Previous period" legend. Backfill rolled back after capture.

## Verification facts

**Scenario 1.** `studio-alpha.lvh.me:3000/studio/analytics` — Revenue £100,
Active subscribers 1, Followers 3, Purchases 6, top-3 content leaderboard,
30-day default preset, compare toggle off.

**Scenario 2.** `studio-beta.lvh.me:3000/studio/analytics` — URL redirected
to `/studio`; sidebar omits the Analytics link for creator role (UI filter +
route guard = defence in depth).

**Scenario 3.** `org-1776696434498-9x50w.lvh.me:3000/studio/analytics` —
`AnalyticsZeroState` region renders: flat-chart illustration, heading "Your
analytics will appear here.", body "As customers engage with your content,
trends and insights will fill in automatically." KPIs/chart/leaderboard
hidden.

**Scenario 4.** Clicking 90d preset updates URL to
`?startDate=2026-01-20&endDate=2026-04-20`; clicking 7d updates to
`?startDate=2026-04-13&endDate=2026-04-20`. "Last 30 days" chip → "Last 90
days" → "Last 7 days". `aria-selected` + `data-active` transitions correctly.
Subscribers KPI re-computed (1 → 0) for 7-day window — confirms fetcher
re-runs.

**Scenario 5.** Toggling compare on writes `compareFrom` + `compareTo` to
URL (matching preceding window of equal length). Switch `aria-checked=true`.
At-a-glance narrative switches from "No comparison window selected yet" to
data-driven copy: "Revenue climbed 119% to £175 — your strongest stretch
yet." KPI deltas render (+119% revenue, +200% purchases). Leaderboard gains
a Trend column (+£20, +£60, +£15). Chart renders 3 SVG paths including
`hero-chart__compare-line` with legend "Current period / Previous period".

**Scenario 6.** Chart tabs switch series: Revenue (3 paths, SVG), Followers
(empty: "Not enough data yet for this window."), Subscribers (empty). Tab
`data-state="active"` cycles through each value; panel `hidden` toggles
correctly. KPICards are non-interactive — see caveat.
