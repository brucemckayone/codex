# Security Implementation Checklist

**Reference:** [design/infrastructure/SECURITY.md](../design/infrastructure/SECURITY.md)

**Sprint:** Week 1-2 (Critical items only)

---

## Week 1: Critical Fixes (Must Complete)

### Day 1-2: Stripe Webhook Security

- [ ] **Install Stripe SDK**
  ```bash
  cd workers/ecom-api
  pnpm add stripe
  ```

- [ ] **Implement signature verification** ([SECURITY.md#1-stripe-webhook-signature-verification](../design/infrastructure/SECURITY.md#1-stripe-webhook-signature-verification))
  - File: `workers/ecom-api/src/index.ts`
  - Lines to modify: 70-78
  - Add signature extraction and verification before processing
  - Test with invalid/missing signatures

- [ ] **Add unit tests**
  - File: `workers/ecom-api/src/index.test.ts`
  - Test: Reject missing signature (expect HTTP 400)
  - Test: Reject invalid signature (expect HTTP 401)
  - Test: Accept valid signature (mock Stripe event)

- [ ] **Verify in preview deployment**
  ```bash
  # Test via curl
  curl -X POST https://api-preview-{PR}.revelations.studio/webhook \
    -H "stripe-signature: invalid" \
    -d '{"type":"test"}' \
    --verbose
  # Expected: HTTP 401
  ```

---

### Day 2-3: Remove Secret Leakage

- [ ] **Update health endpoints** ([SECURITY.md#2-remove-secret-leakage-from-health-endpoint](../design/infrastructure/SECURITY.md#2-remove-secret-leakage-from-health-endpoint))
  - File: `workers/ecom-api/src/index.ts` (lines 54-65)
  - File: `workers/auth/src/index.ts`
  - File: `apps/web/src/routes/api/health/+server.ts`
  - Remove: `hasDatabase`, `hasStripeKey`, `webhookSecretsConfigured`
  - Keep only: `status`, `worker`, `environment`, `timestamp`

- [ ] **Verify no secrets in logs**
  ```bash
  # Check production health endpoint
  curl https://api.revelations.studio/health | jq
  # Should NOT show secret configuration

  # Check worker logs
  wrangler tail ecom-api-production --format json | grep -i "secret\|key\|password"
  # Should be empty or redacted
  ```

---

### Day 3-4: Mask Database URLs in Workflows

- [ ] **Update testing workflow** ([SECURITY.md#6-mask-secrets-in-github-actions-logs](../design/infrastructure/SECURITY.md#6-mask-secrets-in-github-actions-logs))
  - File: `.github/workflows/testing.yml`
  - Add `echo "::add-mask::$DATABASE_URL"` to:
    - Line 118 (before migrations)
    - Line 146 (before tests)
  - Add to E2E workflow as well (lines 210, 240)

- [ ] **Update preview deployment workflow**
  - File: `.github/workflows/preview-deploy.yml`
  - Line 151: Already has `::add-mask::`, verify it works
  - Add to all steps that use `DATABASE_URL`

- [ ] **Verify masking works**
  ```bash
  # Open recent workflow run
  gh run view <run-id> --log | grep -i "DATABASE_URL"
  # Should show: *** instead of actual URL
  ```

---

### Day 4-5: Reduce Artifact Retention

- [ ] **Update artifact retention** ([SECURITY.md#7-reduce-artifact-retention](../design/infrastructure/SECURITY.md#7-reduce-artifact-retention))
  - File: `.github/workflows/testing.yml`
  - Line 138: Change `retention-days: 7` to `retention-days: 1`

- [ ] **Verify in GitHub UI**
  - Open Actions → Recent workflow → Artifacts
  - Check expiration shows "Expires in 1 day"

- [ ] **Document in CICD.md**
  - Update retention policy documentation
  - Add rationale: "Ephemeral secrets should not persist beyond immediate use"

---

## Week 2: High Priority

### Day 6-7: Security Headers

- [ ] **Add SvelteKit security headers** ([SECURITY.md#3-security-headers-middleware](../design/infrastructure/SECURITY.md#3-security-headers-middleware))
  - Create file: `apps/web/src/hooks.server.ts`
  - Implement CSP, X-Frame-Options, HSTS, etc.
  - Test headers in preview:
    ```bash
    curl -I https://codex-preview-{PR}.revelations.studio
    ```

- [ ] **Add auth worker headers**
  - File: `workers/auth/src/index.ts`
  - Add middleware after request timing
  - Test: `curl -I https://auth-preview-{PR}.revelations.studio/health`

- [ ] **Add webhook handler headers**
  - File: `workers/ecom-api/src/index.ts`
  - Same pattern as auth worker

---

### Day 8-10: Rate Limiting

- [ ] **Create rate limiter middleware** ([SECURITY.md#4-rate-limiting-middleware-cloudflare-workers](../design/infrastructure/SECURITY.md#4-rate-limiting-middleware-cloudflare-workers))
  - Create file: `workers/auth/src/middleware/rate-limit.ts`
  - Implement in-memory rate limiting (Map-based)

- [ ] **Apply to auth endpoints**
  - File: `workers/auth/src/index.ts`
  - Protect `/login`, `/register`, `/forgot-password`
  - Config: 5 requests per 15 minutes per IP

- [ ] **Apply to webhook endpoint**
  - File: `workers/ecom-api/src/index.ts`
  - Protect `/webhook`
  - Config: 100 requests per minute per IP (Stripe can send bursts)

- [ ] **Add Playwright test**
  - File: `apps/web/e2e/security/rate-limit.spec.ts`
  - Test: 6 rapid login attempts → expect 429 on 6th

---

### Day 10-12: Dependency & Secret Scanning

- [ ] **Enable Dependabot** ([SECURITY.md#required-automated-checks](../design/infrastructure/SECURITY.md#required-automated-checks))
  - Create file: `.github/dependabot.yml`
  - Configure for npm and GitHub Actions
  - Verify PRs appear for outdated dependencies

- [ ] **Add security scan workflow**
  - Create file: `.github/workflows/security-scan.yml`
  - Add jobs: `dependency-scan`, `sast-scan`, `secret-scan`
  - Trigger on PR, push to main, and weekly schedule

- [ ] **Configure CodeQL**
  - Already in workflow (uses `github/codeql-action`)
  - Enable in repository settings: Settings → Security → Code scanning

- [ ] **Add Gitleaks**
  - Uses `gitleaks/gitleaks-action@v2`
  - Run locally first:
    ```bash
    docker run --rm -v $(pwd):/repo zricethezav/gitleaks:latest detect --source /repo
    ```

---

## Week 3+: Medium/Low Priority

### Preview Environment Hardening

- [ ] **Add preview authentication** (Item #8)
  - Option: Basic auth with PR-specific password
  - Or: GitHub OAuth with team membership check
  - Decision needed (see SECURITY.md follow-up questions)

- [ ] **Isolate preview DB branches** (Item #10)
  - Create sanitized "staging" parent (not production)
  - Update `.github/workflows/testing.yml` line 93

### Logging & Monitoring

- [ ] **Implement PII redaction** (Item #11)
  - File: `packages/observability/src/logger.ts`
  - Add `redactSensitiveData()` function
  - Apply to all log calls

- [ ] **Add structured logging** ([SECURITY.md#structured-log-schema](../design/infrastructure/SECURITY.md#structured-log-schema))
  - Define schemas for auth events and payment events
  - Implement in observability package

- [ ] **Configure Sentry** (if using)
  - Get DSN from security team (see follow-up questions)
  - Add to `packages/observability/src/sentry.ts`
  - Initialize in all workers

### Database Security

- [ ] **Add query timeouts** (Item #13)
  - File: `packages/database/src/client.ts`
  - Set `neonConfig.fetchConnectionTimeout = 30000`

- [ ] **Add connection pooling limits**
  - Configure in Neon dashboard
  - Document in SECURITY.md

### Incident Response

- [ ] **Create IR runbook** (already in SECURITY.md)
  - Print and keep accessible
  - Train team on 10-step procedure

- [ ] **Test rollback procedure**
  - Practice worker rollback in staging
  - Practice DB point-in-time recovery

---

## Validation Commands

After each item, run validation:

```bash
# Stripe signature verification
curl -X POST https://api.revelations.studio/webhook -H "stripe-signature: invalid" -d '{}'
# Expected: HTTP 401

# Health endpoint (no secrets)
curl https://api.revelations.studio/health | jq
# Expected: No hasDatabase, hasStripeKey fields

# Security headers
curl -I https://codex.revelations.studio | grep -i "content-security-policy\|x-frame-options"
# Expected: CSP and X-Frame-Options headers present

# Rate limiting
for i in {1..6}; do curl -X POST https://auth.revelations.studio/login \
  -d '{"email":"test@test.com","password":"wrong"}'; done
# Expected: 6th request returns HTTP 429

# Workflow logs (DATABASE_URL masked)
gh run view <run-id> --log | grep DATABASE_URL
# Expected: *** instead of actual URL

# Artifact retention
gh run view <run-id> | grep -i "artifact.*expires"
# Expected: "Expires in 1 day"

# Dependency scan
pnpm audit --production --audit-level=moderate
# Expected: Exit code 0 (no critical/high vulns)

# Secret scan
docker run --rm -v $(pwd):/repo zricethezav/gitleaks:latest detect --source /repo
# Expected: No secrets found
```

---

## Progress Tracking

Mark items as complete using `[x]` in this file. Update weekly in sprint planning.

**Questions/Blockers:** Add here and escalate to security team.

**Current Sprint:** Week 1 (Critical items)
**Target Completion:** All critical items by [DATE]
**Sprint Review:** [DATE] with security team

---

**Reference Docs:**
- [Complete Security Plan](../design/infrastructure/SECURITY.md)
- [CI/CD Guide](../design/infrastructure/CICD.md)
- [PR Security Checklist](PULL_REQUEST_TEMPLATE.md)
