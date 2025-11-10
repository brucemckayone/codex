# Documentation Context Map

**Version**: 1.0
**Last Updated**: 2025-11-05

---

## Purpose

This document helps you find the right documentation quickly. Use this as your first stop when looking for information about the Codex platform.

---

## Quick Navigation

### I need to understand...

**...the overall architecture**
→ [Multi-Tenant Architecture](../core/MULTI_TENANT_ARCHITECTURE.md)
→ [Access Control Patterns](../core/ACCESS_CONTROL_PATTERNS.md)
→ [Database Schema Design](../infrastructure/DATABASE_SCHEMA_DESIGN.md)

**...how to work with the database**
→ `packages/database/src/` (see actual implementation)
→ [Database Integration Tests](../infrastructure/Database-Integration-Tests.md)
→ Schema files: `packages/database/src/schema/*.ts`

**...how authentication works**
→ `workers/auth/src/index.ts` (BetterAuth implementation)
→ [Auth TDD](../features/auth/ttd-dphase-1.md)
→ Auth schema: `packages/database/src/schema/auth.ts`

**...how to handle Stripe webhooks**
→ `workers/stripe-webhook-handler/src/index.ts` (existing implementation)
→ Webhook schemas: `workers/stripe-webhook-handler/src/schemas/*.ts`
→ Signature verification: `workers/stripe-webhook-handler/src/middleware/verify-signature.ts`

