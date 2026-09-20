# Reference 12 — Multi-Tenancy (Subdomains + Branding)

> **Part of `/design-system`.** Pair with [`10-brand-editor.md`](10-brand-editor.md) for
> the token delivery chain and [`11-theming.md`](11-theming.md) for how theme + brand
> interact in the CSS cascade. SSR branding binding rules also tie back to
> [`02-css-architecture.md`](02-css-architecture.md).

# Multi-Tenancy — Subdomain Routing + Per-Org Branding

Codex is a multi-tenant content platform: every organization lives at its own subdomain
(`yoga-studio.revelations.studio`), has its own branding (colours, fonts, hero layout,
shader preset), and renders from the same SvelteKit app through a subdomain-based
reroute. This reference documents the routing, naming, and branding delivery contracts
that make that work.

---

## 1. Subdomain → Route Mapping

The mapping is a **universal** hook (runs both on the server and in the client) —
`apps/web/src/hooks.ts`, exporting `reroute`. **Not** `hooks.server.ts`, which handles
session validation and security headers only.

`apps/web/src/hooks.ts:38-89`:

```ts
export const reroute: Reroute = ({ url }) => {
  const hostname = url.hostname;
  const pathname = url.pathname;
  const subdomain = extractSubdomain(hostname);

  if (isAuthPath(pathname)) return pathname;        // /login, /register, etc. pass through
  if (pathname.startsWith('/api/')) return pathname; // /api/* always global

  if (!subdomain || subdomain === 'www') return pathname;  // Platform routes — (platform)/* group

  if (subdomain === 'creators') {
    return `/_creators${pathname}`;                 // creators.revelations.studio
  }

  if (isReservedSubdomain(subdomain)) return pathname;   // api., admin., etc. — don't rewrite

  return `/_org/${subdomain}${pathname}`;           // All other orgs
};
```

The mapping table:

| Hostname | Reroute target | Files |
|---|---|---|
| `revelations.studio` (or `www.`) | `/{path}` matched against `(platform)/*` | `src/routes/(platform)/` |
| `{slug}.revelations.studio` (org) | `/_org/{slug}{path}` | `src/routes/_org/[slug]/` |
| `{slug}.revelations.studio/studio` | `/_org/{slug}/studio{path}` | `src/routes/_org/[slug]/studio/` |
| `creators.revelations.studio` | `/_creators{path}` | `src/routes/_creators/` |
| Reserved (`api.`, `admin.`, etc.) | Pathname unchanged | No matching route — 404 |
| `/login`, `/register`, etc. on any host | `/{authPath}` | `src/routes/(auth)/` |
| `/api/*` on any host | Unchanged | `src/routes/api/` |

Route-group parents (`(platform)`, `(space)`, `(auth)`, `(creators)`) are **filesystem-only**
and never appear in URLs — the reroute path must not contain them.

**Verification**: tests at `apps/web/src/hooks.test.ts` cover each branch. Run them before
shipping reroute changes.

---

## 2. The `extractSubdomain` Cases

Source: `apps/web/src/lib/utils/subdomain.ts:21-59`.

The function is the **single source of truth** for converting a hostname into a subdomain
string. It handles four host-shape families:

| Family | Example input | Subdomain | Use case |
|---|---|---|---|
| `lvh.me` | `yoga-studio.lvh.me` | `yoga-studio` | Local dev cross-subdomain cookies (RFC 6761 blocks `Domain=.localhost`) |
| `nip.io` | `yoga-studio.192.168.1.10.nip.io` | `yoga-studio` | LAN testing from phone/other device — the IP is part of the base domain |
| `localhost` | `yoga-studio.localhost` | `yoga-studio` | Legacy / CI; rarely used — prefer lvh.me |
| Production | `yoga-studio.revelations.studio` | `yoga-studio` | Live environment |

Edge cases the function handles:

- Bare `lvh.me`, `{ip}.nip.io`, `localhost`, `revelations.studio` → returns `null`
  (treated as platform root by `reroute`)
- Port suffixes stripped by splitting on `:` at line 23
- `www.revelations.studio` → returns `www`, which `reroute` treats as platform at
  `hooks.ts:60-62` (the `subdomain === 'www'` check)

