# Security Quick Reference Card

**Print this page and keep it visible during code reviews and deployments.**

---

## 🚨 Critical Security Rules

### 1. NEVER Commit Secrets
```bash
❌ BAD:
const stripeKey = "sk_live_abc123...";
DATABASE_URL=postgresql://user:pass@host/db

✅ GOOD:
const stripeKey = process.env.STRIPE_SECRET_KEY;
DATABASE_URL=${{ secrets.NEON_PRODUCTION_URL }}
```

**Check before commit:**
```bash
git diff | grep -i "api_key\|secret\|password\|token" && echo "⚠️  SECRETS DETECTED"
```

---

### 2. ALWAYS Verify Stripe Webhooks
```typescript
❌ BAD:
app.post('/webhook', async (c) => {
  const body = await c.req.json();
  // Process payment without verification
});

✅ GOOD:
app.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  const rawBody = await c.req.text();
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  // Now process verified event
});
```

---

### 3. NEVER Log Secrets or PII
```typescript
❌ BAD:
console.log('User logged in', { email: user.email, password: password });
console.log('DB connected', { url: DATABASE_URL });
obs.info('Stripe key loaded', { key: STRIPE_SECRET_KEY });

✅ GOOD:
console.log('User logged in', { userId: user.id });
console.log('DB connected', { status: 'ok' });
obs.info('Stripe key loaded', { configured: !!STRIPE_SECRET_KEY });
```

---

### 4. ALWAYS Add Security Headers
```typescript
// Required on ALL workers and SvelteKit app:
response.headers.set('X-Frame-Options', 'DENY');
response.headers.set('X-Content-Type-Options', 'nosniff');
response.headers.set('Content-Security-Policy', "default-src 'self'; ...");

// Production only:
if (env === 'production') {
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
```

---

### 5. ALWAYS Rate Limit Auth Endpoints
```typescript
❌ BAD:
app.post('/login', async (c) => {
  // Process login (vulnerable to brute force)
});

✅ GOOD:
const rateLimiter = createRateLimiter({ windowMs: 900000, maxRequests: 5 });
app.post('/login', rateLimiter, async (c) => {
  // Process login (protected)
});
```

---

### 6. ALWAYS Mask Secrets in CI/CD
```yaml
❌ BAD:
- name: Run migrations
  run: pnpm db:migrate
  env:
    DATABASE_URL: ${{ secrets.NEON_PRODUCTION_URL }}

✅ GOOD:
- name: Run migrations
  run: |
    echo "::add-mask::$DATABASE_URL"
    pnpm db:migrate
  env:
    DATABASE_URL: ${{ secrets.NEON_PRODUCTION_URL }}
```

---

## 🔍 Pre-Deployment Checklist

**Before merging to main:**

- [ ] No hardcoded secrets in code (`git grep -i "sk_live\|password\|secret_key"`)
- [ ] Stripe webhook has signature verification
- [ ] Health endpoints don't leak secret values
- [ ] Security headers added to new workers/routes
- [ ] Rate limiting on authentication endpoints
- [ ] No `console.log()` with PII or secrets
- [ ] Database queries use Drizzle (not raw SQL)
- [ ] `pnpm audit` passes with no critical/high vulnerabilities

---

## 🎯 Code Review Focus Areas

**When reviewing PRs, look for:**

1. **Secrets Management**
   - Check for `.env` files committed
   - Verify secrets use `process.env` or `c.env`
   - Ensure GitHub Actions use `${{ secrets.* }}`

2. **Input Validation**
   - All user input validated with Zod schemas
   - Database queries use parameterized queries (Drizzle)
   - No `eval()`, `Function()`, or `dangerouslySetInnerHTML`

3. **Authentication & Authorization**
   - Session tokens are httpOnly and secure
   - CSRF protection on state-changing endpoints
   - Rate limiting on sensitive endpoints

4. **API Security**
   - Stripe webhooks verify signatures
   - CORS allows only known origins
   - API responses don't leak internal errors

5. **Logging & Privacy**
   - No PII in logs (email, name, address)
   - Errors don't include stack traces in production
   - Sensitive fields redacted (`[REDACTED]`)

---

## 🚑 Incident Response (Quick Version)

**If you discover a security issue:**

1. **DO NOT** commit fixes to public branches
2. **IMMEDIATELY** notify security team: `@security-team` in Slack
3. If production is affected: Page on-call engineer
4. For secret leaks:
   ```bash
   # Rotate immediately
   wrangler secret put SECRET_NAME --env production
   # Then redeploy
   cd apps/web && wrangler deploy --env production
   ```

**If a PR looks suspicious:**
- Close the PR immediately
- Delete preview environment:
  ```bash
  wrangler delete --name codex-web-preview-$PR_NUMBER
  neonctl branches delete pr-$PR_NUMBER
  ```
- Report to security team

---

## 📞 Contacts

| Issue Type | Contact | Method |
|-----------|---------|--------|
| **Critical (production down)** | On-call engineer | PagerDuty |
| **Security incident** | Security team | `@security-team` in Slack #incidents |
| **Secret leak** | DevOps lead | Slack DM + rotate immediately |
| **Compliance (GDPR/PCI)** | Legal team | Email legal@company.com |

---

## 🔗 Full Documentation

- **Complete Security Plan:** [design/infrastructure/SECURITY.md](../design/infrastructure/SECURITY.md)
- **Implementation Checklist:** [.github/SECURITY_IMPLEMENTATION_CHECKLIST.md](SECURITY_IMPLEMENTATION_CHECKLIST.md)
- **PR Security Checklist:** [.github/PULL_REQUEST_TEMPLATE.md](PULL_REQUEST_TEMPLATE.md)
- **CI/CD Guide:** [design/infrastructure/CICD.md](../design/infrastructure/CICD.md)

---

**Last Updated:** 2025-11-02
**Version:** 1.0
**Print Date:** _______________
