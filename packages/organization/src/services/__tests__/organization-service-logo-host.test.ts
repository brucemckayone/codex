/**
 * OrganizationService logo-host gate (Codex-8so68)
 *
 * NO DATABASE. The external-host check runs immediately after Zod and
 * BEFORE `db.transaction()` opens, so a stub whose `transaction` throws a
 * sentinel separates the two outcomes:
 *   - REJECT case  → ValidationError, sentinel never reached.
 *   - ACCEPT case  → sentinel surfaces, proving the gate let the value past.
 *
 * `handleError()` re-throws a `ServiceError` unchanged, so a `NotFoundError`
 * sentinel arrives at the caller verbatim.
 *
 * The base literal mirrors the `R2_PUBLIC_URL_BASE` binding value in
 * `workers/organization-api/wrangler.jsonc`.
 */

import { NotFoundError, ValidationError } from '@codex/service-errors';
import type { CreateOrganizationInput } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import type { OrganizationServiceConfig } from '../organization-service';
import { OrganizationService } from '../organization-service';

const PROD_BASE = 'https://cdn-assets.revelations.studio';
const SENTINEL = 'DB_STUB_REACHED';

function makeService(r2PublicUrlBase?: string): OrganizationService {
  const db = {
    transaction: () => {
      throw new NotFoundError(SENTINEL);
    },
  };
  return new OrganizationService({
    db: db as unknown as OrganizationServiceConfig['db'],
    environment: 'test',
    r2PublicUrlBase,
  });
}

const baseInput: CreateOrganizationInput = {
  name: 'Test Organization',
  slug: 'test-org-logo-host',
};

describe('OrganizationService logo host gate', () => {
  describe('create', () => {
    it('rejects an externally-hosted logo', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.create(
          { ...baseInput, logoUrl: 'https://evil.example.com/logo.png' },
          'user-1'
        )
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a lookalike host that has the CDN as a prefix', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.create(
          {
            ...baseInput,
            logoUrl:
              'https://cdn-assets.revelations.studio.evil.example.com/logo.png',
          },
          'user-1'
        )
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('accepts a platform-hosted logo URL', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.create(
          { ...baseInput, logoUrl: `${PROD_BASE}/logos/org-1/lg.webp` },
          'user-1'
        )
      ).rejects.toThrow(SENTINEL);
    });

    it('accepts null and undefined logos', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.create({ ...baseInput, logoUrl: null }, 'user-1')
      ).rejects.toThrow(SENTINEL);
      await expect(service.create(baseInput, 'user-1')).rejects.toThrow(
        SENTINEL
      );
    });

    it('keeps websiteUrl external — it is a legitimate outbound link', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.create(
          {
            ...baseInput,
            websiteUrl: 'https://some-creator-site.example.com',
          },
          'user-1'
        )
      ).rejects.toThrow(SENTINEL);
    });

    it('fails closed when no asset base is configured', async () => {
      const service = makeService(undefined);

      await expect(
        service.create(
          { ...baseInput, logoUrl: `${PROD_BASE}/logos/org-1/lg.webp` },
          'user-1'
        )
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('update', () => {
    it('rejects an externally-hosted logo', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.update('org-1', {
          logoUrl: 'https://evil.example.com/logo.png',
        })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('accepts a platform-hosted logo URL', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.update('org-1', {
          logoUrl: `${PROD_BASE}/logos/org-1/lg.webp`,
        })
      ).rejects.toThrow(SENTINEL);
    });

    it('leaves an absent logo alone and allows an explicit null', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.update('org-1', { name: 'New Name' })
      ).rejects.toThrow(SENTINEL);
      await expect(service.update('org-1', { logoUrl: null })).rejects.toThrow(
        SENTINEL
      );
    });

    it('keeps websiteUrl external on update too', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.update('org-1', {
          websiteUrl: 'https://some-creator-site.example.com/new',
        })
      ).rejects.toThrow(SENTINEL);
    });
  });
});
