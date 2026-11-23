<!--
  @component ReelInkWarning
  The hero colours the Showreel can't carry over film, even at its strongest
  shade (`reelInkWarnings`), for both themes, each named in its own line. It
  reads the brand being edited and draws nothing when every colour reads.
  Shown where the creator can act on it: beside Text over footage (the
  Composition), and atop the Hero colours.
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import { reelInkWarnings } from '$lib/brand-editor/reel-ink-warning';
  import * as m from '$paraglide/messages';

  const warnings = $derived(
    reelInkWarnings({
      background: brandEditor.pending?.backgroundColor,
      backgroundDark: brandEditor.pending?.darkOverrides?.backgroundColor,
      tokenOverrides: brandEditor.pending?.tokenOverrides,
      darkTokenOverrides: brandEditor.pending?.darkTokenOverrides,
    })
  );
</script>

{#if warnings.length > 0}
  <div class="ink-warning" data-ink-warning>
    <strong>{m.branding_hero_reel_ink_warning_title()}</strong>
    {#each warnings as warning (warning.theme)}
      {@const numbers = { ratio: String(warning.ratio), floor: String(warning.floor) }}
      <p data-theme-warning={warning.theme}>
        {warning.theme === 'dark'
          ? m.branding_hero_reel_ink_warning_dark(numbers)
          : m.branding_hero_reel_ink_warning_light(numbers)}
      </p>
    {/each}
    <p>{m.branding_hero_reel_ink_warning_fix()}</p>
  </div>
{/if}

<style>
  .ink-warning {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-status-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-status-warning-surface);
    color: var(--color-status-warning-text);
    font-size: var(--text-xs);
  }

  .ink-warning p {
    margin: 0;
  }
</style>
