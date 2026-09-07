#!/bin/bash
set -e

# Cloudflare WAF Custom Rules Management for revelations.studio
#
# WHY THIS EXISTS AS A SCRIPT AND NOT A DASHBOARD CLICK-PATH.
# The first version of these rules was applied by hand in the dashboard on
# 2026-08-26. It worked, and then it drifted: the block rule shipped with
# `contains "wp-"`, a SUBSTRING match that will silently 403 any future org or
# content slug containing "wp-" — in production only, because WAF does not run
# in `wrangler dev`. Nothing in the repo recorded the expression, so nothing
# could review it. This file is the reviewable record.
#
# WHAT A WAF BLOCK BUYS, precisely: from Cloudflare's Workers observability
# docs, "requests blocked by WAF or other security features will NOT count" as
# Worker invocations. So a block happens BEFORE the Worker runs — no invocation,
# no KV operation, no SSR render, no cost. In-Worker filtering cannot achieve
# this: by the time your code runs, the invocation is already billed.
#
# WHY THE RULES ARE PATH-ONLY AND NEVER HOST-BASED.
# `*.revelations.studio` routes to `codex-web-production` deliberately — org
# subdomains are dynamic tenant slugs, so the set of GOOD hostnames is unbounded
# and cannot be allow-listed at the edge. Any host-based denylist can only chase
# hostnames one at a time and will drift. PATH RULES ONLY.
#
# ORDER IS LOAD-BEARING AND GETTING IT WRONG IS SILENT.
# Cloudflare: "Start by creating an exception for verified bots so they are
# protected BEFORE you deploy any blocking rules." Rule 1 must be the
# verified-bot Skip; a path block without it blocks Googlebot/Bingbot and uptime
# monitors, which is an invisible SEO wound on a content platform. This script
# always writes both rules together, in order, so the ordering cannot rot.
#
# CREDENTIALS. The repo's `wrangler login` OAuth carries workers* scopes only
# and has NO zone-level WAF permission, so wrangler cannot do this. You need an
# API token with `Zone.WAF: Edit` (plus `Zone.Zone: Read` if you pass a zone
# NAME rather than an id). Create one at
# dash.cloudflare.com/profile/api-tokens. Never commit it.
#
# Usage:
#   .github/scripts/manage-waf-rules.sh show   <API_TOKEN> <ZONE_ID|ZONE_NAME>
#   .github/scripts/manage-waf-rules.sh apply  <API_TOKEN> <ZONE_ID|ZONE_NAME> [--force]
#   .github/scripts/manage-waf-rules.sh verify <BASE_URL> [ORG_SUBDOMAIN_URL]
#
# `show` mutates nothing. `apply` REPLACES the custom-rules entrypoint (that is
# how Cloudflare's ruleset API works), so it first refuses if it finds a rule it
# does not manage — see REFUSE-UNTRACKED below. `verify` needs no token at all.

ACTION=$1
API_BASE="https://api.cloudflare.com/client/v4"

# The Free zone plan gives 5 custom rules, all actions except Log, and NO regex
# support (verified against Cloudflare's Firewall Rules availability table). So
# these expressions use only `in` (exact set), `starts_with` and `eq`. Exact
# matching is not merely tidier: it makes a collision with a tenant or content
# slug structurally impossible rather than merely unlikely.
#
# Every path below was observed hitting codex-web-production in production logs
# over 2026-09-06T21:28Z -> 2026-09-07T11:43Z. Because a WAF block would have
# prevented the invocation entirely, their PRESENCE in Worker logs is itself the
# proof the current rules do not cover them.
read -r -d '' BLOCK_EXPRESSION <<'EXPR' || true
(http.request.uri.path in {"/sa.json" "/gcp-sa.json" "/gcp-key.json" "/google-key.json" "/key.json" "/keyfile.json" "/service-account.json" "/firebase-adminsdk.json" "/firebase-key.json" "/docker-compose.yml" "/_environment" "/info" "/blog/" "/livewire/update" "/api/fs/read" "/api/proc/self/environ" "/__vite_rsc_findSourceMapURL" "/graphql" "/v1/graphql" "/api/graphql"}) or (starts_with(http.request.uri.path, "/.") and not starts_with(http.request.uri.path, "/.well-known/")) or starts_with(http.request.uri.path, "/@fs/") or starts_with(http.request.uri.path, "/proc/") or starts_with(http.request.uri.path, "/var/run/secrets/") or starts_with(http.request.uri.path, "/wp/") or starts_with(http.request.uri.path, "/wp-") or starts_with(http.request.uri.path, "/wordpress") or (http.request.uri.path contains "/wp/v2/") or (http.request.method eq "POST" and http.request.uri.path eq "/")
EXPR

