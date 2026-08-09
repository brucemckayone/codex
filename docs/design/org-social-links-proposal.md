# Org social links: where should they live?

**Status:** proposal, awaiting a product decision. **Nothing has been moved, hidden or deleted.**
**Date:** 2026-08-09
**Scope of this document:** the four social URL fields on `/studio/settings`
(`contact_settings.twitter_url`, `youtube_url`, `instagram_url`, `tiktok_url`).

The user asked to verify first and propose second, so this round changed the *quality* of the
settings form (validation surfacing, alignment, accessibility) and changed **nothing** about
where the social fields live. The form is still exactly where it was, still writes to the same
columns, still covered by the same e2e test.

---

## 1. The finding, in one line

**The org-level social links are a complete write path with no read path anywhere, and a
per-USER social-links feature that already works end to end makes them redundant.**

---

## 2. Evidence

### 2.1 The org fields are written and never read

| Checked | Result |
|---|---|
| `@codex/notifications` templates, renderer, services, types | zero matches for twitter / youtube / instagram / tiktok / social |
| Email brand token bag (`packages/worker-utils/src/procedure/service-registry.ts`) | resolves exactly three tokens — `primaryColor`, `logoUrl`, `supportEmail` |
| `admin-api`, `identity-api` | `grep -i contact` → zero hits in both |
| `fetchPublicOrgInfo` (`workers/organization-api/src/routes/organizations.ts`) — the builder behind `/public/:slug/info`, which `_org/[slug]/+layout.server.ts` consumes | returns id, slug, name, description, logoUrl, brandColors, brandFonts, brandRadius, brandDensity, introVideoUrl, heroLayout, brandFineTune, enableSubscriptions. **No social fields.** Verified by reading the return literal. |
| `apps/web/e2e/studio/settings.spec.ts` "social media fields are visible" | asserts input *presence* only. There is no read-side assertion anywhere in e2e. |

The layout cannot render org social links today without a payload change, because the payload
does not carry them.

### 2.2 A populated org renders nothing

`of-blood-and-bones` is the only org with a social value set. Confirmed by direct read:

```
$ docker exec neon-postgres-1 psql -U postgres -d main -tAc \
    "select platform_name, instagram_url from contact_settings ..."
Of Blood & Bones|https://instagram.com/of.blood.and.bones
```

On `of-blood-and-bones.lvh.me/explore` the footer renders `Powered by Revelations | About |
Terms | Privacy | © 2026 Codex.` — zero `<svg>` in the footer, zero occurrences of
"instagram"/"tiktok"/"youtube" in the document, and JSON-LD is a bare `CollectionPage` with no
`sameAs`. (The three "twitter" hits are `twitter:card`/`twitter:title`/`twitter:description`
meta — Twitter Cards, unrelated.)

An org with the value **set** renders it **nowhere**. This is dead config, not
under-documented config.

### 2.3 The duplicate: a per-user social-links feature that already works

- Column: `packages/database/src/schema/users.ts` — `social_links` **JSONB**
  `{ website?, twitter?, youtube?, instagram? }`. Verified. Note it **has `website` and lacks
  `tiktok`** — the mirror image of the org set. Neither set is a superset of the other.
- Validation: `packages/validation/src/identity/user-schema.ts` `socialLinksSchema`, wired into
  `updateProfileSchema` and `upgradeToCreatorSchema`.
- Write surfaces: `ProfileForm.svelte`, mounted at both `(platform)/account` **and
  `_creators/studio/settings`** — whose page header already reads *"Manage your creator profile
  and social links"*. Plus onboarding (`become-creator/steps/StepProfile.svelte`).
- Read surfaces: `CreatorCard`, `CreatorProfileDrawer`, `CreatorExploreBanner`,
  `_creators/[username]/+page.svelte`.
- 17 users have `social_links` populated.
- Live: opening a creator on `of-blood-and-bones.lvh.me/creators` renders two real anchors with
  icons — `https://ofbloodandbones.com` ("Visit website") and
  `https://instagram.com/of.blood.and.bones` ("Visit Instagram") — from a real DB join in
  `OrganizationService`.

**That same Instagram URL is stored twice** — once on `users.social_links` (luzura) and once on
`contact_settings.instagram_url` (the org). Only the user copy renders.

### 2.4 Field-by-field: 1 of 8 fields on the page has a live consumer

