# Refactoring Report: Centralizing Test Mocks and Utilities

## Executive Summary
A comprehensive analysis of the Codex codebase reveals significant duplication in test setup code, particularly regarding database mocking (`@codex/database`), Hono context creation, and event payload generation. Currently, individual test suites (especially in `workers/*`) implement ad-hoc, brittle mocks that drift in consistency.

**Recommendation**: Centralize these patterns into `@codex/test-utils`. This will standardize how services interact with the database in tests, reduce boilerplate, and improve type safety across the platform.

---

## 1. Current State Analysis

### A. Fragmented Database Mocking
Tests currently mock the database layer manually in every file. This leads to inconsistent API surfaces and makes refactoring the actual database layer difficult.

*   **Pattern 1: Simple Object Mocking**
    *   **Location**: `workers/organization-api/src/__tests__/settings.test.ts`
    *   **Code**: `vi.mock('@codex/database', () => ({ dbHttp: {} }));`
    *   **Issue**: It provides no type safety and requires manual mocking of every used method (e.g., `db.query...`) inside the test body.

*   **Pattern 2: Factory Function Mocking**
    *   **Location**: `workers/ecom-api/src/handlers/__tests__/checkout.test.ts`
    *   **Code**: Mocks `createPerRequestDbClient` to return a plain object `{ db: mockDb, cleanup: vi.fn() }`.
    *   **Issue**: Re-implements the "transaction-capable" client contract in every test file.

### B. Duplicated Hono Context
Worker tests require a mock Hono `Context` to simulate headers, environment variables, and dependency injection.

*   **Observation**: `createMockContext` functions are defined locally in test files (e.g., `workers/ecom-api`).
*   **Duplication**: Logic for mocking `c.env`, `c.get('obs')` (observability), and logging spies is repeated. This boilerplate distracts from the actual test logic.

### C. Isolated Data Factories
Domain-specific test data generators are trapped inside specific worker tests instead of being shared.

*   **Observation**: `createMockCheckoutEvent` exists inside `workers/ecom-api`.
*   **Impact**: Other services that might need to test webhook handling or payment flows (e.g., a future reporting worker) cannot reuse this logic.

---

## 2. Proposed Architecture

We should expand `packages/test-utils` to include a new **Mocks Module** and enhance the existing **Factories Module**.

### New Module: `packages/test-utils/src/mocks.ts`

This module will provide standardized, type-safe mocks for core infrastructure.

**1. `createMockDatabase()`**
A helper that returns a fully mocked Drizzle-like client. It should allow chaining (e.g., `db.query.users.findFirst.mockResolvedValue(...)`) without manual setup.

**2. `createMockHonoContext<Env>(envOverrides?)`**
A factory that generates a Hono `Context` object with:
*   Pre-configured `env` (bindings).
*   Pre-configured Observability client (`c.get('obs')`).
*   Spy-attached logging methods for assertions.

### Enhanced Module: `packages/test-utils/src/factories.ts`

**1. `createMockStripeEvent(type, payload)`**
Generalize the `createMockCheckoutEvent` from `ecom-api` to support various Stripe event types, making it reusable for any payment-related tests.

---

## 3. Implementation Plan

### Step 1: Create Shared Mock Utilities
1.  Create `packages/test-utils/src/mocks.ts`.
2.  Implement `createMockDatabase`.
3.  Implement `createMockHonoContext`.
4.  Export these from `packages/test-utils/src/index.ts`.

### Step 2: Centralize Factories
1.  Move `createMockCheckoutEvent` logic from `workers/ecom-api` to `packages/test-utils/src/factories.ts`.
2.  Refactor it to be generic (e.g., accept event type and data overrides).

### Step 3: Refactor Consumer Tests
1.  **Refactor `workers/ecom-api`**:
    *   Replace local `createMockContext` with the imported utility.
    *   Replace local `createMockCheckoutEvent` with the imported factory.
    *   Update database mocks to use the shared pattern.
2.  **Refactor `workers/organization-api`**:
    *   Replace manual `vi.mock` for database with standard utilities where applicable.

---

## 4. Benefits
*   **Maintainability**: Changing the database client signature only requires updating the mock utility in one place, not 50+ test files.
*   **Developer Experience**: Developers stop writing boilerplate context setup code and focus on business logic.
*   **Consistency**: All tests run against the same "virtual" infrastructure behavior.
