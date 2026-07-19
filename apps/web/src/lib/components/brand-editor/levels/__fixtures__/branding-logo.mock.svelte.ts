/**
 * Reactive test double for `$lib/remote/branding.remote` (Codex-cijzb · WP-1.6
 * logo tests). Stubs the two exports BrandEditorLogo imports —
 * `uploadLogoForm` + `deleteLogo` — so the real remote (which needs
 * `$app/server`) never loads in jsdom.
 *
 * `uploadLogoForm.result`/`.pending` are $state-backed so a test can simulate a
 * completed upload and the reused <LogoUpload>'s success `$effect` fires.
 * `deleteLogo` records its calls and can be made to reject, so the delete +
 * delete-error paths are both exercised.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file → never
 * collected as a suite.
 */

export type LogoUploadResult =
  | { success: true; data: { logoUrl: string | null } }
  | { success: false; error: string }
  | undefined;

const uploadState = $state<{ pending: number; result: LogoUploadResult }>({
  pending: 0,
  result: undefined,
});

export const uploadLogoForm = {
  method: 'POST',
  action: '?/uploadLogoForm',
  enctype: 'multipart/form-data',
  onsubmit: () => {},
  get pending() {
    return uploadState.pending;
  },
  get result() {
    return uploadState.result;
  },
  fields: {
    logo: {
      as: (_type: string) => ({ type: 'file', name: 'logo' }),
    },
  },
};

export function setUploadResult(result: LogoUploadResult): void {
  uploadState.result = result;
}

export function setUploadPending(pending: number): void {
  uploadState.pending = pending;
}

/** deleteLogo call log + optional rejection, controllable from a test. */
export const deleteCalls: string[] = [];
let deleteRejectMessage: string | null = null;

export function setDeleteRejection(message: string | null): void {
  deleteRejectMessage = message;
}

export async function deleteLogo(orgId: string): Promise<{ success: true }> {
  deleteCalls.push(orgId);
  if (deleteRejectMessage) throw new Error(deleteRejectMessage);
  return { success: true };
}

/** Reset between tests (module singleton persists across mounts). */
export function reset(): void {
  uploadState.pending = 0;
  uploadState.result = undefined;
  deleteCalls.length = 0;
  deleteRejectMessage = null;
}
