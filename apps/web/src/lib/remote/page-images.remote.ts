/**
 * Page-image upload remote function (Codex-61zsk.10, contract amendment A3).
 *
 * A `File` may only travel through `form()`, never `command()` or `query()`
 * — enforced repo-wide by `remote-file-uploads.test.ts`, and the reason is
 * mechanical, not stylistic: `command()`/`query()` arguments serialize
 * through devalue, which has no representation for a `File`, so calling one
 * with a File throws "Cannot stringify arbitrary non-POJOs" in the BROWSER,
 * before any request is made. `form()` submits real multipart FormData,
 * where a File is fine.
 *
 * Modelled on `journeys.remote.ts`'s `uploadJourneyHeroImageForm`, with ONE
 * structural difference that follows from contract A3: there is no
 * `deleteJourneyHeroImage`-style clear command here, because a page image
 * has no column to clear. Removing one is expressed by saving the page
 * without its reference — the ordinary `saveJourneyPage` command
 * (`journeys.remote.ts`) already owns that, and
 * `CourseJourneyService.saveJourneyPage`'s save-time deep-scan diff is what
 * notices the dropped reference and queues the key for the orphan sweep.
 * This file therefore exports exactly one remote function.
 */

import {
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '@codex/validation';
import { z } from 'zod';
import { form, getRequestEvent } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { ApiError } from '$lib/server/errors';
import { getSubdomainContext } from '$lib/utils/subdomain';

/**
 * Resolve the current studio org (host subdomain → `getPublicInfo` id) plus a
 * session-forwarding API client. Returns `null` off a non-org host.
 *
 * A DELIBERATE DUPLICATE of `journeys.remote.ts`'s own `resolveStudioOrg`,
 * not an import: a `.remote.ts` file may export only remote functions
 * (query/command/form/prerender), so this small helper cannot be shared by
 * import and every studio remote file that needs it carries its own copy.
 */
async function resolveStudioOrg(): Promise<{
  api: ReturnType<typeof createServerApi>;
  orgId: string;
} | null> {
  const { platform, cookies, url } = getRequestEvent();
  const context = getSubdomainContext(url.hostname);
  if (context.type !== 'organization') return null;
  const api = createServerApi(platform, cookies);
  const org = await api.org.getPublicInfo(context.slug);
  if (!org || typeof org !== 'object' || !('id' in org)) return null;
  return { api, orgId: (org as { id: string }).id };
}

/**
 * Upload a free-placement page image (multipart FormData: `pageId` + the
 * `image` file) and return its stored R2 key plus an immediately-usable
 * preview URL. `form()`, NEVER `command()` — devalue cannot serialize a
 * `File`; see the module docblock.
 *
 * The kit's block inspector is the one that decides which prop the returned
 * `key` ends up in (`props.image`, `props.background`, `items[].image`, ...)
 * — this function has no opinion on that, and does not validate it: it only
 * uploads and hands back `{ key, url }`.
 */
export const uploadPageImageForm = form(
  z.object({
    pageId: z.string().uuid(),
    image: z
      .instanceof(File)
      .refine(
        (file) => !file.type || SUPPORTED_IMAGE_MIME_TYPES.has(file.type),
        'Use a JPG, PNG, WebP, or GIF image — HEIC and other formats are not supported.'
      )
      .refine(
        (file) => file.size <= MAX_IMAGE_SIZE_BYTES,
        `The image must be ${Math.round(
          MAX_IMAGE_SIZE_BYTES / 1024 / 1024
        )}MB or smaller.`
      ),
  }),
  async ({ pageId, image }) => {
    const ctx = await resolveStudioOrg();
    if (!ctx) {
      return {
        outcome: 'failed' as const,
        message: 'A page image can only be uploaded within an organization',
      };
    }
    try {
      const { key, url } = await ctx.api.access.uploadPageImage(
        ctx.orgId,
        pageId,
        image
      );
      return { outcome: 'uploaded' as const, key, url };
    } catch (err) {
      if (ApiError.isApiError(err) && err.status >= 400 && err.status < 500) {
        return { outcome: 'failed' as const, message: err.message };
      }
      throw err;
    }
  }
);
