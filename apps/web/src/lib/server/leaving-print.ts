/**
 * The print view of a LEAVING article (Codex-a6ofh.6.5, design D7): the load
 * the org and creator `/content/[contentSlug]/print` pages share.
 *
 * The worker decides who may print it (`GET /api/access/content/print`, the
 * file download's eligibility answering `'print'`: leaving, the creator's
 * `owners_can_download` on, an owner asking, an article). Each of its
 * refusals is one 404, and this page's 404, as are a signed-out visitor, a
 * slug the API would refuse, and an unknown org or creator. Any other failure
 * propagates as a 500, never as "not found", and so does a 404 the worker
 * did not give on the print read and the org lookup: a route that isn't there
 * (deploy skew, an edge 404) carries no `NOT_FOUND` code, and must not read
 * as "you don't own this". NOT YET in the creator tree: its lookup,
 * `api.account.getPublicProfile`, turns ANY 404 into null, a bare one
 * included, so a missing identity-api route still reads as "no such creator"
 * there (Codex-niqxy owns that fix, in `api.ts`).
 *
 * The page carries a paid body, so it is stored nowhere (`private, no-store`)
 * whatever it answers.
 */

import { publicContentSlugSchema } from '@codex/validation';
import type { Cookies } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { hasStoredText, renderContentBody } from '$lib/editor/render';
import { createServerApi } from './api';
import { CACHE_HEADERS } from './cache';
import { ApiError } from './errors';

/** What the print page renders. */
interface LeavingPrintPage {
  title: string;
  creatorName: string;
  /** The body as sanitised HTML, or null when it did not render. */
  bodyHtml: string | null;
  /** Stored text that did not render: the page says so and prints nothing. */
  bodyUnavailable: boolean;
}

/** Whose piece the URL names: an org's, or a creator's personal one. */
type LeavingPrintOwner = { orgId: string } | { creatorId: string };

/** The parts of a load event the print load reads. */
interface PrintLoadEvent {
  params: { contentSlug: string };
  locals: App.Locals;
  platform: App.Platform | undefined;
  cookies: Cookies;
  setHeaders: (headers: Record<string, string>) => void;
}

/**
 * The worker's own 404, carrying its `NOT_FOUND` code, as the org layout's
 * guard reads one (Codex-4p2l7): a bare 404 is a route that isn't there.
 */
export function isWorkerNotFound(err: unknown): err is ApiError {
  return (
    ApiError.isApiError(err) && err.status === 404 && err.code === 'NOT_FOUND'
  );
}

/** The print read's refusal: the worker's 404, naming the content. */
function isPrintRefusal(err: unknown): boolean {
  if (!isWorkerNotFound(err)) return false;
  const details = err.details as { code?: unknown } | null | undefined;
  return details?.code === 'CONTENT_NOT_FOUND';
}

/**
 * The print page's data. `ownerOf` resolves the URL's org or creator, or null
 * when there is none (its own 404s answered null; anything else thrown).
 *
 * @throws a 404 for every refusal
 */
export async function loadLeavingPrint(
  event: PrintLoadEvent,
  ownerOf: (
    api: ReturnType<typeof createServerApi>
  ) => Promise<LeavingPrintOwner | null>
): Promise<LeavingPrintPage> {
  event.setHeaders(CACHE_HEADERS.FRESH);
  const slug = event.params.contentSlug;
  if (!event.locals.user || !publicContentSlugSchema.safeParse(slug).success) {
    error(404, 'Content not found');
  }

  const api = createServerApi(event.platform, event.cookies);
  const owner = await ownerOf(api);
  if (!owner) error(404, 'Content not found');

  const print = await api.access
    .leavingPrint({ ...owner, slug })
    .catch((err: unknown) => {
      if (isPrintRefusal(err)) error(404, 'Content not found');
      throw err;
    });
  const bodyHtml = await renderContentBody(print.body, {
    contentId: print.contentId,
    surface: 'content-print',
  });
  return {
    title: print.title,
    creatorName: print.creatorName,
    bodyHtml,
    bodyUnavailable: hasStoredText(print.body) && bodyHtml == null,
  };
}
