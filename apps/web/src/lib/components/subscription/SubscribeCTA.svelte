<!--
  @component SubscribeCTA

  Full-bleed membership banner used once on the org landing page (between
  Articles and per-category sections). Wraps `<SubscribeButton>` so logged-in
  subscribers see a "Manage membership" state instead of "Subscribe" — no
  wrong-state flash because SubscribeButton hydrates from the localStorage-
  backed `subscriptionCollection` on mount.

  The banner has an optional ShaderHero backdrop (inherits the org preset if
  set, falls back to `glow` for a soft decorative glow). The gradient veil
  keeps text legible while letting the shader carry the mood.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import SubscribeButton from '$lib/components/subscription/SubscribeButton.svelte';
  import { ShaderHero } from '$lib/components/ui/ShaderHero';
  import type { ShaderPresetId } from '$lib/components/ui/ShaderHero/shader-config';

  interface Props {
    organizationId: string;
    orgName: string;
    isAuthenticated: boolean;
    /** Optional headline override — defaults to "Join {orgName}". */
    headline?: string;
    /** Short subtitle under the headline. */
    tagline?: string;
    /** Value-prop bullets — kept to 3. */
    bullets?: [string, string, string];
    /** Secondary microcopy under the CTA (e.g. "From £9/mo · Cancel anytime"). */
    meta?: string;
    /** Destination for unauthenticated users clicking the CTA. */
    subscribeHref?: string;
  }

  const DEFAULT_BULLETS: [string, string, string] = [
    'Unlimited library access',
    'New releases every week',
    'Support the creators directly',
  ];

  const FALLBACK_PRESET: ShaderPresetId = 'glow';

  const {
    organizationId,
    orgName,
    isAuthenticated,
    headline,
    tagline = 'Everything on the platform, one membership.',
    bullets = DEFAULT_BULLETS,
    meta = 'Cancel anytime',
    subscribeHref = '/pricing',
  }: Props = $props();

  const effectiveHeadline = $derived(headline ?? `Join ${orgName}`);

  let resolvedPreset = $state<ShaderPresetId>(FALLBACK_PRESET);

  onMount(() => {
    if (!browser) return;
    const orgLayout = document.querySelector('.org-layout');
    if (!orgLayout) return;
    const orgPreset = getComputedStyle(orgLayout)
      .getPropertyValue('--brand-shader-preset')
      .trim();
    if (orgPreset && orgPreset !== 'none') {
      resolvedPreset = orgPreset as ShaderPresetId;
    }
  });
</script>

