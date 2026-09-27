<!--
  @component ImageField

  An `image` field: the creator's own picture for one spot on the page, kept
  in the section's props as an `ImageRef` (contract A3/A5). The upload is a
  real multipart `form()` — a `File` cannot cross a `command()` — and the key
  it returns is written through `onChange` like any other field, so undo,
  autosave and the canvas follow it. Remove only drops the reference; the
  save-time scan queues the stored file for the orphan sweep.

  One form instance per field (`.for`): a remote form drives a single
  `<form>`, and a page holds several of these.

  A `decorative` field (a hero, a background) needs no words and offers them
  behind a switch; any other image asks for a description outright.
-->
<script lang="ts">
  import { MAX_IMAGE_SIZE_BYTES } from '@codex/validation';
  import { tick } from 'svelte';
  import Switch from '$lib/components/ui/Switch/Switch.svelte';
  import type { BlockField } from '$lib/page-builder/kit';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import {
    type ImageRef,
    isImageRef,
    resolvePageImageUrl,
  } from '$lib/page-builder/page-images';
  import { uploadPageImageForm } from '$lib/remote/page-images.remote';
  import * as m from '$paraglide/messages';

  interface Props {
    field: BlockField;
    value: unknown;
    onChange: (value: ImageRef | undefined) => void;
    /** `context.mediaBaseUrl`. Without it only a fresh upload can preview. */
    mediaBaseUrl?: string | null;
    /** No words needed unless the creator chooses to add them. */
    decorative?: boolean;
  }

  const { field, value, onChange, mediaBaseUrl = null, decorative = false }: Props = $props();

  const id = $props.id();
  const upload = uploadPageImageForm.for(id);
  const maxMb = String(Math.round(MAX_IMAGE_SIZE_BYTES / 1024 / 1024));

  const ref = $derived(isImageRef(value) ? value : null);
  const alt = $derived(ref?.alt ?? '');
  const busy = $derived(upload.pending > 0);

  let fileInput = $state<HTMLInputElement | null>(null);
  let altInput = $state<HTMLInputElement | null>(null);
  /** The last upload's own preview URL, for a page with no CDN base yet. */
  let fresh = $state<{ key: string; url: string } | null>(null);
  let brokenThumb = $state<string | null>(null);
  let error = $state<string | null>(null);
  let uploaded = $state(false);
  /** Switched off "Decorative" but typed nothing yet — never persisted. */
  let describing = $state(false);

  const thumb = $derived.by(() => {
    if (!ref) return null;
    const url =
      resolvePageImageUrl(ref, 'sm', mediaBaseUrl) ??
      (fresh?.key === ref.key ? fresh.url : null);
    return url && url !== brokenThumb ? url : null;
  });
  const isDecorative = $derived(decorative && !describing && !alt.trim());

  function writeAlt(next: string): void {
    if (!ref) return;
    // Clearing the words to retype them must not flip the field to decorative.
    describing = true;
    onChange(next.trim() ? { key: ref.key, alt: next } : { key: ref.key });
  }

  async function setDecorative(on: boolean): Promise<void> {
    // Melt's switch echoes its own prop on mount and on every sync.
    if (on === isDecorative) return;
    describing = !on;
    if (!on) {
      await tick();
      altInput?.focus();
    } else if (ref && ref.alt !== undefined) {
      onChange({ key: ref.key });
    }
  }

  function remove(): void {
    onChange(undefined);
    fresh = null;
    describing = false;
    uploaded = false;
    error = null;
  }
</script>

