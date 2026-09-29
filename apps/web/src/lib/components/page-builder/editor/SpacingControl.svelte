<!--
  @component SpacingControl

  Small · Medium · Large — how much room the section's band leaves above and
  below its content. It always shows the RESOLVED size (a compact layout sits
  small until the creator picks otherwise), so the pressed button is what
  the canvas shows. Each button draws its size.
-->
<script lang="ts">
  import { type SectionSpacingId, SPACING_OPTIONS } from '$lib/page-builder/kit';
  import * as m from '$paraglide/messages';

  interface Props {
    value: SectionSpacingId;
    /** True when the creator picked `value`. */
    chosen: boolean;
    onChoose: (spacing: SectionSpacingId) => void;
    onReset: () => void;
  }

  const { value, chosen, onChoose, onReset }: Props = $props();

  const label = $derived(SPACING_OPTIONS.find((option) => option.id === value)?.label ?? value);
</script>

<div class="spacing">
  <div class="spacing__options" role="group" aria-label={m.studio_page_editor_spacing_title()}>
    {#each SPACING_OPTIONS as option (option.id)}
      <button
        type="button"
        class="spacing__option"
        data-spacing={option.id}
        aria-pressed={value === option.id}
        onclick={() => onChoose(option.id)}
      >
        <span class="spacing__glyph" aria-hidden="true"><span></span></span>
        {option.label}
      </button>
    {/each}
  </div>
  {#if chosen}
    <button type="button" class="spacing__reset" onclick={onReset}>
      {m.studio_page_editor_spacing_reset()}
    </button>
  {:else}
    <p class="spacing__note">{m.studio_page_editor_spacing_default({ size: label })}</p>
  {/if}
</div>

<style>
  .spacing {
    display: grid;
    gap: var(--space-2);
  }

  .spacing__options {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  /* A fixed glyph row, so the labels line up whatever size each glyph draws. */
  .spacing__option {
    display: grid;
    grid-template-rows: var(--space-6) auto;
    place-items: center;
    gap: var(--space-1);
    min-block-size: var(--tap-target-min);
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .spacing__option:hover {
    color: var(--color-text);
  }

  .spacing__option[aria-pressed='true'] {
    background: var(--color-surface);
    color: var(--color-text);
    font-weight: var(--font-medium);
    box-shadow: var(--shadow-xs);
  }

  .spacing__option:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  /* A band with its content bar: the band's padding grows with the size. */
  .spacing__glyph {
    --_pad: var(--space-1);
    display: grid;
    inline-size: var(--space-8);
    padding-block: var(--_pad);
    padding-inline: var(--space-1);
    border: var(--border-width) var(--border-style) currentColor;
    border-radius: var(--radius-xs);
  }

  .spacing__glyph span {
    block-size: var(--space-1);
    border-radius: var(--radius-full);
    background: currentColor;
  }

  [data-spacing='compact'] .spacing__glyph {
    --_pad: var(--space-0-5);
  }

  [data-spacing='spacious'] .spacing__glyph {
    --_pad: var(--space-2);
  }

  .spacing__note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .spacing__reset {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
    cursor: pointer;
  }

  .spacing__reset:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
    border-radius: var(--radius-xs);
  }
</style>
