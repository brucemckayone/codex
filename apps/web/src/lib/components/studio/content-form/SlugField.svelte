<!--
  @component SlugField

  Slug input with prominent URL preview bar and real-time availability check.
  It never moves the slug itself (Codex-a6ofh.2.4). The old form edits only
  a piece that has been live (`editorView`), whose address must not move
  under its links. Before that, the draft session makes the slug follow the
  title.

  Without a form (the editor's Publish step) the host holds the slug: this
  shows it and hands on a slug typed here once it is one the API takes, so a
  half-typed `my-` is never saved. The host is told while what is on screen
  is not one (`oninvalid`), so it never publishes the last good one instead.

  @prop {ContentForm} [form] - The active form instance; absent on the Publish step
  @prop {string} [value] - The slug, without a form
  @prop {(slug: string) => void} [onchange] - A valid slug typed here, without a form
  @prop {(invalid: boolean) => void} [oninvalid] - What is on screen is not a slug the API takes, without a form
  @prop {string | null} orgSlug - Organization slug for URL preview (null for personal content)
  @prop {string | null} [creatorUsername] - Creator username for personal content URL preview
  @prop {string | null} [organizationId] - Organization ID for slug scope
  @prop {string | null} [contentId] - Content ID to exclude from check (edit mode)
-->
<script lang="ts">
  import { createSlugSchema } from '@codex/validation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { checkContentSlug } from '$lib/remote/content.remote';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';
  import { pieceHref } from '../editor/editor-url';
  import { logReadFailure } from '../media-library/log-read-failure';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form?: ContentForm;
    value?: string;
    onchange?: (slug: string) => void;
    oninvalid?: (invalid: boolean) => void;
    orgSlug: string | null;
    creatorUsername?: string | null;
    organizationId?: string | null;
    contentId?: string | null;
  }

  const {
    form,
    value = '',
    onchange,
    oninvalid,
    orgSlug,
    creatorUsername,
    organizationId,
    contentId,
  }: Props = $props();

  /** What the API takes for a content slug: lowercase words joined by single hyphens, up to 500. */
  const CONTENT_SLUG = createSlugSchema(500);
  const isContentSlug = (slug: string) => CONTENT_SLUG.safeParse(slug).success;

  let slugCheckStatus = $state<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');

  // Plain variable — NOT $state. Reading $state inside $effect creates a
  // reactive dependency; ++counter on $state would infinite-loop the effect.
  let checkRequestId = 0;

  /**
   * What the field shows without a form: the host's slug, or what is typed
   * over it until the host's slug moves (a valid one handed on, or a title it
   * follows).
   */
  let typed = $derived(value);
  const slugValue = $derived(form ? (form.fields.slug.value() ?? '') : typed);
  const misshapen = $derived(!form && typed !== value && !isContentSlug(typed));
  // Gone (a fold closed over it): what was typed goes too, so the host's
  // slug stands again.
  $effect(() => {
    oninvalid?.(misshapen);
    return () => oninvalid?.(false);
  });

  function typedSlug(text: string) {
    const slug = text.trim().toLowerCase();
    typed = slug;
    if (isContentSlug(slug)) onchange?.(slug);
  }

  /** Where the piece will live, as visitors reach it: the real host, never a guess. */
  const urlPrefix = $derived.by(() => {
    const href = pieceHref(
      page.url,
      { orgSlug, creatorUsername: creatorUsername ?? null },
      { slug: 'x', id: contentId ?? 'x' }
    );
    if (href === null) return null;
    const at = new URL(href, page.url);
    return `${at.host}${at.pathname.slice(0, -1)}`;
  });

  // Debounced slug availability check.
  // The returned teardown clears the timer before each re-run and on unmount.
  $effect(() => {
    const slug = slugValue;
    // Before the guard: a check still out for an earlier slug must never
    // answer for one that is not checked at all.
    const thisRequestId = ++checkRequestId;

    // Don't check empty, too short, or badly formatted slugs
    if (!slug || slug.length < 2 || !isContentSlug(slug)) {
      slugCheckStatus = 'idle';
      return;
    }

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
      } catch (err) {
        // Never the slug: it is what the creator typed.
        logReadFailure('studio_editor.slug_check_failed', err, { contentId });
        if (thisRequestId === checkRequestId) {
          slugCheckStatus = 'error';
        }
      }
    }, 800);

    return () => clearTimeout(timer);
  });

</script>

<div class="slug-field">
  <label class="field-label" for="slug">
    {m.studio_content_form_slug_label()}
  </label>
  {#if form}
    <input
      {...form.fields.slug.as('text')}
      id="slug"
      class="field-input"
      class:input-error={slugCheckStatus === 'taken'}
      placeholder={m.studio_content_form_slug_placeholder()}
    />
    {#each form.fields.slug.issues() as issue (issue)}
      <p class="field-error">{issue.message}</p>
    {/each}
  {:else}
    <input
      id="slug"
      type="text"
      class="field-input"
      class:input-error={slugCheckStatus === 'taken' || misshapen}
      value={slugValue}
      aria-invalid={misshapen || undefined}
      aria-describedby={misshapen ? 'slug-shape' : undefined}
      oninput={(event) => typedSlug(event.currentTarget.value)}
      placeholder={m.studio_content_form_slug_placeholder()}
    />
    {#if misshapen}
      <p id="slug-shape" class="field-error">{m.studio_content_form_slug_shape()}</p>
    {/if}
  {/if}
  {#if slugCheckStatus === 'checking'}
    <p class="slug-status slug-checking">{m.studio_content_form_slug_checking()}</p>
  {:else if slugCheckStatus === 'available'}
    <p class="slug-status slug-available">{m.studio_content_form_slug_available()}</p>
  {:else if slugCheckStatus === 'taken'}
    <p class="slug-status slug-taken">{m.studio_content_form_slug_taken()}</p>
  {:else if slugCheckStatus === 'error'}
    <p class="slug-status slug-unchecked">{m.studio_content_form_slug_check_failed()}</p>
  {/if}
  {#if slugValue && urlPrefix}
    <div class="url-preview">
      <span class="url-prefix">{urlPrefix}</span><span class="url-slug">{slugValue}</span>
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

  .field-input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
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

  .slug-unchecked {
    color: var(--color-text-secondary);
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
    color: var(--color-link-hover);
    font-weight: var(--font-medium);
  }

</style>
