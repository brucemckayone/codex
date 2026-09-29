<!--
  @component Sign

  An accordion row's plus, which folds into a minus as its panel opens. Two
  CSS bars rather than an icon, so it can morph. Decorative: the button's
  `aria-expanded` carries the state.
-->
<script lang="ts">
  const { open }: { open: boolean } = $props();
</script>

<span class="lp-sign" data-open={open ? '' : undefined} aria-hidden="true"></span>

<style>
  .lp-sign {
    position: relative;
    flex-shrink: 0;
    inline-size: var(--space-5);
    block-size: var(--space-5);
    color: var(--lp-ink);
  }

  .lp-sign::before,
  .lp-sign::after {
    content: '';
    position: absolute;
    inset-inline: 0;
    inset-block-start: calc(50% - var(--lp-rule) / 2);
    block-size: var(--lp-rule);
    background: currentColor;
  }

  .lp-sign::after {
    transform: rotate(90deg);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .lp-sign[data-open]::after {
    transform: rotate(0deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .lp-sign::after {
      transition: none;
    }
  }
</style>
