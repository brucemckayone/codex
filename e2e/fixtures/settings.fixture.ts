/**
 * Settings fixture for e2e tests
 * Handles platform settings API operations via REAL organization-api worker
 */

import { httpClient } from '../helpers/http-client';
import { WORKER_URLS } from '../helpers/worker-urls';

// Settings response types
export interface BrandingSettings {
  logoUrl: string | null;
  logoR2Path?: string | null;
  primaryColorHex: string;
}

export interface ContactSettings {
  platformName: string;
  supportEmail: string;
  contactUrl: string | null;
  timezone: string;
}

export interface FeatureSettings {
  enableSignups: boolean;
  enablePurchases: boolean;
}

export interface AllSettings {
  branding: BrandingSettings;
  contact: ContactSettings;
  features: FeatureSettings;
}

export const settingsFixture = {
  /**
   * Build settings URL for an organization
   */
  buildUrl(orgId: string, path = ''): string {
    console.debug(
      'Platform Settings URL',
      `${WORKER_URLS.organization}/api/organizations/${orgId}/settings${path}`
    );
    return `${WORKER_URLS.organization}/api/organizations/${orgId}/settings${path}`;
  },

  // ============================================================================
  // Get Settings
  // ============================================================================

  /**
   * GET /api/organizations/:id/settings
   */
  async getAllSettings(cookie: string, orgId: string): Promise<AllSettings> {
    const response = await httpClient.get(this.buildUrl(orgId), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.organization,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`getAllSettings failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * GET /api/organizations/:id/settings/branding
   */
  async getBranding(cookie: string, orgId: string): Promise<BrandingSettings> {
    const response = await httpClient.get(this.buildUrl(orgId, '/branding'), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.organization,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`getBranding failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * GET /api/organizations/:id/settings/contact
   */
  async getContact(cookie: string, orgId: string): Promise<ContactSettings> {
    const response = await httpClient.get(this.buildUrl(orgId, '/contact'), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.organization,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`getContact failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * GET /api/organizations/:id/settings/features
   */
  async getFeatures(cookie: string, orgId: string): Promise<FeatureSettings> {
    const response = await httpClient.get(this.buildUrl(orgId, '/features'), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.organization,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`getFeatures failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  // ============================================================================
  // Update Settings
  // ============================================================================

  /**
   * PUT /api/organizations/:id/settings/branding
   */
  async updateBranding(
    cookie: string,
    orgId: string,
    data: { primaryColorHex?: string }
  ): Promise<BrandingSettings> {
    const response = await httpClient.put(this.buildUrl(orgId, '/branding'), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.organization,
      },
      data,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`updateBranding failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * PUT /api/organizations/:id/settings/contact
   */
  async updateContact(
    cookie: string,
    orgId: string,
    data: {
      platformName?: string;
      supportEmail?: string;
      contactUrl?: string | null;
      timezone?: string;
    }
  ): Promise<ContactSettings> {
    const response = await httpClient.put(this.buildUrl(orgId, '/contact'), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.organization,
      },
      data,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`updateContact failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * PUT /api/organizations/:id/settings/features
   */
  async updateFeatures(
    cookie: string,
    orgId: string,
    data: { enableSignups?: boolean; enablePurchases?: boolean }
  ): Promise<FeatureSettings> {
    const response = await httpClient.put(this.buildUrl(orgId, '/features'), {
      headers: {
        Cookie: cookie,
        Origin: WORKER_URLS.organization,
      },
      data,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`updateFeatures failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  // ============================================================================
  // Logo Operations
  // ============================================================================

  /**
   * POST /api/organizations/:id/settings/branding/logo
   * Uploads a logo image
   */
  async uploadLogo(
    cookie: string,
    orgId: string,
    file: Buffer,
    filename: string,
    mimeType: string
  ): Promise<{ logoUrl: string }> {
    const response = await httpClient.post(
      this.buildUrl(orgId, '/branding/logo'),
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.organization,
        },
        multipart: {
          logo: {
            name: filename,
            mimeType,
            buffer: file,
          },
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`uploadLogo failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * DELETE /api/organizations/:id/settings/branding/logo
   */
  async deleteLogo(cookie: string, orgId: string): Promise<boolean> {
    const response = await httpClient.delete(
      this.buildUrl(orgId, '/branding/logo'),
      {
        headers: {
          Cookie: cookie,
          Origin: WORKER_URLS.organization,
        },
      }
    );

    if (!response.ok && response.status !== 204) {
      const error = await response.text();
      throw new Error(`deleteLogo failed (${response.status}): ${error}`);
    }

    return true;
  },
};