**Rule**: every consumer asking "what subdomain am I on" MUST call `extractSubdomain(hostname)`.
Never hand-roll hostname parsing — the four host families are non-obvious and easy to miss.

---

## 3. Reserved Subdomains — Two-Layer Guard

Org slugs ARE subdomains, so the set of subdomain names that would collide with
infrastructure (`api`, `auth`, `admin`, `www`, `cdn`, etc.) MUST be rejected at two layers:
schema validation **and** runtime reroute.

### Layer 1 — Zod refinement at the API boundary

Source of truth: `packages/constants/src/urls.ts:85`

```ts
export const RESERVED_SUBDOMAINS_SET = new Set<string>(RESERVED_SUBDOMAINS);
```

Consumed by the org-slug schema at `packages/validation/src/content/content-schemas.ts:49-52`:

```ts
const organizationSlugSchema = createSlugSchema(255).refine(
  (slug) => !RESERVED_SUBDOMAINS_SET.has(slug),
  { message: 'This slug is reserved and cannot be used for an organization' }
);
```

This runs every time someone creates or renames an org. The offending slug never makes
it to the database.

### Layer 2 — Runtime reroute guard

`apps/web/src/hooks.ts:76-78` + `apps/web/src/lib/utils/subdomain.ts:64-66`:

```ts
if (isReservedSubdomain(subdomain)) return pathname;  // don't rewrite → 404 from unmatched route
```

Runs in case a reserved name sneaks through (e.g., historical data predating the refine,
a manual DB edit, a race condition). Belt-and-braces: even if the API layer fails, the
router will never expose `_org/admin/*` routes.

### The re-export chain (for grep)

`apps/web/src/lib/constants.ts:1` re-exports from `@codex/constants`, so web code can import
from `$lib/constants` or the package directly.

**Audit check**: if you see a set of reserved-subdomain strings defined inline in any file
other than `packages/constants/src/urls.ts`, that's drift — the set must be defined once
and imported everywhere.

---

## 4. Flat Namespace — No Brand Inheritance

Orgs are **independent**. The database schema has no `parentOrgId`, `brandInheritsFromId`,
or similar link. Every org's branding is fully self-contained.

Consequences:

- There is no "child org", "sub-org", "tenant hierarchy", or "org family" concept. Do not
  introduce one without an explicit product decision — it's a large structural change
  affecting validation, caching, routing, and the brand editor data model.
- A new org starts from `DEFAULT_BRANDING`
  (`packages/validation/src/schemas/settings.ts`), never from another org's saved state.
- Copying one org's brand to another is a user action (export preset → apply preset), not
  a relational link. The preset JSON is the transport; the target org's row is the owner.

**Rule**: any code that reads one org's branding and applies it as a fallback for another
org's missing values is wrong. Missing values cascade to **system defaults** (tokens at
`apps/web/src/lib/styles/tokens/`), never to another org.

---

## 5. Branding Delivery — The SSR + Client Contract

Org branding reaches the page through **four channels**, each covering a different scenario:

### 5.1. Base brand properties — SSR inline style attributes

`apps/web/src/routes/_org/[slug]/+layout.svelte:412-446` binds every base brand token as
a `style:--brand-*` attribute on the `.org-layout` element:

```svelte
<div
  class="org-layout"
  data-org-brand={hasBranding ? '' : undefined}
  style:--brand-color={brandPrimary}
  style:--brand-secondary={brandSecondary}
  style:--brand-accent={brandAccent}
  style:--brand-bg={brandBackground}
  style:--brand-color-dark={brandPrimaryDark}
  ...
>
```

These values are present in the **initial SSR HTML** — no JS required. Visitors with JS
disabled get the correct palette. Cold-load visitors with JS get it on first paint with
no flash.

### 5.2. Token overrides — SSR inline style (post-Codex-wcwpw) + client `$effect` fallback

The `tokenOverrides` JSON column holds everything that isn't a first-class column: shader
preset, fine-tune shadow/text scale, player chrome colors, card hover ratios, hero
visibility flags, and ~100 shader parameters. Pre-fix, these were client-injected only
(`$effect` called `injectTokenOverrides`), causing a flash where ShaderHero would boot
with the default preset before the override arrived.