| Field | Live reader? | Nature |
|---|---|---|
| Platform Name | **No** — notifications uses `brandDefaults.platformName` (config default `'Codex'`); web uses `organizations.name` | duplicates `organizations.name` |
| Support Email | **YES — the only live field**, reaches `{{supportEmail}}` in every email | operational, never moves |
| Contact URL | **No** — the service overwrites the token with `mailto:${supportEmail}` | operational |
| Timezone | **No reader anywhere** | operational (reporting/scheduling) |
| Twitter / YouTube / Instagram / TikTok | **No** | presentation |

Nothing on that page is a brand token. Timezone and Support Email are unambiguously
operational. So "some of this belongs in the brand editor" is directionally understandable but
turns out to be the wrong diagnosis: most of the page is **dead**, and dead is a different
problem from misfiled.

---

## 3. The four options, priced

### Option 1 — render them (org footer + JSON-LD `sameAs`)

Turns dead config into a feature.

- The org footer is **inline** in `apps/web/src/routes/_org/[slug]/+layout.svelte`, *not* the
  shared `ui/Layout/Footer.svelte` (that one is the platform footer, used only by
  `(platform)/+layout.svelte`). `.footer-inner` already caps at `--container-max` and flips to
  `space-between` at `--breakpoint-md`, so a third flex child slots in cleanly, inside
  `.org-layout` where brand tokens resolve.
- **Icons: 3 of 4 already exist.** `TwitterIcon`, `YoutubeIcon`, `InstagramIcon` (+ `GlobeIcon`)
  are all present and exported. Only `TikTokIcon` is missing — one new `IconBase` glyph, not four.
- The real cost is the **data path**: social fields must be added to `fetchPublicOrgInfo` → the
  `/public/:slug/info` payload → `lib/types.ts` `PublicOrgInfo` → the layout. Cache invalidation
  is free: that endpoint is KV-cached 30 min under `CacheType.ORG_CONFIG` keyed by slug, and the
  contact `PUT` already invalidates the slug-keyed public-info cache.
- ~5 files + 1 icon + ~5 i18n keys. One focused session. The JSON-LD `sameAs` emission is the
  actual SEO win.
- **Bonus that argues for this option over option 2:** `BrandStudioCanvas` embeds the org's
  *real public pages* in a same-origin iframe. If the footer renders the links, they appear
  inside the brand preview automatically, with zero brand-editor changes.
- **Against:** the org footer would publish links the creator already publishes, and the two
  will drift. Decide the precedence rule *before* building.

### Option 2 — move the form into the brand editor — **reject**

Cheapest to imagine, most expensive to do right, and wrong on contract.

- `BrandEditorState` is 13 keys, every one of them colour / font / radius / density / logo /
  tokenOverrides / heroLayout. `getSavePayload()` → `handleSave()` → `updateBrandingCommand` →
  **`branding_settings`**. Social URLs live in **`contact_settings`** — different table,
  different endpoint, different auth call.
- So a "social tab" is not a tab. It means extending `BrandEditorState` with non-token fields,
  extending the sessionStorage draft, extending dirty/`markSaved` bookkeeping, and turning
  `handleSave` into a **two-write transaction** with partial-failure handling.
  `lib/page-builder/builder-save.ts` is the honest precedent — that machinery had to be built
  once already for a two-leg save, and it deliberately gates `markSaved()` until every leg lands.
- They also **do not preview**: the brand-preview bridge postMessages CSS custom properties
  only. Social URLs would need an iframe reload — worse UX than the live token preview
  everything else in that workspace provides.
- Cost: 2–3× option 1, and it puts non-token state in a token store.

### Option 3 — invest in the per-user links that already exist — nearly free

- `_creators/studio/settings` exists, is rail-listed, and its header already says "Manage your
  creator profile and social links". DB + validation + write path + 4 read surfaces all exist.
- Only gap versus the org form: no `tiktok` key. Because the column is **JSONB this needs no
  migration** — 4 small edits (`schema/users.ts`, `user-schema.ts`, `account.remote.ts`,
  `ProfileForm.svelte`) plus a `TikTokIcon` and the render sites.
- Pairs with the bug in §4, which is what stops the creator profile page rendering its
  already-written social block.

### Option 4 — leave the form, show nothing

Both hazards were checked, not assumed:

- `updateContactFormSchema` **tolerates the four fields being absent** — `{ orgId }` with no
  `twitterUrl` parses successfully against the repo's zod 4.3.x.
- `ContactSettingsService.update` is a true partial upsert
  (`onConflictDoUpdate({ set: {...updateValues} })`, only keys `!== undefined`), so removing the
  inputs would leave existing DB values **untouched, not nulled**.
