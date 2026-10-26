/**
 * How a missing agreement share renders (Codex-fazy6), for tests: the "—"
 * hidden from assistive technology, beside visually hidden "No share
 * recorded" (`AgreementShare.svelte`). Reads the two apart, because the
 * element's `textContent` holds both.
 */

import * as m from '$paraglide/messages';

export const MISSING_SHARE_PARTS = {
  visible: '—',
  spoken: m.agreement_share_missing(),
};

/** The visible and the spoken text of a share inside `el`. */
export function missingShareParts(el: Element | null | undefined) {
  return {
    visible: el?.querySelector('[aria-hidden="true"]')?.textContent?.trim(),
    spoken: el?.querySelector('.sr-only')?.textContent?.trim(),
  };
}