The fix landed in commit `334f17dc` for Codex-wcwpw:

`apps/web/src/routes/_org/[slug]/+layout.svelte:156-164`:

```ts
const serverTokenOverrideStyle = $derived.by(() => {
  if (!brandEditor.isClosed) return undefined;
  const overrides = serverTokenOverrides;
  if (!overrides) return undefined;
  const vars = tokenOverridesToCssVars(overrides);
  const entries = Object.entries(vars);
  if (entries.length === 0) return undefined;
  return entries.map(([prop, value]) => `${prop}: ${value}`).join('; ');
});
```

Then bound via a `style={...}` attribute on `.org-layout` at line 445.

The shared pure helper is `tokenOverridesToCssVars` from
`apps/web/src/lib/brand-editor/css-injection.ts:510-522`:

```ts
export function tokenOverridesToCssVars(
  overrides: Record<string, string | null | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) continue;
    const prop = BRAND_PREFIX_KEYS.has(key)
      ? `--brand-${key}`
      : `--color-${key}`;
    out[prop] = value;
  }
  return out;
}
```

It's intentionally SSR-safe (plain `Record` in, plain `Record` out — no `document` or
`HTMLElement` access) so the same key-to-prop mapping logic runs on the server and in
the browser.

The client `$effect` at `+layout.svelte:172-188` still runs to handle the post-editor-save
re-inject path (after brand editor closes, the server value is re-applied). It's
idempotent with the SSR binding on cold load.

### 5.3. Google Fonts — `<svelte:head>` `<link>`

Custom fonts per-org are injected via `<link rel="stylesheet">` at
`+layout.svelte:404-410`:

```svelte
<svelte:head>
  {#if googleFontsUrl}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
    <link rel="stylesheet" href={googleFontsUrl} />
  {/if}
</svelte:head>
```

`googleFontsUrl` is derived from `brandFontBody` + `brandFontHeading`
(`+layout.svelte:191-198`) and appends `&display=swap` so the fallback font (system sans)
shows until the Google Font loads — prevents FOIT on slow connections.

### 5.4. The `[data-org-brand]` gate attribute

`apps/web/src/routes/_org/[slug]/+layout.svelte:416`:

```svelte
data-org-brand={hasBranding ? '' : undefined}
```

`hasBranding = !!brandPrimary` (`+layout.svelte:86`) — the attribute is present iff the
org has set a primary brand colour.

Every `[data-org-brand]`-scoped CSS rule (in `apps/web/src/lib/theme/tokens/org-brand.css`)
deactivates automatically when the attribute is absent. An org with no branding gets the
stock design-system tokens.

**Semantic invariant**: `[data-org-brand]` is present-iff-hasBranding. Never set it
unconditionally. Never leave it set after a brand is cleared. The Svelte binding
`hasBranding ? '' : undefined` produces exactly this behaviour (`undefined` omits the
attribute entirely, `''` renders as a bare attribute).

---

## 6. Cross-Org Navigation — Hard Reload, Not `goto()`

Orgs live on different **origins**. `yoga-studio.lvh.me:3000` and `bruce-studio.lvh.me:3000`
share a parent domain but are distinct origins under the Same-Origin Policy. SvelteKit's
`goto()` is an SPA client-side navigation — it can't cross origins.

The utility for this is `buildOrgUrl(currentUrl, slug, path)` at
`apps/web/src/lib/utils/subdomain.ts:89-114`:

