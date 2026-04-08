<!--
  @component SlugField

  Slug input with prominent URL preview bar and real-time availability check.
  Auto-generates from title value unless manually edited.

  @prop {ContentForm} form - The active form instance
  @prop {string | null} orgSlug - Organization slug for URL preview (null for personal content)
  @prop {string | null} [creatorUsername] - Creator username for personal content URL preview
  @prop {string | null} [organizationId] - Organization ID for slug scope
  @prop {string | null} [contentId] - Content ID to exclude from check (edit mode)
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { checkContentSlug } from '$lib/remote/content.remote';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    orgSlug: string | null;
    creatorUsername?: string | null;
    organizationId?: string | null;
    contentId?: string | null;
  }

  const { form, orgSlug, creatorUsername, organizationId, contentId }: Props = $props();

  let slugManuallyEdited = $state(false);
  let slugCheckStatus = $state<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');

  // Plain variable — NOT $state. Reading $state inside $effect creates a
  // reactive dependency; ++counter on $state would infinite-loop the effect.
  let checkRequestId = 0;

  const titleValue = $derived(form.fields.title.value() ?? '');
  const slugValue = $derived(form.fields.slug.value() ?? '');

  // Auto-generate slug from title when not manually edited
  $effect(() => {
    if (!slugManuallyEdited && titleValue) {
      const generated = titleValue
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      form.fields.slug.set(generated);
    }
  });

  // Debounced slug availability check.
  // The returned teardown clears the timer before each re-run and on unmount.
  $effect(() => {
    const slug = slugValue;

    // Don't check empty, too short, or badly formatted slugs
    if (!slug || slug.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      slugCheckStatus = 'idle';
      return;
    }

    const thisRequestId = ++checkRequestId;

    const timer = setTimeout(async () => {
      slugCheckStatus = 'checking';

      try {
        const result = await checkContentSlug({
          slug,
          organizationId: organizationId ?? undefined,
          excludeContentId: contentId ?? undefined,
        });

        // Only update if this is still the latest request
        if (thisRequestId === checkRequestId) {
          slugCheckStatus = result.available ? 'available' : 'taken';
        }
      } catch {
        if (thisRequestId === checkRequestId) {
          slugCheckStatus = 'error';
        }
      }
    }, 800);

    return () => clearTimeout(timer);
  });

  function handleSlugInput() {
    slugManuallyEdited = true;
  }
</script>

<div class="slug-field">
  <label class="field-label" for="slug">
    {m.studio_content_form_slug_label()}
  </label>
  <input
    {...form.fields.slug.as('text')}
    id="slug"
    class="field-input"
    class:input-error={slugCheckStatus === 'taken'}
    placeholder={m.studio_content_form_slug_placeholder()}
    oninput={handleSlugInput}
  />
  {#each form.fields.slug.issues() as issue}
    <p class="field-error">{issue.message}</p>
  {/each}
  {#if slugCheckStatus === 'checking'}
    <p class="slug-status slug-checking">{m.studio_content_form_slug_checking()}</p>
  {:else if slugCheckStatus === 'available'}
    <p class="slug-status slug-available">{m.studio_content_form_slug_available()}</p>
  {:else if slugCheckStatus === 'taken'}
    <p class="slug-status slug-taken">{m.studio_content_form_slug_taken()}</p>
  {/if}
  {#if slugValue}
    <div class="url-preview">
      <span class="url-prefix">{orgSlug ? `${orgSlug}.lvh.me` : 'creators.lvh.me'}/{orgSlug ? '' : creatorUsername ? `${creatorUsername}/` : ''}content/</span><span class="url-slug">{slugValue}</span>
    </div>
  {/if}
</div>

<style>
  .slug-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .field-input {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
    font-family: inherit;
  }

  .field-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  .field-input[aria-invalid='true'],
  .field-input.input-error {
    border-color: var(--color-error-500);
  }

  .field-error {
    font-size: var(--text-xs);
    color: var(--color-error-600);
    margin: 0;
  }

  .slug-status {
    font-size: var(--text-xs);
    margin: 0;
  }

  .slug-checking {
    color: var(--color-text-muted);
  }

  .slug-available {
    color: var(--color-success-600);
  }

  .slug-taken {
    color: var(--color-error-600);
  }

  .url-preview {
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-surface-secondary, var(--color-surface));
    border-radius: var(--radius-md);
    font-family: var(--font-mono, monospace);
    font-size: var(--text-xs);
    overflow-x: auto;
    white-space: nowrap;
  }

  .url-prefix {
    color: var(--color-text-muted);
  }

  .url-slug {
    color: var(--color-interactive-hover);
    font-weight: var(--font-medium);
  }

</style>
