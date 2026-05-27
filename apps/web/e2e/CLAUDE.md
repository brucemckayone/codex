# Web App E2E Tests (Playwright)

End-to-end tests against the SvelteKit app, running against the full local stack (workers + dev server). Sibling to the API E2E suite at the repo root (`/e2e/`) which uses Vitest — these are different runners with different fixture systems; don't confuse them.

**Stack:** Playwright 1.52, Node 22, BetterAuth + Neon test branch, lvh.me wildcard DNS.

---

## Strict Rules

### Cookies & Auth
- **MUST** POST to `lvh.me:42069` (NOT `localhost:42069`) when an HTTP call sets cookies — see [Cookie domain gotcha](#cookie-domain-gotcha)
- **MUST** inject BOTH `better-auth.session_token` AND `codex-session` cookies — use `aliasSessionCookies()` from `helpers/auth-cookies.ts`
- **MUST** scope cookies to `.lvh.me` (leading dot) so they propagate to every `*.lvh.me` subdomain
- **NEVER** hand-roll the cookie aliasing logic — extend `helpers/auth-cookies.ts` if a new input shape needs support

### Test Data
- **NEVER** call `cleanupDatabase()` from `@codex/test-utils` in a Playwright spec — it deletes ALL orgs including the seeded `studio-alpha`/`studio-beta`/`creators`
- **MUST** use unique slugs (`e2e-<purpose>-${timestamp}-${rand}`) for any spec that creates orgs
- **MUST** be idempotent — assume the previous run left state behind; either run a teardown that restores starting state, or assert "at least one X" rather than "exactly one X"

### Navigation
- **MUST** use `expectClickNavigates()` from `helpers/spa-nav.ts` for studio routes (`ssr=false`) — `waitForURL` hangs
- **MUST** use root-relative paths inside `page.goto()` once on an org subdomain — slug is in hostname, not path
- **MUST** prefer `getByRole(...)` and structural class locators over `getByText(...)` — text drifts faster than roles or DOM structure

### Locators (transitional)
- **PREFER** `data-testid` for new tests where the underlying element will likely have copy changes (button labels, badges, tier names)
- **AVOID** raw text matchers without a regex — `getByText('Cancel')` matches "Cancel Subscription", "Cancel Plan", etc.

---

## Cookie domain gotcha

The auth worker emits `Set-Cookie: ...; Domain=.lvh.me; Path=/; HttpOnly; SameSite=Lax`. Chromium silently REJECTS the cookie unless the response host matches the cookie's Domain attribute.

- ✅ POST to `http://lvh.me:42069/api/test/fast-signin` → cookie accepted
- ❌ POST to `http://localhost:42069/api/test/fast-signin` → cookie silently dropped

This is the single most expensive gotcha — it cost hours during PR #261's debug cycle. The symptom: `loginAsSeedViewer` returns successfully, but the next `page.goto('/library')` redirects to `/login` because no session cookie ever reached the browser.

Health checks (`request.get('http://localhost:42069/health')`) are fine — they don't set cookies. Only cookie-setting endpoints need `lvh.me`.

---

## Dual-cookie injection

Two cookie names exist for one session:

| Cookie | Set by | Read by |
|---|---|---|
| `better-auth.session_token` | BetterAuth (auth worker) — its default name | The auth worker itself (and direct auth API calls) |
| `codex-session` | Our SvelteKit layer (via `COOKIES.SESSION_NAME` in `@codex/constants`) | `hooks.server.ts` session validation |

When you receive a Set-Cookie from `/api/test/fast-signin` or `/api/auth/sign-in/email`, the auth worker emits ONLY `better-auth.session_token`. SvelteKit reads `codex-session`. The two-cookie convergence happens via `aliasSessionCookies()` which detects `better-auth.session_token` and emits a `codex-session` alias with the same value.

`★ Why the alias exists`: Historical — the platform was built before adopting BetterAuth and the cookie name was hardcoded in many places. Renaming the SvelteKit-side constant to match BetterAuth's default would be cleaner but the migration cost is high; the alias is the de-facto contract.

---

## Helper map

```
apps/web/e2e/helpers/
├── auth-cookies.ts      Cookie alias + Set-Cookie parsers (the heart of e2e auth)
├── seed-auth.ts         Login as a pre-seeded user via fast-signin
├── spa-nav.ts           expectClickNavigates() for ssr=false routes
├── studio.ts            registerSharedStudioUser, navigateToStudio, injectOrgCookies
├── subscription.ts      Seeded creator login, fresh-owner-with-rate-bypass, Stripe cleanup
└── agreements.ts        Owner ↔ creator topology helpers (revenue-share specs)
```

### Choosing an auth helper

| Helper | When to use | Auth strategy | Cost |
|---|---|---|---|
| `loginAsSeedViewer` (seed-auth.ts) | Test needs `viewer@test.com` with the seeded `studio-alpha` subscription | `/api/test/fast-signin` | Fast (1 HTTP) |
| `loginAsSeededCreator` (subscription.ts) | Test needs `creator@test.com` (Studio Alpha owner) | Real `/api/auth/sign-in/email` via form | Slow + rate-limited |
| `captureSeededCreatorCookies` (subscription.ts) | Same as above but for `beforeAll` — share cookies across tests | Sign-in with synthetic CF-Connecting-IP | Fast, bypasses rate limit |
| `registerSharedStudioUser` (studio.ts) | Test needs a fresh org with isolated state | `orgFixture.createOrgMember` (multi-step) | Slow, but isolated |
| `createFreshOwnerWithBypass` (subscription.ts) | Same as above but rate-limit-immune | fast-register + synthetic-IP sign-in + direct DB org insert | Fastest fresh-org path |
| `createOwnerAndCreator` (agreements.ts) | Two-actor negotiation tests | Two `createOrgMember` calls | Slowest, two users |

**Rule of thumb**: prefer seed-user helpers (idempotency burden, but fast). Use fresh-org helpers when the test mutates state in ways that would corrupt the next run.

---

## Rate limits

The auth worker enforces `RATE_LIMIT_PRESETS.auth` (5 req / 15 min per IP) on `/api/auth/sign-in/email`. On localhost the default IP fallback resolves to the string `"unknown"`, so **all parallel processes share one bucket** — easily exhausted by a single failed test run.

Three escape hatches:

1. **`/api/test/fast-signin`** — bypasses the form flow entirely. No rate limit. Used by `loginAsSeedViewer`.
2. **Synthetic `CF-Connecting-IP` header** — per `defaultKeyGenerator` in `packages/security/src/rate-limit.ts:135-143`, the header is honoured for bucket keying. Used by `captureSeededCreatorCookies` and `createFreshOwnerWithBypass`.
3. **Wait 15 minutes** — only useful in extreme cases; just use one of the above.

---

## Test fixtures (`fixtures/auth.ts`)

`fixtures/auth.ts` extends Playwright's `test` with `authenticatedUser` and `authenticatedPage` fixtures. Used by specs that need a stock authenticated context without spec-local setup.

**Health-check fixture**: All auth-dependent specs should skip cleanly when the auth worker isn't running — pattern:

```typescript
test.beforeAll(async ({ request }) => {
  try {
    const res = await request.get('http://localhost:42069/health');
    if (!res.ok()) test.skip(true, 'Auth worker not running on port 42069');
  } catch {
    test.skip(true, 'Auth worker not running on port 42069');
  }
});
```

The localhost URL is OK here — `/health` doesn't set cookies. (Yes, it's inconsistent with the lvh.me rule. The rule applies only to cookie-setting endpoints.)

