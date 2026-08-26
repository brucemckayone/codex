# Studio money surfaces: where should they live?

**Status:** proposal, awaiting a product decision. **Nothing has been moved, hidden or deleted.**
No route changed. `lib/config/navigation.ts` and `StudioSidebar.svelte` were not touched.
**Date:** 2026-08-10
**Scope of this document:** the information architecture of every studio destination that
configures or reports money.

This round changed the *quality* of five surfaces — `studio/monetisation` and its two tabs,
`studio/subscribers`, and the shared money-readiness signal — and changed **nothing** about
where anything lives. Every URL still resolves to the same page, the sidebar still groups by
permission, and the monetisation hub still has exactly three tabs.

---

## 1. The finding, in one line

**The sidebar groups destinations by PERMISSION while every page header already declares a
CONCERN — and the four concern labels needed to fix that already ship and already render.**

---

## 2. Evidence

### 2.1 Money configuration is spread across 7 destinations, 3 sidebar groups, 2 subdomains

| Concern | Current home | How a creator finds it |
|---|---|---|
| Enable subscriptions (feature flag) | `/studio/monetisation` — Subscriptions tab, card 2 | Sidebar → **OWNER** → Monetisation, then scroll |
| Subscription tier CRUD | `/studio/monetisation` — same tab, card 4 | same page, scroll further |
| Stripe Connect onboarding (org) | `/studio/monetisation` — same tab, card 1. **Only entry point in the org studio.** | same page, scroll to top |
| Stripe Connect onboarding (creator, personal) | `_creators/studio/earnings`, `become-creator/steps/StepPayouts.svelte` | `creators.*` subdomain. **Invisible from the org studio.** |
| Viewing subscribers | `/studio/subscribers` | Sidebar → **OWNER** |
| Viewing sales | `/studio/sales` | Sidebar → **OWNER** |
| Payout ledger (org) | `/studio/payouts` | Sidebar → **OWNER** |
| Payout ledger (creator's own) | `_creators/studio/earnings` | `creators.*` subdomain |
| Revenue share | `/studio/monetisation/revenue-share` — moved from `/studio/settings/revenue-share`, 308 retained (Codex-4zmw7); the component is *still named* `SettingsRevenueShare` | Monetisation → tab 2 |
| Public pricing-page FAQ | `/studio/monetisation/pricing-faq` — moved from settings, 308 retained (Codex-eb00a.17) | Monetisation → tab 3 |
| Org catalogue revenue **+ the owner's own consumer Stripe portal** | `/studio/billing` (`portalSessionForm` re-exported from `account.remote` — the *customer* portal) | Sidebar → **OWNER** → Billing |
| Per-content price, access type, tier inclusion | `ContentForm` → `content-form/AccessSection.svelte` | Sidebar → Content → open an item |
| Journey offer price, course plan, tier access | `/studio/journeys/[id]/page` builder | Sidebar → **ADMIN** → Portals → open → page builder |
| Customers (purchasers) | `/studio/customers` — in the **ADMIN** group, but its header kicker reads **"Audience"** | Sidebar → **ADMIN** |

### 2.2 The nav ignores the four labels its own pages use

`SIDEBAR_ADMIN_LINKS` / `SIDEBAR_OWNER_LINKS` render as the section labels `ADMIN` and
`OWNER`. Meanwhile `studio_section_money`, `_audience`, `_catalogue` and `_organisation` ship in
`messages/en.json` and render as `PageHeader` kickers on 10 pages — including all four money
surfaces (`monetisation` hub, `sales`, `payouts`, `billing` all pass
`kicker={m.studio_section_money()}`).

Consequences visible today:

- **"Audience" is split across two role groups.** Customers sits under ADMIN, Subscribers under
  OWNER, and both headers say Audience.
- **"Money" spans five destinations** plus two pages that never say Money (the content form's
  access section, the portal page builder).
- **The hub accumulated two tabs that arrived because they had nowhere better to go**, not
  because they belong beside Stripe Connect.

### 2.3 There is exactly ONE Connect account per USER, not per org

`stripe_connect_accounts` is unique on `user_id`. An org's account is a *resolution*, not a row:
`resolvePrimaryConnect()` → `organizations.primary_connect_account_user_id` (pin) → else the
earliest `role='owner'` membership → that user's single account.
`ConnectAccountService.createAccount(orgId, userId, …)` **ignores `orgId`** and delegates to
`createAccountForUser`. So the button on `/studio/monetisation` onboards **the signed-in owner's
personal account** — the same row `_creators/studio/earnings` reads.

Readiness is therefore one near-global fact, but only two of seven money surfaces ever read it.

### 2.4 Live DB state (read-only), which is why this was urgent rather than theoretical

```
$ docker exec neon-postgres-1 psql -U postgres -d main -c "…"
        slug        | tiers | active_subs | connect_rows | team
--------------------+-------+-------------+--------------+------
 studio-alpha       |     2 |           2 |            0 |    8
 studio-beta        |     1 |           0 |            0 |    4
 of-blood-and-bones |     1 |           0 |            1 |   16
```

**studio-alpha takes real money and has no payout account.** Before this round every surface was
silent about it: `/studio/subscribers` rendered both paying subscribers with no mention of
Stripe, because the Connect check was bolted to the *empty* branch rather than the page.

### 2.5 Two verified dead-end CTAs (not fixed in this round — out of scope)

- **`/studio/monetisation` is owner-only** via a client `$effect` → `goto('/studio')`. The
  layout admits creator/admin/owner. So `AccessSection`'s payout hint sends a non-owner creator
  to a page that silently bounces them to the dashboard.
- **`/studio/earnings` does not exist under `_org`** — it is `_creators/studio/earnings`. A
  root-relative `/studio/earnings` link from an org page 404s; a cross-context link needs
  `buildCreatorsUrl(page.url, …)`.

---

## 3. Recommendation — ONE option

**Keep every route where it is. Change the nav to group by concern instead of permission, and
split Payments from Tiers *inside* the existing hub.**

### 3.1 Sidebar groups by concern, not role

Replace the `ADMIN` / `OWNER` section labels with the four that already ship and already render
on 10 page headers:

| Group | Destinations |
|---|---|
| **Catalogue** | Content, Media, Portals, Categories |
| **Audience** | Customers, Subscribers |
| **Money** | Monetisation, Sales, Payouts, Billing |
| **Organisation** | Brand, Team, Settings |

Role filtering is **unchanged** — nothing becomes visible to anyone who cannot already see it.
Only the grouping changes. This is the highest-leverage fix because it makes the rail agree with
the page headers, and it directly answers "I don't know where to look".

### 3.2 The monetisation hub becomes four tabs

`Payments` (Connect + the enable-subscriptions switch) | `Tiers` | `Revenue share` |
`Pricing FAQ`.

Today's Subscriptions tab does two unrelated jobs in one scroll. Splitting its cards separates
"the rails" from "the products" **without moving a URL** — `/studio/monetisation` keeps working
as the Payments tab, and the tab strip already derives its active state from the pathname.

### 3.3 Do NOT make Stripe Connect a top-level sidebar destination

It is a one-time-then-rare task. A permanent rail slot is worse than a prompt that appears
exactly where it blocks you — which the `MoneySetupPrompt` work in this round already delivers.
It would also tear the status badge away from the switch and the tiers it gates, the three
things that must be read together.

### 3.4 Do NOT move Billing — rename it

The page genuinely mixes org catalogue revenue with the owner's *own consumer* Stripe portal,
and its own lede admits it. Cheapest honest fix: keep the route, retitle to "Revenue & your
plan", and put the consumer-portal card under its own clearly-labelled sub-heading. The right
end state — org revenue merged into Sales, consumer portal retired to the already-existing
`/account/subscriptions` — costs a route retirement and deserves its own decision.

### 3.5 Migration cost, honestly

| Item | Cost |
|---|---|
| §3.1 concern grouping | ~40 lines: `navigation.ts` (data only) + the `sections` derivation in `StudioSidebar.svelte`, plus sidebar label assertions |
| §3.2 four tabs | one new leaf route + markup moved between two files. **No existing URL changes, so zero new redirect debt** |
| §3.4 Billing rename | copy plus one heading |
| §3.3 and the Billing split | decisions, not code |

**No DB migration, no worker change, no seed change.** There is proven prior art for the heavier
variant if it is ever wanted: two routes already relocated into this hub behind `+page.ts` 308s
that preserve `url.search`.

### 3.6 Rejected alternative

Hoist Payments/Connect to its own sidebar entry and demote Monetisation to Tiers-only. Cleaner
on a wireframe, but it buys a permanent rail slot for a once-ever task and separates the Connect
badge from the switch and tiers whose availability it determines.

---

## 4. Open questions for the product decision

1. **Is `AccessSection` gating paid/subscriber content on the CREATOR's personal Connect account
   intentional** (per-creator payout compliance) or a leftover? It decides whether the fix is
   "read the org's readiness" or "keep the gate, fix the link". This is a money-routing question,
   not a UX one.
2. **`/studio/billing`:** retitle in place, or retire the consumer-portal card in favour of the
   existing `/account/subscriptions`?
3. **Tab labels:** does `Payments` / `Tiers` match how you think about it, or would
   `Stripe` / `Subscriptions` read better? Cheapest thing to change, hardest to guess.
4. **studio-alpha has 2 tiers and 2 active subscriptions with ZERO Connect rows.** Seed artefact,
   or a real invariant hole where tiers and subscriptions can be created before Connect exists?
   If the latter, the backend guard has a gap and this round's copy ("nowhere to send the money")
   is describing a bug rather than an unfinished setup.
5. **Ship the concern-grouping with this round's work, or as its own PR?** It is the one item
   that touches shared nav.

---

## 5. What this round DID change (for contrast)

Implemented inside the pages that already exist, no IA moved:

- `lib/utils/connect-readiness.ts` — `moneyReadiness()`, one string-discriminated verdict
  (`stripe_missing` | `stripe_incomplete` | `stripe_restricted` | `stripe_disabled` |
  `stripe_unknown` | `no_tiers` | `no_subscribers` | `ready`), all `stripe_*` states resolving
  before `no_tiers`.
- `lib/components/studio/MoneySetupPrompt.svelte` — renders that verdict ABOVE the content, so a
  blocked org is warned whether or not its lists are empty. Colour comes only from
  `styles/themes/status.css` via `ui/Alert`, so no new colour token exists to regress.
- `studio/monetisation` — explicit `disabled` badge case, `requirementsFetchFailed` surfaced with
  an explicit-click retry, the previously-unhandled `?connect=refresh` return, and a
  payments-are-live → add-a-tier hand-off.
- `studio/subscribers` — a header count, a three-up summary band, `ui/DataTable` (which fixes the
  Amount column's `th`/`td` disagreement declaratively), and the readiness prompt above the table.
- One masthead contract for the hub and its three leaves, replacing 402px of stacked wayfinding.

`/studio/payouts` and `/studio/sales` were deliberately left alone — a parallel agent owns them.
They are the next two surfaces that should consume `moneyReadiness()`.
