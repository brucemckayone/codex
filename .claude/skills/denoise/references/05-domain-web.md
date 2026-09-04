# Reference 05 — Domain: apps/web

> Loaded by `/denoise --scope=apps/web` regardless of phase. Pair with the relevant phase reference (01–04).
> Owns the patterns specific to the SvelteKit web application: SSR/CSR boundaries, server loads, remote functions, TanStack DB, subdomain routing.

---

## §0 — Scope of this reference

The `apps/web/` directory is the SvelteKit application that serves the public + creator + studio surfaces. Layout:

```
apps/web/src/
├── routes/                    # SvelteKit file-based routing
│   ├── (public)/              # Unauthenticated surfaces
│   ├── (authed)/              # Logged-in user surfaces
│   ├── _org/[slug]/           # Org-subdomain routes (resolved via hooks.ts reroute)
│   │   ├── studio/            # Creator studio (ssr = false; SPA mode)
│   │   └── ...
│   ├── admin/                 # Platform-owner surfaces
│   └── api/                   # Internal SvelteKit API routes
├── lib/
│   ├── server/                # Server-only code (api clients, auth helpers)
│   ├── remote/*.remote.ts     # SvelteKit remote functions (framework-registered)
│   ├── client/                # Client-only code (collections, version manifest)
│   └── ui/                    # Component library (composes with /design-system)
├── hooks.ts                   # Universal hooks (reroute for subdomains)
├── hooks.server.ts            # Server hooks (auth resolution, headers)
├── hooks.client.ts            # Client hooks
└── paraglide/                 # Generated i18n
```

Cross-loaded skills for findings in this scope: `/design-system` for any token/component/motion/a11y violation; `/tanstack-db` for collection/live-query concerns; `/caching` for client-cache layer questions.

---

## §1 — `+page.server.ts` vs `+page.ts` (server vs universal loads)

The fundamental rule: **`+page.server.ts` runs only on the server, has access to secrets and DB; `+page.ts` runs on both server (SSR) and client (CSR transitions)**.

Anti-patterns:

- Importing `@codex/database` in `+page.ts` — leaks Drizzle to the client bundle
- Reading `env.SECRET` in `+page.ts` — value undefined on client; silent failure
- Using `+page.ts` for an authenticated load that needs to verify session — session lives in HttpOnly cookie, requires `+page.server.ts`

**Audit recipe:**

```bash
# Find +page.ts files importing server-only modules
grep -rn "from '@codex/database\|from '\$lib/server\|from '\$env/static/private'" \
  apps/web/src/routes --include='+page.ts' --include='+layout.ts'
# Each match is a candidate finding
```

**Findings to flag:**

- `web:server-import-in-universal-load` — `+page.ts` imports from `@codex/database`, `$lib/server`, or `$env/static/private`
- `web:secret-env-in-universal-load` — `process.env.X` accessed from `+page.ts` for a server-only var

---

## §2 — Server load streaming (Shell + Stream pattern)

Per project `CLAUDE.md`: **await critical data, stream secondary data**. Critical = needed for first paint, SEO `<svelte:head>`, page structure. Secondary = below-fold, personalised, can show skeleton.

```typescript
// +page.server.ts — Shell + Stream
export const load: PageServerLoad = async ({ parent }) => {
  const { org } = await parent();
  const content = await getPublicContent({ orgId: org.id, limit: 6 });  // AWAIT
  return {
    newReleases: content?.items ?? [],
    creators: getCreators({ slug: org.slug })                            // STREAM
      .then(r => ({ items: r?.items ?? [], total: r?.pagination?.total ?? 0 }))
      .catch(() => ({ items: [], total: 0 })),
  };
};
```

**Hard rules** (from project CLAUDE.md):
- Streamed promises MUST `.catch()` — unhandled rejection crashes server
- Streamed data MUST be in `+page.server.ts` (NOT `+page.ts`)
- SEO data (used in `<svelte:head>`) MUST be awaited

**Findings to flag:**

- `web:streamed-promise-no-catch` — Promise returned from `load()` without `.catch()` handler
- `web:seo-data-streamed` — Title/description/og-tag derived from a streamed (un-awaited) value
- `web:streaming-in-universal-load` — Bare promise returned from `+page.ts` (only works in `+page.server.ts`)
- `web:awaited-data-could-stream` — Below-fold data `await`-ed when streaming would improve LCP

