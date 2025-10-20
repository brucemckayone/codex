# Testing Strategy

Testing framework selection and strategy for Codex monorepo.

![Testing Strategy Diagram](assets/testing-strategy.png)

---

## Testing Pyramid

```
                    /\
                   /  \
                  / E2E \          Playwright (slow, high confidence)
                 /________\
                /          \
               / Integration \     Vitest (medium, API/DB)
              /______________\
             /                \
            /   Unit Tests     \   Vitest (fast, isolated)
           /____________________\
```

**Philosophy:**
- Many fast unit tests (business logic, utilities)
- Moderate integration tests (API routes, database)
- Few E2E tests (critical user flows only)

---

## Framework Selection

| Component | Framework | Purpose |
|-----------|-----------|---------|
| **SvelteKit (unit)** | Vitest + Testing Library | Fast, Vite-native, component testing |
| **Workers (unit)** | Vitest + Miniflare | Simulate Cloudflare runtime |
| **API Routes (integration)** | Vitest | Test HTTP with real DB |
| **E2E** | Playwright | Browser automation, critical flows |
| **Type checking** | tsc --noEmit | Compile-time safety |

---

## SvelteKit Testing

### Unit Tests

**What to test:**
- Component rendering and interactions
- Utility functions (pure logic)
- Server utilities (mocked external APIs)
- Form validation
- Business logic (price calculations, etc)

**What NOT to test:**
- Svelte framework internals
- Third-party libraries
- CSS/styling

**Example:**
```typescript
// Component test
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import VideoPlayer from './VideoPlayer.svelte';

describe('VideoPlayer', () => {
  it('renders with correct playback ID', () => {
    render(VideoPlayer, { props: { playbackId: 'test-123' } });
    const player = screen.getByRole('application');
    expect(player).toHaveAttribute('playback-id', 'test-123');
  });
});
```

```typescript
// Utility test
import { describe, it, expect } from 'vitest';
import { formatPrice } from './formatPrice';

describe('formatPrice', () => {
  it('formats USD correctly', () => {
    expect(formatPrice(2999, 'usd')).toBe('$29.99');
  });
});
```

### Integration Tests (API Routes)

**Setup:**
- Test database (separate from dev)
- Reset DB before each test suite
- Mock external services (Stripe, RunPod, Resend)

**Example:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from './+server';

describe('POST /api/content', () => {
  beforeEach(async () => {
    await clearTestDB();
  });

  it('creates content and returns ID', async () => {
    const request = new Request('http://localhost/api/content', {
      method: 'POST',
      body: JSON.stringify({ type: 'video', title: 'Test', price: 2999 })
    });

    const response = await POST({ request, locals: mockAuth() });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBeDefined();
  });
});
```

### E2E Tests (Critical Flows)

**Critical flows:**
1. User signup + email verification
2. Content purchase (Stripe test cards)
3. Content upload + processing status
4. Library access after purchase

**Example:**
```typescript
// tests/purchase-flow.spec.ts
import { test, expect } from '@playwright/test';

test('user can purchase and access content', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name=email]', 'test@example.com');
  await page.fill('[name=password]', 'password');
  await page.click('button[type=submit]');

  await page.goto('/content/video-123');
  await page.click('button:has-text("Purchase")');

  // Stripe test card
  const frame = page.frameLocator('iframe[name^="__privateStripeFrame"]');
  await frame.locator('[name="cardNumber"]').fill('4242424242424242');
  await frame.locator('[name="cardExpiry"]').fill('12/34');
  await frame.locator('[name="cardCvc"]').fill('123');

  await page.click('button:has-text("Pay")');
  await expect(page.locator('mux-player')).toBeVisible();
});
```

**Config:**
```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // Sequential for DB safety
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173'
  }
});
```

---

## Worker Testing

### Unit Tests

**Framework:** Vitest + Miniflare (unstable_dev)

**Setup:**
- Miniflare simulates Workers runtime
- Mock KV, R2, Queues
- Test message processing logic

**Example:**
```typescript
import { describe, it, expect } from 'vitest';
import { unstable_dev } from 'wrangler';

describe('Queue Consumer', () => {
  it('processes video job', async () => {
    const worker = await unstable_dev('src/index.ts');

    const message = {
      id: '1',
      timestamp: new Date(),
      body: {
        contentId: '123',
        videoKey: 'videos/test.mp4',
        operations: ['transcode']
      }
    };

    const response = await worker.fetch('http://localhost/__queue', {
      method: 'POST',
      body: JSON.stringify({ messages: [message] })
    });

    expect(response.status).toBe(200);
  });
});
```

### Integration Tests

**Test scenarios:**
- Message batching
- Retry logic (failed external calls)
- Dead letter queue handling
- KV cache interactions

---

## Shared Package Testing

### Shared Types

**Framework:** TypeScript compiler (tsc --noEmit)

No runtime tests needed - types are compile-time only.

```bash
pnpm --filter @codex/shared-types typecheck
```

### Env Config (Zod Schemas)

**Framework:** Vitest

**Example:**
```typescript
import { describe, it, expect } from 'vitest';
import { envSchema } from './schemas';

