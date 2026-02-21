<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';

  const { data }: { data: PageData } = $props();

  const checkmarkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
</script>

<svelte:head>
  <title>{m.commerce_purchase_complete()} | Codex</title>
  <meta name="description" content={m.commerce_content_ready()} />
</svelte:head>

<div class="success-page">
  <div class="success-card">
    <div class="success-icon" aria-hidden="true">
      {@html checkmarkIcon}
    </div>

    <h1 class="success-title">{m.commerce_purchase_complete()}</h1>
    <p class="success-description">{m.commerce_content_ready()}</p>

    {#if data.content}
      <div class="content-preview">
        <div class="content-thumb">
          {#if data.content.mediaItem?.thumbnailUrl}
            <img src={data.content.mediaItem.thumbnailUrl} alt="" class="thumb-img" />
          {:else}
            <div class="thumb-placeholder"></div>
          {/if}
        </div>
        <div class="content-info">
          <h2 class="content-title">{data.content.title}</h2>
          {#if data.content.description}
            <p class="content-description">{data.content.description}</p>
          {/if}
        </div>
      </div>

      <div class="success-actions">
        <a href="/watch/{data.content.id}" class="btn btn-primary">
          {m.commerce_watch_now()}
        </a>
      </div>
    {:else}
      <div class="success-actions">
        <a href="/library" class="btn btn-primary">
          {m.commerce_go_to_library()}
        </a>
      </div>
    {/if}

    <div class="success-actions secondary">
      <a href="/discover" class="btn btn-secondary">
        {m.commerce_browse_content()}
      </a>
    </div>
  </div>
</div>

<style>
  .success-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--color-background);
  }

  .success-card {
    width: 100%;
    max-width: 560px;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    box-shadow: var(--shadow-lg);
    border: var(--border-width) var(--border-style) var(--color-border);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
  }

  .success-icon {
    color: var(--color-success);
    margin-bottom: var(--space-2);
  }

  .success-title {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .success-description {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .content-preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-4);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    margin-top: var(--space-2);
  }

  @media (min-width: 480px) {
    .content-preview {
      flex-direction: row;
      align-items: flex-start;
    }
  }

  .content-thumb {
    flex-shrink: 0;
    width: 100%;
    aspect-ratio: 16 / 9;
    max-width: 200px;
    background-color: var(--color-neutral-100);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-placeholder {
    width: 100%;
    height: 100%;
    background-color: var(--color-neutral-200);
  }

  .content-info {
    flex: 1;
    text-align: left;
    min-width: 0;
  }

  @media (min-width: 480px) {
    .content-info {
      text-align: left;
    }
  }

  .content-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-2) 0;
    line-height: var(--leading-tight);
  }

  .content-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
  }

  .success-actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-2);
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
  }

  .success-actions.secondary {
    margin-top: 0;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    text-decoration: none;
    border: none;
    cursor: pointer;
    transition: var(--transition-colors);
    font-family: inherit;
  }

  .btn-primary {
    background: var(--color-primary-500);
    color: #ffffff;
  }

  .btn-primary:hover {
    background: var(--color-primary-600);
  }

  .btn-secondary {
    background: transparent;
    color: var(--color-text-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .btn-secondary:hover {
    background: var(--color-neutral-50);
    color: var(--color-text);
  }

  /* Dark mode */
  [data-theme='dark'] .success-page {
    background: var(--color-background);
  }

  [data-theme='dark'] .success-card {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  [data-theme='dark'] .success-title {
    color: var(--color-text);
  }

  [data-theme='dark'] .success-description {
    color: var(--color-text-secondary);
  }

  [data-theme='dark'] .content-preview {
    background: var(--color-surface-secondary);
  }

  [data-theme='dark'] .content-title {
    color: var(--color-text);
  }

  [data-theme='dark'] .content-description {
    color: var(--color-text-secondary);
  }

  [data-theme='dark'] .thumb-placeholder {
    background-color: var(--color-neutral-700);
  }

  [data-theme='dark'] .btn-secondary {
    border-color: var(--color-border);
    color: var(--color-text-secondary);
  }

  [data-theme='dark'] .btn-secondary:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }
</style>
