<!--
  @component ContentGone

  What an old link to a removed piece shows (Codex-a6ofh.6.7, mockup LN9b):
  the detail pages' 410. Never the piece's title, so a takedown does not show
  what was taken down. The line about the owners' email is only for a piece
  that left after its 30 days' notice (owner, 2026-11-24); a takedown, or a
  piece deleted with no owners, gets the heading alone.
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { LibraryIcon } from '$lib/components/ui/Icon';
  import { buildPlatformUrl } from '$lib/utils/subdomain';

  const libraryUrl = $derived(buildPlatformUrl(page.url, '/library'));
  const leftWithNotice = $derived(page.error?.leftWithNotice === true);
</script>

<svelte:head>
  <title>{m.content_gone_title()}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="content-gone" role="alert" aria-live="polite">
  <div class="content-gone__card">
    <h1 class="content-gone__title">{m.content_gone_title()}</h1>
    {#if leftWithNotice}
      <p class="content-gone__notice">{m.content_gone_notice()}</p>
    {/if}
    <a href={libraryUrl} class="content-gone__action">
      <LibraryIcon size={16} />
      {m.content_gone_library()}
    </a>
  </div>
</div>

<style>
  .content-gone {
    min-height: 60vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }

  .content-gone__card {
    width: 100%;
    max-width: 480px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }

  /* No colour of its own: on an org page the brand's heading colour owns
     every title (org-brand.css), so a colour here would only tie with it and
     win or lose by stylesheet order. Owner, 2026-11-25. */
  .content-gone__title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
  }

  .content-gone__notice {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
  }

  .content-gone__action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    text-decoration: none;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    transition: var(--transition-colors);
  }

  .content-gone__action:hover {
    background-color: var(--color-surface-secondary);
  }

  .content-gone__action:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
