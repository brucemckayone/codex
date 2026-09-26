<!--
  @component Connector

  The drawn line from a before to its after: a rule with a chevron head, never
  an arrow glyph in the text. `auto` runs across while the section is wide and
  downward on a phone, where each pair stacks.
-->
<script lang="ts">
  interface Props {
    direction?: 'across' | 'down' | 'auto';
  }

  const { direction = 'across' }: Props = $props();
</script>

<span class="tf-link" data-direction={direction} aria-hidden="true"></span>

<style>
  .tf-link {
    position: relative;
    align-self: center;
    min-inline-size: var(--space-8);
    block-size: var(--border-width-thick);
    background: var(--lp-accent);
  }

  .tf-link::after {
    content: '';
    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: 0;
    inline-size: var(--space-2-5);
    block-size: var(--space-2-5);
    border-block-end: var(--border-width-thick) var(--border-style) var(--lp-accent);
    border-inline-end: var(--border-width-thick) var(--border-style) var(--lp-accent);
    transform: translateY(-50%) rotate(-45deg);
  }

  .tf-link[data-direction='down'] {
    align-self: auto;
    justify-self: start;
    min-inline-size: 0;
    inline-size: var(--border-width-thick);
    block-size: var(--space-10);
    margin-inline-start: var(--space-2);
  }

  .tf-link[data-direction='down']::after {
    inset-block: auto 0;
    inset-inline: 50% auto;
    transform: translateX(-50%) rotate(45deg);
  }

  @container (width < 44rem) {
    .tf-link[data-direction='auto'] {
      align-self: auto;
      justify-self: start;
      min-inline-size: 0;
      inline-size: var(--border-width-thick);
      block-size: var(--space-6);
      margin-inline-start: var(--space-2);
    }

    .tf-link[data-direction='auto']::after {
      inset-block: auto 0;
      inset-inline: 50% auto;
      transform: translateX(-50%) rotate(45deg);
    }
  }
</style>
