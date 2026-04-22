<!--
  @component FormSection

  Standard card wrapper for ContentForm sections. Provides the eyebrow +
  title + optional description header, and a body slot. The section `id`
  is the anchor target for the left rail.

  @prop id           Anchor id (matches RailSection.id)
  @prop ordinal      Visible numeric prefix shown as "eyebrow" (e.g. "01")
  @prop title        Section heading
  @prop description  Optional subtitle
  @prop optional     If true, renders an "Optional" flag next to the title
  @prop children     Body snippet
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    id: string;
    ordinal: string;
    title: string;
    description?: string;
    optional?: boolean;
    children: Snippet;
  }

  const { id, ordinal, title, description, optional = false, children }: Props = $props();
</script>

<section {id} class="form-section" aria-labelledby="{id}-title" data-optional={optional || undefined}>
  <header class="section-header">
    <span class="section-ordinal" aria-hidden="true">{ordinal}</span>
    <h2 id="{id}-title" class="section-title">
      {title}
      {#if optional}
        <span class="optional-flag">Optional</span>
      {/if}
    </h2>
    {#if description}
      <p class="section-description">{description}</p>
    {/if}
  </header>

  <div class="section-body">
    {@render children()}
  </div>
</section>

<style>
  .form-section {
    /* Offset scroll anchor so the sticky command bar doesn't cover
       the header when scroll-into-view lands here. --cf-bar-height is
       measured at runtime by ContentForm; falls back to the previous
       token-derived offset. */
    scroll-margin-top: calc(var(--cf-bar-height, calc(var(--space-16) + var(--space-6))) + var(--space-4));
    padding: var(--space-6) var(--space-6) var(--space-7);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  @media (--breakpoint-lg) {
    .form-section {
      padding: var(--space-7) var(--space-8);
    }
  }

  .section-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      'ordinal title'
      'ordinal description';
    column-gap: var(--space-4);
    row-gap: var(--space-1);
    margin-bottom: var(--space-5);
    padding-bottom: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .section-ordinal {
    grid-area: ordinal;
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
    line-height: var(--leading-none);
    padding-top: var(--space-1-5);
    /* Editorial detail: small rule between ordinal and title */
    border-right: var(--border-width) var(--border-style) var(--color-border);
    padding-right: var(--space-4);
    margin-right: calc(-1 * var(--space-4));
    align-self: stretch;
    min-width: var(--space-8);
  }

  .section-title {
    grid-area: title;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-snug);
  }

  .optional-flag {
    display: inline-block;
    margin-left: var(--space-2);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
    vertical-align: middle;
  }

  .section-description {
    grid-area: description;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .section-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
</style>
