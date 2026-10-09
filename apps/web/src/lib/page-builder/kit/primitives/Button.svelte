<!--
  @component Button

  A kit call to action — always a link (every CTA navigates). Colours come
  only from the scheme's button tokens, and hover never changes them: moving
  the fill toward the label would drop the label's contrast in the hover state.
  Hover LIFTS instead — a hard offset in Bold, a soft brand-tinted shadow
  elsewhere — which answers the pointer without touching the colours.

  On the canvas the link does not navigate, so a click lands in the label.
-->
<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import type { SectionTypeId } from '../model/ids';
  import type { BlockEdit } from '../model/types';
  import { editAttrs } from './edit';

  interface Props extends Omit<HTMLAnchorAttributes, 'href' | 'type'> {
    href: string;
    label: string;
    /**
     * `secondary` follows the Style (Bold draws it as an underlined link);
     * `outline` is always a bordered button, for a CTA that must hold its own.
     */
    variant?: 'primary' | 'secondary' | 'outline' | 'quiet';
    size?: 'md' | 'lg';
    /** A fuller accessible name, for buttons that share a label. Must contain it. */
    name?: string;
    section: SectionTypeId;
    field?: string;
    edit?: BlockEdit | null;
  }

  const {
    href,
    label,
    variant = 'primary',
    size = 'md',
    name,
    section,
    field,
    edit = null,
    class: className,
    ...rest
  }: Props = $props();

  const labelAttrs = $derived(editAttrs(section, field, edit));

  function stayOnCanvas(event: MouseEvent) {
    event.preventDefault();
  }
</script>

<a
  class="lp-button {className ?? ''}"
  data-variant={variant}
  data-size={size}
  {href}
  aria-label={name}
  onclick={edit ? stayOnCanvas : undefined}
  {...rest}
>
  <span class="lp-button__label" {...labelAttrs}>{label}</span>
</a>

<style>
  .lp-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-block-size: var(--lp-button-height);
    min-inline-size: var(--tap-target-min);
    /* Block padding only for a label that wraps: one line sits inside the
       org's button height (kit.css) at every Style's label size. */
    padding: var(--space-2) var(--lp-button-pad);
    border: var(--border-width-thick) var(--border-style) transparent;
    border-radius: var(--lp-radius-button);
    font-family: var(--lp-font-body);
    font-size: var(--lp-button-size);
    font-weight: var(--lp-button-weight);
    letter-spacing: var(--lp-button-tracking);
    line-height: var(--lp-leading-title);
    text-align: center;
    text-decoration: none;
    transition:
      transform var(--duration-fast) var(--ease-out),
      box-shadow var(--duration-normal) var(--ease-out),
      border-color var(--duration-fast) var(--ease-default);
  }

  .lp-button[data-size='lg'] {
    min-block-size: var(--lp-button-height-lg);
    padding-inline: calc(var(--lp-button-pad) * 1.25);
  }

  .lp-button[data-variant='primary'] {
    background: var(--lp-button-bg);
    border-color: var(--lp-button-bg);
    color: var(--lp-button-ink);
  }

  .lp-button[data-variant='secondary'],
  .lp-button[data-variant='outline'] {
    background: transparent;
    border-color: var(--lp-button-line);
    color: var(--lp-ink);
  }

  .lp-button[data-variant='quiet'],
  :global(.lp[data-lp-style='bold']) .lp-button[data-variant='secondary'] {
    min-inline-size: 0;
    padding-inline: var(--space-1);
    background: transparent;
    border-color: transparent;
    color: var(--lp-ink);
    text-decoration: underline;
    text-decoration-thickness: var(--border-width-thick);
    text-underline-offset: var(--lp-underline-offset);
  }

  @media (hover: hover) {
    .lp-button[data-variant='primary']:hover {
      transform: translateY(calc(-1 * var(--space-0-5)));
      box-shadow: 0 var(--space-3) var(--space-6) calc(-1 * var(--space-3))
        color-mix(in oklab, var(--lp-button-bg) 60%, transparent);
    }

    :global(.lp[data-lp-style='bold']) .lp-button[data-variant='primary']:hover {
      transform: translate(calc(-1 * var(--space-1)), calc(-1 * var(--space-1)));
      box-shadow: var(--space-1) var(--space-1) 0 0 var(--lp-button-line);
    }

    .lp-button[data-variant='secondary']:hover,
    .lp-button[data-variant='outline']:hover {
      border-color: var(--lp-ink);
    }

    .lp-button[data-variant='quiet']:hover,
    :global(.lp[data-lp-style='bold']) .lp-button[data-variant='secondary']:hover {
      border-color: transparent;
      text-decoration-thickness: calc(var(--border-width-thick) * 2);
    }
  }

  .lp-button:active {
    transform: none;
    box-shadow: none;
  }

  .lp-button:focus-visible {
    outline: var(--border-width-thick) solid var(--lp-focus);
    outline-offset: var(--space-1);
  }
</style>