<div class="image" role="group" aria-labelledby="{id}-label">
  <span class="image__label" id="{id}-label">{field.label}</span>
  {#if field.hint}<p class="image__hint">{field.hint}</p>{/if}

  <div class="image__row">
    <div class="image__frame">
      {#if thumb}
        <img class="image__thumb" src={thumb} alt="" onerror={() => (brokenThumb = thumb)} />
      {:else}
        <span class="image__empty">
          {ref ? m.studio_page_editor_image_added() : m.studio_page_editor_image_empty()}
        </span>
      {/if}
    </div>

    <form
      class="image__actions"
      enctype="multipart/form-data"
      {...upload.enhance(async ({ form, submit }) => {
        error = null;
        uploaded = false;
        // The catch covers the UPLOAD only. It used to wrap the write below
        // too, so a failed write was reported as a failed upload — and, when
        // the field had gone, reported nowhere at all.
        try {
          await submit();
        } catch {
          error = m.studio_page_editor_image_failed();
          return;
        } finally {
          // Re-picking the same file must fire `change` again.
          form.reset();
        }
        const result = upload.result;
        if (result?.outcome === 'uploaded') {
          fresh = { key: result.key, url: result.url };
          // `value` as it is NOW, not the `ref` derived when the upload
          // started: a slow upload can outlive the field on screen.
          const alt = isImageRef(value) ? value.alt : undefined;
          onChange(alt ? { key: result.key, alt } : { key: result.key });
          uploaded = true;
        } else {
          // The server's own words (a format it refuses, a size over the
          // limit) — a creator can only fix what they can read.
          error =
            result?.message ??
            upload.fields.image.issues()?.[0]?.message ??
            m.studio_page_editor_image_failed();
        }
      })}
    >
      <input {...upload.fields.pageId.as('hidden', pageBuilder.pageId ?? '')} />
      <!-- The button is the control; the input is the mechanism, so it is
           clipped (not `display: none`, which Safari will not submit) and
           kept out of the tab order after the spread. -->
      <input
        bind:this={fileInput}
        class="image__file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        {...upload.fields.image.as('file')}
        tabindex="-1"
        onchange={(event) => event.currentTarget.form?.requestSubmit()}
      />
      <button
        type="button"
        class="image__btn"
        disabled={busy || !pageBuilder.pageId}
        onclick={() => fileInput?.click()}
      >
        {busy
          ? m.studio_page_editor_image_uploading()
          : ref
            ? m.studio_page_editor_image_replace()
            : m.studio_page_editor_image_upload()}
      </button>
      {#if ref}
        <button type="button" class="image__btn image__btn--quiet" disabled={busy} onclick={remove}>
          {m.studio_page_editor_image_remove()}
        </button>
      {/if}
    </form>
  </div>

  <p class="image__hint">{m.studio_page_editor_image_formats({ mb: maxMb })}</p>
  {#if error}
    <p class="image__error" role="alert">{error}</p>
  {/if}
  <p class="image__status" role="status">{uploaded ? m.studio_page_editor_image_uploaded() : ''}</p>

  {#if ref}
    {#if decorative}
      <div class="image__toggle">
        <span class="image__label" id="{id}-decorative">{m.studio_page_editor_image_decorative()}</span>
        <Switch
          checked={isDecorative}
          aria-labelledby="{id}-decorative"
          onCheckedChange={(on) => void setDecorative(on)}
        />
      </div>
    {/if}
    {#if !isDecorative}
      <div class="image__alt">
        <label class="image__label" for="{id}-alt">{m.studio_page_editor_image_alt_label()}</label>
        <input
          bind:this={altInput}
          id="{id}-alt"
          class="image__input"
          type="text"
          autocomplete="off"
          maxlength="200"
          value={alt}
          aria-describedby="{id}-alt-hint"
          oninput={(event) => writeAlt(event.currentTarget.value)}
        />
        <p class="image__hint" id="{id}-alt-hint">
          {m.studio_page_editor_image_alt_hint()}
          {#if !decorative && !alt.trim()}{m.studio_page_editor_image_alt_missing()}{/if}
        </p>
      </div>
    {/if}
  {/if}
</div>

<style>
  .image,
  .image__alt {
    display: grid;
    gap: var(--space-1);
  }

  .image__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .image__hint,
  .image__status,
  .image__error {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .image__error {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }

  .image__error::before {
    content: '';
    display: inline-block;
    inline-size: var(--space-2);
    block-size: var(--space-2);
    margin-inline-end: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--color-error);
  }

  .image__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-block: var(--space-1);
  }

  .image__frame {
    display: grid;
    place-items: center;
    flex: none;
    inline-size: var(--space-24);
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
  }

  .image__thumb {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .image__empty {
    padding: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    text-align: center;
  }

  .image__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .image__file {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .image__btn {
    min-block-size: var(--space-10);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .image__btn--quiet {
    border-color: transparent;
    background: none;
    color: var(--color-text-secondary);
  }

  .image__btn:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .image__btn:disabled {
    cursor: not-allowed;
    opacity: var(--opacity-60);
  }

  .image__btn:focus-visible,
  .image__input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width);
  }

  .image__toggle {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
    margin-block-start: var(--space-2);
  }

  .image__alt {
    margin-block-start: var(--space-2);
  }

  .image__input {
    inline-size: 100%;
    min-block-size: var(--space-10);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
  }
</style>
