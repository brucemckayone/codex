<!--
  @component WriteBar

  The editor's top bar (Codex-a6ofh.2.3, mockups W2/W3/W8a): back, the
  draft's save state, the two steps, and on Write, Next. The save state is
  the only save UI: a draft saves itself, so there is no Save button. On a
  phone the steps shrink to numbers and Next moves to the foot of the page
  (the editor's own). On Publish (Codex-a6ofh.2.4, mockup W4) it goes back to
  writing, Write reads as done, and the step's own button publishes. Once
  the piece went live by another way, it reads Live and offers neither
  Preview nor Next: the screen is frozen, and the notice under the bar is the
  one way on (owner, 2026-11-09).

  @prop {DraftSession} session - The editor's draft session
  @prop {EditorContentType} contentType - Names a piece not yet saved
  @prop {'write' | 'publish'} [step] - The step it is on
  @prop {string} backHref - The content list from Write; the Write step from Publish
  @prop {() => void} [onnext] - Go on to Publish: offered on Write once the draft exists
  @prop {boolean} [advancing] - Next was pressed and is saving first
  @prop {string | null} [nextHint] - Why Next can't go yet, for a screen reader; null when it can
  @prop {boolean} [holding] - A move to step 2 is waiting for the same thing: the reason is said aloud and shown
  @prop {string | null} [previewHref] - The draft as visitors will see it (Codex-a6ofh.2.11): offered once the draft exists
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { Badge, Button } from '$lib/components/ui';
  import { CheckIcon, ChevronRightIcon, EyeIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { TYPE_WORD } from './canvas-text';
  import type { DraftSession } from './draft-session.svelte';
  import EditorBarLink from './EditorBarLink.svelte';
  import type { EditorContentType } from './editor-url';

  interface Props {
    session: DraftSession;
    contentType: EditorContentType;
    step?: 'write' | 'publish';
    backHref: string;
    onnext?: () => void;
    advancing?: boolean;
    nextHint?: string | null;
    holding?: boolean;
    previewHref?: string | null;
  }

  const {
    session,
    contentType,
    step = 'write',
    backHref,
    onnext,
    advancing = false,
    nextHint = null,
    holding = false,
    previewHref = null,
  }: Props = $props();

  /** How long a save reads as "just now". */
  const JUST_NOW_MS = 60_000;

  /** The save whose minute is up: one timer per save, never a ticking clock. */
  let staleSave = $state<Date | null>(null);
  $effect(() => {
    const at = session.lastSavedAt;
    if (!at) return;
    const timer = setTimeout(() => (staleSave = at), Math.max(0, JUST_NOW_MS - (Date.now() - at.getTime())));
    return () => clearTimeout(timer);
  });
  const justNow = $derived(session.lastSavedAt !== null && session.lastSavedAt !== staleSave);

  const saveWords = $derived.by(() => {
    if (session.needsTitle) return m.studio_content_draft_title_needed();
    if (session.status === 'pending' || session.status === 'saving') return m.studio_editor_saving();
    if (session.contentId === null) return m.studio_editor_not_saved_yet({ type: TYPE_WORD[contentType]() });
    return justNow ? m.studio_editor_saved_just_now() : m.studio_editor_saved();
  });

  const nextHintId = $props.id();
  /** Live by another way: what a draft's bar offers goes (owner, 2026-11-09: freeze it). */
  const frozen = $derived(session.wentLiveElsewhere);
  const showPreview = $derived(previewHref !== null && !frozen);

  let wordsEl = $state<HTMLElement | null>(null);

  /**
   * Try again goes as the save starts: focus moves to the save words, which
   * stay put whether the retry saves or fails again.
   */
  async function retry() {
    session.retry();
    await tick();
    wordsEl?.focus();
  }
</script>

<header class="write-bar" data-preview={showPreview ? '' : undefined}>
  <EditorBarLink
    href={backHref}
    label={step === 'publish' ? m.studio_editor_back_to_writing() : m.studio_editor_back()}
  />

  <div class="write-state">
    {#if session.wentLiveElsewhere}
      <!-- Live by another way (Codex-a6ofh.2): the notice below says so, once, and has the way on. -->
      <Badge variant="success" class="write-pill">{m.studio_live_badge()}</Badge>
    {:else if session.contentId !== null}
      <Badge variant="warning" class="write-pill">{m.studio_content_status_draft()}</Badge>
    {/if}
    <span class="write-words" tabindex="-1" bind:this={wordsEl}>
      {#if session.wentLiveElsewhere}
        <!-- Nothing to say here, nor to try again: nothing is sent from this editor now. -->
      {:else if session.status === 'error'}
        <span class="write-error" role="alert">{session.errorMessage ?? m.studio_content_draft_save_failed()}</span>
      {:else}
        <span class="write-saved">{saveWords}</span>
      {/if}
    </span>
    {#if session.status === 'error' && !session.wentLiveElsewhere}
      <Button type="button" size="xs" variant="ghost" onclick={retry}>
        {m.common_try_again()}
      </Button>
    {/if}
    <span class="write-held" role="status">{holding && nextHint ? nextHint : ''}</span>
  </div>

  <ol class="write-steps" aria-label={m.studio_editor_steps()}>
    <li class="write-step" aria-current={step === 'write' ? 'step' : undefined}>
      {#if step === 'publish'}
        <span class="write-step-number" data-done>
          <CheckIcon size={12} />
          <span class="sr-only">{m.studio_editor_step_done()}</span>
        </span>
      {:else}
        <span class="write-step-number">1</span>
      {/if}
      <span class="write-step-label">{m.studio_editor_step_write()}</span>
    </li>
    <li class="write-step-rule" aria-hidden="true"></li>
    <li class="write-step" aria-current={step === 'publish' ? 'step' : undefined}>
      <span class="write-step-number">2</span>
      <span class="write-step-label">{m.studio_editor_step_publish()}</span>
    </li>
  </ol>

  <div class="write-actions">
    {#if showPreview && previewHref}
      <!-- Mockup w4: on both steps. Leaving saves first (the session's guard),
           so the preview shows the latest words. -->
      <EditorBarLink href={previewHref} label={m.studio_preview_button()} icon={EyeIcon} />
    {/if}
    {#if step === 'write' && !frozen}
      <div class="write-next">
        <Button
          type="button"
          size="sm"
          disabled={nextHint !== null}
          loading={advancing}
          aria-describedby={nextHint === null ? undefined : nextHintId}
          onclick={onnext}
        >
          {m.studio_editor_next()}
          <ChevronRightIcon size={16} />
        </Button>
        {#if nextHint !== null}
          <span id={nextHintId} class="sr-only">{nextHint}</span>
        {/if}
      </div>
    {/if}
  </div>
</header>

<style>
  .write-bar {
    position: sticky;
    inset-block-start: 0;
    z-index: var(--z-sticky);
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-block-end: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
  }

  .write-state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-inline-size: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .write-words {
    display: inline-flex;
    min-inline-size: 0;
  }

  .write-saved,
  .write-error {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .write-error {
    color: var(--color-status-error-text);
  }

  /* Empty, out of the row (no gap) but still in the tree, so its words are heard when they come. */
  .write-held:empty {
    position: absolute;
  }

  .write-state :global(.write-pill) {
    flex-shrink: 0;
  }

  .write-steps {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .write-step {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .write-step[aria-current='step'] {
    color: var(--color-text);
    font-weight: var(--font-semibold);
  }

  .write-step-number {
    display: inline-grid;
    place-items: center;
    inline-size: var(--space-5);
    block-size: var(--space-5);
    border-radius: var(--radius-full);
    background: var(--color-surface-tertiary);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
  }

  .write-step[aria-current='step'] .write-step-number {
    background: var(--color-interactive);
    color: var(--color-on-interactive);
  }

  .write-step-number[data-done] {
    background: var(--color-status-success-surface);
    color: var(--color-status-success-text);
  }

  .write-step-rule {
    inline-size: var(--space-6);
    border-block-start: var(--border-width) var(--border-style) var(--color-border);
  }

  /* Phone (W8a): the step labels and Next go (the bar's links hide their own
     words, keeping their icons); the foot of the page has Next. The actions
     add no box of their own, so a hidden Next takes no room. */
  .write-actions {
    display: contents;
  }

  .write-next {
    display: none;
  }

  .write-bar[data-preview] {
    grid-template-columns: auto minmax(0, 1fr) auto auto;
  }

  @media (--below-md) {
    .write-step-label {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  @media (--breakpoint-md) {
    .write-bar,
    .write-bar[data-preview] {
      grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr) auto;
    }

    .write-actions {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      grid-column: 5;
    }

    .write-next {
      display: block;
    }

    .write-state {
      grid-column: 2;
    }

    .write-steps {
      grid-column: 3;
    }
  }
</style>
