import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { randomUuid } from './random-uuid';

const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID where the context is secure', () => {
    const id = randomUuid();
    expect(id).toMatch(V4);
  });

  // http://*.lvh.me (local dev, e2e): no crypto.randomUUID.
  it('builds a valid v4 uuid from getRandomValues without crypto.randomUUID', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: real.getRandomValues.bind(real),
    });

    const ids = Array.from({ length: 200 }, () => randomUuid());
    for (const id of ids) {
      expect(id).toMatch(V4);
      expect(z.string().uuid().safeParse(id).success).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
