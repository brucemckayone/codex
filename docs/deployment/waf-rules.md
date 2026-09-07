# WAF custom rules (revelations.studio)

Edge blocking for scanner and credential-probe paths. Two rules, applied in
order, on the `http_request_firewall_custom` phase of the **zone** (not the
account — the account-level WAF page is Enterprise-only and a dead end).

Scripted path: [`.github/scripts/manage-waf-rules.sh`](../../.github/scripts/manage-waf-rules.sh).
That file carries the expressions and the per-clause reasoning; this document is
the operator's guide, including the dashboard route for when you would rather
not mint a token.

---

## Why bother, given the traffic costs nothing

It is **not** about cost. ~2k scanner requests/day is ~0.6% of the 10M requests
included on Workers Paid, and the probed paths do no database work (the apex
`GET /` load only sets a cache header), so this traffic does not keep Neon awake
either. Marginal cost is effectively zero.

The reason is **signal quality**. In the 14h after the 2026-09-06 production
deploy, bots produced the large majority of `cache_stats` cache gets and the
single largest production error string was bot `POST /`. Every cache or
performance reading had to be de-noised by hand before it could be trusted —
an ongoing tax on being able to measure anything.

The mechanism that makes it worth doing at all: per Cloudflare's Workers
observability docs, *"requests blocked by WAF or other security features will
NOT count"* as invocations. A block happens **before** the Worker runs. No
invocation, no KV op, no SSR render. In-Worker filtering cannot do this — by the
time your code executes, the invocation is already billed.

---

## Rule 1 must come first, and getting it wrong is silent

Cloudflare's own guidance: *"Start by creating an exception for verified bots so
they are protected BEFORE you deploy any blocking rules."*

- **Rule 1** — expression `(cf.client.bot)`, action **Skip**, skipping
  *"All remaining custom rules"*, placed **FIRST**.
- **Rule 2** — the path block, action **Block**, placed **Last**.

Without rule 1 the path block also blocks Googlebot, Bingbot and uptime
monitors. On a content platform that is an invisible SEO wound: nothing errors,
traffic just quietly stops arriving. The dashboard's "Select order" dropdown
defaults to **Last**, which puts the Skip *after* the block where it does
nothing — so this is easy to get wrong and hard to notice.

The script always writes both rules together in order, which is the main reason
to prefer it over clicking.

---

## Path A — scripted

Needs an API token with **`Zone.WAF: Edit`** (add `Zone.Zone: Read` if you want
to pass a zone *name* instead of its id). Create at
`dash.cloudflare.com/profile/api-tokens`. The repo's `wrangler login` OAuth
carries `workers*` scopes only and **cannot** do this.

```bash
# 1. See what is there now. Mutates nothing.
.github/scripts/manage-waf-rules.sh show "$CF_TOKEN" revelations.studio

# 2. Apply both rules, in order.
.github/scripts/manage-waf-rules.sh apply "$CF_TOKEN" revelations.studio

# 3. Verify. No token needed. Do not skip this.
.github/scripts/manage-waf-rules.sh verify https://revelations.studio \
  https://<org-slug>.revelations.studio
```

`apply` **refuses** if the zone holds a custom rule the script does not manage,
because Cloudflare's ruleset API replaces the entire entrypoint — a `PUT` that
omits a rule deletes it. Fold any such rule into the script rather than reaching
for `--force`.

---

## Path B — dashboard

1. Go to `dash.cloudflare.com` → **revelations.studio** → **Security** →
   **Security rules**. (Zone level. Not the account-level WAF page.)
2. If a verified-bot Skip rule does not already exist, create it:
   - Expression: **Custom filter expression** → edit as text → `(cf.client.bot)`
   - Action: **Skip** → tick **All remaining custom rules**
   - **Place at: First** — change this from the default `Last`.
3. Edit the existing block rule (or create it), action **Block**, **Place at:
   Last**, and paste the expression from `BLOCK_EXPRESSION` in
   `.github/scripts/manage-waf-rules.sh`.
4. Run step 3 of Path A to verify — the `verify` action needs no token.

### If you are editing the rule that already exists

Replace `contains "wp-"` with `starts_with "/wp-"`. As a substring, `wp-`
matches anywhere in the path, so any future org or content slug containing
`wp-` gets silently 403'd — and only in production, because WAF does not run in
`wrangler dev`. Coverage of the real probes (`/wp-login.php`,
`/wp-includes/*`, both at root) is identical.

---

## Verifying: test the blocks *and* the negative controls

A rule that 403s everything is indistinguishable from a working one if you only
check the blocks. The `verify` action tests both halves, and two of the controls
matter more than the rest:

- **`/.well-known/acme-challenge/...` must NOT be 403.** ACME renewal and
  `apple-app-site-association` live under `/.well-known/`, and the dotfile
  clause (`starts_with "/."`) would swallow the whole prefix without its
  explicit exclusion. Blocking it breaks certificate renewal — weeks later.
- **A tenant subdomain must NOT be 403.** `*.revelations.studio` is a wildcard
  onto the same worker and org slugs are unbounded, which is exactly why these
  rules are path-only and never host-based.

A useful calibration, run 2026-09-07 before the extended rules existed:
`/wp-login.php` returned **403** (the pre-existing rule) while `/sa.json`,
`/wp/`, `/wordpress/`, `/.aws/credentials`, `/@fs/...` and `/proc/...` all
returned **404** — i.e. they reached the Worker. That is the coverage gap, and
it also proves the probe can tell a block from a miss.

---

## Plan limits (Free zone — verified, do not recall these)

| Limit | Free |
|---|---|
| Custom rules | **5** |
| Actions | all except Log |
| **Regex** | **not supported** — use `in`, `starts_with`, `eq` |
| Rate-limiting rules | 1, 10s period only, IP-only counting |

Two rules are used, so three slots remain. Regex being unavailable is why the
expressions use exact sets and prefixes.

## Two things not to do

- **Never enable Bot Fight Mode.** It runs outside the Ruleset Engine, so
  *"cannot be bypassed with custom rule Skip actions"*, and this platform has
  non-browser callers with no possible exemption: worker-to-worker HMAC between
  subdomains, Stripe webhooks to ecom-api, RunPod callbacks to media-api.
- **Do not reach for the WAF rate-limiting rule.** On Free it is 1 rule, 10s
  period only, IP-only counting, Path/Verified-Bot expressions only — near
  useless here and actively risky, since IP-only counting can throttle our own
  traffic.