---

## §3 — Remote functions (`*.remote.ts`)

SvelteKit remote functions in `apps/web/src/lib/remote/**/*.remote.ts` are **framework-registered**, not statically imported. The compiler transforms exports into RPC endpoints. Critical implications:

- **NEVER delete an export from a `.remote.ts` file** — the false-positive taxonomy in `/fallow-audit` documents this (Codex-zf9wf precedent)
- **NEVER run `biome check --write --unsafe`** on `.remote.ts` — biome mis-renames exports with `_` prefix, breaking the compiler transform
- Each remote function becomes a public-facing HTTP endpoint — the same auth/scoping rules as `procedure()` apply, but enforced at the function body

**Audit recipe:**

```bash
# Find remote functions doing DB writes
grep -rn 'from .\$lib/server\|from .@codex/' apps/web/src/lib/remote --include='*.remote.ts'
# Each match needs auth check inside the function body
```

**Findings to flag:**

- `web:remote-fn-no-auth-check` — Remote function calls service without verifying session/scope
- `web:remote-fn-input-not-validated` — Remote function takes input without Zod validation
- `web:remote-fn-leaking-internals` — Remote function returns internal state that should be transformed (full DB row → public DTO)

---

## §4 — TanStack DB collections (cross-link to `/tanstack-db`)

The web app uses TanStack DB for client-side state. Two flavours:

- **localStorage-backed** (`progressCollection`, `libraryCollection`) — survives reload, syncs across tabs via `storage` event
- **QueryClient session cache** (`contentCollection`) — populated on demand, lost on reload

Project memory documents the platform layout pattern (required) for SSR hydration:

```typescript
// (platform)/+layout.svelte
$effect(() => {
  invalidate('cache:versions');
}); // staleness check on data.versions

// visibility change → invalidate
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') invalidate('cache:versions');
});

// init progress sync
initProgressSync(userId);
```

**Findings to flag:**

- `web:collection-init-missing-platform-layout` — New localStorage collection doesn't have `hydrateIfNeeded()` reconciliation in `(platform)/+layout.svelte` (canonical helper at `apps/web/src/lib/collections/hydration.ts:99`)
- `web:collection-not-browser-guarded` — `localStorageCollectionOptions` called without `if (browser)` guard (crashes during SSR)
- `web:layout-missing-depends-cache-versions` — `+layout.server.ts` returning version manifest doesn't `depends('cache:versions')`

For deeper TanStack DB concerns, hand off to `/tanstack-db`.

---

## §5 — Subdomain routing (`hooks.ts` reroute)

Three subdomain regimes (from project CLAUDE.md):
- **platform** (root domain) — public, signup, marketing
- **org** (`<slug>.domain.tld`) — org's tenant surface, resolved via `hooks.ts` reroute → `/_org/[slug]/`
- **creators** (subdirectories under platform) — creator profiles

Reroute logic lives in `apps/web/src/hooks.ts`. Findings here are usually about subdomain detection bugs or cross-subdomain links.

**Findings to flag:**

- `web:subdomain-detection-naive` — Subdomain detection that doesn't handle preview branches / staging URLs
- `web:cross-org-link-uses-relative` — Link from one org subdomain to another's content uses relative path (broken across orgs)
- `web:reroute-bypassing-org-resolution` — Code paths that read URL slug directly instead of `params.slug` resolved by reroute

Use `buildContentUrl(page.url, content)` from `apps/web/src/lib/utils/subdomain.ts` for cross-org URLs (per CLAUDE.md).

---

## §6 — SSR / CSR boundaries

Studio uses `export const ssr = false` (per project CLAUDE.md `_org/[slug]/studio/+layout.ts`) — entire studio sub-tree is client-rendered for instant navigation.

Other surfaces are SSR-by-default. Findings:

- `web:studio-ssr-true-regression` — Studio route accidentally re-enables SSR (`ssr = true` or removed `ssr = false`)
- `web:public-route-ssr-false` — Public/marketing route disabled SSR (kills SEO)
- `web:auth-data-leaked-in-ssr` — SSR-rendered HTML embeds authenticated user data accessible to scrapers

