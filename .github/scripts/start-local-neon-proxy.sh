#!/bin/bash
# Make the `neon-proxy` service container of a CI test job serve queries, and
# prove it reaches the test database before anything runs against it.
#
# Usage: start-local-neon-proxy.sh <proxy-container-id>
#   (pass `${{ job.services.neon-proxy.id }}`)
#
# Reads DATABASE_URL_LOCAL_PROXY — the URL the tests use — for the database
# name the proxy must answer with. LOCAL_NEON_PROXY_PORT (default 4444, the
# port @codex/database hardcodes) exists only so the script can be exercised
# against a stack published on other ports.
#
# WHY A RESTART. The proxy image's start.sh runs `psql $PG_CONNECTION_STRING`
# ONCE, at container start, to create `neon_control_plane.endpoints`, and it
# neither waits for Postgres nor exits when that fails. GitHub starts service
# containers together and only waits for health checks AFTERWARDS, so the
# proxy starts before Postgres accepts connections: the table is never created
# and every query then fails with "Control plane request failed" (relation
# "neon_control_plane.endpoints" does not exist). Verified against the pinned
# digest, Codex-75m0t.2. By the time the job's steps run, GitHub has waited for
# Postgres' health check, so a restart re-runs start.sh against a live server.
# Up to three restarts absorb any remaining race.
#
# WHY /etc/hosts. `db.localtest.me` is the hostname @codex/database and
# @codex/test-utils key the LOCAL_PROXY rewrite on (http://…:4444/sql and
# ws://…:4444/v1). Public DNS answers both 127.0.0.1 and ::1 for it. Pinning
# it to 127.0.0.1 takes public DNS out of the test path and keeps every client
# (node, workerd) on the IPv4 loopback the service ports are published on.

set -euo pipefail

PROXY_CONTAINER="${1:?usage: $0 <proxy-container-id>}"
: "${DATABASE_URL_LOCAL_PROXY:?DATABASE_URL_LOCAL_PROXY must be set}"
EXPECTED_DB="${DATABASE_URL_LOCAL_PROXY##*/}"
PROXY_PORT="${LOCAL_NEON_PROXY_PORT:-4444}"

if [ "${GITHUB_ACTIONS:-}" = "true" ] &&
  ! grep -qE '[[:space:]]db\.localtest\.me([[:space:]]|$)' /etc/hosts; then
  echo "127.0.0.1 db.localtest.me" | sudo tee -a /etc/hosts > /dev/null
fi

response=""
for attempt in 1 2 3; do
  docker restart "$PROXY_CONTAINER" > /dev/null
  for _ in $(seq 1 30); do
    response=$(curl -s -m 5 -X POST "http://db.localtest.me:${PROXY_PORT}/sql" \
      -H "Neon-Connection-String: ${DATABASE_URL_LOCAL_PROXY}" \
      -H 'Content-Type: application/json' \
      -d '{"query":"select current_database() as name","params":[]}' || true)
    if [[ "$response" == *"\"name\":\"${EXPECTED_DB}\""* ]]; then
      echo "Local Neon proxy is serving \"${EXPECTED_DB}\" (after restart ${attempt})."
      exit 0
    fi
    sleep 1
  done
  echo "Local Neon proxy not serving \"${EXPECTED_DB}\" after restart ${attempt}; last response: ${response:-<none>}"
done

echo "::error::The local Neon proxy never served \"${EXPECTED_DB}\". Last 50 lines of its log:"
docker logs --tail 50 "$PROXY_CONTAINER" 2>&1 || true
exit 1
