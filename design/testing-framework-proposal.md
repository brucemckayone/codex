# Testing Framework Proposal

## 1. Introduction

This document outlines a comprehensive testing framework for the Codex platform, building upon the project's architecture, technology stack, and the requirements defined in the PDRs and TDDs. The goal is to ensure code quality, reliability, and maintainability across all phases of development.

## 2. Testing Philosophy

### 2.1. The Testing Pyramid

We will adhere to the testing pyramid principle, emphasizing a large base of fast, isolated unit tests, a moderate layer of integration tests, and a small number of end-to-end (E2E) tests for critical user flows.

```
                    /\ 
                   /  \ 
                  / E2E \          (Playwright: Critical User Flows)
                 /________\ 
                /          \ 
               / Integration \     (Vitest: API Routes, Service Interactions)
              /______________\ 
             /                \ 
            /   Unit Tests     \   (Vitest: Components, Functions, Workers)
           /____________________\ 
```

### 2.2. Shift-Left Testing

Testing will be integrated early and continuously throughout the development lifecycle, from local development to CI/CD pipelines.

## 3. Test Types and Tools

### 3.1. Unit Tests

*   **Purpose**: Verify the smallest testable parts of an application (functions, methods, components) in isolation.
*   **Tool**: [Vitest](https://vitest.dev/)
    *   **SvelteKit Components**: Use `@testing-library/svelte` for component rendering and interaction testing.
    *   **Services & Utilities**: Pure TypeScript logic tested with Vitest.
    *   **Cloudflare Workers**: Use [Miniflare](https://miniflare.dev/) (via `wrangler.unstable_dev`) to simulate the Workers runtime for isolated worker logic testing.
*   **Key Characteristics**: Fast execution, high coverage, easy to pinpoint failures.

### 3.2. Integration Tests

*   **Purpose**: Verify interactions between different units or components, ensuring they work together correctly.
*   **Tool**: [Vitest](https://vitest.dev/)
    *   **API Routes**: Test SvelteKit `+server.ts` endpoints by simulating HTTP requests, interacting with a dedicated test database.
    *   **Service-to-Service Interactions**: Verify the flow of data and logic across multiple services (e.g., Content Management interacting with Media Transcoding).
    *   **Database Interactions**: Test ORM queries and transactions against a real (but isolated) database instance.
*   **Key Characteristics**: Cover integration points, slower than unit tests, require a test environment setup.

### 3.3. End-to-End (E2E) Tests

*   **Purpose**: Simulate real user scenarios across the entire application stack, from the UI to the database and external services.
*   **Tool**: [Playwright](https://playwright.dev/)
    *   **Critical User Flows**: Focus on core business processes like user registration, content upload, content purchase, and media playback.
    *   **Browser Coverage**: Test across Chromium (default), Firefox, and WebKit (Safari).
*   **Key Characteristics**: Slowest tests, highest confidence in overall system health, catch UI/integration issues.

### 3.4. Type Checking

*   **Purpose**: Ensure type safety across the TypeScript codebase.
*   **Tool**: `tsc --noEmit` (TypeScript compiler)
*   **Integration**: Run as a mandatory step in the CI/CD pipeline.

### 3.5. Linting & Formatting

*   **Purpose**: Enforce code style and identify potential code quality issues.
*   **Tools**: [ESLint](https://eslint.org/) and [Prettier](https://prettier.io/)
*   **Integration**: Run as a pre-commit hook and a mandatory step in the CI/CD pipeline.

## 4. Test Environment & Data Management

### 4.1. Dedicated Test Database

*   **Setup**: Use a separate Neon branch or a local Dockerized PostgreSQL instance (`docker-compose.test.yml`) for integration and E2E tests.
*   **Isolation**: The test database must be completely isolated from development and production environments.
*   **Resetting**: The database should be reset (e.g., `TRUNCATE` tables or drop/recreate schema) before each test suite or run to ensure a clean state.

### 4.2. Mocking External Services

*   **Principle**: External services (Stripe, RunPod, Resend, R2) should always be mocked in unit and integration tests to ensure test isolation, speed, and determinism.
*   **Tools**: `vitest.mock()` for module mocking, custom mock objects/classes.
*   **E2E Exception**: For E2E tests, use test mode credentials for real external services (e.g., Stripe test keys) where appropriate to validate actual integrations.

### 4.3. Test Data Seeding

*   **Strategy**: Use factories or seed scripts to generate realistic test data for integration and E2E tests.
*   **Tools**: Custom TypeScript/JavaScript scripts, Drizzle ORM for insertions.

## 5. CI/CD Integration

*   **Platform**: GitHub Actions (as defined in `design/infrastructure/CI-CD-Pipeline.md`).
*   **Workflow**: All tests (unit, integration, E2E, type checking, linting) will run automatically on every `push` and `pull_request` to relevant branches (`develop`, `main`).
*   **E2E Scope**: E2E tests will primarily run on `develop` (staging) and `main` (production) branches due to their longer execution time and resource requirements.

## 6. Code Coverage

*   **Tool**: Vitest's built-in code coverage (`c8` or `istanbul`).
*   **Targets**: Establish minimum code coverage targets for different parts of the codebase (e.g., 90% for core services, 80% for UI components).
*   **Reporting**: Generate HTML reports for detailed analysis and integrate coverage checks into CI/CD.

## 7. Best Practices

*   **Test Isolation**: Each test should be independent and not rely on the state of other tests.
*   **Clear Naming**: Test files and descriptions should clearly indicate what is being tested.
*   **AAA Pattern**: Arrange, Act, Assert for clear test structure.
*   **Error Testing**: Explicitly test error conditions and edge cases.
*   **Performance**: Keep unit tests fast; optimize integration and E2E tests where possible.

## 8. Project-Specific Considerations

### 8.1. Shared Packages Testing

*   **`packages/core-logic` (or similar)**: Services within this package (e.g., `PurchasesService`, `ContentAccessService`, `R2Service`, `PlatformSettingsService`) will have dedicated unit and integration tests, mocking their dependencies (database, external APIs).
*   **`packages/database`**: Unit tests for schema definitions and integration tests for Drizzle ORM queries against a test database.
*   **`packages/validation`**: Unit tests for Zod schemas to ensure correct validation rules.

### 8.2. Cloudflare Workers Testing

*   **Unit Tests**: Use Vitest with `wrangler.unstable_dev` to spin up a local Miniflare instance for each worker. This allows testing worker logic, queue consumers, and webhook handlers in an environment closely mimicking production.
*   **Integration Tests**: For worker-to-worker communication (e.g., queue producer/consumer), or worker-to-external-service interactions (e.g., Runpod API calls from `transcoding-queue-consumer`).

### 8.3. Security Testing

*   **Rate Limiting**: Integration tests to verify rate limits are correctly applied and enforced on sensitive endpoints (e.g., login, registration).
*   **Access Control**: Unit and integration tests for `requireAuth()`, `requireOwner()`, `requireCreatorAccess()` guards to ensure correct role-based access enforcement.
*   **Input Validation**: Extensive unit tests for Zod schemas and integration tests for API endpoints to prevent injection attacks and data corruption.
*   **Signed URLs**: Integration tests to verify signed URLs are correctly generated, expire, and prevent unauthorized access.

### 8.4. Performance Testing

*   **Basic Load Testing**: Use tools like `k6` (open-source) in staging environments to simulate user load and identify performance bottlenecks before production deployment. This can be integrated into the CI/CD pipeline for key API endpoints.

---

**Note**: This document serves as a proposal for the testing framework. Specific implementation details and test examples will be further elaborated within each feature's TDD.