```ts
export function buildOrgUrl(currentUrl: URL, slug: string, path = '/'): string {
  const host = currentUrl.hostname;
  const port = currentUrl.port;
  const protocol = currentUrl.protocol;

  let baseDomain: string;
  if (host.endsWith('lvh.me'))              baseDomain = 'lvh.me';
  else if (host.endsWith('nip.io'))         baseDomain = nipMatch ? nipMatch[1] : 'nip.io';
  else if (host.includes('localhost'))      baseDomain = 'localhost';
  else if (host.endsWith('revelations.studio')) baseDomain = 'revelations.studio';
  else                                       baseDomain = /* fallback */;

  return `${protocol}//${slug}.${baseDomain}${portSuffix}${path}`;
}
```

Returns a full URL. Consumers navigate via `window.location.assign(url)` or an
`<a href>` — never `goto()`.

### Same-origin cross-content navigation

`buildContentUrl(currentUrl, content)` at
`apps/web/src/lib/utils/subdomain.ts:160-178` is the one helper that decides:

- If the content belongs to the current org → returns root-relative `/content/{slug}`
  (SPA `goto()` is fine)
- If it belongs to a different org → delegates to `buildOrgUrl()` for a full reload

Using `buildContentUrl` everywhere means consumers don't have to know whether a click
will stay in the SPA or cross origins.

---

## 7. Anti-Patterns

### 7.1. Hardcoded hostname checks

**Bad**:

```ts
const isDev = hostname.includes('lvh.me') || hostname.includes('localhost');
const orgSlug = hostname.split('.')[0];  // breaks on nip.io (IP segments in between)
```

**Good**: `extractSubdomain(hostname)` handles all four host families correctly.

The `nip.io` case is the trap — `bruce-studio.192.168.1.10.nip.io`.split('.')[0] returns
`bruce-studio` correctly by luck, but the naive split breaks on any host shape with more
than one non-subdomain segment.

### 7.2. `goto()` across orgs

**Bad**:

```ts
goto(`/_org/${otherOrgSlug}`);   // Wrong path shape; also cross-origin
goto(`https://${otherOrgSlug}.lvh.me:3000/`);  // goto() doesn't do cross-origin
```

**Good**:

```ts
window.location.assign(buildOrgUrl(page.url, otherOrgSlug, '/'));
```

Or render an `<a href>` with `buildOrgUrl` and let the browser handle the full reload.

`goto()` silently falls back to a full reload on cross-origin URLs in some versions of
SvelteKit, but that behaviour is not contractual — don't rely on it. `buildOrgUrl`
makes the intent explicit.

### 7.3. Inheriting brand tokens from a "parent" org

**Bad**: any code that walks an org-to-org link to resolve missing branding. If you see
`org.parentOrgId`, `org.brandInheritsFromId`, or a function named `resolveBrandWithFallback`
that accepts another org's branding as input — stop. The model is flat (§4). Missing
values cascade to **system defaults** (tokens in `apps/web/src/lib/styles/tokens/`), never
to another org.

**Good**: each org's branding stands alone. `DEFAULT_BRANDING` from
`packages/validation/src/schemas/settings.ts` is the only fallback.

### 7.4. Writing branding CSS vars only via client `$effect`

**Canonical bug**: Codex-wcwpw.

**What broke**: `injectTokenOverrides(el, overrides)` ran inside a client-side `$effect`,
so the initial SSR HTML had no `--brand-shader-preset`, `--brand-shader-intensity`, or
any of the other ~100 shader parameters. `ShaderHero`'s `onMount` read
`getComputedStyle(layout)` to initialise its preset — but depending on `$effect` ordering
it often fired **before** the tokenOverride `$effect`, initialising with the default
preset. Next frame, the effect fired, the preset arrived, the shader swapped — visible
flicker (~50–100ms).

**Rule**: every `--brand-*` or `--color-*` CSS variable that CSS reads during the initial
render MUST be present in the SSR HTML. Client-only `$effect` injection is acceptable
only for values that:
- Do not affect first paint
- OR are strictly preview-only (brand editor live edits, transient font preview)

For everything else, render the style attribute at SSR time. The
`tokenOverridesToCssVars` helper (`css-injection.ts:510-522`) is the shared
mapping — it runs on both server and client so SSR and CSR produce identical CSS.

**Cross-ref**: `10-brand-editor.md` §13.3 covers the related "every `--brand-*` READ
needs a WRITE in `+layout.svelte`" rule from Codex-lqvyy. The Codex-wcwpw fix extends
that coverage to the `tokenOverrides` JSON path specifically.

### 7.5. Setting `[data-org-brand]` unconditionally

**Bad**:

```svelte
<div class="org-layout" data-org-brand>  <!-- always present -->
```

**Good**:

```svelte
<div class="org-layout" data-org-brand={hasBranding ? '' : undefined}>
```

Always-on `[data-org-brand]` triggers org-brand CSS rules for orgs that haven't set a
primary colour — they'd read `var(--brand-color, fallback)` chains with the fallback
branch, which is usually close to correct but not guaranteed. Forcing `hasBranding` as
the gate keeps unbranded orgs visually identical to the platform.

---

## 8. Checklist — Adding a Multi-Tenancy-Aware Feature

When a feature reads org-scoped data, renders inside `.org-layout`, or does cross-org
navigation:

```
[ ] Read the subdomain via extractSubdomain(hostname) — never parse directly
[ ] For an org slug input, validate against organizationSlugSchema
    (refinement uses RESERVED_SUBDOMAINS_SET)
