# E2E Testing Implementation Plan

## Overview
Set up end-to-end testing for Codex backend workers to validate critical user flows across all 4 APIs.

## Goals
- Test critical user flows across auth, content, identity, and ecom workers
- Reuse existing @codex/test-utils infrastructure
- Run against local dev servers (ports: 42069, 4001, 42071, 42072)
- Ensure tests are isolated, idempotent, and maintainable

---

## Directory Structure

```
/e2e/
├── playwright.config.ts           # Playwright configuration for API testing
├── setup/
│   ├── global-setup.ts           # Verify all workers healthy before tests
│   ├── global-teardown.ts        # Cleanup after all tests
│   └── test-context.ts           # Shared test context/state management
├── fixtures/
│   ├── api-client.ts             # HTTP client fixtures for each worker
│   ├── auth-fixture.ts           # Auth helpers (register, login, session)
│   ├── test-data-fixture.ts      # Service factory integration for test data
│   └── index.ts                  # Export all fixtures
├── helpers/
│   ├── worker-urls.ts            # Worker base URLs configuration
│   ├── assertions.ts             # Custom assertions for API responses
│   ├── wait-for.ts               # Polling helpers for async operations
│   └── cleanup.ts                # Database cleanup helpers
├── tests/
│   ├── 01-auth-flow.spec.ts      # Register → Login → Session
│   ├── 02-content-creation.spec.ts   # Create → Upload → Publish
│   ├── 03-free-content-access.spec.ts # Login → Streaming URL → Access
│   ├── 04-paid-content-purchase.spec.ts # Checkout → Webhook → Access
│   └── 05-organization-flow.spec.ts   # Org → Content → Isolation
├── package.json                   # E2E-specific dependencies (if needed)
└── README.md                      # How to run e2e tests
```

---

## Implementation Steps

### Phase 1: Configuration & Setup (Foundation)

**Step 1.1: Playwright Configuration**
- Create `playwright.config.ts` with API testing defaults
- Single worker (sequential execution to avoid race conditions)
- Configure timeouts (60s for API tests)
- Set up reporters (list for local, html+json for CI)
- Point to global setup/teardown

**Step 1.2: Global Setup**
- Create `setup/global-setup.ts`
- Health check all 4 workers before running tests
- Fail fast with clear error if any worker unreachable
- Log status of each worker

**Step 1.3: Worker URLs Configuration**
- Create `helpers/worker-urls.ts`
- Export constants for each worker base URL
- Allow override via environment variables for CI

**Files to create:**
- `e2e/playwright.config.ts`
- `e2e/setup/global-setup.ts`
- `e2e/setup/global-teardown.ts`
- `e2e/helpers/worker-urls.ts`

---

### Phase 2: Fixtures & Helpers (Test Infrastructure)

**Step 2.1: API Client Fixtures**
- Create `fixtures/api-client.ts`
- Extend Playwright's `request` fixture
- Add helpers for each worker:
  - `authClient` - Points to localhost:42069
  - `contentClient` - Points to localhost:4001
  - `identityClient` - Points to localhost:42071
  - `ecomClient` - Points to localhost:42072
- Auto-inject cookies from auth state

**Step 2.2: Auth Fixture**
- Create `fixtures/auth-fixture.ts`
- `registerUser()` - POST /api/auth/email/register
- `loginUser()` - POST /api/auth/email/login, return session cookie
- `getSession()` - GET /api/auth/session with cookie
- `logout()` - POST /api/auth/signout
- Store session state in fixture for reuse

**Step 2.3: Test Data Fixture**
- Create `fixtures/test-data-fixture.ts`
- Import @codex/test-utils factories
- Instantiate services with test database
- `seedContent()` - Creates org + media + content via ContentService
- `seedOrganization()` - Creates org via OrganizationService
- `cleanupTestData()` - Database cleanup between tests
- Use ephemeral Neon branch via withNeonTestBranch()

