# Security Plan & Hardening Guide

**Last Updated:** 2025-11-02
**Status:** Implementation Required

---

## Executive Summary

**Critical security gaps identified:** (1) Stripe webhook signature verification is not implemented, exposing the API to unauthenticated payment manipulation; (2) secrets are logged in health check endpoints allowing credential exfiltration via logs; (3) ephemeral preview environments expose production-like secrets without isolation controls, creating lateral movement risk across PRs. Immediate remediation required within 7 days to prevent potential fraud, data breaches, and regulatory violations.

---

## Threat Model (STRIDE Analysis)

### Assets

1. **Cloudflare Workers** (codex-web, auth-worker, ecom-api)
2. **Neon Postgres Database** (production + ephemeral branches)
3. **Secrets** (Stripe keys, session secrets, DB credentials, API tokens)
4. **GitHub Actions** (workflow execution, artifact storage, secrets management)
5. **DNS Infrastructure** (Cloudflare DNS records, custom domains)
6. **R2/KV Storage** (planned, not yet configured)
7. **User Data** (authentication sessions, PII, payment information)

### Threat Analysis by Component

#### 1. Stripe Webhook Handler (`workers/ecom-api`)

| Threat Type | Threat | Impact | Likelihood | Mitigation Priority |
|-------------|--------|--------|------------|---------------------|
| **Spoofing** | Unauthenticated webhook requests forge payment events | 5/5 | High | **CRITICAL** |
| **Tampering** | Malicious actor modifies webhook payload mid-flight | 4/5 | Medium | High |
| **Repudiation** | No audit trail for webhook processing failures | 3/5 | High | Medium |
| **Info Disclosure** | Health endpoint leaks secret existence in logs | 4/5 | High | **CRITICAL** |
| **DoS** | Webhook endpoint overwhelmed with invalid requests | 3/5 | Medium | Medium |
| **Privilege Escalation** | Compromised webhook triggers admin actions | 5/5 | Low | High |

