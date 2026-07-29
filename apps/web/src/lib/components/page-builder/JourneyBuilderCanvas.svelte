<!--
  @component JourneyBuilderCanvas

  The INLINE WYSIWYG canvas for the journey sales-page builder
  (Codex-2pryk.3.3 · WP-5). Renders the store's enabled sections directly via the
  EDITABLE {@link SectionRenderer} from `$lib/page-builder/render-edit`, so the
  canvas IS the page — structurally, not pixel-for-pixel.

  NOT the public components. `render-edit/` holds 8 static, contenteditable
  sections; the public page renders 11 animated ones from `render/`. The canvas
  therefore cannot show real motion, and a section with no `render-edit` twin does
  not appear here at all. The route's "View live ↗" (which saves first) is the way
  to see the true page. Unifying the two sets behind one `editable` flag is filed
  as a follow-up.

  Each block is:
    · selectable  — mousedown selects it (without stealing caret from text)
    · inline-editable — contenteditable copy writes straight to the store
    · block-toolbarred — move ↑/↓, duplicate, add-after, delete (on selection)

  The primary editing surface (the user chose inline WYSIWYG over an iframe): every
  edit mutates the `pageBuilder` store, which the route also streams to the public
  preview bridge for a separate full-width real-page preview. In `editable={false}`
  (Preview mode) the block chrome + contenteditable are off — a clean read-only page.
-->
<script lang="ts">
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { SectionRenderer } from '$lib/page-builder/render-edit';
  import type { JourneyStagePreview } from '$lib/page-builder/render-edit';
  import {
    ChevronDownIcon,
    ChevronUpIcon,
    CopyIcon,
    PlusIcon,
    TrashIcon,
  } from '$lib/components/ui/Icon';
  import AddSectionPicker from './AddSectionPicker.svelte';

  interface Props {
    /** Off in Preview mode — hides block chrome + disables contenteditable. */
    editable?: boolean;
    /** Canvas device width. */
    device?: 'desktop' | 'tablet' | 'mobile';
    /** Sections rail collapsed — the bar's toggle flips it (route owns the state). */
    railCollapsed?: boolean;
    onToggleRail?: () => void;
    /** Page slug + org domain for the read-only address read-out in the bar. */
    slug?: string;
    orgDomain?: string;
    /** Curriculum stages the map/descent section previews. */
    stages?: readonly JourneyStagePreview[];
  }

  let {
    editable = true,
    device = 'desktop',
    railCollapsed = false,
    onToggleRail,
    slug = '',
    orgDomain = '',
    stages = [],
  }: Props = $props();

  const sections = $derived(pageBuilder.sections);
  const enabled = $derived(sections.filter((s) => s.enabled));
  const selectedId = $derived(pageBuilder.selectedSectionId);

  const indexOf = (id: string): number => sections.findIndex((s) => s.id === id);

  // In-canvas "add after this block" floating picker.
  let addAfterId = $state<string | null>(null);
  let addPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

  function openAdd(afterId: string, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    addPos = {
      x: Math.min(r.left, window.innerWidth - 288),
      y: Math.min(r.bottom + 6, window.innerHeight - 360),
    };
    addAfterId = afterId;
  }

  function onAdd(type: string): void {
    if (addAfterId) pageBuilder.addSection(type, addAfterId);
    addAfterId = null;
  }

  function onEditProp(id: string, key: string, value: string): void {
    pageBuilder.setSectionProp(id, key, value);
  }

  // A block-toolbar button must not steal the mousedown selection nor bubble it.
  function stop(event: Event): void {
    event.stopPropagation();
  }
</script>