**Step 2.4: Helper Utilities**
- Create `helpers/assertions.ts`:
  - `expectSuccessResponse()` - Validates 2xx with data shape
  - `expectErrorResponse()` - Validates error shape
  - `expectAuthRequired()` - Validates 401
- Create `helpers/wait-for.ts`:
  - `waitForWebhook()` - Poll database for webhook result
  - `waitForTranscoding()` - Poll media status
- Create `helpers/cleanup.ts`:
  - `cleanupDatabase()` - Use @codex/test-utils cleanup

**Files to create:**
- `e2e/fixtures/api-client.ts`
- `e2e/fixtures/auth-fixture.ts`
- `e2e/fixtures/test-data-fixture.ts`
- `e2e/fixtures/index.ts`
- `e2e/helpers/assertions.ts`
- `e2e/helpers/wait-for.ts`
- `e2e/helpers/cleanup.ts`

---

### Phase 3: Test Specs (Critical User Flows)

**Step 3.1: Auth Flow Test**
- Create `tests/01-auth-flow.spec.ts`
- Test register new user
- Test login with credentials
- Test session validation
- Test logout
- Test invalid credentials rejection

**Step 3.2: Content Creation Test**
- Create `tests/02-content-creation.spec.ts`
- Test create draft content
- Test create media item
- Test publish content (draft → published)
- Test cannot publish without media ready
- Test get content by ID

**Step 3.3: Free Content Access Test**
- Create `tests/03-free-content-access.spec.ts`
- Seed published free content
- Login as viewer
- Request streaming URL
- Verify presigned R2 URL returned
- Verify URL format valid

**Step 3.4: Paid Content Purchase Test**
- Create `tests/04-paid-content-purchase.spec.ts`
- Seed published paid content (priceCents > 0)
- Create checkout session
- Simulate Stripe webhook (checkout.session.completed)
- Verify purchase recorded
- Verify access granted
- Request streaming URL successfully

**Step 3.5: Organization Flow Test**
- Create `tests/05-organization-flow.spec.ts`
- Create organization
- Create org-scoped content
- Verify creator can access
- Verify other user cannot access
- Test slug uniqueness

**Files to create:**
- `e2e/tests/01-auth-flow.spec.ts`
- `e2e/tests/02-content-creation.spec.ts`
- `e2e/tests/03-free-content-access.spec.ts`
- `e2e/tests/04-paid-content-purchase.spec.ts`
- `e2e/tests/05-organization-flow.spec.ts`

---

### Phase 4: Integration & Documentation

**Step 4.1: Package Scripts**
- Add to root `package.json`:
  - `test:e2e:api` - Run e2e tests
  - `test:e2e:api:ui` - Run with Playwright UI
  - `test:e2e:api:headed` - Run with browser visible
  - `test:e2e:api:debug` - Run in debug mode

**Step 4.2: README Documentation**
- Create `e2e/README.md`
- Prerequisites (all workers must be running)
- How to run tests locally
- How to run single test file
- How to debug failures
- CI integration notes

**Step 4.3: CI Integration** (if needed)
- Add e2e job to GitHub Actions
- Start all 4 workers before tests
- Use ephemeral Neon branch (CI mode)
- Upload test reports as artifacts

**Files to create:**
- `e2e/README.md`
- Update root `package.json` scripts

---

## Implementation Order (Step-by-Step)

1. ✅ Create `/e2e` directory structure
2. ✅ Create `playwright.config.ts` and global setup
3. ✅ Create `helpers/worker-urls.ts` and `helpers/assertions.ts`
4. ✅ Create `fixtures/api-client.ts` (base HTTP client)
5. ✅ Create `fixtures/auth-fixture.ts` (auth helpers)
6. ✅ Create `fixtures/test-data-fixture.ts` (service factories integration)
7. ✅ Create `helpers/wait-for.ts` and `helpers/cleanup.ts`
8. ✅ Create first test: `tests/01-auth-flow.spec.ts`
9. ✅ Run first test to validate setup
10. ✅ Create remaining test specs (02-05)
11. ✅ Add package.json scripts
12. ✅ Create README.md with documentation
13. ✅ Test all flows end-to-end
14. ✅ Add CI integration (optional)

