<!--
  @component Notice

  An explicit statement where an action would otherwise be — "not open for
  enrolment yet" in place of a buy button. A sales page is never CTA-less AND
  silent (contract §1): when there is nothing to buy, this says so.
-->
<script lang="ts">
  import { ClockIcon } from '$lib/components/ui/Icon';

  interface Props {
    title: string;
    body?: string;
    class?: string;
  }

  const { title, body, class: className }: Props = $props();
</script>

<div class="lp-notice {className ?? ''}">
  <span class="lp-notice__icon" aria-hidden="true"><ClockIcon size={20} /></span>
  <div class="lp-notice__copy">
    <p class="lp-notice__heading">{title}</p>
    {#if body}<p class="lp-notice__body">{body}</p>{/if}
  </div>
</div>

<style>
  /* Placed by its row's alignment; its own lines always read from the start. */
  .lp-notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    max-inline-size: var(--lp-measure-lead);
    text-align: start;
    padding: var(--space-4) var(--space-5);
    border: var(--lp-border) var(--border-style) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink);
  }

  .lp-notice__icon {
    display: inline-flex;
    flex-shrink: 0;
    padding-block-start: var(--space-0-5);
    color: var(--lp-accent);
  }

  .lp-notice__copy {
    display: grid;
    gap: var(--space-1);
  }

  .lp-notice__heading,
  .lp-notice__body {
    margin: 0;
  }

  .lp-notice__heading {
    font-size: var(--lp-size-body);
    font-weight: var(--font-semibold);
    line-height: var(--lp-leading-title);
  }

  .lp-notice__body {
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
    color: var(--lp-ink-soft);
  }
</style>