**Current Gaps:**
- ❌ No Stripe signature verification ([src/index.ts:70-78](../../../workers/ecom-api/src/index.ts#L70-L78))
- ❌ Health endpoint exposes secret presence ([src/index.ts:54-65](../../../workers/ecom-api/src/index.ts#L54-L65))
- ❌ No rate limiting on webhook endpoint
- ❌ No request replay protection (idempotency keys)

#### 2. Authentication Worker (`workers/auth`)

| Threat Type | Threat | Impact | Likelihood | Mitigation Priority |
|-------------|--------|--------|------------|---------------------|
| **Spoofing** | Session hijacking via stolen cookies | 5/5 | Medium | High |
| **Tampering** | CSRF attacks on auth endpoints | 4/5 | High | High |
| **Info Disclosure** | Session secrets leaked via logs/errors | 5/5 | Medium | **CRITICAL** |
| **DoS** | Brute-force login attempts | 3/5 | High | Medium |

**Current Gaps:**
- ⚠️ SESSION_SECRET handling needs review
- ❌ No rate limiting on login endpoints
- ❌ Missing security headers (CSP, HSTS, etc.)
- ❌ No CSRF protection visible

#### 3. Neon Database (Ephemeral Branches)

| Threat Type | Threat | Impact | Likelihood | Mitigation Priority |
|-------------|--------|--------|------------|---------------------|
| **Spoofing** | PR author tricks CI into using production DB | 5/5 | Low | High |
| **Info Disclosure** | DB credentials in workflow logs | 5/5 | Medium | **CRITICAL** |
| **Info Disclosure** | Production data exposed to preview environments | 4/5 | High | High |
| **Tampering** | SQL injection via unsanitized Drizzle queries | 5/5 | Low | Medium |
| **DoS** | Ephemeral branch cleanup fails, hitting Neon limits | 3/5 | Medium | Medium |

**Current Gaps:**
- ❌ DATABASE_URL masked in artifacts but logged elsewhere ([.github/workflows/testing.yml:151](../.github/workflows/testing.yml#L151))
- ⚠️ Preview environments inherit production branch data (line 93: `parent: production`)
- ❌ No database connection pooling limits
- ❌ No query timeout enforcement

#### 4. GitHub Actions (CI/CD Pipeline)

| Threat Type | Threat | Impact | Likelihood | Mitigation Priority |
|-------------|--------|--------|------------|---------------------|
| **Spoofing** | Malicious PR injects code into workflows | 5/5 | Medium | High |
| **Info Disclosure** | Secrets leaked via echo/print statements | 5/5 | High | **CRITICAL** |
| **Tampering** | Supply chain attack via compromised npm packages | 5/5 | Medium | High |
| **Privilege Escalation** | Workflow token used to modify repo settings | 4/5 | Low | Medium |

**Current Gaps:**
- ❌ No dependency scanning (npm audit, Snyk, Dependabot)
- ❌ No SAST scanning (CodeQL, Semgrep)
- ❌ Artifact retention too long (7 days for ephemeral secrets)
- ❌ No workflow artifact signing/verification
- ⚠️ `continue-on-error: true` on cleanup steps could mask failures

#### 5. Preview Environments (Per-PR Deployments)

| Threat Type | Threat | Impact | Likelihood | Mitigation Priority |
|-------------|--------|--------|------------|---------------------|
| **Info Disclosure** | Preview URLs leak sensitive data to unauthorized viewers | 4/5 | High | High |
| **Tampering** | Malicious PR tests attack vectors on live infrastructure | 4/5 | Medium | High |
| **DoS** | Abandoned PRs consume resources (DNS, workers, DB branches) | 3/5 | Medium | Medium |
| **Lateral Movement** | Compromised preview worker accesses production resources | 5/5 | Low | High |

**Current Gaps:**
- ❌ No preview URL authentication (anyone with link can access)
- ❌ Stripe test keys shared across all preview environments
- ❌ No network isolation between preview workers
- ❌ DNS records not cleaned up if workflow fails ([.github/workflows/preview-deploy.yml:67-70](../.github/workflows/preview-deploy.yml#L67-L70))

#### 6. SvelteKit Web Application (`apps/web`)

| Threat Type | Threat | Impact | Likelihood | Mitigation Priority |
|-------------|--------|--------|------------|---------------------|
| **Tampering** | XSS via unsanitized user input | 5/5 | Medium | High |
| **Info Disclosure** | CORS misconfiguration leaks data to attacker domains | 4/5 | Medium | High |
| **Clickjacking** | Iframe embedding on malicious sites | 3/5 | Low | Medium |

**Current Gaps:**
- ❌ No Content Security Policy (CSP) headers
- ❌ Missing security headers (X-Frame-Options, HSTS, etc.)
- ❌ No CORS configuration visible

---

## Prioritized Remediation Backlog

### Critical (Fix Within 7 Days)

| # | Item | Risk | Effort | Files/Areas |
|---|------|------|--------|-------------|
| 1 | **Implement Stripe webhook signature verification** | 5/5 | M | `workers/ecom-api/src/index.ts` (lines 70-78) |
| 2 | **Remove secret leakage from health endpoints** | 5/5 | S | `workers/ecom-api/src/index.ts` (lines 54-65), `workers/auth/src/index.ts` |
| 3 | **Mask DATABASE_URL in all workflow logs** | 5/5 | S | `.github/workflows/testing.yml` (line 151), `.github/workflows/preview-deploy.yml` (line 283) |
| 4 | **Reduce artifact retention to 1 day for ephemeral secrets** | 4/5 | S | `.github/workflows/testing.yml` (line 138) |

### High (Next Sprint)

| # | Item | Risk | Effort | Files/Areas |
|---|------|------|--------|-------------|
| 5 | **Add security headers (CSP, HSTS, X-Frame-Options) to all workers** | 4/5 | M | `apps/web/src/`, `workers/auth/src/`, `workers/ecom-api/src/` |
| 6 | **Implement rate limiting on auth and webhook endpoints** | 4/5 | M | `workers/auth/src/index.ts`, `workers/ecom-api/src/index.ts` |
| 7 | **Add dependency vulnerability scanning (npm audit + Dependabot)** | 4/5 | S | `.github/workflows/security-scan.yml` (new file), `.github/dependabot.yml` |
| 8 | **Implement preview environment authentication (basic auth or allowlist)** | 4/5 | M | `.github/workflows/preview-deploy.yml`, middleware in workers |
| 9 | **Add SAST scanning (CodeQL or Semgrep)** | 4/5 | M | `.github/workflows/security-scan.yml` |
| 10 | **Isolate preview DB branches with sanitized data (not production parent)** | 4/5 | L | `.github/workflows/testing.yml` (line 93), Neon branch strategy |

### Medium (Roadmap)

| # | Item | Risk | Effort | Files/Areas |
|---|------|------|--------|-------------|
| 11 | **Add structured logging with PII redaction** | 3/5 | M | `packages/observability/src/`, all workers |
| 12 | **Implement webhook idempotency (replay protection)** | 3/5 | M | `workers/ecom-api/src/index.ts` |
| 13 | **Add database query timeout enforcement** | 3/5 | S | `packages/database/src/client.ts` |
| 14 | **Implement CSRF protection in auth worker** | 3/5 | M | `workers/auth/src/index.ts` |
| 15 | **Add alerting for failed secret rotations** | 3/5 | M | `.github/workflows/production-deploy.yml`, monitoring integration |

### Low (Future Enhancements)

| # | Item | Risk | Effort | Files/Areas |
|---|------|------|--------|-------------|
| 16 | **Implement preview environment TTL (auto-delete after 7 days)** | 2/5 | M | `.github/workflows/preview-deploy.yml` |
| 17 | **Add WAF rules for Cloudflare Workers** | 2/5 | L | Cloudflare dashboard, `wrangler.jsonc` |
| 18 | **Implement artifact signing and verification** | 2/5 | L | `.github/workflows/testing.yml`, deployment workflows |

---

## Configuration Examples

### 1. Stripe Webhook Signature Verification

**File:** `workers/ecom-api/src/index.ts`

```typescript
import Stripe from 'stripe';

app.post('/webhook', async (c) => {
  const obs = new ObservabilityClient(
    'ecom-api',
    c.env.ENVIRONMENT || 'development'
  );

  // Get signature from headers
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    obs.warn('Webhook rejected: Missing stripe-signature header');
    return c.json({ error: 'Missing signature' }, 400);
  }

  // Get raw body (CRITICAL: must be raw, not parsed JSON)
  const rawBody = await c.req.text();

  // Verify signature
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-10-28.acacia' });
  let event: Stripe.Event;

  try {
    // Use appropriate webhook secret based on endpoint
    const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET_PAYMENT!;
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    obs.error('Webhook signature verification failed', { error: (err as Error).message });
    return c.json({ error: 'Invalid signature' }, 401);
  }

  // Process verified event
  obs.info('Webhook verified', { type: event.type, id: event.id });
  // ... handle event.type switch cases ...

  return c.json({ received: true });
});
```

**Dependencies:** `pnpm add stripe` in `workers/ecom-api/package.json`

---

### 2. Remove Secret Leakage from Health Endpoint

**File:** `workers/ecom-api/src/index.ts`

```typescript
app.get('/health', (c) => {
  const obs = new ObservabilityClient(
    'ecom-api',
    c.env.ENVIRONMENT || 'development'
  );
  obs.info('Health check endpoint hit');

  // ✅ SECURE: Only return boolean status, never actual secret values
  return c.json({
    status: 'healthy',
    worker: 'ecom-api',
    environment: c.env.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString(),
    // ❌ REMOVED: hasDatabase, hasStripeKey, webhookSecretsConfigured
    // These fields leak information about secret configuration
  });
});
```

**Apply to:** All health endpoints in `workers/auth/src/index.ts` and `apps/web/src/routes/api/health/+server.ts`

---

### 3. Security Headers Middleware

**File:** `apps/web/src/hooks.server.ts` (create if not exists)

```typescript
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  // Security headers
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.stripe.com", // Allow Stripe.js
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self' https://api.stripe.com https://auth.revelations.studio https://api.revelations.studio",
      "frame-src https://js.stripe.com", // Stripe Elements iframes
      "frame-ancestors 'none'", // Prevent clickjacking
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  );

  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // HSTS (only in production, not preview)
  if (event.platform?.env?.ENVIRONMENT === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  return response;
};
```

**File:** `workers/auth/src/index.ts` (add middleware)

```typescript
// Add after request timing middleware
app.use('*', async (c, next) => {
  await next();

  // Security headers
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (c.env.ENVIRONMENT === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
});
```

---

### 4. Rate Limiting Middleware (Cloudflare Workers)

**File:** `workers/auth/src/middleware/rate-limit.ts` (new file)

```typescript
import type { Context, Next } from 'hono';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export function createRateLimiter(config: RateLimitConfig) {
  const requests = new Map<string, number[]>();

  return async (c: Context, next: Next) => {
    const identifier = c.req.header('cf-connecting-ip') || 'unknown';
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Get existing requests for this identifier
    const userRequests = requests.get(identifier) || [];

    // Filter to only recent requests within window
    const recentRequests = userRequests.filter(time => time > windowStart);

    if (recentRequests.length >= config.maxRequests) {
      return c.json({ error: 'Too many requests' }, 429);
    }

    // Add current request
    recentRequests.push(now);
    requests.set(identifier, recentRequests);

    // Cleanup old entries (prevent memory leak)
    if (requests.size > 10000) {
      const cutoff = now - (config.windowMs * 2);
      for (const [key, times] of requests.entries()) {
        if (times.every(t => t < cutoff)) {
          requests.delete(key);
        }
      }
    }

    await next();
  };
}
```

**Usage in** `workers/auth/src/index.ts`:

```typescript
import { createRateLimiter } from './middleware/rate-limit';

// Apply to login endpoints
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 5 });
app.post('/login', loginLimiter, async (c) => {
  // ... login logic
});
```

---

### 5. Database Connection with Timeouts

**File:** `packages/database/src/client.ts`

```typescript
import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';

import { DbEnvConfig } from './config/env.config';
import { config } from 'dotenv';
import { resolve } from 'path';

if (!DbEnvConfig.method)
  config({ path: resolve(__dirname, '../../../../.env.dev') });

// Apply neonConfig modifications
DbEnvConfig.applyNeonConfig(neonConfig);

// ✅ SECURE: Add query timeout (30 seconds)
neonConfig.fetchConnectionTimeout = 30000;

export const sql = neon(DbEnvConfig.getDbUrl()!, {
  fetchOptions: {
    // Prevent long-running queries from blocking workers
    signal: AbortSignal.timeout(30000)
  }
});

export const db = drizzle({ client: sql });
```

---

### 6. Mask Secrets in GitHub Actions Logs

**File:** `.github/workflows/testing.yml`

```yaml
- name: Apply migrations to ephemeral branch
  env:
    DATABASE_URL: ${{ steps.create-branch.outputs.db_url_with_pooler }}
    DB_METHOD: NEON_BRANCH
  run: |
    # ✅ SECURE: Mask DATABASE_URL before any commands
    echo "::add-mask::$DATABASE_URL"
    pnpm --filter @codex/database db:migrate

- name: Run tests for affected packages
  env:
    DATABASE_URL: ${{ steps.create-branch.outputs.db_url_with_pooler }}
    DB_METHOD: NEON_BRANCH
  run: |
    # ✅ SECURE: Mask in every step that uses secrets
    echo "::add-mask::$DATABASE_URL"
    if [[ "${{ needs.changes.outputs.database }}" == "true" ]]; then pnpm --filter @codex/database test; fi
    # ... rest of tests
```

**Apply to:** All workflow steps using `DATABASE_URL` or other secrets

---

### 7. Reduce Artifact Retention

**File:** `.github/workflows/testing.yml`

```yaml
- name: Upload Neon connection artifact
  uses: actions/upload-artifact@v4
  with:
    name: neon-connection-${{ github.run_id }}
    path: |
      database-url.txt
      branch-id.txt
      branch-name.txt
    retention-days: 1  # ✅ CHANGED from 7 to 1 (ephemeral secrets)
```

---

### 8. CORS Configuration (SvelteKit)

**File:** `apps/web/src/hooks.server.ts`

```typescript
export const handle: Handle = async ({ event, resolve }) => {
  // CORS headers (whitelist only known origins)
  const allowedOrigins = [
    'https://codex.revelations.studio',
    'https://auth.revelations.studio',
    'https://api.revelations.studio'
  ];

  const origin = event.request.headers.get('origin');

  if (origin && allowedOrigins.includes(origin)) {
    event.setHeaders({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true'
    });
  }

  // Handle preflight
  if (event.request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const response = await resolve(event);
  // ... add security headers from example #3 ...
  return response;
};
```

---

## CI/CD Security Gates

### Required Automated Checks (Add to Workflows)

**File:** `.github/workflows/security-scan.yml` (new file)

```yaml
name: Security Scanning

on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sunday

permissions:
  contents: read
  security-events: write

jobs:
  dependency-scan:
    name: Dependency Vulnerability Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run npm audit
        run: pnpm audit --production --audit-level=moderate
        continue-on-error: true

      - name: Run Snyk scan
        uses: snyk/actions/node@master
        continue-on-error: true
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --all-projects --severity-threshold=high

  sast-scan:
    name: Static Application Security Testing
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: javascript, typescript
          queries: security-and-quality

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3

  secret-scan:
    name: Secret Scanning
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for secret detection

      - name: Run Gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  migration-dry-run:
    name: Database Migration Dry Run
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Create test Neon branch
        id: test-branch
        uses: neondatabase/create-branch-action@v5
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          branch_name: migration-test-${{ github.run_id }}
          parent: production
          username: neondb_owner
          api_key: ${{ secrets.NEON_API_KEY }}

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Test migration (dry run)
        env:
          DATABASE_URL: ${{ steps.test-branch.outputs.db_url_with_pooler }}
        run: |
          echo "::add-mask::$DATABASE_URL"
          pnpm --filter @codex/database db:gen:drizzle
          pnpm --filter @codex/database db:migrate

      - name: Cleanup test branch
        if: always()
        uses: neondatabase/delete-branch-action@v3
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          branch: ${{ steps.test-branch.outputs.branch_id }}
          api_key: ${{ secrets.NEON_API_KEY }}
```

**File:** `.github/dependabot.yml` (new file)

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 10
    reviewers:
      - "security-team"
    labels:
      - "dependencies"
      - "security"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 5
    labels:
      - "ci/cd"
      - "security"
```

---

## Testing & Validation

### 1. SAST (Static Analysis)

```bash
# CodeQL (integrated in security-scan.yml)
# Already configured above

# Semgrep (alternative)
pnpm add -D semgrep
npx semgrep --config=auto apps/ workers/ packages/
```

### 2. Dependency Scanning

```bash
# npm audit
pnpm audit --production --audit-level=moderate

# Snyk (requires SNYK_TOKEN)
npx snyk test --all-projects --severity-threshold=high

# Check for outdated packages
pnpm outdated
```

### 3. Secret Scanning

```bash
# Gitleaks (local)
docker run --rm -v $(pwd):/repo zricethezav/gitleaks:latest detect \
  --source /repo --verbose --redact

# TruffleHog (alternative)
docker run --rm -v $(pwd):/repo trufflesecurity/trufflehog:latest \
  filesystem /repo
```

### 4. Playwright Security Tests

**File:** `apps/web/e2e/security/headers.spec.ts` (new file)

```typescript
import { test, expect } from '@playwright/test';

test.describe('Security Headers', () => {
  test('should have CSP header', async ({ page }) => {
    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'];

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test('should have X-Frame-Options', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.headers()['x-frame-options']).toBe('DENY');
  });

  test('should have HSTS in production', async ({ page }) => {
    // Run only on production URLs
    if (process.env.PLAYWRIGHT_BASE_URL?.includes('revelations.studio')) {
      const response = await page.goto('/');
      const hsts = response?.headers()['strict-transport-security'];
      expect(hsts).toContain('max-age=31536000');
    }
  });
});

test.describe('Authentication Security', () => {
  test('should rate limit login attempts', async ({ page }) => {
    await page.goto('/login');

    // Attempt 6 rapid logins (rate limit is 5)
    for (let i = 0; i < 6; i++) {
      await page.fill('[name="email"]', 'test@example.com');
      await page.fill('[name="password"]', 'wrong-password');
      await page.click('button[type="submit"]');

      if (i < 5) {
        // First 5 should show "Invalid credentials"
        await expect(page.locator('text=Invalid credentials')).toBeVisible();
      } else {
        // 6th should be rate limited
        await expect(page.locator('text=Too many requests')).toBeVisible();
      }
    }
  });
});
```

### 5. Stripe Webhook Testing

**File:** `workers/ecom-api/src/index.test.ts` (enhance)

```typescript
import { describe, it, expect } from 'vitest';
import app from './index';

describe('Stripe Webhook Security', () => {
  it('should reject webhook without signature', async () => {
    const res = await app.request('/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'payment_intent.succeeded' }),
      headers: { 'Content-Type': 'application/json' }
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Missing signature');
  });

  it('should reject webhook with invalid signature', async () => {
    const res = await app.request('/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'payment_intent.succeeded' }),
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid-signature'
      }
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid signature');
  });
});
```

### 6. Fuzz Testing for Webhooks

```bash
# Install ffuf
go install github.com/ffuf/ffuf@latest

# Fuzz webhook endpoint
ffuf -u https://api-preview-123.revelations.studio/webhook \
  -H "Content-Type: application/json" \
  -w /path/to/fuzzing-payloads.txt \
  -X POST \
  -mc 200,400,401,500

# Expected: 400/401 for all invalid payloads, never 500
```

---

## Secrets Management: Preview Environments

### Secure Model for Ephemeral Secrets

**Problem:** Preview environments currently use production Stripe test keys shared across all PRs.

**Solution:** Implement per-PR secret isolation.

#### Option A: Short-Lived Stripe Restricted API Keys (Recommended)

**File:** `.github/workflows/preview-deploy.yml` (enhance)

```yaml
- name: Create ephemeral Stripe restricted key
  id: stripe-key
  run: |
    # Use Stripe CLI to create restricted API key valid for 7 days
    RESTRICTED_KEY=$(stripe api keys create \
      --type restricted \
      --name "preview-${{ env.PR_NUMBER }}-$(date +%s)" \
      --expires-at "$(date -d '+7 days' +%s)" \
      --permissions "payment_intents.read,payment_intents.write" \
      | jq -r '.secret')

    echo "::add-mask::$RESTRICTED_KEY"
    echo "key=$RESTRICTED_KEY" >> $GITHUB_OUTPUT
  env:
    STRIPE_API_KEY: ${{ secrets.STRIPE_TEST_KEY }}

- name: Deploy ecom-api (preview)
  uses: cloudflare/wrangler-action@v3
  with:
    secrets: |
      STRIPE_SECRET_KEY
  env:
    STRIPE_SECRET_KEY: ${{ steps.stripe-key.outputs.key }}  # Use ephemeral key
```

#### Option B: Shared Test Key with Metadata Tagging

If restricted keys aren't feasible, add PR metadata to all Stripe objects:

```typescript
// In webhook handler, validate metadata
const paymentIntent = event.data.object as Stripe.PaymentIntent;
const allowedPR = c.env.PREVIEW_PR_NUMBER;

if (paymentIntent.metadata.pr_number !== allowedPR) {
  obs.warn('Webhook rejected: PR number mismatch', {
    expected: allowedPR,
    actual: paymentIntent.metadata.pr_number
  });
  return c.json({ error: 'Unauthorized' }, 403);
}
```

### Secrets That NEVER Go to Preview

**Production-Only Secrets (Never in Preview):**
- `STRIPE_PRODUCTION_KEY` and all production webhook secrets
- `BETTER_AUTH_SECRET_PRODUCTION`
- `SESSION_SECRET_PRODUCTION`
- Production `DATABASE_URL` (only use ephemeral branches)

**Validation Check in Workflow:**

```yaml
- name: Validate preview secrets
  run: |
    # Ensure production secrets are NOT used
    if [[ "${{ secrets.STRIPE_SECRET_KEY }}" == *"_live_"* ]]; then
      echo "❌ ERROR: Production Stripe key detected in preview deployment"
      exit 1
    fi
```

---

## Logging, Privacy & Compliance

### Sensitive Fields to Redact

**File:** `packages/observability/src/logger.ts` (enhance)

```typescript
const SENSITIVE_KEYS = [
  'password', 'secret', 'token', 'apiKey', 'api_key',
  'authorization', 'cookie', 'session', 'csrf',
  'stripe_signature', 'database_url', 'DATABASE_URL',
  'card_number', 'cvv', 'ssn', 'social_security'
];

export function redactSensitiveData(data: any): any {
  if (typeof data !== 'object' || data === null) return data;

  if (Array.isArray(data)) {
    return data.map(redactSensitiveData);
  }

  const redacted: any = {};
  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();

    if (SENSITIVE_KEYS.some(sk => keyLower.includes(sk))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      redacted[key] = redactSensitiveData(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

// Usage in ObservabilityClient
export class ObservabilityClient {
  info(message: string, metadata?: Record<string, any>) {
    const safeMetadata = metadata ? redactSensitiveData(metadata) : {};
    console.log(JSON.stringify({ level: 'info', message, ...safeMetadata }));
  }

  // ... error, warn, etc.
}
```

### Structured Log Schema

**Authentication Events:**
```json
{
  "timestamp": "2025-11-02T12:34:56.789Z",
  "level": "info",
  "service": "auth-worker",
  "event_type": "login_attempt",
  "user_id": "usr_abc123",
  "email_hash": "sha256:abc...",  // ✅ Hash, not plaintext
  "ip_address": "203.0.113.42",
  "user_agent": "Mozilla/5.0...",
  "success": true,
  "mfa_used": false,
  "login_method": "email_password"
}
```

**Payment Events:**
```json
{
  "timestamp": "2025-11-02T12:34:56.789Z",
  "level": "info",
  "service": "ecom-api",
  "event_type": "payment_succeeded",
  "stripe_event_id": "evt_abc123",
  "stripe_event_type": "payment_intent.succeeded",
  "amount_cents": 5000,
  "currency": "usd",
  "customer_id": "cus_xyz789",
  "payment_method_type": "card",
  "card_last4": "4242",  // ✅ Last 4 only
  "card_brand": "visa"
}
```

### Retention Policy

| Log Type | Retention | Storage | Compliance |
|----------|-----------|---------|------------|
| Authentication logs | 90 days | Cloudflare Logs | GDPR Art. 6(1)(f) |
| Payment events | 7 years | External SIEM | PCI-DSS 10.7 |
| Application errors | 30 days | Cloudflare Logs | N/A |
| Access logs | 30 days | Cloudflare Logs | N/A |
| Audit trail (admin actions) | 2 years | External SIEM | SOC 2 |

**Implementation:** Configure Cloudflare Logpush to external SIEM (Datadog, Splunk, etc.)

---

## Monitoring & Alerting

### Recommended Metrics & Thresholds

| Metric | Threshold | Alert Severity | Action |
|--------|-----------|----------------|--------|
| **Database error rate** | >5% over 5 min | Critical | Page on-call, check Neon status |
| **API latency (p95)** | >2000ms for 10 min | High | Investigate worker performance |
| **Failed login spike** | >20 failures/min from single IP | Medium | Auto-block IP, review for breach |
| **Stripe signature failures** | >10 failures/hour | Critical | Check webhook secrets, review logs |
| **4xx rate on preview endpoints** | >50% over 15 min | Low | Check PR deployment health |
| **5xx rate** | >1% over 5 min | Critical | Page on-call, check rollback |
| **Ephemeral branch count** | >50 active branches | Medium | Clean up stale PR branches |
| **Artifact storage** | >10GB | Low | Review retention policies |

### Cloudflare Workers Metrics (Built-In)

```bash
# View metrics via Cloudflare API
curl -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/codex-web-production/metrics" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

# Response includes:
# - requests_per_second
# - cpu_time_p50, cpu_time_p99
# - errors_per_second
```

### Integration Options

#### Option 1: Cloudflare Workers Analytics (Free)

- Built-in, no setup required
- View in Cloudflare Dashboard → Workers → Analytics
- Limited alerting capabilities

#### Option 2: Sentry (Recommended for Errors)

**File:** `packages/observability/src/sentry.ts` (new file)

```typescript
import * as Sentry from '@sentry/cloudflare';

export function initSentry(environment: string) {
  Sentry.init({
    dsn: 'https://your-dsn@sentry.io/project-id',
    environment,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      // Redact sensitive data before sending
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
      }
      return event;
    }
  });
}
```

#### Option 3: Prometheus + Alertmanager (Self-Hosted)

**File:** `.github/workflows/metrics-push.yml` (scheduled job)

```yaml
name: Push Metrics to Prometheus

on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes

jobs:
  push-metrics:
    runs-on: ubuntu-latest
    steps:
      - name: Collect Cloudflare metrics
        run: |
          # Fetch metrics from Cloudflare API
          # Push to Prometheus Pushgateway
          curl -X POST http://pushgateway.internal:9091/metrics/job/cloudflare_workers
```

### Alert Rules (Prometheus/Alertmanager)

**File:** `infrastructure/monitoring/prometheus-rules.yml` (new file)

```yaml
groups:
  - name: cloudflare_workers
    interval: 30s
    rules:
      - alert: HighErrorRate
        expr: rate(cloudflare_worker_errors_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate on {{ $labels.worker }}"
          description: "Error rate is {{ $value }} (threshold: 0.01)"

      - alert: StripeWebhookFailures
        expr: rate(stripe_webhook_signature_failures_total[1h]) > 10
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "High rate of Stripe webhook signature failures"

      - alert: DatabaseConnectionFailures
        expr: rate(neon_connection_errors_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Database connection failures detected"
```

---

## Incident Response Playbook

### 10-Step IR Procedure (Tailored to Stack)

#### 1. **Detection & Initial Triage** (0-5 minutes)
- Check alert source (Sentry, Cloudflare Dashboard, GitHub Actions failure)
- Classify incident severity:
  - **P0 (Critical):** Data breach, production down, payment processing failure
  - **P1 (High):** Partial outage, security vulnerability exploited
  - **P2 (Medium):** Preview environment compromised, non-critical service degradation
  - **P3 (Low):** Suspected but unconfirmed security issue

#### 2. **Isolate Affected Resources** (5-15 minutes)

**For compromised preview environment:**
```bash
# Immediately delete preview worker
wrangler delete --name codex-web-preview-$PR_NUMBER

# Delete Neon branch (contains potentially compromised data)
neonctl branches delete pr-$PR_NUMBER

# Delete DNS records
.github/scripts/manage-preview-dns.sh delete $PR_NUMBER $CLOUDFLARE_DNS_API_TOKEN $CLOUDFLARE_ZONE_ID

# Close PR to prevent re-deployment
gh pr close $PR_NUMBER --comment "Closed due to security incident"
```

**For compromised production worker:**
```bash
# Rollback to previous deployment (fast, non-destructive)
wrangler rollback --name codex-web-production
wrangler rollback --name auth-worker-production
wrangler rollback --name ecom-api-production

# Verify rollback
curl https://codex.revelations.studio
```

#### 3. **Revoke Compromised Secrets** (15-30 minutes)

**Database credentials:**
```bash
# Rotate Neon password
neonctl password reset --name neondb_owner

# Update secret in Cloudflare
echo $NEW_DATABASE_URL | wrangler secret put DATABASE_URL --env production

# Redeploy workers
cd apps/web && wrangler deploy --env production
```

**Stripe keys:**
```bash
# Revoke compromised key in Stripe Dashboard
# Generate new test/production key
# Update GitHub secret
gh secret set STRIPE_PRODUCTION_KEY --body "$NEW_KEY"

# Update Cloudflare Workers
echo $NEW_KEY | wrangler secret put STRIPE_SECRET_KEY --env production
```

**Session secrets:**
```bash
# Generate new secret
NEW_SECRET=$(openssl rand -base64 32)

# Update GitHub
echo $NEW_SECRET | gh secret set SESSION_SECRET_PRODUCTION

# Update Cloudflare and redeploy
echo $NEW_SECRET | wrangler secret put SESSION_SECRET --env production
cd workers/auth && wrangler deploy --env production
```

#### 4. **Assess Impact & Data Exposure** (30-60 minutes)

```bash
# Review Cloudflare Worker logs
wrangler tail codex-web-production --since 24h --format json > incident-logs.json

# Query Neon for suspicious activity
psql $DATABASE_URL -c "
  SELECT * FROM auth_logs
  WHERE created_at > NOW() - INTERVAL '24 hours'
  AND (failed_attempts > 10 OR ip_address IN ('suspicious_ips'))
  ORDER BY created_at DESC;
"

# Check GitHub Actions logs for secret leakage
gh run list --limit 50 --json conclusion,databaseId,event,headBranch
```

#### 5. **Contain Lateral Movement** (concurrent with step 4)

```bash
# Block malicious IP at Cloudflare edge
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/firewall/access_rules/rules" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d '{
    "mode": "block",
    "configuration": {"target": "ip", "value": "203.0.113.42"},
    "notes": "Incident response - malicious actor"
  }'

# Revoke active user sessions (if auth system supports it)
psql $DATABASE_URL -c "DELETE FROM sessions WHERE created_at > NOW() - INTERVAL '1 hour';"
```

#### 6. **Collect Forensic Evidence** (60-90 minutes)

```bash
# Export full logs
wrangler tail codex-web-production --since 7d --format json > forensics/web-$(date +%s).json
wrangler tail auth-worker-production --since 7d --format json > forensics/auth-$(date +%s).json

# Snapshot Neon database (point-in-time)
neonctl branches create \
  --name forensic-snapshot-$(date +%s) \
  --parent production \
  --timestamp "1 hour ago"

# Export GitHub Actions audit log
gh api /repos/$OWNER/$REPO/actions/runs --paginate > forensics/github-actions.json

# Preserve DNS records
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_DNS_API_TOKEN" > forensics/dns-$(date +%s).json
```

#### 7. **Notify Stakeholders** (60-120 minutes)

**Internal:**
- Engineering team (Slack #incidents channel)
- CTO/CISO
- Legal (if GDPR/PCI compliance affected)

**External (if required):**
- Customers (if PII exposed) - within 72 hours (GDPR Art. 33)
- Stripe (if payment data compromised)
- Data Protection Authority (if >500 users affected)

**Template:**
```
INCIDENT NOTIFICATION

Date: 2025-11-02 14:30 UTC
Severity: P1
Status: Investigating

Summary: Unauthorized access detected to preview environment (PR #123).
Impact: Potential exposure of test Stripe keys and ephemeral database containing non-production data.
Customer Impact: None (isolated to internal preview environment).

Actions Taken:
- Preview environment isolated and deleted (14:15 UTC)
- Stripe test keys rotated (14:25 UTC)
- Ephemeral database branch deleted (14:15 UTC)

Next Steps:
- Forensic analysis of logs (ETA: 16:00 UTC)
- Root cause analysis (ETA: Nov 3 10:00 UTC)
- Security controls update (ETA: Nov 5)
```

#### 8. **Rollback Database (If Necessary - NUCLEAR OPTION)**

```bash
# ⚠️ WARNING: This loses up to 30 minutes of production data
# Only use if database is corrupted or contains malicious data

# Create restore branch from known-good timestamp
neonctl branches create \
  --name emergency-restore-$(date +%s) \
  --parent production \
  --timestamp "30 minutes ago"

# Get connection string
RESTORE_URL=$(neonctl connection-string emergency-restore-* --pooled)

# Update all workers
echo $RESTORE_URL | wrangler secret put DATABASE_URL --env production

# Redeploy
cd workers/ecom-api && wrangler deploy --env production
cd ../auth && wrangler deploy --env production
cd ../../apps/web && wrangler deploy --env production

# Verify
curl https://codex.revelations.studio
```

#### 9. **Contact Third-Party Services** (as needed)

**Stripe:**
- Report potential key compromise: https://support.stripe.com/contact
- Provide: Key ID, estimated exposure window, affected environment

**Cloudflare:**
- Report abuse: abuse@cloudflare.com
- For account takeover: Open support ticket

**GitHub:**
- Report compromised secrets: https://github.com/security
- For unauthorized Actions runs: Contact GitHub Support

**Neon:**
- Support: support@neon.tech
- For database compromise or suspected abuse

#### 10. **Post-Incident Review** (within 5 business days)

**RCA Template:**
```markdown
# Incident Post-Mortem: [Title]

Date: 2025-11-02
Duration: 2 hours 15 minutes
Severity: P1

## Timeline
- 14:00 UTC: Alert triggered (high rate of 401 errors)
- 14:05 UTC: On-call engineer paged
- 14:15 UTC: Preview environment isolated
- 16:15 UTC: All systems restored

## Root Cause
Malicious PR introduced code that exfiltrated secrets via health endpoint.

## Contributing Factors
1. No code review requirement for external contributors
2. Health endpoint exposed secret existence (fixed in commit abc123)
3. Preview environments used shared Stripe test keys

## Action Items
- [ ] Require code review for all PRs (owner: @security-lead, ETA: Nov 3)
- [ ] Implement preview environment authentication (owner: @devops, ETA: Nov 10)
- [ ] Add automated secret scanning to CI (owner: @security-lead, ETA: Nov 5)
- [ ] Update runbooks with new isolation procedures (owner: @sre, ETA: Nov 4)

## Lessons Learned
- Fast isolation (15 min) prevented production impact
- Log retention (7 days) was sufficient for forensics
- Need better preview environment isolation
```

---

## PR Security Checklist

**File:** `.github/PULL_REQUEST_TEMPLATE.md` (create/update)

```markdown
## PR Security Checklist

Before merging, confirm all applicable items:

### Code Changes
- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] No sensitive data logged (use `redactSensitiveData()` from observability package)
- [ ] No `console.log()` with user data or secrets
- [ ] Input validation on all user-facing endpoints (use Zod schemas)
- [ ] SQL queries use parameterized queries (Drizzle ORM, not raw SQL)

### Infrastructure Changes
- [ ] New secrets added to GitHub Secrets (not committed to repo)
- [ ] Cloudflare Worker secrets updated via `wrangler secret put`
- [ ] DNS changes reviewed by DevOps team
- [ ] Database migrations tested on ephemeral branch (CI validates this)
- [ ] No changes to `.github/workflows/` without security review

### Worker Deployments
- [ ] Health endpoints do NOT expose secret values
- [ ] Security headers added (CSP, X-Frame-Options, HSTS)
- [ ] Rate limiting implemented on authentication endpoints
- [ ] Error messages do not leak stack traces or internal paths

### Database Schema Changes
- [ ] Migration rollback plan documented
- [ ] No PII stored in plaintext (use encryption or hashing)
- [ ] Indexes on sensitive columns (email, user_id) reviewed
- [ ] Foreign key constraints prevent orphaned records

### Dependencies
- [ ] `pnpm audit` passes with no critical/high vulnerabilities
- [ ] New dependencies reviewed for known CVEs
- [ ] Lockfile (`pnpm-lock.yaml`) updated

### Stripe Integration
- [ ] Webhook signature verification implemented
- [ ] Test keys used in preview, production keys only in production
- [ ] No Stripe secret keys in frontend code

### Preview Deployment
- [ ] Preview environment uses ephemeral Neon branch (not production)
- [ ] Preview URLs do not contain sensitive data
- [ ] No production credentials in preview workers

---

**For reviewers:** If any item is unchecked and applicable, request changes before approval.
```

---

## Acceptance Criteria & Validation

### Critical Item #1: Stripe Webhook Signature Verification

**Validation:**
```bash
# Test invalid signature
curl -X POST https://api.revelations.studio/webhook \
  -H "Content-Type: application/json" \
  -H "stripe-signature: invalid" \
  -d '{"type":"payment_intent.succeeded"}' \
  --verbose

# Expected: HTTP 401, body: {"error":"Invalid signature"}

# Test missing signature
curl -X POST https://api.revelations.studio/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"payment_intent.succeeded"}' \
  --verbose

# Expected: HTTP 400, body: {"error":"Missing signature"}
```

**Logs to inspect:**
```bash
wrangler tail ecom-api-production --format json | grep "signature"
# Should see: "Webhook signature verification failed" for invalid signatures
```

### Critical Item #2: Remove Secret Leakage

**Validation:**
```bash
# Check health endpoint (production)
curl https://api.revelations.studio/health | jq

# Expected output (NO hasDatabase, hasStripeKey, etc.):
{
  "status": "healthy",
  "worker": "ecom-api",
  "environment": "production",
  "timestamp": "2025-11-02T12:34:56.789Z"
}

# Check auth worker
curl https://auth.revelations.studio/health | jq
# Same: no secret configuration exposed
```

### Critical Item #3: Mask DATABASE_URL in Logs

**Validation:**
```bash
# Review recent workflow runs
gh run view <run-id> --log | grep -i "DATABASE_URL"

# Expected: No plaintext connection strings
# Should see: ****** or [REDACTED] instead
```

### Critical Item #4: Artifact Retention

**Validation:**
```bash
# Check workflow file
grep "retention-days" .github/workflows/testing.yml

# Expected output:
#   retention-days: 1
```

**Verify in GitHub UI:**
- Navigate to Actions → Recent workflow run → Artifacts
- Check "Expires in 1 day"

### High Item #5: Security Headers

**Validation:**
```bash
# Check CSP header
curl -I https://codex.revelations.studio | grep -i "content-security-policy"

# Expected:
# content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; ...

# Check HSTS (production only)
curl -I https://codex.revelations.studio | grep -i "strict-transport-security"

# Expected:
# strict-transport-security: max-age=31536000; includeSubDomains; preload

# Check X-Frame-Options
curl -I https://codex.revelations.studio | grep -i "x-frame-options"

# Expected:
# x-frame-options: DENY
```

### High Item #6: Rate Limiting

**Validation:**
```bash
# Test login rate limit (use jq and curl in loop)
for i in {1..6}; do
  curl -X POST https://auth.revelations.studio/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}' \
    --silent | jq -r '.error'
done

# Expected output:
# null (first 5 attempts)
# Too many requests (6th attempt)
```

### High Item #7: Dependency Scanning

**Validation:**
```bash
# Run npm audit locally
pnpm audit --production --audit-level=moderate

# Expected: No critical or high vulnerabilities
# Exit code 0

# Check Dependabot is enabled
gh api /repos/$OWNER/$REPO/vulnerability-alerts

# Expected: HTTP 204 (alerts enabled)
```

### High Item #9: SAST Scanning

**Validation:**
```bash
# Trigger security scan workflow manually
gh workflow run security-scan.yml

# Wait for completion
gh run list --workflow=security-scan.yml --limit 1

# Check CodeQL results
gh api /repos/$OWNER/$REPO/code-scanning/alerts

# Expected: No critical or high alerts
```

---

## Follow-Up Questions

To refine this security plan, the security team should answer:

1. **GDPR/PCI Compliance Scope:** Are you processing EU citizen data (GDPR) or storing cardholder data (PCI-DSS Level 1-4)? This affects logging retention, encryption requirements, and incident notification timelines. If yes, we need to add: (a) database encryption at rest (Neon supports this), (b) log anonymization for IP addresses, (c) data retention policies with automated deletion.

2. **Preview Environment Access Control:** Who should be able to access preview URLs (`codex-preview-{PR}.revelations.studio`)? Options: (a) Anyone with link (current, risky), (b) Basic auth with shared password per PR, (c) OAuth with GitHub team membership check, (d) IP allowlist (CI runners + office IPs). This determines the authentication mechanism to implement in item #8.

3. **Monitoring & SIEM Integration:** Do you have an existing SIEM (Datadog, Splunk, Sumo Logic) or prefer self-hosted (Prometheus + Grafana)? This affects the logging export configuration (Cloudflare Logpush destination) and alert routing. If using Sentry, what's the DSN and project ID? If none, should we provision a free Sentry account or start with Cloudflare's built-in analytics?

---

**Document Version:** 1.0
**Maintained By:** Security & DevOps Team
**Next Review:** 2025-12-01