# Clause notes, because the next reader will want to change one of these:
#
# * `in {...}` is EXACT, so none of those 20 can catch a slug. "/blog/" matches
#   only the literal path — a future /blog or /blog/my-post is untouched, and
#   the nested /blog/wp/v2/* probes are caught by the "/wp/v2/" clause instead.
#   That is a deliberate trade: it kills 96 observed bot events while foreclosing
#   almost nothing.
# * `starts_with "/."` covers every dotfile probe seen (.aws/credentials, .oci/*,
#   .bash_profile, .zshrc, .profile, .dockerenv) AND future ones — a prefix rule
#   covers the unlisted. The `/.well-known/` exclusion is REQUIRED: ACME renewal
#   and apple-app-site-association live there, and blocking it breaks TLS renewal.
# * `starts_with "/wp-"` REPLACES the hand-applied `contains "wp-"`. Identical
#   coverage of the real probes (/wp-login.php, /wp-includes/*, both at root),
#   zero collision surface. This is the drift fix.
# * `POST / eq "/"` kills 161 observed events and the single largest production
#   error string ("POST method not allowed. No form actions exist for this
#   page"). Safe TODAY because this app mutates via SvelteKit remote functions
#   (POST /_app/remote/*, a different path, unaffected) rather than root form
#   actions. If a root form action is ever added, this clause 403s it in
#   PRODUCTION ONLY — delete the clause in the same change.
# * NOT blocked: /terms and /privacy. Those 404s were real users following the
#   site's own Footer links; fixed by adding the routes (Codex-6wkr1), not here.

SKIP_RULE_DESC="Skip remaining custom rules for verified bots"
BLOCK_RULE_DESC="Block scanner and credential-probe paths"
PHASE="http_request_firewall_custom"

# ---------------------------------------------------------------------------
# verify — no token needed. Tests BLOCKS *and* NEGATIVE CONTROLS.
# ---------------------------------------------------------------------------
# A rule that 403s everything is indistinguishable from a working one if you
# only check the blocks. The controls are the half that catches an over-broad
# expression, and /.well-known/ is the one that catches a broken cert renewal.
if [ "$ACTION" = "verify" ]; then
  BASE_URL=${2:-https://revelations.studio}
  ORG_URL=$3
  fails=0

  echo "Expect 403 (blocked at the edge):"
  for p in /sa.json /wp/ /wordpress/ /.aws/credentials /@fs/proc/self/cmdline /proc/self/cgroup /wp-login.php; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}${p}" || echo "ERR")
    if [ "$code" = "403" ]; then echo "  ok   $code  $p"; else echo "  FAIL $code  $p (wanted 403)"; fails=$((fails+1)); fi
  done
  code=$(curl -s -X POST -o /dev/null -w '%{http_code}' "${BASE_URL}/" || echo "ERR")
  if [ "$code" = "403" ]; then echo "  ok   $code  POST /"; else echo "  FAIL $code  POST / (wanted 403)"; fails=$((fails+1)); fi

  echo
  echo "Expect NOT 403 (negative controls — an over-broad rule fails here):"
  for p in / /pricing /login /about /terms /privacy /sitemap.xml /.well-known/acme-challenge/probe; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}${p}" || echo "ERR")
    if [ "$code" != "403" ]; then echo "  ok   $code  $p"; else echo "  FAIL 403  $p (must NOT be blocked)"; fails=$((fails+1)); fi
  done

  if [ -n "$ORG_URL" ]; then
    echo
    echo "Expect NOT 403 (tenant subdomain — proves no host-based over-reach):"
    for p in / /explore; do
      code=$(curl -s -o /dev/null -w '%{http_code}' "${ORG_URL}${p}" || echo "ERR")
      if [ "$code" != "403" ]; then echo "  ok   $code  ${ORG_URL}${p}"; else echo "  FAIL 403  ${ORG_URL}${p}"; fails=$((fails+1)); fi
    done
  else
    echo
    echo "NOTE: pass an org subdomain URL as arg 3 to test tenant routing too."
  fi

  echo
  if [ "$fails" -eq 0 ]; then echo "All checks passed."; else echo "$fails check(s) FAILED."; exit 1; fi
  exit 0
fi

API_TOKEN=$2
ZONE=$3
FORCE=$4

if [ -z "$ACTION" ] || [ -z "$API_TOKEN" ] || [ -z "$ZONE" ]; then
  echo "Usage: $0 <show|apply> <API_TOKEN> <ZONE_ID|ZONE_NAME> [--force]"
  echo "       $0 verify <BASE_URL> [ORG_SUBDOMAIN_URL]"
  exit 1
