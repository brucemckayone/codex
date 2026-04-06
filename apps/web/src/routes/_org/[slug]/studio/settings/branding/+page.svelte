<!--
  @component BrandingSettings (Simplified)

  Logo upload + "Edit Brand Live" CTA that opens the floating brand editor.
  Read-only brand summary showing current color swatches, fonts, and shape.
  Fetches branding settings client-side to avoid __data.json round-trips.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import { getBrandingSettings, uploadLogoForm, deleteLogo } from '$lib/remote/branding.remote';
  import LogoUpload from '$lib/components/studio/LogoUpload.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { Button, Card, PageHeader } from '$lib/components/ui';

  let { data } = $props();

  const orgId = $derived(data.org.id);

  // Role guard: admin/owner only
  $effect(() => {
    if (data.userRole !== 'admin' && data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isAuthorized = $derived(data.userRole === 'admin' || data.userRole === 'owner');

  const brandingQuery = $derived(
    isAuthorized ? getBrandingSettings(orgId) : null
  );

  const branding = $derived(brandingQuery?.current ?? {
    logoUrl: null,
    primaryColorHex: '#C24129',
    secondaryColorHex: null,
    accentColorHex: null,
    backgroundColorHex: null,
    fontBody: null,
    fontHeading: null,
    radiusValue: 0.5,
    densityValue: 1,
  });

  // Optimistic logo URL override
  let optimisticLogoUrl = $state<string | null | undefined>(undefined);
  const effectiveLogoUrl = $derived(
    optimisticLogoUrl !== undefined ? (optimisticLogoUrl || null) : branding.logoUrl
  );

  function handleEditLive() {
    goto('/?brandEditor=true');
  }

  async function handleDeleteLogo() {
    try {
      await deleteLogo(orgId);
      optimisticLogoUrl = null;
      toast.success('Logo deleted');
    } catch {
      toast.error('Failed to delete logo');
    }
  }
</script>

<svelte:head>
  <title>{m.branding_title()} | {data.org?.name ?? 'Studio'}</title>
</svelte:head>

{#if !isAuthorized}
  <!-- Redirecting... -->
{:else if brandingQuery?.loading}
<div class="branding-page">
  <PageHeader title={m.branding_title()} description={m.branding_description()} />
  <div class="loading-state">
    <p>Loading branding settings...</p>
  </div>
</div>
{:else}
<div class="branding-page">
  <PageHeader title={m.branding_title()} description={m.branding_description()}>
    {#snippet actions()}
      <Button variant="primary" onclick={handleEditLive}>
        Edit Brand Live
      </Button>
    {/snippet}
  </PageHeader>

  <!-- Logo Upload -->
  <Card.Root>
    <Card.Header>
      <Card.Title>Logo</Card.Title>
      <Card.Description>Your organization's logo appears in the header and throughout your space.</Card.Description>
    </Card.Header>
    <Card.Content>
      <LogoUpload
        logoUrl={effectiveLogoUrl}
        {uploadLogoForm}
        {orgId}
        ondelete={handleDeleteLogo}
        onupload={(url) => { optimisticLogoUrl = url; }}
      />
    </Card.Content>
  </Card.Root>

  <!-- Brand Summary (read-only) -->
  <Card.Root>
    <Card.Header>
      <Card.Title>Current Brand</Card.Title>
      <Card.Description>Use "Edit Brand Live" to customize your brand while seeing changes in real-time.</Card.Description>
    </Card.Header>
    <Card.Content>
      <div class="brand-summary">
        <div class="brand-summary__section">
          <span class="brand-summary__label">Colors</span>
          <div class="brand-summary__swatches">
            <div class="brand-summary__swatch" style="background-color: {branding.primaryColorHex}" title="Primary: {branding.primaryColorHex}"></div>
            {#if branding.secondaryColorHex}
              <div class="brand-summary__swatch" style="background-color: {branding.secondaryColorHex}" title="Secondary: {branding.secondaryColorHex}"></div>
            {/if}
            {#if branding.accentColorHex}
              <div class="brand-summary__swatch" style="background-color: {branding.accentColorHex}" title="Accent: {branding.accentColorHex}"></div>
            {/if}
            {#if branding.backgroundColorHex}
              <div class="brand-summary__swatch" style="background-color: {branding.backgroundColorHex}; border: 1px solid var(--color-border)" title="Background: {branding.backgroundColorHex}"></div>
            {/if}
          </div>
        </div>

        <div class="brand-summary__section">
          <span class="brand-summary__label">Typography</span>
          <span class="brand-summary__value">
            {branding.fontBody || 'Default'} / {branding.fontHeading || 'Default'}
          </span>
        </div>

        <div class="brand-summary__section">
          <span class="brand-summary__label">Shape</span>
          <span class="brand-summary__value">
            Radius: {branding.radiusValue}rem &middot; Density: {branding.densityValue}x
          </span>
        </div>
      </div>
    </Card.Content>
  </Card.Root>
</div>
{/if}

<style>
  .branding-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 800px;
  }

  .loading-state {
    display: flex;
    justify-content: center;
    padding: var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .brand-summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .brand-summary__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .brand-summary__label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .brand-summary__swatches {
    display: flex;
    gap: var(--space-2);
  }

  .brand-summary__swatch {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    cursor: default;
  }

  .brand-summary__value {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
