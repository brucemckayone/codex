<!--
  @component ContentListCommandBar

  Sticky command bar for the Studio content list, as the media library's:
  the breadcrumb (Studio / Content) and the page's actions (Categories, the
  New menu). The count is the page header's, and search, status, filters,
  sort and view live in ContentListToolbar below it (Codex-a6ofh.3.1).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    actions: Snippet;
  }

  const { actions }: Props = $props();
</script>

<div class="command-bar" role="toolbar" aria-label={m.studio_content_list_command_bar_label()}>
  <a href="/studio" class="breadcrumb">
    <span class="breadcrumb-root">{m.media_breadcrumb_root()}</span>
    <span class="breadcrumb-sep" aria-hidden="true">/</span>
    <span class="breadcrumb-leaf">{m.studio_content_title()}</span>
  </a>

  <div class="bar-actions">
    {@render actions()}
  </div>
</div>

<style>
  .command-bar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    background-color: color-mix(in srgb, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-2xl));
    -webkit-backdrop-filter: blur(var(--blur-2xl));
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: 0 var(--space-1) var(--space-4)
      color-mix(in srgb, var(--color-text) 6%, transparent);
  }

  @media (--below-lg) {
    .command-bar {
      padding: var(--space-3) var(--space-4);
    }
  }

  .breadcrumb {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    text-decoration: none;
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    min-width: 0;
    transition: var(--transition-colors);
  }

  .breadcrumb:hover {
    color: var(--color-link);
  }

  .breadcrumb:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .breadcrumb-root {
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .breadcrumb-sep {
    color: var(--color-text-muted);
    font-weight: var(--font-normal);
  }

  .breadcrumb-leaf {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .bar-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }
</style>
