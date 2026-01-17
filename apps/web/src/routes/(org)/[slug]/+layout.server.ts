import { getBrandConfig, setBrandConfig } from '$lib/server/brand-cache';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, platform, fetch }) => {
  const { slug } = params;

  // 1. Fast Path: Check KV cache (Zero latency)
  const cached = await getBrandConfig(platform, slug);
  if (cached) {
    return { brandConfig: cached.branding };
  }

  // 2. Slow Path: Fetch from Organization API
  // Note: This requires the user to be authenticated if the endpoint is protected.
  // Unauthenticated users on cache miss will fall back to default branding
  // until an authenticated user (or admin update) warms the cache.
  try {
    const apiUrl = platform?.env?.API_URL || 'https://api.revelations.studio';

    // We fetch the 'settings/branding' endpoint.
    // Since we don't know the Org ID, we might need to lookup by slug first?
    // Wait, the API routes are usually /organizations/:id/settings/branding
    // But we only have the SLUG here!

    // We first need to resolve Slug -> ID?
    // OR does the API support /organizations/slug/:slug/settings/branding?
    // The viewed `organizations.ts` has `GET /slug/:slug`.
    // The viewed `settings.ts` has `GET /:id/...` (via orgIdParamSchema).

    // So we need to:
    // A) Get Org by Slug -> Get ID
    // B) Get Settings by ID

    // This is 2 round trips.
    // Optimization: Just call GET /slug/:slug and hope it returns branding?
    // `OrganizationBySlugResponse` returns `Organization`.
    // Let's assume Organization model *might* contain branding (logo, color) if simplified?
    // But `settings.ts` manages it separately.

    // Let's implement the 2-step lookup for now, or just GET /slug/:slug and see what we get.
    // If we assume `Organization` has `logoUrl` and `primaryColorHex` (denormalized), that would be great.
    // The user mentioned: "The current API/DB schema (logoUrl, primaryColorHex) is simpler..."
    // This implies the Organization table might have these fields!

    // If so, `GET /api/organizations/slug/:slug` returns valid branding data!
    const orgRes = await fetch(`${apiUrl}/api/organizations/slug/${slug}`);

    if (orgRes.ok) {
      const orgData = (await orgRes.json()) as {
        data: { logoUrl?: string; primaryColorHex?: string };
      };
      // Expecting { data: Organization }
      const org = orgData.data;

      if (org) {
        // Construct BrandingSettingsResponse from Organization data
        // Assuming Organization has these fields based on "simpler schema" comment
        const branding = {
          logoUrl: org.logoUrl ?? null,
          primaryColorHex: org.primaryColorHex ?? '#000000', // Default fallback
        };

        // Background write to cache
        setBrandConfig(platform, slug, {
          updatedAt: new Date().toISOString(),
          branding,
        });

        return { brandConfig: branding };
      }
    }
  } catch (err) {
    console.error(`[Layout] Error fetching branding for ${slug}:`, err);
  }

  // Fallback: Return null (app will use CSS defaults)
  return { brandConfig: null };
};