describe('envSchema', () => {
  it('validates correct environment', () => {
    const env = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://localhost/test',
      STRIPE_SECRET_KEY: 'sk_test_123',
      // ... all required
    };

    expect(() => envSchema.parse(env)).not.toThrow();
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => envSchema.parse({ NODE_ENV: 'development' }))
      .toThrow('DATABASE_URL');
  });

  it('rejects invalid Stripe key', () => {
    const env = {
      DATABASE_URL: 'postgres://localhost/test',
      STRIPE_SECRET_KEY: 'invalid' // Should start with sk_
    };

    expect(() => envSchema.parse(env)).toThrow();
  });
});
```

---

## Test Database

### Setup

**Separate test database:**
```bash
# Test docker-compose
docker-compose -f infrastructure/docker-compose.test.yml up -d

# Run migrations
DATABASE_URL=http://localhost:4445 pnpm db:migrate
```

**Test DB config:**
```yaml
# infrastructure/docker-compose.test.yml
services:
  postgres-test:
    image: postgres:17
    ports: ["5433:5432"]
    environment:
      POSTGRES_DB: codex_test
    tmpfs: /var/lib/postgresql/data  # In-memory for speed

  neon-proxy-test:
    image: ghcr.io/timowilhelm/local-neon-http-proxy:main
    environment:
      PG_CONNECTION_STRING: postgres://postgres:postgres@postgres-test:5432/codex_test
    ports: ["4445:4444"]
```

### Utilities

```typescript
// Test DB helpers
import { neon } from '@neondatabase/serverless';

const TEST_DB = 'http://localhost:4445';

export async function clearTestDB() {
  const db = neon(TEST_DB);
  await db`TRUNCATE TABLE content, users, purchases CASCADE`;
}

export async function seedTestData() {
  const db = neon(TEST_DB);
  await db`INSERT INTO users (id, email) VALUES ('1', 'test@example.com')`;
}
```

---

## Mocking External Services

### Always Mock

- Stripe API
- RunPod API
- Resend email
- R2 uploads (use Miniflare)

### Mock Implementations

```typescript
// Stripe mock
import { vi } from 'vitest';

export const mockStripe = {
  paymentIntents: {
    create: vi.fn().mockResolvedValue({
      id: 'pi_test_123',
      client_secret: 'secret_123'
    })
  }
};
```

```typescript
// RunPod mock
export const mockRunPod = {
  submit: vi.fn().mockResolvedValue({
    id: 'job_123',
    status: 'IN_QUEUE'
  }),

  status: vi.fn().mockResolvedValue({
    id: 'job_123',
    status: 'COMPLETED',
    output: {
      video_1080p_url: 'https://r2.example.com/1080p.mp4',
      thumbnail_url: 'https://r2.example.com/thumb.jpg'
    }
  })
};
```

```typescript
// Resend mock
export const mockResend = {
  emails: {
    send: vi.fn().mockResolvedValue({ id: 'email_123' })
  }
};
```

---

## Test Commands

**Root package.json:**
```json
{
  "scripts": {
    "test": "pnpm -r test",
    "test:unit": "pnpm --filter web test:unit && pnpm --filter '{workers/*}' test",
    "test:integration": "pnpm --filter web test:integration",
    "test:e2e": "pnpm --filter web test:e2e",
    "test:watch": "vitest",
    "test:coverage": "pnpm -r test:coverage",
    "typecheck": "pnpm -r typecheck"
  }
}
```

**Web app:**
```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run src/**/*.test.ts",
    "test:integration": "vitest run src/**/*.integration.ts",
    "test:e2e": "playwright test",
    "test:watch": "vitest",
    "test:coverage": "vitest --coverage"
  }
}
```

**Workers:**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

---

## Coverage Targets

| Component | Target | Critical |
|-----------|--------|----------|
| Utils/Logic | 90%+ | All pure functions |
| API Routes | 80%+ | Auth, payments, CRUD |
| Components | 70%+ | Forms, interactions |
| Workers | 85%+ | Queue processing |
| Shared Packages | 95%+ | Schemas, validation |

**Generate report:**
```bash
pnpm test:coverage
# Output: coverage/index.html
```

---

## Best Practices

### 1. Test Isolation
Each test independent, no shared state, reset DB/mocks before each.

### 2. Test Naming
```typescript
// Good
describe('formatPrice', () => {
  it('formats USD with dollar sign and 2 decimals', () => {});
});

// Bad
describe('formatPrice', () => {
  it('test 1', () => {});
});
```

### 3. AAA Pattern
Arrange → Act → Assert

```typescript
it('creates payment intent', async () => {
  // Arrange
  const amount = 2999;

  // Act
  const intent = await createPaymentIntent(amount);

  // Assert
  expect(intent.amount).toBe(2999);
});
```

### 4. Mock External APIs
Never make real API calls in tests (except E2E with test mode APIs).

### 5. Keep Tests Fast
- Unit: <1s per suite
- Integration: <5s per suite
- E2E: <30s per test

### 6. Test Error Cases
```typescript
describe('createPaymentIntent', () => {
  it('succeeds with valid input', async () => {});
  it('throws on negative amount', async () => {});
  it('handles Stripe errors', async () => {});
});
```

---

## Related Documents

- [EnvironmentManagement.md](./EnvironmentManagement.md) - Development setup
- **CodeStructure.md** - Project structure and file organization (TBD)
- **CI-CD-Pipeline.md** - Continuous integration and deployment (TBD)

---

## Reference

**Framework Docs:**
- [Vitest](https://vitest.dev/)
- [Testing Library](https://testing-library.com/docs/svelte-testing-library/intro/)
- [Playwright](https://playwright.dev/)
- [Miniflare](https://miniflare.dev/)
- [Wrangler Testing](https://developers.cloudflare.com/workers/testing/)
