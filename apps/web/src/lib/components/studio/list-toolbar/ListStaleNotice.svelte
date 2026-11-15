<!--
  @component ListStaleNotice

  Over rows a studio list could not read again (a refresh after a change
  failed): these rows are the last that arrived, with a way to read them
  again. The media library's and the content list's (Codex-a6ofh.3.5), so
  both read alike.

  @prop words       What happened, and whether a try already failed
  @prop retryLabel  The button's words
  @prop retrying    A read again is under way: the button waits
  @prop onRetry     Read them again
-->
<script lang="ts">
  import { Button } from '$lib/components/ui';

  interface Props {
    words: string;
    retryLabel: string;
    retrying: boolean;
    onRetry: () => void;
  }

  const { words, retryLabel, retrying, onRetry }: Props = $props();
</script>

<div class="stale" role="alert">
  <p class="stale-text">{words}</p>
  <Button size="sm" variant="secondary" loading={retrying} disabled={retrying} onclick={onRetry}>
    {retryLabel}
  </Button>
</div>

<style>
  .stale {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-status-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-status-warning-surface);
  }

  .stale-text {
    flex: 1;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }
</style>