<section class="subscribe-cta" aria-labelledby="subscribe-cta-title">
  <div class="subscribe-cta__backdrop" aria-hidden="true">
    <ShaderHero preset={resolvedPreset} />
    <div class="subscribe-cta__veil"></div>
  </div>

  <div class="subscribe-cta__body">
    <p class="subscribe-cta__eyebrow">Membership</p>

    <h2 class="subscribe-cta__title" id="subscribe-cta-title">
      {effectiveHeadline}
    </h2>

    {#if tagline}
      <p class="subscribe-cta__tagline">{tagline}</p>
    {/if}

    <ul class="subscribe-cta__bullets">
      {#each bullets as bullet, i (i)}
        <li class="subscribe-cta__bullet">
          <span class="subscribe-cta__bullet-dot" aria-hidden="true"></span>
          <span>{bullet}</span>
        </li>
      {/each}
    </ul>

    <div class="subscribe-cta__actions">
      <SubscribeButton
        {organizationId}
        {isAuthenticated}
        {subscribeHref}
        size="lg"
        showBadge={true}
      />
    </div>

    {#if meta}
      <p class="subscribe-cta__meta">{meta}</p>
    {/if}
  </div>
</section>

<style>
  /* ── Section ────────────────────────────────────────────────
     Full-bleed banner. Does not use the parent container's padding
     so the shader reaches edge-to-edge. */
  .subscribe-cta {
    position: relative;
    /* Escape the parent's max-width by breaking out to full viewport
       width. `calc(100vw - scrollbar)` isn't bulletproof on all browsers
       but margin-inline negative works because the parent `.content-area`
       is centered with max-width. */
    width: 100vw;
    margin-inline: calc(50% - 50vw);
    padding-block: calc(var(--space-16) + var(--space-4));
    padding-inline: var(--space-6);
    display: grid;
    place-items: center;
    overflow: hidden;
    isolation: isolate;
    text-align: center;
    /* Banner is a dedicated light-on-dark context — it always has the dark
       radial veil behind it, so text must lean on the `--color-player-*`
       tokens, which are defined at :root as "inverse chrome" (always light
       on dark) and remain org-brand overridable. Using `--color-text-inverse`
       here would regress on dark-mode orgs (it flips to dark and vanishes
       into the veil). */
    color: var(--color-player-text);
  }

  /* ── Backdrop ───────────────────────────────────────────────
     Shader + veil. Always renders so anon + signed-in users get the
     same mood on first paint (SubscribeButton handles the state logic). */
  .subscribe-cta__backdrop {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }

  /* The veil DARKENS the shader (not brightens it). Shaders can be any
     colour — bright yellows, pastels, high-saturation pinks — so the dark
     floor gives a consistent legibility surface for the light text that
     sits above. A radial gradient puts the darkest spot behind the CTA
     column, letting edges fade back into the shader. Uses `hsl(0 0% 0% / α)`
     directly (same pattern as player.css) so the veil stays dark in both
     light- and dark-theme orgs — semantic surface tokens flip with theme
     and would LIGHTEN the shader on dark themes, inverting the intent. */
  .subscribe-cta__veil {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        ellipse 60% 80% at 50% 50%,
        hsl(0 0% 0% / 0.72) 0%,
        hsl(0 0% 0% / 0.55) 60%,
        hsl(0 0% 0% / 0.30) 100%
      );
    backdrop-filter: blur(var(--blur-md));
    -webkit-backdrop-filter: blur(var(--blur-md));
  }

  /* ── Body ───────────────────────────────────────────────────
     Narrow column for readable centered copy. */
  .subscribe-cta__body {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    max-width: calc(var(--space-24) * 7);
    margin-inline: auto;
  }

  .subscribe-cta__eyebrow {
    margin: 0;
    font-family: var(--font-body, var(--font-sans));
    font-size: var(--text-xs);
    font-weight: var(--font-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    /* Lift the brand colour above the dark veil — mix with the player-text
       token so the tint stays visible even on dark-brand orgs. */
    color: color-mix(in srgb, var(--color-interactive) 55%, var(--color-player-text) 45%);
    line-height: var(--leading-tight);
  }

  .subscribe-cta__title {
    margin: 0;
    font-family: var(--font-heading, var(--font-sans));
    font-size: clamp(var(--text-3xl), 4vw, var(--text-4xl));
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tighter);
    color: var(--color-player-text);
  }

  .subscribe-cta__tagline {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    /* Secondary light text — the player-text-secondary token is pre-tuned
       to ~80% opacity white for a clear step below the crisp title. */
    color: var(--color-player-text-secondary);
    max-width: 42ch;
  }

  /* ── Bullets ────────────────────────────────────────────────
     Horizontal inline list on desktop; stacks on mobile. */
  .subscribe-cta__bullets {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-player-text-secondary);
  }

  .subscribe-cta__bullet {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .subscribe-cta__bullet-dot {
    width: var(--space-1-5);
    height: var(--space-1-5);
    /* Lift the brand dot above the dark veil — same treatment as eyebrow. */
    background: color-mix(in srgb, var(--color-interactive) 55%, var(--color-player-text) 45%);
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  /* ── Actions ────────────────────────────────────────────────
     SubscribeButton renders its own styling; this just gives it
     consistent spacing inside the banner. */
  .subscribe-cta__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  .subscribe-cta__meta {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-player-text-muted);
    letter-spacing: var(--tracking-wide);
  }

  /* ── Reveal motion ─────────────────────────────────────────── */

  @media (prefers-reduced-motion: no-preference) {
    .subscribe-cta__body {
      opacity: 0;
      transform: translateY(var(--space-4));
      animation: subscribe-in var(--duration-slower) var(--ease-out) 100ms forwards;
    }
  }

  @keyframes subscribe-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