<div class="jbc" data-editable={editable ? '' : undefined}>
  <div class="jbc__bar">
    {#if onToggleRail}
      <button
        type="button"
        class="jbc__railtoggle"
        aria-pressed={railCollapsed}
        title={railCollapsed ? 'Show the sections panel' : 'Collapse the sections panel'}
        onclick={onToggleRail}
      >
        <span class="jbc__chev" class:jbc__chev--collapsed={railCollapsed} aria-hidden="true">«</span>
        Sections
      </button>
    {/if}
    <span class="jbc__live"><span class="jbc__live-dot" aria-hidden="true"></span> Live</span>
    <span class="jbc__url">{orgDomain || 'your-space'} / journeys / {slug || 'draft'}</span>
    {#if editable}
      <span class="jbc__hint">Click a block to edit · type directly into text</span>
    {/if}
  </div>

  <div class="jbc__stage">
    <!-- `journey-palette` supplies the colour ladder `.jp` styles read; it is the
         same file the live sales page and checkout derive from, so the canvas and
         the real page cannot drift apart again (Codex-gfg50). The canvas takes
         the BASE class only — `--page` would re-point `--color-surface*` /
         `--color-border*`, which the in-canvas block affordances below read and
         need to keep studio-neutral against any page palette. -->
    <div
      class="jbc-page jp journey-palette"
      class:jbc-page--editable={editable}
      data-device={device}
    >
      {#each enabled as section (section.id)}
        {@const i = indexOf(section.id)}
        {@const isSel = editable && selectedId === section.id}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="jbc-block"
          class:jbc-block--selected={isSel}
          data-sec={section.id}
          onmousedown={editable ? () => pageBuilder.selectSection(section.id) : undefined}
        >
          {#if editable}
            <span class="jbc-block__tag">{section.name ?? section.type}</span>
            {#if isSel}
              <div class="jbc-block__bar" role="toolbar" aria-label="Section actions">
                <button
                  type="button"
                  class="jbc-block__btn"
                  title="Move up"
                  disabled={i <= 0}
                  onmousedown={stop}
                  onclick={() => pageBuilder.moveSection(section.id, -1)}
                >
                  <ChevronUpIcon size={15} />
                </button>
                <button
                  type="button"
                  class="jbc-block__btn"
                  title="Move down"
                  disabled={i >= sections.length - 1}
                  onmousedown={stop}
                  onclick={() => pageBuilder.moveSection(section.id, 1)}
                >
                  <ChevronDownIcon size={15} />
                </button>
                <button
                  type="button"
                  class="jbc-block__btn"
                  title="Duplicate"
                  onmousedown={stop}
                  onclick={() => pageBuilder.duplicateSection(section.id)}
                >
                  <CopyIcon size={14} />
                </button>
                <button
                  type="button"
                  class="jbc-block__btn"
                  title="Add a section after this"
                  onmousedown={stop}
                  onclick={(e) => openAdd(section.id, e.currentTarget)}
                >
                  <PlusIcon size={15} />
                </button>
                <button
                  type="button"
                  class="jbc-block__btn jbc-block__btn--danger"
                  title="Delete"
                  onmousedown={stop}
                  onclick={() => pageBuilder.removeSection(section.id)}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            {/if}
          {/if}

          <SectionRenderer {section} {editable} {onEditProp} {stages} />
        </div>
      {/each}

      {#if enabled.length === 0}
        <p class="jbc-empty">No visible sections. Enable one in the rail, or add a section.</p>
      {/if}
    </div>
  </div>

  {#if addAfterId}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="jbc-addpop"
      style="left: {addPos.x}px; top: {addPos.y}px;"
      onmousedown={stop}
    >
      <AddSectionPicker onadd={onAdd} onclose={() => (addAfterId = null)} />
    </div>
    <button
      type="button"
      class="jbc-addpop__scrim"
      aria-label="Close add-section picker"
      onclick={() => (addAfterId = null)}
    ></button>
  {/if}
</div>

<style>
  .jbc {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  /* ── canvas bar ── */
  .jbc__bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
  }

  .jbc__railtoggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jbc__railtoggle:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .jbc__chev {
    display: inline-block;
    transition: transform var(--duration-normal) var(--ease-default);
  }

  .jbc__chev--collapsed {
    transform: rotate(180deg);
  }

  .jbc__live {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-success-600, var(--color-success));
  }

  .jbc__live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: currentColor;
    box-shadow: 0 0 8px 1px currentColor;
  }

  .jbc__url {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .jbc__hint {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── stage + page ── */
  .jbc__stage {
    overflow: auto;
    display: grid;
    place-items: start center;
    padding: var(--space-6) var(--space-4);
    background-color: var(--color-surface-secondary);
    background-image: radial-gradient(
      color-mix(in oklab, var(--color-border) 60%, transparent) 1px,
      transparent 1px
    );
    background-size: 22px 22px;
  }

  .jbc-page {
    width: 100%;
    max-width: 1080px;
    border-radius: var(--radius-xl);
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--color-border);
    box-shadow: var(--shadow-xl);
    transition: max-width var(--duration-slow) var(--ease-default);
  }

  .jbc-page[data-device='tablet'] {
    max-width: var(--brand-studio-preview-tablet, 768px);
  }

  .jbc-page[data-device='mobile'] {
    max-width: var(--brand-studio-preview-mobile, 380px);
  }

  /* ── block selection + chrome ── */
  .jbc-block {
    position: relative;
  }

  .jbc-page--editable .jbc-block {
    cursor: pointer;
  }

  .jbc-block::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    outline: 0 solid transparent;
    outline-offset: -1px;
    transition: outline-color var(--duration-fast) var(--ease-default);
    z-index: 40;
  }

  .jbc-page--editable .jbc-block:hover::after {
    outline: var(--border-width) solid color-mix(in oklab, var(--color-interactive) 45%, transparent);
  }

  .jbc-block--selected::after {
    outline: var(--border-width-thick) solid var(--color-interactive);
    outline-offset: -2px;
  }

  .jbc-block__tag {
    position: absolute;
    top: 0;
    left: 0;
    transform: translateY(-100%);
    z-index: 41;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-on-brand, var(--color-background));
    background-color: var(--color-interactive);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-default);
  }

  .jbc-block:hover .jbc-block__tag,
  .jbc-block--selected .jbc-block__tag {
    opacity: 1;
  }

  .jbc-block__bar {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    z-index: 43;
    display: flex;
    gap: var(--space-0-5);
    padding: var(--space-1);
    border-radius: var(--radius-md);
    background-color: color-mix(in oklab, var(--color-surface) 92%, transparent);
    border: var(--border-width) var(--border-style) var(--color-border);
    box-shadow: var(--shadow-lg);
    backdrop-filter: blur(var(--blur-sm));
  }

  .jbc-block__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-6);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jbc-block__btn:hover:not(:disabled) {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .jbc-block__btn:disabled {
    opacity: var(--opacity-40, 0.4);
    cursor: default;
  }

  .jbc-block__btn--danger:hover:not(:disabled) {
    color: var(--color-error-600, var(--color-error));
    background-color: color-mix(in oklab, var(--color-error, red) 14%, transparent);
  }

  /* editable-text affordance — only in the editing canvas */
  .jbc-page--editable :global([data-field]) {
    border-radius: var(--radius-xs, 3px);
    outline: none;
    transition: var(--transition-colors);
  }

  .jbc-page--editable :global([data-field][contenteditable='true']:hover) {
    background-color: color-mix(in oklab, var(--color-interactive) 12%, transparent);
  }

  .jbc-page--editable :global([data-field][contenteditable='true']:focus) {
    background-color: color-mix(in oklab, var(--color-interactive) 10%, transparent);
    box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--color-interactive) 70%, transparent);
  }

  .jbc-empty {
    padding: var(--space-16) var(--space-6);
    text-align: center;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  /* ── in-canvas add popover ── */
  .jbc-addpop {
    position: fixed;
    z-index: var(--z-popover, 60);
    width: 272px;
    max-height: 60vh;
    overflow-y: auto;
    box-shadow: var(--shadow-xl);
    border-radius: var(--radius-lg);
  }

  .jbc-addpop__scrim {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover, 60) - 1);
    border: 0;
    background: none;
    cursor: default;
  }
</style>
