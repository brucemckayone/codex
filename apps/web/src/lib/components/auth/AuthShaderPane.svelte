<!--
  @component AuthShaderPane

  The shader-backed left half of the split auth shell. It renders ShaderHero
  plus a logo + name + description overlay. It deliberately does NOT carry
  the `.org-layout` class or brand CSS vars — those live on the auth layout
  root, so both panes (shader on the left, form on the right) share the
  same brand context.

  When `branding` is null (visitor on the platform domain), the pane shows
  a Codex wordmark instead of an org overlay and ShaderHero falls back to
  the platform default preset. Visual treatment stays identical so the
  shape of the page never changes between org and platform contexts.

  Text on the shader uses fixed white literals (`hsl(0 0% 100%)`) rather
  than `--color-player-*` tokens — those are org-overridable and can
  collapse to the brand colour itself, leaving overlay text invisible
  against a same-coloured shader.
-->
<script lang="ts">
  import { ShaderHero } from '$lib/components/ui/ShaderHero';
  import type { ShaderPresetId } from '$lib/components/ui/ShaderHero/shader-config';
  import type { OrganizationData } from '$lib/types';
  import * as m from '$paraglide/messages';

  interface Props {
    branding: OrganizationData | null;
    fallbackPreset: ShaderPresetId;
  }

  const { branding, fallbackPreset }: Props = $props();
</script>

<aside class="auth-shader-pane">
  <ShaderHero
    class="auth-shader-canvas"
    preset={branding ? undefined : fallbackPreset}
  />

  <div class="auth-shader-overlay">
    <div class="auth-shader-content">
      {#if branding}
        {#if branding.logoUrl}
          <img
            class="auth-shader-logo"
            src={branding.logoUrl}
            alt={branding.name}
            loading="eager"
            decoding="async"
          />
        {:else}
          <p class="auth-shader-wordmark">{branding.name}</p>
        {/if}
        {#if branding.description}
          <p class="auth-shader-description">{branding.description}</p>
        {/if}
      {:else}
        <p class="auth-shader-wordmark auth-shader-wordmark--platform">codex</p>
        <p class="auth-shader-description">{m.footer_powered_by_platform()}</p>
      {/if}
    </div>
  </div>
</aside>

<style>
  .auth-shader-pane {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    min-height: 100%;
    width: 100%;
    background: var(--color-background);
  }

  :global(.auth-shader-canvas) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
  }

  .auth-shader-overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: flex-end;
    padding: var(--space-10);
    background: linear-gradient(
      to top,
      hsl(0 0% 0% / 0.55) 0%,
      hsl(0 0% 0% / 0.25) 35%,
      hsl(0 0% 0% / 0) 70%
    );
    pointer-events: none;
  }

  .auth-shader-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 32rem;
    pointer-events: auto;
  }

  .auth-shader-logo {
    display: block;
    max-width: 14rem;
    max-height: 5rem;
    width: auto;
    height: auto;
    object-fit: contain;
  }

  .auth-shader-wordmark {
    font-family: var(--brand-font-heading, var(--font-heading));
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: hsl(0 0% 100%);
    margin: 0;
    letter-spacing: var(--tracking-tight);
  }

  .auth-shader-wordmark--platform {
    text-transform: lowercase;
  }

  .auth-shader-description {
    font-family: var(--brand-font-body, var(--font-sans));
    font-size: var(--text-base);
    color: hsl(0 0% 100% / 0.85);
    margin: 0;
    line-height: var(--leading-relaxed);
  }

  @media (--below-md) {
    .auth-shader-pane {
      min-height: 32vh;
      height: 32vh;
    }

    .auth-shader-overlay {
      padding: var(--space-6);
    }

    .auth-shader-logo {
      max-width: 10rem;
      max-height: 3.5rem;
    }

    .auth-shader-wordmark {
      font-size: var(--text-2xl);
    }

    .auth-shader-description {
      font-size: var(--text-sm);
    }
  }
</style>
