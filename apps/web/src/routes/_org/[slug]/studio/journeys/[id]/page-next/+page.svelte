<!--
  @component Page editor route (WP-7b)

  Thin by design: it creates the editor session for this page and renders
  the shell, or the load's other three states. Everything else lives in
  `$lib/components/page-builder/editor`.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { createBuilderSession } from '$lib/components/page-builder/editor/builder-session.svelte';
  import BuilderShell from '$lib/components/page-builder/editor/BuilderShell.svelte';
  import * as m from '$paraglide/messages';

  const { data } = $props();

  const session = createBuilderSession({ pageId: () => page.params.id ?? '' });
  const orgName = $derived(data.org?.name ?? 'Studio');
  const orgDomain = $derived(data.org?.slug ?? 'your-space');
</script>

<svelte:head>
  <title>{m.studio_page_editor_title()} | {orgName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if session.load === 'ready'}
  <BuilderShell {session} {orgDomain} />
{:else if session.load === 'error'}
  <div class="state" role="alert" data-studio-fullbleed>
    <p class="state__title">{m.studio_builder_error_title()}</p>
    <p class="state__body">{session.loadError}</p>
    <div class="state__actions">
      <button type="button" class="state__button" onclick={() => session.reload()}>
        {m.studio_builder_error_retry()}
      </button>
      <a class="state__link" href="/studio/journeys">{m.studio_builder_all_portals()}</a>
    </div>
  </div>
{:else if session.load === 'missing'}
  <div class="state" data-studio-fullbleed>
    <p class="state__title">{m.studio_builder_missing_title()}</p>
    <p class="state__body">{m.studio_builder_missing_body()}</p>
    <div class="state__actions">
      <a class="state__link" href="/studio/journeys">{m.studio_builder_all_portals()}</a>
    </div>
  </div>
{:else}
  <div class="state" aria-busy="true" data-studio-fullbleed>
    <p class="state__body">{m.studio_builder_loading()}</p>
  </div>
{/if}

<style>
  .state {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-3);
    min-block-size: 100dvh;
    padding: var(--space-8);
    text-align: center;
    background: var(--color-background);
    color: var(--color-text);
  }

  .state__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
  }

  .state__body {
    margin: 0;
    max-inline-size: 42ch;
    color: var(--color-text-secondary);
  }

  .state__actions {
    display: flex;
    gap: var(--space-3);
    margin-block-start: var(--space-2);
  }

  .state__button,
  .state__link {
    padding: var(--space-2) var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    text-decoration: none;
    cursor: pointer;
  }

  .state__button:focus-visible,
  .state__link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }
</style>
