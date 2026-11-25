/**
 * An owner's download of a leaving piece (Codex-a6ofh.6.7, LN7). The page's
 * Download link lands here, and this answers a 302 to the worker's signed
 * link to the original (`GET /api/access/content/:id/download`, WP-5), which
 * saves as a file and leaves the reader on the page.
 *
 * The link is asked for at the click, so its 15 minutes start then and it
 * never sits in the page's data. The worker decides everything (leaving, the
 * creator's setting, an owner, the file still stored) and answers one 404
 * for every refusal.
 *
 * Anything that is not a download goes back to the piece's page with a 303,
 * never to an error page (an error thrown from a server route renders
 * SvelteKit's bare fallback, not the site's). A refusal just re-reads the
 * page, whose note then says what is true now. Any other failure is logged
 * and comes back with `?download=failed`, so the note says the download did
 * not start.
 */
import { uuidSchema } from '@codex/validation';
import type { RequestEvent } from '@sveltejs/kit';
import { LEAVING_DOWNLOAD_FAILED } from '$lib/components/content/leaving-note';
import { createServerApi } from './api';
import { CACHE_HEADERS } from './cache';
import { isLeavingRefusal } from './leaving-print';
import { logReadFailure } from './read-failure';

/** The parts of a request event the download reads. */
type DownloadEvent = Pick<
  RequestEvent,
  'url' | 'locals' | 'platform' | 'cookies'
>;

/** A redirect stored nowhere: the signed link is a credential. */
const redirectTo = (status: 302 | 303, location: string): Response =>
  new Response(null, {
    status,
    headers: { ...CACHE_HEADERS.FRESH, Location: location },
  });

/**
 * Back to the piece's page: this route's own URL, one segment up. Setting
 * `pathname` on a copy of the request URL never changes its origin.
 */
function backToPage(url: URL, failed: boolean): Response {
  const page = new URL(url);
  page.pathname = url.pathname.replace(/\/download\/?$/, '');
  page.search = '';
  if (failed) {
    page.searchParams.set(
      LEAVING_DOWNLOAD_FAILED.name,
      LEAVING_DOWNLOAD_FAILED.value
    );
  }
  return redirectTo(303, page.href);
}

/**
 * Redirect to the signed link for the piece named by `?id=`, the id the page
 * links with.
 *
 * @returns a 302 to the signed link; a 303 back to the piece's page for a
 *   signed-out reader, a malformed id or the worker's refusal; the same with
 *   `?download=failed` for any other failure
 */
export async function redirectToLeavingDownload(
  event: DownloadEvent
): Promise<Response> {
  const id = uuidSchema.safeParse(event.url.searchParams.get('id'));
  if (!event.locals.user || !id.success) return backToPage(event.url, false);

  try {
    const download = await createServerApi(
      event.platform,
      event.cookies
    ).access.leavingDownload(id.data);
    return redirectTo(302, download.url);
  } catch (err) {
    if (isLeavingRefusal(err)) return backToPage(event.url, false);
    logReadFailure(
      'Leaving download failed; back to the page',
      { contentId: id.data },
      err
    );
    return backToPage(event.url, true);
  }
}
