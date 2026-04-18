<!--
  @component BrandEditorMount

  Dynamic-import entry point for the brand editor. Statically imports all
  14 level components + panel chrome + save plumbing. The parent layout
  loads this module only when the editor is activated (?brandEditor URL
  param or store state !== closed), so regular visitors to org pages
  never download this JS.

  Keep the parent layout free of heavy brand-editor imports. Anything
  brand-editor-specific that is only needed while the panel is active
  should live inside this component.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { brandEditor } from '$lib/brand-editor';
  import { updateBrandingCommand } from '$lib/remote/branding.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import ConfirmDialog from '$lib/components/ui/Feedback/ConfirmDialog.svelte';
  import BrandEditorPanel from './BrandEditorPanel.svelte';
  import BrandEditorHeader from './BrandEditorHeader.svelte';
  import BrandEditorFooter from './BrandEditorFooter.svelte';
  import BrandEditorHome from './levels/BrandEditorHome.svelte';
  import BrandEditorColors from './levels/BrandEditorColors.svelte';
  import BrandEditorTypography from './levels/BrandEditorTypography.svelte';
  import BrandEditorShape from './levels/BrandEditorShape.svelte';
  import BrandEditorShadows from './levels/BrandEditorShadows.svelte';
  import BrandEditorLogo from './levels/BrandEditorLogo.svelte';
  import BrandEditorFineTuneColors from './levels/BrandEditorFineTuneColors.svelte';
  import BrandEditorFineTuneTypography from './levels/BrandEditorFineTuneTypography.svelte';
  import BrandEditorPresets from './levels/BrandEditorPresets.svelte';
  import BrandEditorHeroEffects from './levels/BrandEditorHeroEffects.svelte';
  import BrandEditorIntroVideo from './levels/BrandEditorIntroVideo.svelte';
  import BrandEditorHeaderLayout from './levels/BrandEditorHeaderLayout.svelte';

  let saving = $state(false);
  let discardDialogOpen = $state(false);

  async function handleSave() {
    const payload = brandEditor.getSavePayload();
    if (!payload || !brandEditor.orgId) return;

    saving = true;
    try {
      const overrides = payload.tokenOverrides ?? {};
      const hasOverrides = Object.keys(overrides).length > 0;

      // tokenOverrides JSON is the single source of truth for fine-tune fields.
      // The broken-out columns (textColorHex, shadowScale, etc.) still exist on
      // the DB row and are read by the layout for backward compatibility with
      // pre-JSON rows, but we no longer double-write them here — the JSON blob
      // is authoritative for new saves (iter-04 Codex-2nl7).
      await updateBrandingCommand({
        orgId: brandEditor.orgId,
        primaryColorHex: payload.primaryColor,
        secondaryColorHex: payload.secondaryColor ?? '',
        accentColorHex: payload.accentColor ?? '',
        backgroundColorHex: payload.backgroundColor ?? '',
        fontBody: payload.fontBody ?? '',
        fontHeading: payload.fontHeading ?? '',
        radiusValue: payload.radius,
        densityValue: payload.density,
        tokenOverrides: hasOverrides ? JSON.stringify(overrides) : '',
        darkModeOverrides: payload.darkOverrides ? JSON.stringify(payload.darkOverrides) : '',
        heroLayout: payload.heroLayout as
          | 'default' | 'split' | 'centered' | 'logo-hero' | 'minimal'
          | 'magazine' | 'asymmetric' | 'portrait' | 'gallery' | 'stacked',
      });
      brandEditor.markSaved();
      toast.success('Brand settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save brand settings');
    } finally {
      saving = false;
    }
  }

  function handleEditorClose() {
    if (brandEditor.isDirty) {
      discardDialogOpen = true;
      return;
    }
    finishClose();
  }

  function confirmDiscard() {
    brandEditor.discard();
    finishClose();
  }

  function finishClose() {
    brandEditor.close();
    const url = new URL(page.url);
    url.searchParams.delete('brandEditor');
    goto(url.pathname + url.search, { replaceState: true });
  }
</script>

<BrandEditorPanel onsave={handleSave} {saving}>
  {#snippet header()}
    <BrandEditorHeader onclose={handleEditorClose} />
  {/snippet}

  {#if brandEditor.level === 'home'}
    <BrandEditorHome />
  {:else if brandEditor.level === 'colors'}
    <BrandEditorColors />
  {:else if brandEditor.level === 'typography'}
    <BrandEditorTypography />
  {:else if brandEditor.level === 'shape'}
    <BrandEditorShape />
  {:else if brandEditor.level === 'shadows'}
    <BrandEditorShadows />
  {:else if brandEditor.level === 'logo'}
    <BrandEditorLogo />
  {:else if brandEditor.level === 'presets'}
    <BrandEditorPresets />
  {:else if brandEditor.level === 'hero-effects'}
    <BrandEditorHeroEffects />
  {:else if brandEditor.level === 'intro-video'}
    <BrandEditorIntroVideo />
  {:else if brandEditor.level === 'header-layout'}
    <BrandEditorHeaderLayout />
  {:else if brandEditor.level === 'fine-tune-colors'}
    <BrandEditorFineTuneColors />
  {:else if brandEditor.level === 'fine-tune-typography'}
    <BrandEditorFineTuneTypography />
  {/if}

  {#snippet footer()}
    <BrandEditorFooter onsave={handleSave} {saving} />
  {/snippet}
</BrandEditorPanel>

<ConfirmDialog
  bind:open={discardDialogOpen}
  title="Discard unsaved changes?"
  description="You have unsaved brand changes. Closing the editor now will discard them."
  confirmText="Discard"
  cancelText="Keep editing"
  variant="destructive"
  onConfirm={confirmDiscard}
/>
