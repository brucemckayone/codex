# Cloudflare Edge-Case Research: Routing Centralization

**Date**: 2026-05-22
**Scope**: Validate the prod-vs-dev routing asymmetry (`*.revelations.studio/*` wildcard zone route in prod vs per-org Workers Custom Domains via `DevDomainService` in dev) and recommend keep / modify / unify.

Sources cited inline. Docs verified live 2026-05-22.

---

## 1. Routing precedence summary (Q1)

A Workers **Custom Domain** is treated as an **origin** — Cloudflare creates a proxied DNS record at the registered hostname bound directly to the Worker. It does NOT participate in route-pattern matching.

When `auth.dev.revelations.studio` (Custom Domain on `auth-worker`) coexists with `*.dev.revelations.studio/*` (zone route on `web-worker`):

- The Custom Domain hostname is an exact DNS entry — request `auth.dev.revelations.studio/*` hits `auth-worker` directly, not the wildcard route.
- The wildcard route catches all *other* matching subdomains for `web-worker`.
- Cloudflare also documents the **inverse precedence rule**: if a *route* and a Custom Domain target the *same hostname*, the route wins (see [Custom Domains → Background](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) — "Routes can `fetch()` Custom Domains and take precedence if configured on the same hostname"). So overlapping by *exact* hostname is the only conflict surface; non-overlap by subdomain is safe.
- Route specificity rule: `www.example.com/*` beats `*.example.com/*` ([Routes → Matching behavior](https://developers.cloudflare.com/workers/configuration/routing/routes/)). Custom Domains are out-of-band of that mechanism (they're DNS+binding, not patterns).

**Verdict**: per-org Custom Domains and a sibling wildcard route on the *same zone* coexist cleanly **as long as they don't target identical hostnames**. The wildcard does NOT shadow Custom Domains.

## 2. SSL options table for two-level subdomains (Q2)

Universal SSL on a full-setup zone covers apex + first-level subdomains only. `studio-alpha.dev.revelations.studio` is two-deep — Universal SSL won't auto-issue. ([Universal SSL limitations](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/))

| Option | Coverage | Cost | Ops burden |
|---|---|---|---|
| **Universal SSL** | apex + 1 level only | Free | None |
| **Workers Custom Domain (per hostname)** | Auto-issues per hostname at ANY depth; routes + cert in one call | Free | Per-org API call at create/delete; limit: 100 Custom Domains/zone (Workers platform) |
| **Total TLS** | Auto-issues per proxied hostname at any depth via ACM machinery | Requires ACM ($10/mo/zone) | Toggle once; Cloudflare auto-orders. CN ≤ 64 chars; excludes Tunnel/Spectrum/LB hostnames |
| **Advanced Cert (manual)** | Single multi-level wildcard cert e.g. `*.dev.revelations.studio` | $10/mo/zone (ACM) | Order once, renews auto; up to 50 SANs per cert; 100 edge certs/zone cap |
| **Custom uploaded cert** | Whatever SANs you upload | Free upload (LetsEncrypt etc) | Manual renewal — operationally terrible |

Sources: [ACM docs](https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/), [Total TLS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/total-tls/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Cloudflare plans](https://www.cloudflare.com/plans/).

**Critical constraint**: 100 Custom Domains per zone hard limit. At ~1 org = 1 Custom Domain, dev caps at 100 orgs before requiring a different strategy. Production wildcard route has no such cap (1,000 routes/zone, but you only need 1 wildcard).

## 3. Unification verdict (Q3)

**Verdict: NO — keep the asymmetry. The cost of unifying is not justified by the benefit.**

Options considered:

- **(a) Prod uses per-org Custom Domains too**: would hit the 100-orgs-per-zone ceiling, adds API failure modes (Cloudflare hiccup blocks org create unless fire-and-forget), and replaces a single declarative wildcard route with N stateful API resources. Wrong direction.
- **(b) Dev uses a wildcard route + ACM wildcard cert (`*.dev.revelations.studio`)**: technically clean — one ACM cert ($10/mo) covers all dev orgs, and the wildcard zone route binds web-worker globally with API workers carved out by their own Custom Domains (same coexistence rule as prod). This would be the "true" unified model. Cost: $10/mo + an ACM cert resource + a wildcard route.

**Why (b) is tempting but not worth it**:
- The current `DevDomainService` already works, fails open (logs + swallows), runs only in dev, and has no production blast radius.
- Dev rarely exceeds 100 orgs in practice.
- Swapping to ACM means introducing a paid feature gate in CI/CD account setup and a new failure mode (ACM cert provisioning lag is 24-48h on first issue).
- The asymmetry is **documented in the dev-domain-service docstring** — the next engineer knows why.

**If dev org count is projected to grow past 50**: switch to (b). Otherwise the current Phase 7 model is right.

## 4. Multi-worker deploy gotchas (Q4)

- **Deploy order doesn't matter for Custom Domains** — they're exact-hostname DNS bindings; whichever Worker's most-recent deploy specifies `custom_domain: true` owns that hostname. No race.
- **Wildcard routes are the danger surface**: if you deploy `web-worker` with `*.revelations.studio/*` BEFORE the API workers register their Custom Domains, all requests including `auth.revelations.studio` would briefly hit `web-worker`. Mitigation: API workers' Custom Domains are stable (set at first deploy); only freshly-deployed zones are at risk. Codex's wrangler config already orders specific routes before wildcards in `apps/web/wrangler.jsonc` — good.
- **Same-zone Worker-to-Worker fetch limitation**: Workers on *routes* in the same zone cannot `fetch()` each other (need service bindings); Workers on *Custom Domains* can. ([Custom Domains → Worker to Worker communication](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)). Codex already uses Custom Domains for API workers, so cross-worker HMAC calls work. Do NOT migrate API workers to routes.
- **Cannot create a Custom Domain on a hostname with an existing CNAME**: dev-domain-service must ensure no CNAME conflict — verified the service handles 409s.

## 5. Staging routing safety (Q5)

`*-staging.revelations.studio/*` already exists in `apps/web/wrangler.jsonc` (confirmed in batch index). It runs **alongside** prod's `*.revelations.studio/*` wildcard. Safety analysis:

- Both wildcards match `foo-staging.revelations.studio`. Route specificity rule: `*-staging.revelations.studio/*` is **more specific** than `*.revelations.studio/*` (the prefix `*-staging` constrains characters before the literal `-staging`), so the staging route wins for staging traffic.
- Cloudflare's wildcard docs explicitly support this pattern (`*` matches zero-or-more chars; more-specific wins). Verified in [Routes → Matching behavior](https://developers.cloudflare.com/workers/configuration/routing/routes/).
- **Caveat**: the `*-staging` prefix wildcard pattern is supported in *routes* but **not in Custom Domains** (which reject `*` operators entirely). So API workers in staging are also via per-domain `auth-staging.revelations.studio` Custom Domains, same model as prod.
- TLS for staging: `foo-staging.revelations.studio` is a first-level subdomain → Universal SSL covers it automatically. No ACM needed.

**Verdict**: staging pattern is safe and the current config is correct.

## 6. Final recommendation

**Keep the current asymmetry.** It is:

- Documented in code (`packages/organization/src/services/dev-domain-service.ts`)
- Bounded in failure (no-op outside dev, fire-and-forget, swallows errors)
- Free (no ACM subscription)
- Locally faithful enough — dev hostnames behave like production org subdomains for routing/TLS purposes

**Migration trigger** (file a follow-up bead now, don't act): if dev org count exceeds 50, or if the dev-domain provisioning API becomes a hot spot for incidents, switch to the unified model — buy ACM for the dev zone, order one wildcard advanced cert for `*.dev.revelations.studio`, and replace `DevDomainService` with a wildcard route. ~1-day migration; reversible.

**Do NOT** migrate prod toward per-org Custom Domains. The wildcard-route + per-API-Custom-Domain pattern is the canonical Cloudflare model and is documented as such.

---

## Sources

- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Workers Routes — Matching behavior](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/)
- [Universal SSL limitations](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)
- [Total TLS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/total-tls/)
- [Advanced Certificate Manager](https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/)
- [Certificate and hostname priority](https://developers.cloudflare.com/ssl/reference/certificate-and-hostname-priority/)
- [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare plans pricing](https://www.cloudflare.com/plans/)
