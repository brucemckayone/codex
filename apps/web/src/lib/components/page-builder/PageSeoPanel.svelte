<!--
  @component PageSeoPanel

  The "SEO & web address" page-mode panel (Codex-2pryk.3.3 · WP-5). Edits the web
  address (slug, real `PageBuilderState.slug`) — persisted by the page save and
  live in the address read-out immediately.

  META TITLE / DESCRIPTION ARE NOT YET PERSISTED. `landing_pages` has no `seo`
  column (the `PageSeo` doc comment claiming "Backs landing_pages.seo jsonb" is
  aspirational), and the save schema is `.strict()`, so `seo` has nowhere to go.
  The fields are therefore DISABLED rather than accepting keystrokes the save
  would discard while the toast said "Page saved" — the same silent swallow the
  pricing panel had before `updateJourneyOffer` landed. Enabling them needs a
  migration + save-schema + service field (bead filed).
-->
<script lang="ts">
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';

  interface Props {
    /** Org domain for the address preview (e.g. `rootwork.space`). */
    orgDomain?: string;
  }

  const { orgDomain = 'your-space' }: Props = $props();

  const pending = $derived(pageBuilder.pending);

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
</script>

{#if pending}
  <div class="panel">
    <header class="panel__head">
      <h2 class="panel__title">SEO &amp; web address</h2>
      <p class="panel__sub">Page-level</p>
    </header>

    <label class="panel__field">
      <span class="panel__label">Web address</span>
      <input
        type="text"
        class="panel__input"
        value={pending.slug}
        oninput={(e) => pageBuilder.updateMeta('slug', slugify(e.currentTarget.value))}
      />
      <span class="panel__hint">{orgDomain} / journeys / <b>{pending.slug || 'draft'}</b></span>
    </label>

    <p class="panel__note">
      Meta title, description and share image land with page metadata. Until then the
      page’s own title is used, so nothing here is silently dropped.
    </p>

    <label class="panel__field">
      <span class="panel__label">Meta title</span>
      <input
        type="text"
        class="panel__input"
        disabled
        placeholder={pending.title}
        value={pending.seo?.title ?? ''}
      />
      <span class="panel__hint">Shown in search results &amp; the browser tab. Unset → the page title.</span>
    </label>

    <label class="panel__field">
      <span class="panel__label">Meta description</span>
      <textarea
        class="panel__input panel__input--area"
        rows="3"
        disabled
        value={pending.seo?.description ?? ''}
      ></textarea>
    </label>

    <p class="panel__group">Share image</p>
    <div class="panel__media">
      <span class="panel__media-thumb" aria-hidden="true">🖼</span>
      <span class="panel__media-copy">
        Social preview
        <small>1200×630 · media library soon</small>
      </span>
    </div>
  </div>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .panel__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .panel__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .panel__sub {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .panel__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .panel__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .panel__input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    transition: var(--transition-colors);
  }

  .panel__input--area {
    resize: vertical;
    line-height: var(--leading-normal);
  }

  .panel__input:disabled {
    background-color: var(--color-surface-secondary);
    color: var(--color-text-muted);
    cursor: not-allowed;
  }

  .panel__note {
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-muted);
  }

  .panel__input:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
    box-shadow: var(--shadow-focus-ring);
  }

  .panel__hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
  }

  .panel__hint b {
    color: var(--color-text-secondary);
  }

  .panel__group {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .panel__media {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .panel__media-thumb {
    display: grid;
    place-items: center;
    width: var(--space-12);
    height: var(--space-8);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
  }

  .panel__media-copy {
    display: flex;
    flex-direction: column;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .panel__media-copy small {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
</style>