**...how to write secure code**
→ `packages/security/src/` (security middleware)
→ [Security Guide](../infrastructure/SECURITY.md)
→ [STANDARDS.md](./STANDARDS.md#2-security-standards)

**...how logging and observability work**
→ `packages/observability/src/` (observability package)
→ [STANDARDS.md](./STANDARDS.md#7-logging--observability)

**...how R2 storage works**
→ `packages/cloudflare-clients/src/r2/` (R2 client)
→ [R2 Storage Patterns](../core/R2_STORAGE_PATTERNS.md)
→ [R2 Bucket Structure](../infrastructure/R2BucketStructure.md)

**...how KV storage works**
→ `packages/cloudflare-clients/src/kv/` (KV client)
→ [KV Namespaces](../infrastructure/KV-Namespaces.md)

**...how testing works**
→ [Testing Strategy](../infrastructure/Testing.md)
→ [STANDARDS.md](./STANDARDS.md#1-testing-standards)
→ `packages/test-utils/src/` (test utilities)

**...how CI/CD works**
→ [CI/CD Guide](../infrastructure/CICD.md)
→ `.github/workflows/` (actual workflows)
→ [Environment Management](../infrastructure/EnvironmentManagement.md)

**...how to structure code**
→ [Code Structure](../infrastructure/CodeStructure.md)
→ [STANDARDS.md](./STANDARDS.md#3-code-organization)

**...validation patterns**
→ `packages/validation/src/` (Zod schemas)
→ [STANDARDS.md](./STANDARDS.md#22-input-validation)

---

## Documentation Index by Category

### Architecture & Design

| Document | Location | Purpose |
|----------|----------|---------|
| Multi-Tenant Architecture | `design/core/MULTI_TENANT_ARCHITECTURE.md` | Organization scoping, query patterns |
| Access Control Patterns | `design/core/ACCESS_CONTROL_PATTERNS.md` | Guards, RLS, authorization |
| R2 Storage Patterns | `design/core/R2_STORAGE_PATTERNS.md` | File storage, signed URLs |
| Database Schema | `design/infrastructure/DATABASE_SCHEMA_DESIGN.md` | Complete schema v2.0 |

### Implementation Guides

| Document | Location | Purpose |
|----------|----------|---------|
| Phase 1 Roadmap README | `design/roadmap/README.md` | Overview and navigation |
| Coding Standards | `design/roadmap/STANDARDS.md` | Code patterns and best practices |
| Context Map (this doc) | `design/roadmap/CONTEXT_MAP.md` | Find documentation quickly |

### Infrastructure

| Document | Location | Purpose |
|----------|----------|---------|
| CI/CD Guide | `design/infrastructure/CICD.md` | Build and deployment |
| Testing Strategy | `design/infrastructure/Testing.md` | Test approach and tools |
| Security Guide | `design/infrastructure/SECURITY.md` | Security standards |
| Code Structure | `design/infrastructure/CodeStructure.md` | Project organization |
| Environment Management | `design/infrastructure/EnvironmentManagement.md` | Env vars and config |
| Database Integration Tests | `design/infrastructure/Database-Integration-Tests.md` | DB testing approach |
| R2 Bucket Structure | `design/infrastructure/R2BucketStructure.md` | R2 organization |
| KV Namespaces | `design/infrastructure/KV-Namespaces.md` | KV usage patterns |

### Feature Specifications

| Document | Location | Purpose |
|----------|----------|---------|
| MVP Definition | `design/MVP-Definition.md` | Phase 1 scope |
| Phase Definitions | `design/reference/PHASE_DEFINITIONS.md` | Multi-phase plan |
| Cross-Feature Dependencies | `design/cross-feature-dependencies.md` | How features connect |

### Technical Design Documents (TDD)

| Feature | Location | Status |
|---------|----------|--------|
| Auth | `design/features/auth/ttd-dphase-1.md` | ✅ Partially implemented |
| Content Management | `design/features/content-management/ttd-dphase-1.md` | 🚧 To be implemented |
| E-Commerce | `design/features/e-commerce/ttd-dphase-1.md` | 🚧 To be implemented |
| Content Access | `design/features/content-access/ttd-dphase-1.md` | 🚧 To be implemented |
| Notifications | `design/features/notifications/ttd-dphase-1.md` | 🚧 To be implemented |
| Admin Dashboard | `design/features/admin-dashboard/ttd-dphase-1.md` | 🚧 To be implemented |

---

## Actual Code Locations

### Implemented Code (Read these for examples!)

```
workers/
├── auth/                              # BetterAuth worker (✅ Implemented)
│   └── src/index.ts                   # Main entry, middleware, session caching
└── stripe-webhook-handler/            # Stripe webhook worker (✅ Implemented)
    ├── src/index.ts                   # Main entry, endpoints, security
    ├── src/middleware/verify-signature.ts
    └── src/schemas/*.ts               # Event schemas for each webhook type

packages/
├── database/                          # Drizzle ORM + Neon (✅ Implemented)
│   ├── src/client.ts                  # DB client setup
│   ├── src/schema/auth.ts             # Auth tables (users, accounts, sessions)
│   └── src/schema/test.ts             # Test tables
├── cloudflare-clients/                # R2 & KV clients (✅ Implemented)
│   ├── src/r2/client.ts               # R2 operations
│   └── src/kv/client.ts               # KV operations
├── security/                          # Security middleware (✅ Implemented)
│   ├── src/headers.ts                 # Security headers
│   ├── src/rate-limit.ts              # Rate limiting
│   └── src/worker-auth.ts             # Auth guards
├── observability/                     # Logging & metrics (✅ Implemented)
│   ├── src/index.ts                   # ObservabilityClient
│   └── src/redact.ts                  # PII redaction
├── validation/                        # Zod schemas (✅ Implemented)
│   └── src/user-schema.ts             # Example validation
└── test-utils/                        # Test helpers (✅ Implemented)
    ├── src/factories.ts               # Test data factories
    ├── src/database.ts                # DB test helpers
    └── src/miniflare-helpers.ts       # Worker test helpers
```

---

## When Something Doesn't Work

### Step 1: Check This Context Map

Use the tables above to find the right documentation for your issue.

### Step 2: Use Context-7 Map

If documentation seems outdated or you need the latest architecture:

**Context-7 Map Command** (in your LLM tool):
```
Use Context-7 map to understand [specific component/pattern]
```

**What it does**: Provides up-to-date architectural context by analyzing the codebase.

**When to use**:
- Documentation references don't match code
- Need to understand recent changes
- Exploring unfamiliar parts of codebase

### Step 3: Search the Codebase

If Context-7 doesn't resolve the issue, search for similar patterns:

**Search Strategies**:
```bash
# Find similar implementations
grep -r "pattern I need" packages/

# Find usage examples
grep -r "function or class name" .

# Find tests for reference
find . -name "*.test.ts" | xargs grep "test scenario"
```

**Good Search Terms**:
- Function/class names
- Error messages you're seeing
- Patterns you need (e.g., "rate limit", "validate", "transaction")

### Step 4: Check CI/CD Logs

If tests are failing:

1. Check GitHub Actions tab
2. Look at workflow run logs
3. Review Neon branch creation (if DB related)
4. Check test output artifacts

**CI/CD Workflow Files**:
- `.github/workflows/testing.yml` - Tests with Neon ephemeral branches
- `.github/workflows/deploy-production.yml` - Production deployment
- `.github/workflows/preview-deploy.yml` - Preview deployments
- `.github/workflows/static_analysis.yml` - Linting, typecheck, format

---

## Common Scenarios

### Scenario: Implementing a New API Endpoint

**Documents to Read**:
1. [STANDARDS.md](./STANDARDS.md#5-api-design) - API design patterns
2. [Security Guide](../infrastructure/SECURITY.md) - Required security middleware
3. [Testing Strategy](../infrastructure/Testing.md) - How to test endpoints

**Code Examples**:
- Existing endpoint: `workers/stripe-webhook-handler/src/index.ts`
- Security middleware: `packages/security/src/`
- Tests: `workers/stripe-webhook-handler/src/index.test.ts`

### Scenario: Working with Database

**Documents to Read**:
1. [Database Schema Design](../infrastructure/DATABASE_SCHEMA_DESIGN.md) - Table structure
2. [STANDARDS.md](./STANDARDS.md#4-database-patterns) - Query patterns
3. [Database Integration Tests](../infrastructure/Database-Integration-Tests.md) - Testing DB code

**Code Examples**:
- DB client: `packages/database/src/client.ts`
- Schema: `packages/database/src/schema/`
- Tests: `packages/database/src/client.test.ts`

### Scenario: Adding Validation

**Documents to Read**:
1. [STANDARDS.md](./STANDARDS.md#22-input-validation) - Validation patterns
2. [STANDARDS.md](./STANDARDS.md#12-separation-of-concerns-in-tests) - Testable validation

**Code Examples**:
- Validation: `packages/validation/src/user-schema.ts`
- Tests: `packages/validation/src/user-schema.test.ts`

### Scenario: Implementing Stripe Integration

**Documents to Read**:
1. [E-Commerce TDD](../features/e-commerce/ttd-dphase-1.md) - Stripe patterns
2. [Security Guide](../infrastructure/SECURITY.md) - Webhook signature verification

**Code Examples**:
- Webhook handler: `workers/stripe-webhook-handler/src/index.ts`
- Signature verification: `workers/stripe-webhook-handler/src/middleware/verify-signature.ts`
- Event schemas: `workers/stripe-webhook-handler/src/schemas/`

### Scenario: Writing Tests

**Documents to Read**:
1. [Testing Strategy](../infrastructure/Testing.md) - Overall test approach
2. [STANDARDS.md](./STANDARDS.md#1-testing-standards) - Test patterns
3. [Database Integration Tests](../infrastructure/Database-Integration-Tests.md) - DB testing

**Code Examples**:
- Unit tests: `packages/validation/src/user-schema.test.ts`
- Integration tests: `packages/database/src/client.test.ts`
- Worker tests: `workers/auth/src/index.test.ts`

---

## Documentation Freshness

**Last Verified**: 2025-11-05

**How to verify documentation is current**:
1. Check "Last Updated" date in document
2. Compare with actual code in referenced locations
3. If discrepancy, use Context-7 map or search codebase
4. Trust the code over documentation when in doubt

**Report Outdated Documentation**:
If you find documentation that doesn't match the code, note it in your PR or create an issue.

---

## Quick Reference Card

| Need | First Check | Then Check | Code Example |
|------|-------------|------------|--------------|
| API endpoint | STANDARDS.md § 5 | Security Guide | `workers/stripe-webhook-handler/src/index.ts` |
| Database query | STANDARDS.md § 4 | DB Schema Design | `packages/database/src/client.ts` |
| Validation | STANDARDS.md § 2.2 | Validation package | `packages/validation/src/user-schema.ts` |
| Testing | Testing Strategy | STANDARDS.md § 1 | `*.test.ts` files |
| Security | Security Guide | STANDARDS.md § 2 | `packages/security/src/` |
| Logging | STANDARDS.md § 7 | Observability package | `packages/observability/src/` |
| CI/CD issue | CI/CD Guide | Workflow files | `.github/workflows/*.yml` |

---

**Remember**: When in doubt, check the actual code first. The code is the source of truth.

---

**Last Updated**: 2025-11-05
