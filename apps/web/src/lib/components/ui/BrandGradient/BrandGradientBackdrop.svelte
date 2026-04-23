<!--
  @component BrandGradientBackdrop

  Atmospheric CSS gradient for promotional surfaces (Spotlight card,
  SubscribeCTA banner). Replaces per-surface ShaderHero WebGL canvases
  — three concurrent shaders on org landing were burning GPU fill-rate.
  Renders layered radial glows tinted from --color-interactive. Pure CSS,
  tokens only, reduced-motion respected.

  Variants:
  - 'aurora'    — two crossing glows that drift in counter-direction.
                  Wider surfaces (full-bleed banner).
  - 'spotlight' — softer single glow with secondary halo.
                  Contained cards (Spotlight).

  Pair with your own darkening veil + content layer — this is a passive
  fill (inset:0, pointer-events:none, aria-hidden).
-->
<script lang="ts">
  interface Props {
    variant?: 'aurora' | 'spotlight';
    /** Optional class forwarding (R13). */
    class?: string;
  }

  const { variant = 'aurora', class: className }: Props = $props();
</script>

<div
  class="brand-gradient {className ?? ''}"
  data-variant={variant}
  aria-hidden="true"
></div>

<style>
  .brand-gradient {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    isolation: isolate;
    /* Dark floor — same explicit-neutral pattern as player.css veils.
       Semantic --color-surface would flip on light-theme orgs and fight
       the dark veils these backdrops sit under. */
    background: hsl(0 0% 0% / 1);
  }

  .brand-gradient::before,
  .brand-gradient::after {
    content: '';
    position: absolute;
    inset: -15%;
    filter: blur(var(--blur-2xl));
  }

  /* Aurora — two crossing glows for wide banners. */
  .brand-gradient[data-variant='aurora']::before {
    background: radial-gradient(
      ellipse 55% 65% at 30% 40%,
      color-mix(in srgb, var(--color-interactive) 60%, transparent) 0%,
      color-mix(in srgb, var(--color-interactive) 28%, transparent) 35%,
      transparent 70%
    );
  }

  .brand-gradient[data-variant='aurora']::after {
    background: radial-gradient(
      ellipse 50% 60% at 70% 60%,
      color-mix(in srgb, var(--color-interactive) 50%, transparent) 0%,
      color-mix(in srgb, var(--color-interactive) 20%, transparent) 40%,
      transparent 75%
    );
  }

  /* Spotlight — softer single glow + small halo for contained cards. */
  .brand-gradient[data-variant='spotlight']::before {
    background: radial-gradient(
      ellipse 70% 80% at 65% 50%,
      color-mix(in srgb, var(--color-interactive) 55%, transparent) 0%,
      color-mix(in srgb, var(--color-interactive) 22%, transparent) 45%,
      transparent 75%
    );
  }

  .brand-gradient[data-variant='spotlight']::after {
    background: radial-gradient(
      ellipse 45% 55% at 25% 70%,
      color-mix(in srgb, var(--color-interactive) 35%, transparent) 0%,
      color-mix(in srgb, var(--color-interactive) 12%, transparent) 50%,
      transparent 80%
    );
  }

  /* Ambient drift on transform + opacity only — compositor-safe, no
     layout/paint thrash. Long cycle reads atmospheric, not hypnotic. */
  @media (prefers-reduced-motion: no-preference) {
    .brand-gradient::before {
      animation: brand-gradient-drift-a 32s var(--ease-smooth) infinite;
    }
    .brand-gradient::after {
      animation: brand-gradient-drift-b 28s var(--ease-smooth) infinite;
    }
  }

  @keyframes brand-gradient-drift-a {
    0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.9; }
    50%      { transform: translate3d(4%, -3%, 0) scale(1.08); opacity: 1; }
  }

  @keyframes brand-gradient-drift-b {
    0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.85; }
    50%      { transform: translate3d(-5%, 3%, 0) scale(1.1); opacity: 1; }
  }
</style>
