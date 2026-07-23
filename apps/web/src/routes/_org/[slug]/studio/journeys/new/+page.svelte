<!--
  @component Studio Journeys — create flow (Codex-2pryk.3.3 · WP-5)

  Names a new journey/landing page and hands off to the builder. Mirrors
  `content/new/` — client-only (studio `ssr = false`), a `command()`-shaped
  create. AGGRESSIVE-MODE MOCKS: `createJourneyMock` stands in for the real
  create command; the conductor swaps it after WP-2.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { createJourneyMock } from '$lib/components/page-builder/journey-queries.mock.svelte';

  const { data } = $props();

  type NewPageType = 'course' | 'landing';

  let title = $state('');
  let pageType = $state<NewPageType>('course');
  let submitting = $state(false);

  const canSubmit = $derived(title.trim().length > 0 && !submitting);

  const PAGE_TYPES: readonly { id: NewPageType; label: string; hint: string }[] = [
    { id: 'course', label: 'Course', hint: 'A guided journey with stages, practices and a sales page.' },
    { id: 'landing', label: 'Landing page', hint: 'A standalone marketing page with no curriculum.' },
  ];

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    submitting = true;
    try {
      const { id } = await createJourneyMock({ title: title.trim(), pageType });
      toast.success('Journey created');
      // Courses go to the curriculum first; landing pages straight to the builder.
      const next = pageType === 'course' ? 'curriculum' : 'page';
      await goto(`/studio/journeys/${id}/${next}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create journey');
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>New journey | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="new-journey">
  <nav class="new-journey__crumbs" aria-label="Breadcrumb">
    <a href="/studio/journeys">Journeys</a>
    <span aria-hidden="true">/</span>
    <span aria-current="page">New</span>
  </nav>

  <h1 class="new-journey__title">Create a journey</h1>

  <form class="new-journey__form" onsubmit={handleSubmit}>
    <label class="new-journey__field">
      <span class="new-journey__label">Title</span>
      <input
        type="text"
        class="new-journey__input"
        placeholder="e.g. Stillness — a 6-week descent"
        bind:value={title}
        autocomplete="off"
      />
    </label>

    <fieldset class="new-journey__field new-journey__types">
      <legend class="new-journey__label">Type</legend>
      {#each PAGE_TYPES as t (t.id)}
        <label class="new-journey__type" class:new-journey__type--active={pageType === t.id}>
          <input
            type="radio"
            name="pageType"
            value={t.id}
            checked={pageType === t.id}
            onchange={() => (pageType = t.id)}
          />
          <span class="new-journey__type-label">{t.label}</span>
          <span class="new-journey__type-hint">{t.hint}</span>
        </label>
      {/each}
    </fieldset>

    <div class="new-journey__actions">
      <a href="/studio/journeys" class="new-journey__btn new-journey__btn--ghost">Cancel</a>
      <button type="submit" class="new-journey__btn new-journey__btn--primary" disabled={!canSubmit}>
        {submitting ? 'Creating…' : 'Create & continue'}
      </button>
    </div>
  </form>
</div>

<style>
  .new-journey {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
    max-width: var(--container-sm);
  }

  .new-journey__crumbs {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .new-journey__crumbs a {
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .new-journey__crumbs a:hover {
    color: var(--color-text);
  }

  .new-journey__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .new-journey__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .new-journey__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border: 0;
    padding: 0;
    margin: 0;
  }

  .new-journey__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .new-journey__input {
    padding: var(--space-2-5) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    transition: var(--transition-colors);
  }

  .new-journey__input:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
    box-shadow: var(--shadow-focus-ring);
  }

  .new-journey__types {
    gap: var(--space-2);
  }

  .new-journey__type {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .new-journey__type:hover {
    background-color: var(--color-surface-secondary);
  }

  .new-journey__type--active {
    border-color: var(--color-interactive);
    background-color: var(--color-interactive-subtle, var(--color-surface-secondary));
  }

  .new-journey__type input {
    grid-row: 1 / 3;
    align-self: center;
    accent-color: var(--color-interactive);
  }

  .new-journey__type-label {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .new-journey__type-hint {
    grid-column: 2;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .new-journey__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .new-journey__btn {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    text-decoration: none;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .new-journey__btn--ghost {
    display: inline-flex;
    align-items: center;
    border: var(--border-width) var(--border-style) var(--color-border);
    background: none;
    color: var(--color-text-secondary);
  }

  .new-journey__btn--ghost:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .new-journey__btn--primary {
    border: var(--border-width) var(--border-style) transparent;
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
  }

  .new-journey__btn--primary:hover:not(:disabled) {
    background-color: var(--color-interactive-hover);
  }

  .new-journey__btn--primary:disabled {
    opacity: var(--opacity-40);
    cursor: not-allowed;
  }

  .new-journey__btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }
</style>
