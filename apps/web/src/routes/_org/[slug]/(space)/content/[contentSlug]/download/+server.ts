/**
 * An owner's download of a leaving piece (Codex-a6ofh.6.7): the page note's
 * Download link, answered with a 302 to the signed link to the original.
 * Anything else goes back to the page (`redirectToLeavingDownload`).
 */
import { redirectToLeavingDownload } from '$lib/server/leaving-download';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => redirectToLeavingDownload(event);
