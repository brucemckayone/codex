<!--
  Split auth shell — shader pane on the left, form pane on the right.

  Branding context lives on the layout root (`.org-layout` class +
  `[data-org-brand]` attribute + inline `--brand-*` CSS vars). Both child
  panes inherit the brand context, so the form pane on the right can pick
  up brand fonts and accent colours while the shader pane on the left
  drives the org's preset and palette via ShaderHero's CSS-var lookup.

  The layout collapses to a single column on small viewports — shader as
  a 32vh hero strip on top, form below.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { setContext } from 'svelte';
  import AuthShaderPane from '$lib/components/auth/AuthShaderPane.svelte';
  import { tokenOverridesToCssVars } from '$lib/brand-editor';
  import type { LayoutData } from './$types';

  interface Props {
    data: LayoutData;
    children: Snippet;
  }

  const { data, children }: Props = $props();

  const branding = $derived(data.branding);
  const hasBranding = $derived(!!branding?.brandColors?.primary);

  const brandPrimary = $derived(branding?.brandColors?.primary ?? undefined);
  const brandSecondary = $derived(branding?.brandColors?.secondary ?? undefined);
  const brandAccent = $derived(branding?.brandColors?.accent ?? undefined);
  const brandBackground = $derived(branding?.brandColors?.background ?? undefined);
  const brandFontBody = $derived(branding?.brandFonts?.body ?? undefined);
  const brandFontHeading = $derived(branding?.brandFonts?.heading ?? undefined);
  const brandRadius = $derived.by(() => {
    const v = Number(branding?.brandRadius);
    return Number.isFinite(v) ? `${v}rem` : undefined;
  });
  const brandLogoUrl = $derived(branding?.logoUrl ?? undefined);

  // SSR-render tokenOverrides as inline CSS vars so the shader has its
  // preset/intensity/grain values on first paint — mirrors the org layout
  // pattern at _org/[slug]/+layout.svelte.
  const tokenOverrideStyle = $derived.by(() => {
    const raw = branding?.brandFineTune?.tokenOverrides;
    if (!raw) return undefined;
    let parsed: Record<string, string | null>;
    try {
      parsed = JSON.parse(raw) as Record<string, string | null>;
    } catch {
      return undefined;
    }
    if (!parsed || Object.keys(parsed).length === 0) return undefined;
    const vars = tokenOverridesToCssVars(parsed);
    const entries = Object.entries(vars);
    if (entries.length === 0) return undefined;
    return entries.map(([prop, value]) => `${prop}: ${value}`).join('; ');
  });

  // Expose org name to child auth pages so they can render
  // "Welcome back to {org}" instead of the generic "Welcome back".
  // Getter pattern keeps the value reactive — `branding` changes when the
  // user navigates between auth pages while still inside the (auth) group.
  setContext<{ readonly orgName: string | null }>('auth-branding', {
    get orgName() {
      return branding?.name ?? null;
    },
  });
</script>

<div
  class="auth-layout org-layout"
  data-org-brand={hasBranding ? '' : undefined}
  data-org-bg={brandBackground ? '' : undefined}
  style:--brand-color={brandPrimary}
  style:--brand-secondary={brandSecondary}
  style:--brand-accent={brandAccent}
  style:--brand-bg={brandBackground}
  style:--brand-radius={brandRadius}
  style:--brand-font-body={brandFontBody ? `'${brandFontBody}'` : undefined}
  style:--brand-font-heading={brandFontHeading ? `'${brandFontHeading}'` : undefined}
  style:--brand-shader-logo-url={brandLogoUrl}
  style={tokenOverrideStyle}
>
  <AuthShaderPane {branding} fallbackPreset={data.defaultPreset} />

  <section class="auth-form-pane">
    <div class="auth-form-card">
      {@render children()}
    </div>
  </section>
</div>

<style>
  .auth-layout {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 1fr 1fr;
    background: var(--color-background);
  }

  .auth-form-pane {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-8);
    background: var(--color-surface);
    overflow-y: auto;
  }

  .auth-form-card {
    width: 100%;
    max-width: 26rem;
    display: flex;
    flex-direction: column;
  }

  /* Mobile: stack shader pane above form pane. */
  @media (--below-md) {
    .auth-layout {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }

    .auth-form-pane {
      padding: var(--space-6);
    }
  }
</style>
