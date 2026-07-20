<!--
  @component BrandEditorLogo

  The Identity-group LOGO control for the brand studio rail (and the legacy
  overlay). Codex-cijzb · WP-1.6 folds the retired settings/branding page's logo
  upload into the workspace by delegating to the ONE reusable <LogoUpload>
  affordance — drag-drop + multipart upload via `uploadLogoForm`, which
  re-forwards the File through `forwardMultipartUpload` server-side (the workerd
  filename-strip fix, PR #351).

  This component is now a thin STORE ADAPTER: it owns no upload markup of its
  own (the bespoke form that lived here in WP-1.5 was removed so there is exactly
  ONE logo mechanism). It wires <LogoUpload> to the brand-editor store:
    - upload success → `brandEditor.updateField('logoUrl', url)` so the WP-1.4
      preview bridge live-updates the framed page and the change-ledger reflects
      the edit. The file itself is already persisted to R2 + DB by
      `uploadLogoForm` at upload time.
    - remove → `deleteLogo` (server: clears the R2 object + DB column) FIRST,
      then the store field — the Codex-ne00j ordering, so a failed delete never
      leaves the store claiming "no logo" while the DB still has one. Delete
      errors surface here (<LogoUpload> owns only upload/validation errors).
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import LogoUpload from '$lib/components/studio/LogoUpload.svelte';
  import { deleteLogo, uploadLogoForm } from '$lib/remote/branding.remote';

  const logoUrl = $derived(brandEditor.pending?.logoUrl ?? null);
  const orgId = $derived(brandEditor.orgId ?? '');

  let deleting = $state(false);
  let deleteError = $state<string | null>(null);

  // Upload success: <LogoUpload> hands us the new URL. Push it into the store's
  // pending so the preview bridge + change-ledger both see it.
  function handleUpload(url: string | null): void {
    brandEditor.updateField('logoUrl', url);
  }

  // Remove: clear the R2 object + DB column FIRST (deleteLogo), then the store
  // field. The `deleting` guard makes double-clicks a no-op (the delete is a
  // command, not the tracked form, so <LogoUpload> can't disable its button).
  async function handleDelete(): Promise<void> {
    if (!brandEditor.orgId || deleting) return;
    deleting = true;
    deleteError = null;
    try {
      await deleteLogo(brandEditor.orgId);
      brandEditor.updateField('logoUrl', null);
    } catch (err) {
      deleteError =
        err instanceof Error ? err.message : 'Failed to remove logo';
    } finally {
      deleting = false;
    }
  }
</script>

{#if orgId}
  <LogoUpload
    {logoUrl}
    {orgId}
    {uploadLogoForm}
    onupload={handleUpload}
    ondelete={handleDelete}
  />
{/if}
{#if deleteError}
  <p class="logo-adapter__error" role="alert">{deleteError}</p>
{/if}

<style>
  .logo-adapter__error {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--color-error-500);
  }
</style>
