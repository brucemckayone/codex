<!--
  @component ContentStatus

  A piece's status in the content list (Codex-a6ofh.3.1): a dot and its
  words, as `listStatus` says it. Once live and not on sale it is "Off
  sale", muted, never a draft (owner, 2026-11-05). The dot is decoration;
  the words carry the state.
-->
<script lang="ts">
  import type { PublicationState } from '@codex/constants';
  import { listStatus } from './list-status';

  interface Props {
    piece: PublicationState;
  }

  const { piece }: Props = $props();

  const shown = $derived(listStatus(piece));
</script>

<span class="content-status" data-status={shown.variant}>
  <span class="status-dot" aria-hidden="true"></span>
  {shown.label}
</span>

<style>
  .content-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .status-dot {
    width: var(--space-2);
    height: var(--space-2);
    flex-shrink: 0;
    border-radius: var(--radius-full);
  }

  .content-status[data-status='published'] .status-dot {
    background-color: var(--color-success);
  }

  .content-status[data-status='draft'] .status-dot {
    background-color: var(--color-warning);
  }

  .content-status[data-status='off-sale'] .status-dot {
    background-color: var(--color-text-muted);
  }
</style>
