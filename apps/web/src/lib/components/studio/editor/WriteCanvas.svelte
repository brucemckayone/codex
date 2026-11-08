<!--
  @component WriteCanvas

  Step 1, Write (Codex-a6ofh.2.3, mockups W2/W3/W6): the piece laid out as
  its public page lays it out, in the page's own type (ContentDetailView's
  960px column, 720px for an article), with every field editable in place. A
  field has no label box: its placeholder is in the real type, and an outline
  shows only on hover or focus. Price and access hold their place; they are
  chosen in step 2.

  @prop {DraftSession} session - The editor's draft session: every field reads and sets it
  @prop {EditorContentType} contentType - The piece's type
  @prop {string} authorName - Who it is by, on the meta line
  @prop {number | null} durationSeconds - The chosen media's length, once known
  @prop {(busy: boolean, failed: boolean) => void} [oncoverbusy] - A cover is going up or coming off; failed once that ended in a problem
  @prop {(pending: boolean, failed: boolean) => void} [onmediapending] - A file in the slot has no media row yet; failed once its upload failed before it had one
  @prop {boolean} [live] - A piece that has been live (Codex-a6ofh.2.5, mockup W5b): its cover is staged for Update through the session, only ready media is offered, and its locked link shows under the title
-->
<script lang="ts">
  import { CONTENT_DESCRIPTION_MAX, CONTENT_TITLE_MAX, hasArticleBody } from '@codex/validation';
  import { tick, untrack } from 'svelte';
  import RichTextEditor from '$lib/components/editor/RichTextEditor.svelte';
  import { Button } from '$lib/components/ui';
  import { LockIcon, PlusIcon } from '$lib/components/ui/Icon';
  import { formatDuration } from '$lib/utils/format';
  import * as m from '$paraglide/messages';
  import { readingMinutes } from './canvas-text';
  import CoverLine from './CoverLine.svelte';
  import type { DraftSession } from './draft-session.svelte';
  import type { EditorContentType } from './editor-url';
  import MediaSlot from './MediaSlot.svelte';

  interface Props {
    session: DraftSession;
    contentType: EditorContentType;
    authorName: string;
    durationSeconds: number | null;
    oncoverbusy?: (busy: boolean, failed: boolean) => void;
    onmediapending?: (pending: boolean, failed: boolean) => void;
    live?: boolean;
  }

  const {
    session,
    contentType,
    authorName,
    durationSeconds,
    oncoverbusy,
    onmediapending,
    live = false,
  }: Props = $props();

  /** A live piece's cover is the session's, staged for Update; a draft's upload writes the row. */
  function stageCover(next: string | null) {
    session.set('thumbnailUrl', next);
  }

  const TYPE = { video: m.content_type_video, audio: m.content_type_audio, written: m.content_type_article };

  /** The body the editor starts with: TipTap owns it from there, and reports each change. */
  const initialBody = untrack(() => session.values.contentBody ?? '');

  /** Video and audio keep their notes folded until asked for, or until they hold some. */
  let notesOpen = $state(untrack(() => hasArticleBody(session.values.contentBody)));
  const showBody = $derived(contentType === 'written' || notesOpen);

  let lede = $state<HTMLTextAreaElement | null>(null);
  let bodyWrap = $state<HTMLElement | null>(null);

  const minutes = $derived(contentType === 'written' ? readingMinutes(session.values.contentBody) : null);

  /** The title is one line: Enter goes on to the description, and a pasted break is a space. */
  function titleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    lede?.focus();
  }

  function setTitle(event: Event & { currentTarget: HTMLTextAreaElement }) {
    session.set('title', event.currentTarget.value.replace(/[\r\n]+/g, ' '));
  }

  function setLede(event: Event & { currentTarget: HTMLTextAreaElement }) {
    const text = event.currentTarget.value;
    session.set('description', text.trim() ? text : null);
  }

  async function openNotes() {
    notesOpen = true;
    // The button goes: focus moves to what it opened, never to <body>.
    await tick();
    bodyWrap?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
  }
</script>