---

## Definition of Done

### Core Requirements
- [ ] All 5 critical user flows have passing tests
- [ ] Tests run against local dev servers (4 workers)
- [ ] Tests use @codex/test-utils service factories for data seeding
- [ ] Tests are isolated (ephemeral Neon branches or cleanup)
- [ ] Tests are idempotent (can run multiple times)
- [ ] Clear error messages when workers not running
- [ ] Documentation in README.md

### Test Coverage
- [ ] Auth flow: register, login, session, logout
- [ ] Content creation: draft, media, publish
- [ ] Free content: access granted to public content
- [ ] Paid content: checkout, webhook, purchase, access
- [ ] Organization: create, scoped content, isolation

### Quality Checks
- [ ] All tests pass on clean database
- [ ] Tests can run sequentially without failures
- [ ] No flaky tests (run 3x to verify)
- [ ] Test failures have clear error messages
- [ ] Can run single test file in isolation

### Developer Experience
- [ ] Simple command: `pnpm test:e2e:api`
- [ ] README explains how to run/debug
- [ ] Fixtures are reusable across tests
- [ ] Test code is readable and maintainable

---

## Potential Issues & Considerations

### Issue 1: Workers Not Running
**Problem**: Tests fail if any worker not started
**Solution**: Global setup health checks all workers, fails fast with clear message

### Issue 2: Database State Conflicts
**Problem**: Tests interfere with each other via shared database
**Solution**: Use ephemeral Neon branches (CI) or cleanup helpers (local)

### Issue 3: Async Webhooks
**Problem**: Stripe webhook processing is async, test may check before completion
**Solution**: `waitForWebhook()` helper polls database until purchase recorded

### Issue 4: Session Cookie Management
**Problem**: Playwright needs to send cookies across multiple requests
**Solution**: Auth fixture stores session, API client auto-injects cookies

### Issue 5: Test Data Cleanup
**Problem**: Failed tests may leave orphaned data
**Solution**: `afterEach()` hooks with cleanup, or rely on ephemeral branch disposal

### Issue 6: Stripe Webhook Signature
**Problem**: Real Stripe webhooks require valid signature
**Solution**: Test mode allows manual webhook event creation or mock signature verification

### Issue 7: R2 Presigned URLs
**Problem**: Cannot verify actual R2 access without credentials
**Solution**: Test only validates URL format and presence, not actual streaming

### Issue 8: Port Conflicts
**Problem**: Dev servers may not be on expected ports
**Solution**: Make ports configurable via environment variables

---

## Dependencies

### Required Packages (Already Installed)
- `@playwright/test` - Test framework
- `@codex/test-utils` - Service factories and database helpers
- `@codex/database` - Database client
- `@codex/validation` - Zod schemas
- `neon-testing` - Ephemeral branch support

### Optional Additions
- None required - all dependencies already in monorepo

---

## Success Metrics

- **5 test specs** covering critical flows
- **~15-20 individual tests** across all specs
- **< 2 minutes** total execution time (sequential)
- **100% pass rate** on clean environment
- **Clear failures** with actionable error messages

---

## Next Steps After Implementation

1. Add more edge case tests (error paths, validation)
2. Add performance tests (response time assertions)
3. Add load tests (concurrent requests)
4. Expand to non-critical flows (profile, settings)
5. Add visual regression testing (if UI involved)

---

## Questions/Decisions Needed

1. ❓ Should webhook tests use real Stripe test mode or mock signature?
2. ❓ Should tests verify actual R2 streaming or just URL generation?
3. ❓ Should we add smoke tests that run before deployment?
4. ❓ How to handle test user cleanup in shared dev database?

---

**Plan Created**: 2025-11-30
**Author**: Claude Code
**Status**: Ready for Implementation
