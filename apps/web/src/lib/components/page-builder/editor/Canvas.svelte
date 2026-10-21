<!--
  @component Canvas

  The page at TRUE scale (contract §7). Desktop fills the canvas; Tablet and
  Mobile are 820px and 390px frames, laid out by the kit's container queries
  exactly as that device would lay them out. Nothing is scaled.

  What the editor adds — the selection ring, the selected section's toolbar
  and the '+' insert points — is drawn on an OVERLAY positioned from the
  sections' measured boxes, so the page underneath is the public markup plus
  the kit's editing attributes and nothing else (contract §6).
-->
<script module lang="ts">
  /**
   * A message pinned above the page, with the one action that resolves it —
   * for what the page itself cannot show, like a save that can no longer
   * happen, or course details that did not load.
   */
  export interface CanvasNotice {
    id: string;
    message: string;
    action: { label: string; run: () => void };
    /** Present when the creator may put the notice away. */
    onDismiss?: () => void;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page as appPage } from '$app/state';
  import { brandEditor } from '$lib/brand-editor';
  import { orgGrounds, orgShader } from '$lib/page-builder/org-grounds';
  import { AlertTriangleIcon, PlusIcon, XIcon } from '$lib/components/ui/Icon';
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import {
    type KitPage,
    PageRenderer,
    renderableSections,
  } from '$lib/page-builder/kit';
  import type { JourneySalesContext } from '$lib/page-builder/render/types';
  import * as m from '$paraglide/messages';
  import { type Device, FRAME_WIDTH } from './editor-state';
  import {
    createInlineEditing,
    fieldFrom,
    isMultiline,
  } from './inline-edit.svelte';
  import { sectionLabel } from './outline';
  import SectionToolbar, { type SectionAction } from './SectionToolbar.svelte';

  interface Props {
    page: KitPage;
    context: JourneySalesContext;
    /**
     * Every read `context` is built from has answered. Until then the
     * sections draw their empty fallbacks, at heights that are not theirs.
     */
    contextSettled?: boolean;
    brandOverrides?: BrandTokenOverrides | null;
    device: Device;
    theme: 'light' | 'dark';
    selectedId: string | null;
    /** `how`: on the section itself, or into its words (edited in place). */
    onSelect: (id: string | null, how: 'section' | 'words') => void;
    onCommit: (sectionId: string, key: string, value: string) => void;
    onInsert: (afterId: string | null) => void;
    onAction: (action: SectionAction, id: string) => void;
    /** Shown in place of the page when no section is visible. */
    empty?: Snippet;
    /** Pinned above the page, in order, until each is resolved or put away. */
    notices?: CanvasNotice[];
  }

  const {
    page,
    context,
    contextSettled = true,
    brandOverrides = null,
    device,
    theme,
    selectedId,
    onSelect,
    onCommit,
    onInsert,
    onAction,
    empty,
    notices = [],
  }: Props = $props();

  interface Box {
    top: number;
    height: number;
  }

  let scroller = $state<HTMLElement>();
  let frame = $state<HTMLElement>();
  let boxes = $state<Record<string, Box>>({});
  let hoveredId = $state<string | null>(null);
  /** Sections out of view skip layout, once each has been laid out in full. */
  let lazy = $state(false);

  const inline = createInlineEditing({
    read: (sectionId, key) => {
      const props = page.sections.find((s) => s.id === sectionId)?.props ?? {};
      return { had: Object.hasOwn(props, key), value: props[key] };
    },
    commit: (sectionId, key, value) => onCommit(sectionId, key, value),
  });

  const rendered = $derived(inline.render(page));
  // The org's own backgrounds, so the kit keeps its real ground (03 X48).
  const grounds = $derived(
    orgGrounds(appPage.data.org, brandEditor.isOpen ? brandEditor.pending : null)
  );
  // The org's moving background, so the hero takes it (03 X50, X51).
  const shader = $derived(
    orgShader(appPage.data.org, brandEditor.isOpen ? brandEditor.pending : null)
  );
  const visible = $derived(renderableSections(page));
  const frameWidth = $derived(FRAME_WIDTH[device]);

  const selectedIndex = $derived(visible.findIndex((s) => s.id === selectedId));
  const selected = $derived(selectedIndex >= 0 ? visible[selectedIndex] : null);
  const selectedBox = $derived(selected ? boxes[selected.id] : undefined);
  const hoveredBox = $derived(
    hoveredId && hoveredId !== selectedId ? boxes[hoveredId] : undefined
  );

  /** Before the first section, then after each one. */
  const slots = $derived(
    visible.length === 0
      ? []
      : [
          {
            afterId: null,
            at: boxes[visible[0].id]?.top ?? 0,
            label: m.studio_page_editor_insert_top(),
          },
          ...visible.map((section) => {
            const box = boxes[section.id];
            return {
              afterId: section.id,
              at: box ? box.top + box.height : 0,
              label: m.studio_builder_canvas_add_after({
                section: sectionLabel(section),
              }),
            };
          }),
        ]
  );

  function sectionElements(): HTMLElement[] {
    return frame
      ? Array.from(frame.querySelectorAll<HTMLElement>('[data-lp-section]'))
      : [];
  }

  function measure(): void {
    if (!frame) return;
    const origin = frame.getBoundingClientRect().top;
    const next: Record<string, Box> = {};
    for (const element of sectionElements()) {
      const box = element.getBoundingClientRect();
      next[element.dataset.lpSection ?? ''] = {
        top: box.top - origin,
        height: box.height,
      };
    }
    boxes = next;
  }

  // Re-measure when the sections or the device change, and whenever any
  // section resizes (typing, an image arriving, a layout reflowing).
  const layoutKey = $derived(`${device}|${visible.map((s) => s.id).join(',')}`);
  $effect(() => {
    void layoutKey;
    if (!frame) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    for (const element of sectionElements()) observer.observe(element);
    return () => observer.disconnect();
  });

  // Sections out of view are skipped only once each has a height worth
  // remembering (`contain-intrinsic-block-size: auto`): every section is laid
  // out in full first, with the page's reads answered, and the second frame
  // is after that layout and its size records (Codex-61zsk.72).
  const ids = $derived(visible.map((section) => section.id));
  /** The sections laid out in full when `lazy` was last set. */
  let drawn = new Set<string>();
  // What every section's height hangs on besides its own words.
  const designKey = $derived(
    `${JSON.stringify(page.design)}|${JSON.stringify(brandOverrides)}`
  );

  $effect(() => {
    if (!frame || lazy || !contextSettled || ids.length === 0) return;
    const now = ids;
    let live = true;
    let next = 0;
    const arm = () => {
      if (!live) return;
      drawn = new Set(now);
      lazy = true;
    };
    const first = requestAnimationFrame(() => {
      next = requestAnimationFrame(() => {
        // A font still on its way would reflow the words after their heights
        // were recorded, so arm once the fonts being loaded have arrived.
        // Not on every later font load: the Style panel's previews load
        // other Styles' fonts on each visit, and laying the whole page out
        // again for each cost more than skipping saved.
        const fonts = typeof document === 'undefined' ? undefined : document.fonts;
        if (fonts?.status === 'loading') void fonts.ready.then(arm);
        else arm();
      });
    });
    return () => {
      live = false;
      cancelAnimationFrame(first);
      cancelAnimationFrame(next);
    };
  });

  // Lay every section out in full again, so each records a true height, when
  // one appears that never was (a template, an unhidden or inserted section)
  // or a read is loading again...
  $effect(() => {
    if (!contextSettled || ids.some((id) => !drawn.has(id))) lazy = false;
  });
  // ...and when the Style, its dials or the brand being edited change.
  $effect(() => {
    void designKey;
    lazy = false;
  });

  /** A section's top, in the scroller's content. */
  function topOf(element: HTMLElement, view: HTMLElement): number {
    return (
      element.getBoundingClientRect().top -
      view.getBoundingClientRect().top +
      view.scrollTop
    );
  }

  /**
   * Where the scroller must be for a section's top to sit just under its
   * edge, or as near as the scroller can go (a short last section).
   */
  function landingOf(element: HTMLElement, view: HTMLElement): number {
    const furthest = view.scrollHeight - view.clientHeight;
    return Math.max(0, Math.min(furthest, topOf(element, view) - 16));
  }

  /** Input that means the creator is steering the scroller themselves. */
  const STEERING = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  /** How long the scroller stays still before a landing is checked. */
  const STILL_MS = 150;

  /** Puts away the landing being checked, if there is one. */
  let stopSettle: (() => void) | null = null;
  $effect(() => () => stopSettle?.());

  /**
   * A section out of view keeps the height it was last drawn at, which is
   * stale after the canvas changes width, so a scroll aimed past it lands off
   * by the difference. Once the scroller is still, the sections at the target
   * have been drawn: aim again, two frames after each correction, at most
   * three times, and stop once a landing holds for two frames
   * (Codex-61zsk.72).
   *
   * The creator always wins: their own wheel, touch, click or key puts the
   * check away, and so does a newer jump, or the section leaving the page.
   */
  function settle(element: HTMLElement, view: HTMLElement): void {
    stopSettle?.();
    const armed = performance.now();
    let idle = 0;
    let tick = 0;
    const steer = (event: Event) => {
      // The event that asked for this jump may still be on its way up.
      if (event.timeStamp > armed) stop();
    };
    const stop = () => {
      clearTimeout(idle);
      cancelAnimationFrame(tick);
      view.removeEventListener('scrollend', land);
      view.removeEventListener('scroll', wait);
      for (const type of STEERING) view.removeEventListener(type, steer);
      if (stopSettle === stop) stopSettle = null;
    };
    const later = (then: () => void) => {
      tick = requestAnimationFrame(() => {
        tick = requestAnimationFrame(then);
      });
    };
    const aim = (tries: number, held: boolean) => {
      // Deleted or hidden on the way: a detached box measures all zeros.
      if (!element.isConnected || !view.isConnected) return stop();
      const goal = landingOf(element, view);
      if (Math.abs(view.scrollTop - goal) <= 2) {
        // Look once more after the sections now in range have drawn.
        if (held) stop();
        else later(() => aim(tries, true));
        return;
      }
      if (tries <= 0) return stop();
      view.scrollTo({ top: goal, behavior: 'auto' });
      later(() => aim(tries - 1, false));
    };
    const land = () => {
      clearTimeout(idle);
      view.removeEventListener('scrollend', land);
      view.removeEventListener('scroll', wait);
      aim(3, false);
    };
    // `scrollend` is the fast path; without it (Safari), or when the scroll
    // was a no-op and fires nothing, the scroller going still is the end.
    const wait = () => {
      clearTimeout(idle);
      idle = window.setTimeout(land, STILL_MS);
    };
    view.addEventListener('scrollend', land);
    view.addEventListener('scroll', wait, { passive: true });
    for (const type of STEERING) {
      view.addEventListener(type, steer, { passive: true });
    }
    stopSettle = stop;
    wait();
  }

  /** Bring a section's top into view, unless it already is. */
  export function scrollToSection(id: string): void {
    // A newer jump replaces a landing still being checked.
    stopSettle?.();
    const element = sectionElements().find((el) => el.dataset.lpSection === id);
    if (!element || !scroller) return;
    const top = topOf(element, scroller);
    const visibleNow =
      top >= scroller.scrollTop &&
      top < scroller.scrollTop + scroller.clientHeight * 0.6;
    if (visibleNow) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({
      top: Math.max(0, top - 16),
      behavior: still ? 'auto' : 'smooth',
    });
    if (lazy) settle(element, scroller);
  }

  function sectionIdAt(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    return (
      target.closest<HTMLElement>('[data-lp-section]')?.dataset.lpSection ?? null
    );
  }

  // How a section was picked comes from the click's own target, not from
  // focus: a click on a section's padding puts Chrome's caret in its nearest
  // words, so focus says "words" for both.
  function handleClick(event: MouseEvent): void {
    onSelect(sectionIdAt(event.target), fieldFrom(event.target) ? 'words' : 'section');
  }

  function handleFocusIn(event: FocusEvent): void {
    const field = fieldFrom(event.target);
    if (!field) return;
    inline.begin(field);
    if (field.sectionId !== selectedId) onSelect(field.sectionId, 'words');
  }

  function handleFocusOut(event: FocusEvent): void {
    if (fieldFrom(event.target)) inline.end();
  }

  // A heading, label or button text is one line; only paragraph fields take
  // Enter, and a soft line break has no plain-text form in any of them.
  function handleBeforeInput(event: InputEvent): void {
    const field = fieldFrom(event.target);
    if (!field) return;
    if (
      event.inputType === 'insertLineBreak' ||
      (event.inputType === 'insertParagraph' &&
        !isMultiline(field.type, field.key))
    ) {
      event.preventDefault();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    const field = fieldFrom(event.target);
    if (!field) return;
    event.preventDefault();
    field.element.blur();
  }
</script>

<div class="canvas" role="region" aria-label={m.studio_page_editor_canvas_label()}>
  {#if notices.length > 0}
    <div class="canvas__notices">
      {#each notices as notice (notice.id)}
        <div class="canvas__notice" role="alert" data-notice={notice.id}>
          <AlertTriangleIcon size={16} />
          <p class="canvas__notice-text">{notice.message}</p>
          <button type="button" class="canvas__notice-action" onclick={notice.action.run}>
            {notice.action.label}
          </button>
          {#if notice.onDismiss}
            <button
              type="button"
              class="canvas__notice-dismiss"
              aria-label={m.studio_page_editor_dismiss()}
              title={m.studio_page_editor_dismiss()}
              onclick={notice.onDismiss}
            >
              <XIcon size={16} />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
  <div class="canvas__scroller" bind:this={scroller}>
    <div
      class="canvas__frame"
      data-device={device}
      style:--_frame={frameWidth === null ? undefined : `${frameWidth}px`}
      bind:this={frame}
    >
      {#if visible.length === 0}
        <div class="canvas__empty">{@render empty?.()}</div>
      {:else}
        <!--
          Pointer selection only: the keyboard path is the outline (arrow
          keys), and focusing any text field on the page selects its section.
        -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="canvas__page"
          data-lazy={lazy ? '' : undefined}
          onclick={handleClick}
          onfocusin={handleFocusIn}
          onfocusout={handleFocusOut}
          onbeforeinput={handleBeforeInput}
          onkeydown={handleKeydown}
          onpointerover={(event) => (hoveredId = sectionIdAt(event.target))}
          onpointerleave={() => (hoveredId = null)}
        >
          <PageRenderer
            page={rendered}
            {context}
            {brandOverrides}
            edit={inline.edit}
            {selectedId}
            {theme}
            still
            sticky={false}
            orgGrounds={grounds}
            orgShader={shader}
          />
        </div>

        <div class="canvas__overlay">
          {#if hoveredBox}
            <div
              class="canvas__ring"
              data-kind="hover"
              style:top="{hoveredBox.top}px"
              style:height="{hoveredBox.height}px"
            ></div>
          {/if}
          {#if selected && selectedBox}
            <div
              class="canvas__ring"
              data-kind="selected"
              style:top="{selectedBox.top}px"
              style:height="{selectedBox.height}px"
            ></div>
            <div
              class="canvas__track"
              style:top="{selectedBox.top}px"
              style:height="{selectedBox.height}px"
            >
              <SectionToolbar
                label={sectionLabel(selected)}
                canMoveUp={selectedIndex > 0}
                canMoveDown={selectedIndex < visible.length - 1}
                onAction={(action) => onAction(action, selected.id)}
              />
            </div>
          {/if}
          {#each slots as slot (slot.afterId ?? '')}
            <div class="canvas__insert" style:top="{slot.at}px" data-after={slot.afterId ?? ''}>
              <button
                type="button"
                class="canvas__insert-button"
                aria-label={slot.label}
                title={slot.label}
                onclick={() => onInsert(slot.afterId)}
              >
                <PlusIcon size={16} />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .canvas {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-block-size: 0;
    block-size: 100%;
    isolation: isolate;
    background: var(--color-background);
  }

  /* The warning ramp the studio panels give a read failure: nothing here is
     beyond fixing, and the notice's one action says what fixes it. */
  .canvas__notices {
    grid-row: 1;
    display: grid;
  }

  .canvas__notice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-block-end: var(--border-width) var(--border-style) var(--color-warning-200);
    background-color: var(--color-warning-50);
    color: var(--color-warning-700);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
  }

  .canvas__notice :global(svg) {
    flex: none;
  }

  .canvas__notice-text {
    flex: 1;
    min-inline-size: 0;
    margin: 0;
  }

  .canvas__notice-action,
  .canvas__notice-dismiss {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-block-size: var(--space-7);
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: var(--font-semibold);
    cursor: pointer;
  }

  .canvas__notice-action {
    padding: 0 var(--space-2);
    border: var(--border-width) var(--border-style) currentColor;
  }

  .canvas__notice-dismiss {
    min-inline-size: var(--space-7);
    padding: 0;
    border: 0;
  }

  .canvas__notice-action:hover,
  .canvas__notice-dismiss:hover {
    background: color-mix(in oklab, currentColor 10%, transparent);
  }

  .canvas__notice-action:focus-visible,
  .canvas__notice-dismiss:focus-visible {
    outline: var(--border-width-thick) solid currentColor;
    outline-offset: var(--focus-offset);
  }

  .canvas__scroller {
    grid-row: 2;
    min-block-size: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .canvas__frame {
    position: relative;
    isolation: isolate;
    min-block-size: 100%;
    background: var(--color-surface);
  }

  /* A device frame: its real width, centred, with a quiet edge. */
  .canvas__frame:not([data-device='desktop']) {
    inline-size: var(--_frame);
    min-block-size: auto;
    margin: var(--space-6) auto;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    overflow: clip;
  }

  .canvas__empty {
    display: grid;
    place-items: center;
    min-block-size: 100%;
    padding: var(--space-8);
  }

  .canvas__frame:not([data-device='desktop']) .canvas__empty {
    min-block-size: 70vh;
  }

  /* A section away from the scroller's view is not laid out
     (Codex-61zsk.72). On a desktop the canvas changes width on every switch
     to or from the Page tab, and every section was laid out again however far
     down the page: on a 28-section page, most of the switch. A skipped
     section keeps the height it was last drawn at (`auto`), recorded while
     it was drawn, so the scroll, the section rings and the insert points
     hold; `scrollToSection` corrects a landing the stale heights moved.
     Only where the browser anchors scrolling: without it, a stale section
     drawn above the view as the creator scrolls up shoves what they are
     reading (Safari). */
  .canvas__page :global(.lp-section) {
    contain-intrinsic-block-size: auto 40rem;
  }

  @supports (overflow-anchor: auto) {
    .canvas__page[data-lazy] :global(.lp-section) {
      content-visibility: auto;
    }
  }

  .canvas__page :global([contenteditable='true']) {
    cursor: text;
  }

  .canvas__page :global([contenteditable='true']:focus) {
    outline: none;
  }

  .canvas__overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  /* Two rings, dark then light, so the mark reads on any section's colour. */
  .canvas__ring {
    position: absolute;
    inset-inline: 0;
    box-shadow:
      inset 0 0 0 var(--border-width-thick) var(--color-text),
      inset 0 0 0 calc(var(--border-width-thick) * 2) var(--color-background);
  }

  .canvas__ring[data-kind='hover'] {
    box-shadow:
      inset 0 0 0 var(--border-width) color-mix(in oklab, var(--color-text) 55%, transparent),
      inset 0 0 0 calc(var(--border-width) * 2)
        color-mix(in oklab, var(--color-background) 55%, transparent);
  }

  .canvas__track {
    position: absolute;
    inset-inline-end: var(--space-3);
    padding-block-start: var(--space-3);
    display: flex;
    align-items: flex-start;
  }

  .canvas__insert {
    position: absolute;
    inset-inline: 0;
    block-size: var(--space-6);
    translate: 0 -50%;
    display: grid;
    place-items: center;
    pointer-events: auto;
  }

  .canvas__insert::before {
    content: '';
    position: absolute;
    inset-inline: var(--space-6);
    inset-block-start: 50%;
    block-size: var(--border-width-thick);
    translate: 0 -50%;
    background: var(--color-text);
    box-shadow: 0 0 0 var(--border-width) var(--color-background);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-default);
  }

  .canvas__insert-button {
    position: relative;
    display: grid;
    place-items: center;
    inline-size: var(--space-8);
    block-size: var(--space-8);
    padding: 0;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-md);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity var(--duration-fast) var(--ease-default),
      transform var(--duration-fast) var(--ease-default);
  }

  .canvas__insert:hover::before,
  .canvas__insert:focus-within::before,
  .canvas__insert:hover .canvas__insert-button,
  .canvas__insert-button:focus-visible {
    opacity: 1;
  }

  .canvas__insert-button:hover {
    transform: scale(1.08);
  }

  .canvas__insert-button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }
</style>
