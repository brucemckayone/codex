// tests/integration.auth.test.ts
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMiniflareHelper, useMiniflare } from '@codex/test-utils';

const helper = createMiniflareHelper({
  modules: true,
  kvPersist: false,
  d1Persist: false,
  r2Persist: false,
});

const {
  beforeEach: mfBefore,
  afterEach: mfAfter,
  helper: mfHelper,
} = useMiniflare(helper);

describe.skip('Auth Worker (integration)', () => {
  beforeEach(async () => {
    const scriptPath = path.resolve(__dirname, '../dist/index.js'); // built worker
    await mfBefore({
      scriptPath,
      modules: true,
      // declare the same binding names you have in wrangler.toml
      kvNamespaces: ['AUTH_SESSION_KV', 'RATE_LIMIT_KV'],
      // disable persistence so tests are isolated
      kvPersist: false,
    });
  });

  afterEach(async () => {
    await mfAfter();
  });

  it('health check returns healthy', async () => {
    const res = await mfHelper.fetch('http://localhost/health');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('healthy');
  });

  it('reads seeded KV', async () => {
    const kv = await mfHelper.getKVNamespace('AUTH_SESSION_KV');
    await kv.put('user:alice', JSON.stringify({ id: 'alice', name: 'Alice' }));

    const res = await mfHelper.fetch('http://localhost/user/alice');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('Alice');
  });
});
