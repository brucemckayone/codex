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
  import {
    darkTokenOverridesToCssVars,
    parseDarkColorOverrides,
    tokenOverridesToCssVars,
  } from '$lib/brand-editor';
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
  // Dark-mode colour overrides. org-brand.css gates its dark tokens on
  // `var(--brand-bg-dark, var(--brand-bg, …))`, so WITHOUT these the dark rules
  // still match but fall straight back to the LIGHT brand colours. That is what
  // broke dark mode here: `.auth-form-pane`'s background resolved inside the
  // brand scope and stayed the org's light background, while its text colour is
  // inherited from `html { color: var(--color-text-primary) }` — resolved at
  // :root, where the theme DOES flip. The result was near-white text on a light
  // brand surface. Mirrors _org/[slug]/+layout.svelte; a per-field absence is
  // handled by that same CSS fallback chain.
  const darkColorOverrides = $derived(
    parseDarkColorOverrides(branding?.brandFineTune?.darkModeOverrides)
  );
  const brandPrimaryDark = $derived(darkColorOverrides?.primaryColor ?? undefined);
  const brandSecondaryDark = $derived(
    darkColorOverrides?.secondaryColor ?? undefined
  );
  const brandAccentDark = $derived(darkColorOverrides?.accentColor ?? undefined);
  const brandBackgroundDark = $derived(
    darkColorOverrides?.backgroundColor ?? undefined
  );

  const brandFontBody = $derived(branding?.brandFonts?.body ?? undefined);
  const brandFontHeading = $derived(branding?.brandFonts?.heading ?? undefined);
  const brandRadius = $derived.by(() => {
    const v = Number(branding?.brandRadius);
    return Number.isFinite(v) ? `${v}rem` : undefined;
  });
  // Density was missing for the same reason as the dark colours: the auth shell
  // claims org brand context via [data-org-brand], so it inherits the org-scoped
  // spacing scale re-declaration, but never supplied the multiplier it reads.
  const brandDensity = $derived.by(() => {
    const v = Number(branding?.brandDensity);
    return Number.isFinite(v) ? String(v) : undefined;
  });
  const brandLogoUrl = $derived(branding?.logoUrl ?? undefined);

  // SSR-render tokenOverrides as inline CSS vars so the shader has its
  // preset/intensity/grain values on first paint — mirrors the org layout
  // pattern at _org/[slug]/+layout.svelte.
  const parseOverrides = (raw: string | null | undefined) => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, string | null>;
      return Object.keys(parsed).length > 0 ? parsed : null;
    } catch {
      return null;
    }
  };

  const tokenOverrideStyle = $derived.by(() => {
    // Light AND dark override sets, same as the org layout. The dark set is
    // emitted as `--brand-{key}-dark` / `--color-{key}-dark` so org-brand.css's
    // dark gate can pick it up; emitting only the light set left per-theme
    // fine-tuning inert on the auth shell.
    const lightOverrides = parseOverrides(branding?.brandFineTune?.tokenOverrides);
    const darkOverrides = parseOverrides(
      branding?.brandFineTune?.darkTokenOverrides
    );
    if (!lightOverrides && !darkOverrides) return undefined;
    const vars: Record<string, string> = {};
    if (lightOverrides) Object.assign(vars, tokenOverridesToCssVars(lightOverrides));
    if (darkOverrides) {
      Object.assign(vars, darkTokenOverridesToCssVars(darkOverrides));
    }
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
  style:--brand-color-dark={brandPrimaryDark}
  style:--brand-secondary-dark={brandSecondaryDark}
  style:--brand-accent-dark={brandAccentDark}
  style:--brand-bg-dark={brandBackgroundDark}
  style:--brand-density={brandDensity}
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
    /* Both halves of the contrast pair MUST resolve in the same scope. This
       element carries [data-org-brand]/[data-org-bg], so `background` above
       resolves against the org's brand tokens — but without this line `color`
       was inherited from `html { color: var(--color-text-primary) }`, which
       resolves at :root where the light/dark theme flips independently of the
       brand. On a branded org that produced near-white text on the org's light
       brand surface in dark mode. Pairing them here also keeps orgs that have
       NO dark-mode override readable: their surface legitimately stays light in
       dark mode, and the brand-derived text stays dark to match it.
       Matches .org-layout in _org/[slug]/+layout.svelte. */
    color: var(--color-text);
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
