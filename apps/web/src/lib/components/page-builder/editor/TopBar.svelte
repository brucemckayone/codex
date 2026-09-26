<!--
  @component TopBar

  Back to Portals · the page title · its status · the device · undo and redo ·
  whether it is saved · Preview · the one primary action. Unpublish sits in
  the small menu at the end, behind a confirmation. Nothing else belongs here.
-->
<script lang="ts">
  import { type Component, tick } from 'svelte';
  import * as Dialog from '$lib/components/ui/Dialog';
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import {
    ArrowLeftIcon,
    CheckIcon,
    DesktopIcon,
    ExternalLinkIcon,
    MobileIcon,
    MoreHorizontalIcon,
    RedoIcon,
    TabletIcon,
    UndoIcon,
  } from '$lib/components/ui/Icon';
  import type { IconProps } from '$lib/components/ui/Icon/types';
  import * as m from '$paraglide/messages';
  import type { SessionBusy } from './builder-session.svelte';
  import {
    DEVICES,
    type Device,
    type PrimaryAction,
    type SaveIndicator,
    type StatusChip,
  } from './editor-state';

  interface Props {
    title: string;
    chip: StatusChip;
    device: Device;
    canUndo: boolean;
    canRedo: boolean;
    save: SaveIndicator;
    saveError?: string;
    primary: PrimaryAction;
    busy: SessionBusy;
    canUnpublish: boolean;
    onTitle: (title: string) => void;
    onDevice: (device: Device) => void;
    onUndo: () => void;
    onRedo: () => void;
    onRetry: () => void;
    onPreview: () => void;
    onPrimary: () => void;
    onUnpublish: () => void;
  }

  const {
    title,
    chip,
    device,
    canUndo,
    canRedo,
    save,
    saveError,
    primary,
    busy,
    canUnpublish,
    onTitle,
    onDevice,
    onUndo,
    onRedo,
    onRetry,
    onPreview,
    onPrimary,
    onUnpublish,
  }: Props = $props();

  const DEVICE_LABELS: Record<Device, () => string> = {
    desktop: () => m.studio_builder_device_desktop(),
    tablet: () => m.studio_builder_device_tablet(),
    mobile: () => m.studio_builder_device_mobile(),
  };

  const DEVICE_ICONS: Record<Device, Component<IconProps>> = {
    desktop: DesktopIcon,
    tablet: TabletIcon,
    mobile: MobileIcon,
  };

  const CHIP_LABELS: Record<StatusChip, () => string> = {
    draft: () => m.studio_builder_status_draft(),
    live: () => m.studio_page_editor_status_live(),
    'live-changes': () => m.studio_page_editor_status_live_changes(),
    archived: () => m.studio_builder_status_archived(),
  };

  // The title may not be saved blank (the save refuses it), so a cleared field
  // keeps the last real title in the draft and shows it again on blur.
  let titleDraft = $state<string | null>(null);
  let confirming = $state(false);
  let primaryButton = $state<HTMLButtonElement>();

  // The menu that opened the confirmation goes when the page stops being
  // live, so focus lands on the primary action rather than on nothing.
  function confirmUnpublish(): void {
    confirming = false;
    onUnpublish();
    void tick().then(() => primaryButton?.focus());
  }

  // Sized to its words, so the status sits beside the title, not across a gap.
  const titleSize = $derived(
    Math.min(40, Math.max(8, (titleDraft ?? title).length + 1))
  );

  function editTitle(value: string): void {
    titleDraft = value;
    if (value.trim()) onTitle(value);
  }

  const primaryLabel = $derived.by(() => {
    if (busy === 'publishing') return m.studio_builder_publishing();
    if (primary.kind === 'publish-changes') return m.studio_page_editor_publish_changes();
    if (primary.kind === 'published') return m.studio_page_editor_published();
    return m.studio_builder_publish();
  });
</script>