---

## SPA navigation (studio sub-tree)

Studio routes have `export const ssr = false` (apps/web/src/routes/_org/[slug]/studio/+layout.ts) — the entire sub-tree is client-rendered. Three consequences:

1. **`waitForURL` with default `waitUntil:'load'` hangs forever** — there is no real `load` event after the initial bundle loads; subsequent navigation is `history.pushState` only.
2. **Playwright's synthetic `click()` doesn't always bubble** in a way SvelteKit's client router (delegated listener on `document`) picks up.
3. **The desktop rail expands on hover**, so the actionability check fails mid-action: the link shifts, the click misses.

The robust pattern (encoded in `helpers/spa-nav.ts` `expectClickNavigates`):

```typescript
await locator.hover();                           // Settle the rail
await locator.evaluate((el: HTMLElement) => el.click());  // Native click bubbles
await expect(page).toHaveURL(pattern);           // Poll URL — no wait events
```

---

## Database hazards

### `cleanupDatabase()` wipes everything

`@codex/test-utils/src/database.ts` exports a `cleanupDatabase()` that deletes ALL rows from key tables — `organizations`, `users`, `subscriptions`, etc. If a Playwright spec calls this (directly or transitively), the seeded `studio-alpha`/`studio-beta` orgs vanish and every subsequent test in the suite breaks.

Vitest integration tests CAN call `cleanupDatabase` (they run in `--concurrency=1` and re-seed in `beforeAll`). Playwright specs must NOT.

### Shared Neon test branch

CI uses one ephemeral Neon branch per workflow run. All Playwright tests in a single run share that branch. Memory: `feedback_e2e_vitest_forks_neon_contention` — workers capped at 2 max on the shared branch.