[ ] For cross-org navigation, use buildOrgUrl() + window.location.assign —
    never goto()
[ ] For same-vs-cross-org content links, use buildContentUrl() — it decides
[ ] For CSS consuming --brand-* vars: confirm the var is bound via
    style:--brand-* on .org-layout in +layout.svelte (SSR-rendered).
    Client $effect is a fallback, not a primary path.
[ ] For tokenOverrides JSON keys: confirm they flow through
    tokenOverridesToCssVars so SSR style attr covers them
[ ] If the feature should only activate for branded orgs, gate on [data-org-brand]
    at the CSS layer (not via JS conditional rendering)
[ ] Test on TWO scenarios:
    (1) A fully-branded org (has primaryColor, shader preset, fonts) on cold load
    (2) An unbranded org (default DEFAULT_BRANDING) on cold load
    Both must paint correctly — no flicker, no missing values, no over-styling
    on the unbranded one
```

---

## 9. Candidate Hard-Rule Promotion

- **"Every `--brand-*` CSS var READ in a stylesheet needs a WRITE in `+layout.svelte` at
  SSR time, not only in a client `$effect`"** (§7.4 + `10-brand-editor.md` §13.3) —
  now at two distinct incidents (Codex-lqvyy in the brand editor path, Codex-wcwpw in
  the tokenOverrides path). Third recurrence should trigger promotion to SKILL.md §2
  per §7 of SKILL.md.
- **"Never `goto()` across orgs; use `buildOrgUrl` + `window.location`"** (§7.2) — zero
  incidents so far; documentation-only today. Promote only if a regression surfaces.

Promotion is a SKILL.md edit, not a reference edit — file a bead if you observe more
occurrences.

---

## 10. When to Re-Verify This Reference

- `apps/web/src/hooks.ts` — reroute logic; update §1 if the mapping changes
- `apps/web/src/lib/utils/subdomain.ts` — `extractSubdomain`, `buildOrgUrl`,
  `buildContentUrl`; update §2 and §6 if any case is added or reshaped
- `apps/web/src/hooks.test.ts` — tests documenting expected mappings; any failing test
  means §1 is stale
- `packages/constants/src/urls.ts` — `RESERVED_SUBDOMAINS`, `RESERVED_SUBDOMAINS_SET`;
  update §3 if the list grows
- `packages/validation/src/content/content-schemas.ts` — `organizationSlugSchema`
  refinement; update §3 if the refinement moves or changes shape
- `apps/web/src/routes/_org/[slug]/+layout.svelte` — branding binding block (lines
  412–446); update §5 if the style attribute surface changes
- `apps/web/src/lib/brand-editor/css-injection.ts` — `tokenOverridesToCssVars`,
  `injectTokenOverrides`; update §5.2 if the shared helper signature changes

If the code disagrees with this reference, **the code wins** — update here.

---

## 11. Cross-References

- `01-tokens.md` — how `--brand-*` feeds into design tokens
- `02-css-architecture.md` — the `[data-theme] > [data-org-brand]` cascade order
- `10-brand-editor.md` §1 "Architecture Overview" — the full SSR/CSR delivery chain,
  including the six integration paths
- `10-brand-editor.md` §13.3 — canonical anti-pattern for missing SSR bindings
- `11-theming.md` §4 — how `[data-editing-theme]` relates to `[data-org-brand]`
- `apps/web/CLAUDE.md` "Routing Structure" — higher-level routing overview from the app's
  perspective
