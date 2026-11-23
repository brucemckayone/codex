<!--
  @component SettleNoticeAlert

  A settle dialog's answer, shown on the page that opened it (`SettleNotice`):
  the lead in bold, the text, and a link when the answer names where to go
  next (a failed refund its chargeback decides is settled on the charge page,
  owner D66; mockup docs/handover/phase3-sources/pause-trials/
  support-short-loss.html, B1, B2). The one place a notice is rendered, so a
  page can't drop its link.

  @prop {SettleNotice} notice
  Every other attribute (a data hook, a test id) goes on the Alert.
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { Alert } from '$lib/components/ui';
  import type { SettleNotice } from './settle-notice';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    notice: SettleNotice;
  }

  const { notice, ...rest }: Props = $props();
</script>

<Alert variant={notice.variant} tabindex={-1} {...rest}>
  <!-- The space sits outside the block: Svelte trims one at a block's end,
       which ran the lead into the text. -->
  <p>{#if notice.lead}<strong>{notice.lead}</strong>{/if} {notice.text}</p>
  {#if notice.link}
    <p class="notice-actions">
      <a class="notice-link" href={notice.link.href} data-testid="settle-notice-link">
        {notice.link.label}
      </a>
    </p>
  {/if}
</Alert>

<style>
  .notice-actions {
    margin-top: var(--space-3);
  }

  .notice-link {
    color: inherit;
    font-weight: var(--font-medium);
    text-decoration: none;
    border-bottom: var(--border-width) var(--border-style) currentColor;
    transition: var(--transition-colors);
  }

  .notice-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }
</style>