fi

AUTH=(-H "Authorization: Bearer ${API_TOKEN}" -H "Content-Type: application/json")

# Accept a zone name for convenience; resolve it to an id (needs Zone:Read).
if printf '%s' "$ZONE" | grep -qE '^[0-9a-f]{32}$'; then
  ZONE_ID="$ZONE"
else
  echo "Resolving zone name '${ZONE}' to an id..."
  ZONE_ID=$(curl -s "${AUTH[@]}" "${API_BASE}/zones?name=${ZONE}" | jq -r '.result[0].id // empty')
  if [ -z "$ZONE_ID" ]; then
    echo "ERROR: could not resolve zone '${ZONE}'. Pass the 32-hex zone id, or add Zone:Read to the token."
    exit 1
  fi
  echo "  -> ${ZONE_ID}"
fi

ENTRYPOINT="${API_BASE}/zones/${ZONE_ID}/rulesets/phases/${PHASE}/entrypoint"

fetch_current() {
  curl -s "${AUTH[@]}" "$ENTRYPOINT"
}

if [ "$ACTION" = "show" ]; then
  body=$(fetch_current)
  if [ "$(printf '%s' "$body" | jq -r '.success')" != "true" ]; then
    # A zone with no custom rules yet returns an error here rather than an empty
    # list, which is expected and not a failure.
    echo "No custom-rules entrypoint returned. Raw response:"
    printf '%s' "$body" | jq '.errors'
    exit 0
  fi
  echo "Current custom rules, in evaluation order:"
  printf '%s' "$body" | jq -r '.result.rules // [] | to_entries[] | "\(.key+1). [\(.value.action)] \(.value.description // "(no description)")\n   \(.value.expression)"'
  exit 0
fi

if [ "$ACTION" != "apply" ]; then
  echo "ERROR: unknown action '$ACTION' (expected show, apply or verify)"
  exit 1
fi

# ---------------------------------------------------------------------------
# REFUSE-UNTRACKED.
# Cloudflare's ruleset API replaces the whole entrypoint, so a PUT that omits a
# rule DELETES it. Rather than trust that the only rules present are the two
# this script knows about, enumerate them and refuse on anything unrecognised.
# Clobbering a rule someone added by hand would be silent and unrecoverable.
# ---------------------------------------------------------------------------
current=$(fetch_current)
if [ "$(printf '%s' "$current" | jq -r '.success')" = "true" ]; then
  unknown=$(printf '%s' "$current" | jq -r --arg s "$SKIP_RULE_DESC" --arg b "$BLOCK_RULE_DESC" \
    '.result.rules // [] | map(select((.description // "") != $s and (.description // "") != $b)) | .[] | "[\(.action)] \(.description // "(no description)"): \(.expression)"')
  if [ -n "$unknown" ]; then
    echo "REFUSING: the zone has custom rule(s) this script does not manage."
    echo "Applying would DELETE them, because Cloudflare replaces the whole entrypoint."
    echo
    printf '%s\n' "$unknown"
    echo
    if [ "$FORCE" != "--force" ]; then
      echo "Fold them into this script's rule list, or re-run with --force to discard them."
      exit 1
    fi
    echo "--force given: proceeding and DISCARDING the rules listed above."
  fi
fi

echo "Applying 2 rules to zone ${ZONE_ID} (phase ${PHASE})..."

payload=$(jq -n \
  --arg skip_desc "$SKIP_RULE_DESC" \
  --arg block_desc "$BLOCK_RULE_DESC" \
  --arg block_expr "$BLOCK_EXPRESSION" \
  '{
     rules: [
       {
         action: "skip",
         action_parameters: { ruleset: "current" },
         expression: "(cf.client.bot)",
         description: $skip_desc,
         enabled: true
       },
       {
         action: "block",
         expression: $block_expr,
         description: $block_desc,
         enabled: true
       }
     ]
   }')

response=$(curl -s -X PUT "${AUTH[@]}" "$ENTRYPOINT" --data "$payload")

if [ "$(printf '%s' "$response" | jq -r '.success')" = "true" ]; then
  echo "Applied. Rules now:"
  printf '%s' "$response" | jq -r '.result.rules // [] | to_entries[] | "\(.key+1). [\(.value.action)] \(.value.description)"'
  echo
  echo "NOW VERIFY — do not assume. Blocks and negative controls both matter:"
  echo "  $0 verify https://revelations.studio https://<org-slug>.revelations.studio"
else
  echo "FAILED:"
  printf '%s' "$response" | jq '.errors'
  exit 1
fi