- Cost of hiding: deleting ~65 lines of markup from one file, plus the one e2e test that guards
  those inputs (presence-only, no read-side counterpart).
- **Against:** hiding without deleting leaves an invisible write path — the API still accepts
  `twitterUrl` et al., so a stale cached form or a future caller can still write values nothing
  displays.

---

## 4. One genuinely broken read path (worth a bead either way)

`_creators/[username]/+page.server.ts` fetches `identity` `/api/user/public/${username}`.
**That route does not exist.** `workers/identity-api/src/routes/users.ts` (mounted at
`/api/user`) exposes only `/avatar`, `/profile`, `/upgrade-to-creator`,
`/notification-preferences` (GET + PUT) and `/creator-onboarding` — verified by reading the
route registrations.

The call 404s into a `catch` whose comment reads *"Profile endpoint may not exist yet - degrade
gracefully"*, so `creatorProfile` is always `null` and the page's fully-written social block
never renders. `creators.lvh.me/luzura` shows **0** social anchors while the *same user's* links
*do* render in the org creator drawer.

This is a known-and-accepted gap rather than an accidental swallow, but the effect is the same:
a public page silently renders nothing. Fixing it will make bio, avatar and social links appear
on a public page for the first time — a visible content change, not a silent bugfix, so
screenshot before/after across the three orgs.

---

## 5. Recommendation

**Option 4 now → option 3 next → option 1 only on explicit product intent → never option 2.**

1. **Now:** leave the Social card exactly where it is — this round improved the form rather than
   relocating it — and treat the honesty problem as *pending a decision*, not as settled. The
   argument for hiding is real (an owner who fills in four URLs and sees nothing appear concludes
   the platform is broken), but hiding is only obviously right if orgs never get their own social
   identities, and that is the open question below. Keep the columns either way.
2. **Next (~half a day):** close option 3's TikTok gap and fix the `/api/user/public/:username`
   404 (§4) so the creator profile page's already-written social block renders. That ships
   *working* social links at the level where they are already modelled and already displayed,
   for a fraction of option 1.
3. **Only if orgs genuinely need accounts distinct from their creators'** — plausible for
   `of-blood-and-bones`, which is a brand rather than a person — do option 1: footer render +
   JSON-LD `sameAs` fed from the public-info payload, **with the form staying** on the settings
   page.

**Where the original framing needs pushing back on:** the *form* does not need to move into the
brand editor for the *output* to be brand-editable. Because the brand canvas iframes the real
org pages, rendering the links in the footer makes them visible and adjustable inside the brand
workspace for free. The form belongs where the data belongs (contact settings); the brand editor
should show the *result*, not own the *field*.

---

## 6. The question only the product owner can answer

**Do organisations need social accounts distinct from their creators'?**

All three seeded orgs are single-practitioner, so today the org fields merely duplicate the
owner's. An org with several creators genuinely needs its own. This is the question that decides
between option 4 forever and option 1 — which is exactly why the recommendation is *leave and
decide*, not *delete*.

Secondary questions:

- Should `tiktok` join the per-user set (cheap — JSONB, no migration), or was its absence
  deliberate? The org set has `tiktok` but no `website`; the user set has `website` but no
  `tiktok`.
- `contact_settings.platform_name` duplicates `organizations.name` and nothing reads it. Drop
  the column, or wire it so emails honour the org's chosen name instead of the hardcoded
  `'Codex'` default?
- Timezone has no reader anywhere. Reserved for upcoming analytics/scheduling localisation, or
  also dead?

---

## 7. Corrections to the scoping notes this document is based on

Recorded so the next reader does not re-derive them:

1. **"`settings/email-templates` and `settings/revenue-share` exist with no nav entry"** is only
   half right. `settings/revenue-share` and `settings/pricing-faq` are **308 redirect stubs**
   whose page bodies say "Redirecting…" — they forward to the Monetisation hub, which *is*
   rail-listed. Only `settings/email-templates` is genuinely reachable by URL alone (it does at
   least carry a `kickerHref` back-link to `/studio/settings`).
2. **The `catch {}` in `_creators/[username]/+page.server.ts` is not bare** — it carries the
   comment "Profile endpoint may not exist yet - degrade gracefully". The gap is documented, not
   accidental. The user-visible effect is unchanged.
3. `settings/branding` is likewise a redirect stub (301 → `/studio/brand`), not a live route.
