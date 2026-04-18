# 11 — Platform Pricing

## Scope

| File | Lines | Role |
|---|---:|---|
| `apps/web/src/routes/(platform)/pricing/+page.svelte` | 212 | Three-tier plan cards (Free / Creator / Enterprise) |
| `apps/web/src/routes/(platform)/pricing/+page.server.ts` | 12 | **Throws `redirect(301, '/discover')` unconditionally** |

## Critical architectural finding

The `+page.server.ts` unconditionally 301-redirects every `/pricing` request to `/discover`:

```ts
export const load: PageServerLoad = async () => {
  throw redirect(301, '/discover');
};
```

The comment explains: *"Platform-level pricing is a static placeholder. Real pricing lives on each org's subdomain (/pricing). Redirect visitors to /discover."*

**The consequence**: the entire 212-line `+page.svelte` is unreachable to users. No human ever renders it. The three-tier plan grid with six Paraglide messages and 130 lines of CSS is vestigial — a record of a pricing model the business moved away from.

By contrast, the real org pricing page at `_org/[slug]/(space)/pricing/+page.svelte` is **2,585 lines** and has seen 44+ `polish(pricing):` commits in recent history (the last-commit log showed passes through #44). That's where the action is.

### Plus a UX oddity

`PLATFORM_NAV` in `lib/config/navigation.ts:40` and 120 both list `{ href: '/pricing', label: 'Pricing' }`. Three other components link here too:

- `lib/components/layout/MobileNav/MobileBottomSheet.svelte:144`
- `lib/components/player/PreviewPlayer.svelte:216, 220`
- `lib/components/content/ContentDetailView.svelte:484`

On the **platform subdomain**, clicking these sends users to `/discover`. The nav displays "Pricing" but navigation lands on the content browser. Users clicking "Pricing" in the header get silently misdirected.

The PreviewPlayer and ContentDetailView links may be dynamic — those components render on **org subdomains** where `/pricing` is the real org pricing page (no redirect). But on the platform origin the behaviour is confusing.

## CSS modernity

Moot — the code doesn't execute in any user session. Still, for completeness:

- **`Card.Root` / `Card.Header` / `Card.Title` / `Card.Content` / `Card.Footer` composition** — page uses the Card primitive correctly (would be the most important win if the page rendered).
- **`@media (--breakpoint-md)`** custom media query drives the 1→3 column grid. Standard modern pattern.
- **`:global()`** selectors to style Card sub-component internals — the only way to punch through Svelte scoped styles into a composed primitive's slots. Acceptable, if leaky.

## Inheritance & reuse

### Button reinvention (again)

`.plan-cta` / `.plan-cta-primary` / `.plan-cta-secondary` (lines 182-211, 30 lines of CSS) — the same `<Button>`-reimplementation pattern flagged in Sections 7, 8, 9, 10. Doubly dead: the component itself never renders, and if it did, the three CTAs should be `<Button>` variants.

### Heading redeclaration (again)

`.pricing-hero h1` (lines 95-102) redeclares font-family/size/weight/color/letter-spacing/margin-bottom — a seventh instance of the pattern first flagged in 7.4. All six declarations duplicate `theme/base.css:36-46`'s `h1` rules.

### List reset duplication

`.plan-features` (line 165): `list-style: none; padding: 0; margin: 0` — `theme/reset.css:38-42` already applies `list-style: none; margin: 0; padding: 0` to every `ul`/`ol` site-wide. Three redundant declarations.

### i18n done right

Every visible string in the template is a Paraglide message (`m.pricing_title`, `m.pricing_plan_free_feature_1`, etc.) — but the `<svelte:head>` (lines 10-17) hardcodes English for title/description/OG/Twitter tags. Same pattern as 7.3 / 8.4 / 9.9 / 10.x. Given the page doesn't render, this is purely academic.

### Hardcoded width

Line 113: `max-width: 64rem` on `.plans-grid`. Matches `--breakpoint-lg: 64rem` exactly — could reference the token. Minor since the page is dead.

## Wasted code

### The entire file

212 lines in `+page.svelte`. Three paths:

1. **Delete the page** — the simplest reading. The server-side `+page.server.ts` makes it unreachable; nothing else references the template; the business direction is per-org pricing. `rm routes/(platform)/pricing/+page.svelte`. The `+page.server.ts` redirect stays (so `/pricing` still 301s gracefully rather than 404ing).
2. **Delete the redirect** — if the page was ever meant to return (a marketing placeholder for "ask us about enterprise"), keep the `+page.svelte`, remove the `+page.server.ts` redirect. Then the Section 07-style cleanup (Button swap, heading dedupe, i18n head) actually matters.
3. **Delete both** — remove the `/pricing` route entirely on platform; let requests 404. Then also fix the five PLATFORM_NAV / component link targets that currently say `/pricing`.

Option 1 is probably correct: per-org pricing is the product reality, the platform doesn't need its own price page, and a graceful 301 to `/discover` respects existing external links.

### Nav misdirection isn't dead code — it's a UX bug

`PLATFORM_NAV[…"Pricing" → "/pricing"]` (2 entries) and the 3 component links are **active code** that generate a misleading user experience. Whichever disposition is chosen for the page (options 1-3), the nav labels need to change:

- If the page stays → nav works.
- If only the redirect survives → remove the nav items + link targets, OR change their destinations (e.g. to `/about`, `/become-creator`, or the relevant per-org pricing).
- If both are deleted → same nav cleanup required.

## Simplification opportunities

1. **Decide the disposition of `+page.svelte`** — my recommendation: delete the file (option 1), keep the 301 redirect. Net: −212 lines.
2. **Clean up the nav** — remove both `/pricing` entries from `PLATFORM_NAV` and `MOBILE_NAV`, or re-target them. Users should never click a nav item that triggers an invisible 301 to an unrelated page.
3. **Re-target the PreviewPlayer and ContentDetailView CTAs** — verify whether they're running on platform or org subdomain; if platform, point them to `/discover` or the org pricing URL via `buildContentUrl`-style helper.
4. **If the page survives** (option 2): apply the standard Section 7-style cleanup — `Button` primitive swap, heading dedupe, i18n head, `64rem` → `var(--breakpoint-lg)`, drop redundant list reset.

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 11.1 | **High** | `+page.svelte` (212 lines) is **100% unreachable** — `+page.server.ts` unconditionally redirects to `/discover` | Delete `+page.svelte`; keep the 301 redirect so external links still resolve gracefully |
| 11.2 | **High** | `PLATFORM_NAV` and `MOBILE_NAV` both list `{ href: '/pricing', label: 'Pricing' }`, but clicking triggers an invisible redirect to `/discover` — users see "Pricing" and land on content browse | Remove the two nav entries, or re-target to a meaningful destination |
| 11.3 | Medium | 3 components link to `/pricing` (MobileBottomSheet, PreviewPlayer ×2, ContentDetailView) | Audit which subdomain they render on; the two on org subdomain work, the one on platform redirects. Re-target the platform-only cases. |
| 11.4 | Medium | `.plan-cta` / `.plan-cta-primary` / `.plan-cta-secondary` (30 lines) re-implement Button — moot since the page doesn't render | Covered by 11.1 (delete the whole file) |
| 11.5 | Low | `.pricing-hero h1` redeclares 6 props already in `theme/base.css` | Covered by 11.1 |
| 11.6 | Low | `.plan-features` redeclares `list-style: none; padding: 0; margin: 0` — reset already applies this | Covered by 11.1 |
| 11.7 | Low | `<svelte:head>` hardcoded English (matches 7.3 / 8.4 / 9.9) | Covered by 11.1 |
| 11.8 | Low | `max-width: 64rem` hardcoded (line 113) — matches `--breakpoint-lg` token | Covered by 11.1 |

## Quantitative summary

- **Files audited**: 2 (`+page.svelte`, `+page.server.ts`).
- **Dead code**: 212 lines in `+page.svelte` — second-largest single-file dead-code find after `LibraryCard.svelte` (283 lines).
- **Functional code**: 12 lines in `+page.server.ts` — the 301 redirect itself works as intended and is probably correct.
- **UX bug**: two nav entries + three component links send users to a 301'd endpoint.
- **Unique to this section**: zero new CSS modernity or token findings — everything is subsumed by the "delete this file" outcome.

## Cross-audit pattern escalation

This section escalates the cross-cutting reuse patterns: the Button-reinvention count is now 7×, heading-redeclaration 9×, `<svelte:head>` English drift 5×. The rollup in Section 31 will need a dedicated cross-cutting finding for each, because fixing them one-by-one in each route audit is less efficient than a single sweep that addresses them app-wide. Batch B launched during this audit session already targets several; its scope may extend to clean this one up too (even though 11.1 proposes deletion over cleanup).

## Next section

12 — Platform about & become-creator (static marketing pages).
