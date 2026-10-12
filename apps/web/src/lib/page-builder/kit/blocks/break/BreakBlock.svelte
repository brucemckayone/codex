<!--
  @component BreakBlock

  A pause between sections (03 X64): space, and nothing else. Its height is
  exactly one of the page's rhythm steps, Small, Medium or Large (the
  section's spacing; a new Break stores none and follows the page), because
  the band around it gives it no padding of its own (`kit.css`).

  It never has a colour: it takes the ground of the section above
  (`joinSimpleSections`), so it can never be an empty stripe.

  MARK. Off by default. On, the Style draws its own pause in the middle, in
  the section's mark ink (its rules live with each Style, `style-*.css`):
  Studio a short hand-drawn underline, Bold its slab, Quiet its hairline,
  Poster a thick printed rule, Soft three pebbles and Cinematic a hairline
  that fades out at both ends. Clean and Path have none (the inspector hides
  the switch), so a stored mark draws nothing there. A marked Break replaces
  the Style's own separator at that joint.

  On the canvas a dashed outline and a chip say what it is; visitors see only
  the space.
-->
<script lang="ts">
  import { SPACING_OPTIONS } from '../../model/styles';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import { breakChip, breakDefinition } from './definition';

  const { props, section, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(breakDefinition.coerce(props));
  const size = $derived(
    SPACING_OPTIONS.find((option) => option.id === section.spacing)?.label ?? 'Medium'
  );
</script>

<div class="lp-break" data-mark={content.mark ? '' : undefined} data-lp-editing={edit ? '' : undefined}>
  {#if content.mark}
    <span
      class="lp-break__mark"
      aria-hidden="true"
      data-lp-draw={page.style === 'studio' ? '' : undefined}
    ></span>
  {/if}
  {#if edit}
    <p class="lp-break__chip" data-lp-edit-only>{breakChip(size)}</p>
  {/if}
</div>

<style>
  .lp-break {
    position: relative;
    display: grid;
    place-items: center;
    block-size: var(--lp-pad);
  }

  .lp-break[data-lp-editing] {
    outline: var(--border-width) dashed var(--lp-line);
    outline-offset: calc(-1 * var(--border-width));
  }

  .lp-break__chip {
    position: absolute;
    inset-block-start: var(--space-2);
    inset-inline-start: var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--lp-panel);
    color: var(--lp-ink-soft);
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-title);
    pointer-events: none;
  }
</style>