<header class="topbar">
  <div class="topbar__start">
    <a class="topbar__back" href="/studio/journeys">
      <ArrowLeftIcon size={16} />
      {m.studio_builder_all_portals()}
    </a>
    <input
      class="topbar__title"
      value={titleDraft ?? title}
      size={titleSize}
      aria-label={m.studio_builder_page_title_label()}
      maxlength={500}
      oninput={(event) => editTitle(event.currentTarget.value)}
      onblur={() => (titleDraft = null)}
    />
    <span class="topbar__chip" data-state={chip}>
      <span class="topbar__dot" aria-hidden="true"></span>
      <span class="topbar__sr">{m.studio_page_editor_status_label()}:</span>
      {CHIP_LABELS[chip]()}
    </span>
  </div>

  <div class="topbar__devices" role="group" aria-label={m.studio_builder_device_label()}>
    {#each DEVICES as option (option)}
      {@const DeviceIcon = DEVICE_ICONS[option]}
      <button
        type="button"
        class="topbar__device"
        aria-pressed={device === option}
        aria-label={DEVICE_LABELS[option]()}
        title={DEVICE_LABELS[option]()}
        onclick={() => onDevice(option)}
      >
        <DeviceIcon size={16} />
      </button>
    {/each}
  </div>

  <div class="topbar__end">
    <div class="topbar__history" role="group" aria-label={m.studio_builder_history_label()}>
      <button
        type="button"
        class="topbar__quiet topbar__icon"
        aria-label={m.studio_builder_undo()}
        title={m.studio_builder_undo_title()}
        disabled={!canUndo}
        onclick={onUndo}
      >
        <UndoIcon size={16} />
      </button>
      <button
        type="button"
        class="topbar__quiet topbar__icon"
        aria-label={m.studio_builder_redo()}
        title={m.studio_builder_redo_title()}
        disabled={!canRedo}
        onclick={onRedo}
      >
        <RedoIcon size={16} />
      </button>
    </div>

    <span class="topbar__save" role="status" data-state={save}>
      {#if busy === 'unpublishing'}
        {m.studio_page_editor_unpublishing()}
      {:else if save === 'saving'}
        {m.studio_builder_saving()}
      {:else if save === 'saved'}
        <CheckIcon size={14} />
        {m.studio_page_editor_saved()}
      {:else if save === 'error'}
        <span title={saveError}>{m.studio_page_editor_save_failed()}</span>
        <button type="button" class="topbar__retry" onclick={onRetry}>
          {m.studio_page_editor_save_retry()}
        </button>
      {/if}
    </span>

    <button
      type="button"
      class="topbar__button"
      title={m.studio_page_editor_preview_title()}
      disabled={busy !== null}
      onclick={onPreview}
    >
      {m.studio_page_editor_preview()}
      <ExternalLinkIcon size={14} />
    </button>

    <button
      type="button"
      class="topbar__button"
      bind:this={primaryButton}
      data-variant={primary.kind === 'published' ? 'done' : 'primary'}
      disabled={primary.disabled}
      onclick={onPrimary}
    >
      {#if primary.kind === 'published' && !primary.busy}<CheckIcon size={14} />{/if}
      {primaryLabel}
    </button>

    {#if canUnpublish}
      <!-- Never `disabled` on the trigger: Melt reads it once, at mount, and
           this trigger mounts mid-publish — it would stay disabled for good. -->
      <DropdownMenu.Root positioning={{ placement: 'bottom-end' }}>
        <DropdownMenu.Trigger
          class="topbar__more"
          data-editor-more=""
          aria-label={m.studio_page_editor_more()}
        >
          <MoreHorizontalIcon size={18} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item disabled={busy !== null} onclick={() => (confirming = true)}>
            {m.studio_page_editor_unpublish()}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>
</header>

<Dialog.Root bind:open={confirming} closeFocus="[data-editor-more]">
  <Dialog.Content size="sm">
    <Dialog.Header>
      <Dialog.Title>{m.studio_page_editor_unpublish_title()}</Dialog.Title>
      <Dialog.Description>{m.studio_page_editor_unpublish_body()}</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <button type="button" class="topbar__button" onclick={() => (confirming = false)}>
        {m.studio_page_editor_cancel()}
      </button>
      <button
        type="button"
        class="topbar__button"
        data-variant="primary"
        onclick={confirmUnpublish}
      >
        {m.studio_page_editor_unpublish()}
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* The actions never shrink; the title side gives way first. */
  .topbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(max-content, 1fr);
    align-items: center;
    gap: var(--space-3);
    min-block-size: var(--space-12);
    padding: var(--space-1-5) var(--space-3);
    border-block-end: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  .topbar__start,
  .topbar__end {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-inline-size: 0;
  }

  .topbar__end {
    justify-content: flex-end;
  }

  .topbar__back {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    text-decoration: none;
    white-space: nowrap;
  }

  .topbar__back:hover {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
    color: var(--color-text);
  }

  .topbar__title {
    flex: 0 1 auto;
    min-inline-size: 6rem;
    padding: var(--space-1-5) var(--space-2);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-weight: var(--font-semibold);
    text-overflow: ellipsis;
  }

  .topbar__title:hover {
    border-color: var(--color-border);
  }

  .topbar__title:focus-visible {
    border-color: var(--color-border-strong);
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  .topbar__chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-0-5) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    white-space: nowrap;
  }

  .topbar__dot {
    inline-size: var(--space-2);
    block-size: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-text-tertiary);
  }

  .topbar__chip[data-state='live'] .topbar__dot {
    background: var(--color-success);
  }

  .topbar__chip[data-state='live-changes'] .topbar__dot {
    background: var(--color-warning);
  }

  .topbar__sr {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .topbar__devices {
    display: flex;
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .topbar__device {
    display: inline-grid;
    place-items: center;
    min-inline-size: var(--space-10);
    min-block-size: var(--space-8);
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    cursor: pointer;
  }

  .topbar__device[aria-pressed='true'] {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-xs);
  }

  .topbar__history {
    display: flex;
  }

  .topbar__quiet,
  .topbar__retry {
    padding: var(--space-1-5) var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    cursor: pointer;
  }

  .topbar__icon {
    display: inline-grid;
    place-items: center;
    min-inline-size: var(--space-8);
    min-block-size: var(--space-8);
    padding: 0;
  }

  .topbar__quiet:hover:not(:disabled),
  .topbar__retry:hover {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
    color: var(--color-text);
  }

  .topbar__quiet:disabled {
    color: var(--color-text-disabled);
    cursor: default;
  }

  .topbar__save {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-inline-size: 4.5rem;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .topbar__save[data-state='error'] {
    color: var(--color-error);
  }

  .topbar__retry {
    padding-inline: var(--space-1-5);
    color: inherit;
    font-weight: var(--font-semibold);
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
  }

  .topbar__button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1-5);
    min-block-size: var(--space-8);
    padding-inline: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-weight: var(--font-medium);
    white-space: nowrap;
    cursor: pointer;
  }

  .topbar__button:hover:not(:disabled) {
    background: color-mix(in oklab, var(--color-text) 6%, var(--color-surface));
  }

  .topbar__button[data-variant='primary'] {
    border-color: var(--color-text);
    background: var(--color-text);
    color: var(--color-background);
  }

  .topbar__button[data-variant='primary']:hover:not(:disabled) {
    background: color-mix(in oklab, var(--color-text) 86%, var(--color-background));
  }

  .topbar__button[data-variant='done'] {
    border-color: var(--color-border);
    color: var(--color-text-secondary);
  }

  .topbar__button:disabled {
    cursor: default;
  }

  .topbar__button[data-variant='primary']:disabled {
    opacity: var(--opacity-60);
  }

  .topbar :global(.topbar__more) {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: var(--space-8);
    block-size: var(--space-8);
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .topbar :global(.topbar__more:hover) {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
    color: var(--color-text);
  }

  .topbar__back:focus-visible,
  .topbar__device:focus-visible,
  .topbar__quiet:focus-visible,
  .topbar__retry:focus-visible,
  .topbar__button:focus-visible,
  .topbar :global(.topbar__more:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }
</style>
