<!--
  @component BrandingSettings (Simplified)

  Logo upload + "Edit Brand Live" CTA that opens the floating brand editor.
  Read-only brand summary showing current color swatches, fonts, and shape.
  Fetches branding settings client-side to avoid __data.json round-trips.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import { getBrandingSettings, uploadLogoForm, deleteLogo } from '$lib/remote/branding.remote';
  import { updateOrganizationForm } from '$lib/remote/org.remote';
  import LogoUpload from '$lib/components/studio/LogoUpload.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { Alert, Button, Card, PageHeader } from '$lib/components/ui';

  let { data } = $props();

  const orgId = $derived(data.org?.id);

  // Hero text (org identity) — prefilled from the org layout's public info.
  const orgName = $derived(data.org?.name ?? '');
  const orgDescription = $derived(data.org?.description ?? '');

  // Prime the progressive-enhancement form so a no-JS submit carries the
  // current values, and JS submits pick up edits from the bound inputs.
  $effect(() => {
    updateOrganizationForm.fields.set({
      orgId,
      name: orgName,
      description: orgDescription,
    });
  });

  // Transient "saved" banner for the hero-text form (mirrors General settings).
  let showHeroSaved = $state(false);
  let heroSavedTimeout: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (
      updateOrganizationForm.result?.success &&
      !updateOrganizationForm.pending
    ) {
      showHeroSaved = true;
      if (heroSavedTimeout) clearTimeout(heroSavedTimeout);
      heroSavedTimeout = setTimeout(() => (showHeroSaved = false), 3000);
    }
  });

  onDestroy(() => {
    if (heroSavedTimeout) clearTimeout(heroSavedTimeout);
  });

  // Role guard: admin/owner only. Wait for data.userRole to populate —
  // ssr=false means first render has data.userRole === undefined.
  $effect(() => {
    if (
      data.userRole !== undefined &&
      data.userRole !== 'admin' &&
      data.userRole !== 'owner'
    ) {
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

  <!-- Hero Text (org name + subheading) -->
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.branding_hero_title()}</Card.Title>
      <Card.Description>{m.branding_hero_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if showHeroSaved}
        <Alert variant="success">{m.branding_saved()}</Alert>
      {/if}
      {#if updateOrganizationForm.result && !updateOrganizationForm.result.success}
        <Alert variant="error">
          {updateOrganizationForm.result.error ?? m.branding_error()}
        </Alert>
      {/if}
      <form {...updateOrganizationForm} class="hero-form" novalidate>
        <input type="hidden" name="orgId" value={orgId} />

        <div class="form-field">
          <label class="field-label" for="heroName">
            {m.branding_hero_name_label()}
          </label>
          <input
            type="text"
            id="heroName"
            name="name"
            class="field-input"
            value={orgName}
            maxlength="255"
            required
          />
        </div>

        <div class="form-field">
          <label class="field-label" for="heroSubheading">
            {m.branding_hero_subheading_label()}
          </label>
          <textarea
            id="heroSubheading"
            name="description"
            class="field-input field-textarea"
            rows="3"
            maxlength="5000"
            placeholder={m.branding_hero_subheading_placeholder()}
            value={orgDescription}
          ></textarea>
        </div>

        <div class="form-actions">
          <Button
            type="submit"
            variant="primary"
            loading={updateOrganizationForm.pending > 0}
          >
            {m.branding_save()}
          </Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>

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
              <div class="brand-summary__swatch brand-summary__swatch--bordered" style="background-color: {branding.backgroundColorHex}" title="Background: {branding.backgroundColorHex}"></div>
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

  .hero-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .field-input {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
  }

  .field-textarea {
    resize: vertical;
    min-height: var(--space-16);
    font-family: inherit;
    line-height: var(--leading-normal);
  }

  .field-input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
    border-color: var(--color-border-focus);
  }

  .form-actions {
    display: flex;
    justify-content: flex-start;
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
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-md);
    cursor: default;
  }

  /* Background-colour swatch needs a visible edge against neutral surfaces. */
  .brand-summary__swatch--bordered {
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .brand-summary__value {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