### Re-seed between long runs

The seed is not re-run between iterations of the full suite. Long debug loops accumulate test-created orgs; queries slow down (28min → 35min observed between iterations). If wall-clock starts climbing mid-session, run `pnpm db:seed` manually.

---

## Parallelism (current state)

`playwright.config.ts`:
```typescript
workers: process.env.CI ? 1 : undefined,   // CI: 1 worker. Local: cores.
```

**Why**: auth-worker + shared Neon ephemeral branch + cookie-jar leakage across contexts caused a flake cluster (Codex-l13ai) that was the primary driver of PR #261. workers=1 is the conservative answer.

**Triggers to revisit**:
- Auth worker gets a Neon connection-pool bump (currently uses HTTP per-request)
- All callers of `/api/auth/sign-in/email` migrate to `fast-signin` (eliminating rate-limit contention)
- A measurement run on a feature branch shows ≥99% pass rate at workers=2 across 3 consecutive full-suite runs

See WP-4 of beads epic `Codex-498na` for the planned measurement.

---

## Selector strategy

PR #261 had 12 of 22 commits as text-locator drift fixes. The trend: button copy changes more often than DOM structure. The strategy:

1. **First choice**: Structural class selectors with regex when stable — `.subscription-card`, `.studio-rail__item[href="/studio/content"]`, `.badge`. These survive copy changes entirely.
2. **Second choice**: `getByRole('button', { name: /pattern/i })` with regex matching. Survives whitespace and minor copy edits but breaks if the button is replaced with a non-button (e.g. Melt UI Select replacing a native `<select>`).
3. **For new tests**: prefer `data-testid` on elements likely to see copy churn (pricing tier buttons, subscription badges, propose-dialog radio labels). Wide data-testid coverage is WP-3 of beads epic `Codex-498na`.
4. **Last resort**: text matchers with regex. Always include a regex (`/pattern/i`) — never a bare string.

### Patterns that drifted in PR #261

- `'Reactivate plan'` → `'Reactivate'` (subscription card)
- `'Cancel'` → `'Cancel Subscription'` (account page)
- `'Current Plan'` → `' Current Plan'` (leading whitespace from layout)
- `<textarea>` → `<RichTextEditor>` Tiptap contenteditable (content form)
- `<select>` → Melt UI Select (portalled options)
- Toast `role="status"` → `role="alert"`

---

## Wall-clock & debugging tips

- **First run cold-start**: ~30s for Playwright `webServer` boot. Subsequent runs in same session use `reuseExistingServer: true` and are instant.
- **Long-running spec smell**: `pie-math` (1.4min, 3x propose+accept), `agreements terminate` (40-50s each), `subscription tests` (17-30s for login + state setup).
- **Trace artifact**: `playwright-report/` — generated on every failure (`trace: 'on-first-retry'` default). Open with `pnpm exec playwright show-report`.
- **Debug a single spec**: `pnpm --filter web exec playwright test apps/web/e2e/<file>.spec.ts --headed --debug`.

---

## Important files

| Path | Purpose |
|---|---|
| `playwright.config.ts` | Test runner config, web server orchestration |
| `e2e/fixtures/auth.ts` | `authenticatedUser` / `authenticatedPage` test fixtures |
| `e2e/helpers/auth-cookies.ts` | `aliasSessionCookies`, `parseSetCookieHeaders`, `parseSetCookieStrings` |
| `e2e/helpers/seed-auth.ts` | `loginAsSeedViewer`, `SEED_VIEWER` |
| `e2e/helpers/spa-nav.ts` | `expectClickNavigates` |
| `e2e/helpers/studio.ts` | `registerSharedStudioUser`, `injectOrgCookies`, `navigateToStudio` |
| `e2e/helpers/subscription.ts` | Seeded creator login, rate-bypass helpers, Stripe cleanup |
| `e2e/helpers/agreements.ts` | Two-actor topology for revenue-share negotiation specs |
| `packages/test-utils/src/e2e/cookies.ts` | `parseCookieString` (Cookie REQUEST header parser) |
| `packages/test-utils/src/e2e/fixtures/auth.fixture.ts` | API E2E auth fixture (vitest, NOT Playwright) |

---

## Related Docs

- Web app overview: `apps/web/CLAUDE.md`
- Caching invalidation strategy: `docs/caching-strategy.md`
- API E2E suite (vitest): `e2e/CLAUDE.md` (if exists) and `packages/test-utils/CLAUDE.md`
- Beads epic for this work: `Codex-498na` (PR #261 follow-up)
