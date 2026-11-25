/**
 * A creator's personal leaving article, as its owner saves it as a PDF
 * (Codex-a6ofh.6.5). `+page@.svelte` resets to the root layout. Every
 * refusal is a 404 and the page is stored nowhere (`loadLeavingPrint`).
 */
import { usernameSchema } from '@codex/validation';
import { loadLeavingPrint } from '$lib/server/leaving-print';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) =>
  loadLeavingPrint(event, async (api) => {
    // The handle without its leading @. One identity-api would refuse names
    // no one: the page's 404, stored nowhere like every other answer here.
    const username = event.params.username.replace(/^@/, '');
    if (!usernameSchema.safeParse(username).success) return null;
    // A 404 from identity-api is null here; anything else throws.
    const creator = await api.account.getPublicProfile(username);
    return creator ? { creatorId: creator.id } : null;
  });
