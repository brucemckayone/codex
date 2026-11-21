/**
 * An org's leaving article, as its owner saves it as a PDF (Codex-a6ofh.6.5).
 *
 * `+page@.svelte` resets to the root layout, so the org layout's load does
 * not run: the org is resolved here, from its public info. Every refusal is
 * a 404 and the page is stored nowhere (`loadLeavingPrint`).
 */
import { isWorkerNotFound, loadLeavingPrint } from '$lib/server/leaving-print';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) =>
  loadLeavingPrint(event, async (api) => {
    // Only the worker's own 404 means no such org; any other failure, a bare
    // 404 included, is thrown, as the org layout's guard treats it.
    const org = await api.org
      .getPublicInfo(event.params.slug)
      .catch((err: unknown) => {
        if (isWorkerNotFound(err)) return null;
        throw err;
      });
    return org ? { orgId: org.id } : null;
  });