<div class="canvas" data-type={contentType}>
  {#if contentType !== 'written'}
    <MediaSlot
      mediaType={contentType}
      value={session.values.mediaItemId}
      onchange={(id) => session.set('mediaItemId', id)}
      onpending={onmediapending}
      readyOnly={live}
    />
  {/if}
  {#if contentType !== 'video'}
    <!-- A draft never sets the session's cover, so it is the saved one there. -->
    <CoverLine
      contentId={session.contentId}
      {contentType}
      thumbnailUrl={session.values.thumbnailUrl}
      onstaged={live ? stageCover : undefined}
      onbusy={oncoverbusy}
    />
  {/if}

  <div class="canvas-header">
    <textarea
      class="canvas-title canvas-field"
      rows="1"
      aria-label={m.studio_editor_title_label()}
      placeholder={m.studio_editor_title_placeholder()}
      maxlength={CONTENT_TITLE_MAX}
      value={session.values.title}
      oninput={setTitle}
      onkeydown={titleKeydown}
    ></textarea>

    {#if live}
      <p class="canvas-link">
        <LockIcon size={14} />
        <span>{m.studio_live_link_path({ slug: session.values.slug })}</span>
        <span aria-hidden="true">·</span>
        <span>{m.studio_live_link_stays()}</span>
      </p>
    {/if}

    <div class="canvas-meta" role="group" aria-label={m.studio_editor_meta_label()}>
      <span>{TYPE[contentType]()}</span>
      {#if minutes !== null}
        <span aria-hidden="true">·</span>
        <span>{m.studio_editor_meta_read({ minutes })}</span>
      {:else if contentType !== 'written'}
        <span aria-hidden="true">·</span>
        {#if durationSeconds}
          <span class="canvas-duration">{formatDuration(durationSeconds)}</span>
        {:else}
          <span class="canvas-duration" aria-hidden="true">–:––</span>
        {/if}
      {/if}
      <span aria-hidden="true">·</span>
      <span>{m.studio_editor_meta_by({ name: authorName })}</span>
      <span class="canvas-auto">{m.studio_editor_meta_auto()}</span>
    </div>
  </div>

  <textarea
    bind:this={lede}
    class="canvas-lede canvas-field"
    rows="2"
    aria-label={m.studio_editor_lede_label()}
    placeholder={m.studio_editor_lede_placeholder()}
    maxlength={CONTENT_DESCRIPTION_MAX}
    value={session.values.description ?? ''}
    oninput={setLede}
  ></textarea>

  <div class="canvas-held">
    <LockIcon size={16} />
    <span>
      <b>{m.studio_editor_price_held_lead()}</b>
      {live ? m.studio_live_price_held_rest() : m.studio_editor_price_held_rest()}
    </span>
  </div>

  {#if showBody}
    <!-- As on the public page: the body under a rule, in the prose measure,
         with no heading of its own ("About" heads the description there). -->
    <div class="canvas-body" bind:this={bodyWrap}>
      <RichTextEditor
        variant="canvas"
        preset="full"
        content={initialBody}
        ariaLabel={contentType === 'written' ? m.studio_editor_body_label() : m.studio_editor_notes_label()}
        placeholder={contentType === 'written' ? m.studio_editor_body_placeholder() : m.studio_editor_notes_placeholder()}
        oninput={(json) => session.set('contentBody', json)}
      />
    </div>
  {:else}
    <Button type="button" variant="ghost" size="sm" class="canvas-add" onclick={openNotes}>
      <PlusIcon size={16} />
      {m.studio_editor_add_notes()}
      <span class="canvas-optional">· {m.studio_editor_optional()}</span>
    </Button>
  {/if}
</div>

<style>
  /* ContentDetailView's column (`.content-detail`): 960px, an article 720px. */
  .canvas {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    inline-size: 100%;
    max-inline-size: var(--container-content);
    margin-inline: auto;
    padding: var(--space-6) var(--space-4) var(--space-16);
  }

  .canvas[data-type='written'] {
    max-inline-size: 720px;
  }

  .canvas-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* A field in the page's type: no box, an outline only on hover or focus.
     Wider than the column by its padding, so its words line up with the
     page's. It grows with its words; a browser without `field-sizing` shows
     its rows and scrolls. */
  .canvas-field {
    display: block;
    box-sizing: border-box;
    inline-size: calc(100% + 2 * var(--space-2));
    margin: 0 calc(-1 * var(--space-2));
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    outline: var(--border-width) dashed transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    field-sizing: content;
    resize: none;
    transition: var(--transition-colors);
  }

  .canvas-field:hover {
    outline-color: var(--color-border);
  }

  .canvas-field:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
  }

  .canvas-field::placeholder {
    color: var(--color-text-muted);
  }

  /* `.content-detail__title` */
  .canvas-title {
    font-size: clamp(var(--text-2xl), 2vw + 1rem, var(--text-3xl));
    font-weight: var(--font-bold);
    line-height: var(--leading-snug);
    color: var(--color-text);
  }

  /* `.content-detail__meta`, `__duration`, `__creator` */
  .canvas-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .canvas-duration {
    font-variant-numeric: tabular-nums;
  }

  .canvas-link {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }

  .canvas-auto {
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-surface-tertiary);
    font-size: var(--text-xs);
  }

  /* `.content-detail__short-description` */
  .canvas-lede {
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .canvas-held {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-4);
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .canvas-held b {
    color: var(--color-text);
    font-weight: var(--font-semibold);
  }

  /* `.content-detail__body` */
  .canvas-body {
    padding-block-start: var(--space-4);
    border-block-start: var(--border-width) var(--border-style) var(--color-border);
  }

  /* Its words in line with the column's, as the fields' are. */
  .canvas :global(.canvas-add) {
    align-self: flex-start;
    margin-inline-start: calc(-1 * var(--space-3));
  }

  .canvas-optional {
    color: var(--color-text-muted);
  }

  @media (--below-md) {
    .canvas {
      padding-block-end: calc(var(--space-16) + var(--space-16));
    }
  }
</style>
