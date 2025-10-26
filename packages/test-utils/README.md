# @codex/test-utils

Shared testing utilities and helpers for the Codex project.

## Features

- **Miniflare Helpers**: Test Cloudflare Workers locally with Miniflare
- Database setup and teardown for integration tests (planned)
- Mock factories for test data (planned)
- Shared test helpers and utilities
- API testing helpers (planned)

## Usage

### Miniflare Helpers

Test Cloudflare Workers in a realistic workerd runtime environment:

```typescript
import {
  createMiniflareHelper,
  type MiniflareTestHelper,
} from '@codex/test-utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('My Worker', () => {
  let helper: MiniflareTestHelper;

  beforeEach(async () => {
    helper = createMiniflareHelper();

    await helper.setup({
      script: `
        export default {
          async fetch(request, env) {
            return new Response("Hello World!");
          }
        }
      `,
      modules: true,
      compatibilityDate: '2024-01-01',
      kvNamespaces: ['MY_KV'],
      queueProducers: ['MY_QUEUE'],
    });
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it('should handle fetch requests', async () => {
    const response = await helper.fetch('http://localhost/');
    expect(await response.text()).toBe('Hello World!');
  });

  it('should access KV bindings', async () => {
    const kv = await helper.getKVNamespace('MY_KV');
    await kv.put('key', 'value');
    expect(await kv.get('key')).toBe('value');
  });
});
```

### Database Helpers (Planned)

```typescript
import { setupTestDb, teardownTestDb } from '@codex/test-utils';
```

## API Reference

See [Testing.md](../../design/infrastructure/Testing.md) for complete testing documentation.