---

## §7 — Paraglide message shapes (i18n)

Paraglide generates message functions from `messages/en.json`. Message names become exported function shapes (e.g., `followers_only_cta_title`).

**Critical**: NEVER `git restore` `messages/en.json` in isolation (per project memory `feedback_shared_generated_source.md`) — strips ambient keys, causes runtime 500s that typecheck won't catch.

**Findings to flag:**

- `web:paraglide-message-not-in-en-json` — Code calls `m.foo_bar()` but `messages/en.json` has no `foo_bar` key (compile-time may not catch)
- `web:paraglide-key-orphan` — Key in `messages/en.json` with zero callers — verify against `/fallow-audit` FP rules before flagging (paraglide function names show as low-consumer to fallow)

---

## §8 — Cross-skill coordination

For findings in this scope, route as follows:

| Finding shape | Hand off to |
|---|---|
| Token / motion / a11y / visual styling | `/design-system` |
| Cache layer correctness (KV, version-manifest) | `/caching` |
| TanStack DB collection internals | `/tanstack-db` |
| Dead `.svelte` component | `/fallow-audit` (with FP taxonomy applied) |
| Server-side BaseService bug (called from `+page.server.ts`) | `references/07-domain-packages.md` |

---

## §9 — Anti-Pattern Table (apps/web domain)

| # | Fingerprint | Pattern | Why bad | Fix |
|---|---|---|---|---|
| 1 | `web:server-import-in-universal-load` | `+page.ts` imports server-only module | Leaks server code to client bundle, runtime undefined errors | Move load to `+page.server.ts` |
| 2 | `web:streamed-promise-no-catch` | Streamed promise without `.catch()` | Crashes server on rejection | Add `.catch(() => fallback)` |
| 3 | `web:remote-fn-no-auth-check` | `.remote.ts` function with no session check | Public RPC endpoint with unauthenticated access | Verify session inside function body |
| 4 | `web:collection-not-browser-guarded` | `localStorageCollectionOptions` without `browser` check | SSR crash on first request | Wrap with `if (browser)` |
| 5 | `web:layout-missing-depends-cache-versions` | Layout with versions data but no `depends('cache:versions')` | Stale version manifest after invalidation | Add `depends('cache:versions')` |
| 6 | `web:cross-org-link-uses-relative` | Link from one org to another via relative path | Broken across subdomains | Use `buildContentUrl(page.url, content)` |
| 7 | `web:studio-ssr-true-regression` | Studio route re-enables SSR | Slow studio nav, defeats SPA pattern | `export const ssr = false` |
| 8 | `web:auth-data-leaked-in-ssr` | SSR HTML embeds auth-only user data | Scrapeable PII in public HTML | Stream auth data; render placeholder in SSR |
| 9 | `web:paraglide-key-orphan` | `messages/en.json` key with zero callers | (Verify against FP rules — paraglide is build-generated) | Delete only after verifying no compile-time references |
| 10 | `web:awaited-data-could-stream` | Below-fold data awaited when streaming would help | Slow first paint | Convert to bare promise + `.catch` |
| 11 | `web:hardcoded-color-or-spacing` | `color: #abc;` or `padding: 16px;` instead of tokens | Bypasses design system; org-overrides won't apply | Use design tokens (route to `/design-system`) |
| 12 | `web:effect-without-cleanup` | `$effect(() => { addEventListener(...) })` no return | Listener leaks on unmount | Return cleanup function |

---

## §10 — Cross-links

- `references/01-security-audit.md` — `web:remote-fn-no-auth-check` overlap with `security:procedure-without-auth-policy`
- `references/02-type-audit.md` — `any` in `+page.server.ts` load returns
- `references/03-simplification.md` — duplicate Svelte components flagged here
- `references/04-performance.md` — `web:awaited-data-could-stream` is also a perf concern
- `/design-system` — for ALL visual / token / motion findings; do not duplicate its rules
- `/tanstack-db` — for collection internals
- `/caching` — for cache-layer concerns specifically
- `/fallow-audit` False-Positive Taxonomy — read before flagging `.remote.ts` exports as unused
