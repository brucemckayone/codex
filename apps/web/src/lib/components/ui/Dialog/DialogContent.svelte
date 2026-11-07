<!--
  @component Dialog.Content

  The panel. Its direct children are the parts, in this order: Dialog.Header,
  Dialog.Toolbar (optional), Dialog.Body, Dialog.Footer, with a Dialog.Form
  wrapping the Toolbar / Body / Footer run when they submit together.
  scripts/check-dialog-structure.mjs fails CI on anything else: every scroll
  and spacing rule below assumes them.

  @prop {'sm' | 'md' | 'lg'} [size='md'] - max-width: 28 / 42 / 56rem. A
    drawer keeps it as its width, so a drawer is 42rem unless it says `sm`.
  @prop {'dialog' | 'drawer'} [variant='dialog'] -
    `dialog`: centred, at most 85dvh; the panel clips and only Dialog.Body
    scrolls, so Header and Footer stay in view.
    `drawer`: a full-height panel on the right edge that slides in, padded
    `--space-6` with a `--space-5` gap. The WHOLE panel scrolls, as the
    hand-built drawers did: Dialog.Body and Dialog.Form lay their children
    straight into it (`display: contents`), so a section, a `margin-top:
    auto` actions row or a sticky bar sits exactly where it would as a direct
    child. The built-in close button stays pinned at the top right while it
    scrolls. Below the sm breakpoint it fills the screen.
  @prop {boolean} [sheet=false] - drawer only: below the sm breakpoint, a
    bottom sheet instead (full width, at most 90dvh, rounded top, slides up),
    padded `--space-5 --space-4`. A sheet at every width, not only on a
    phone, is `placement="bottom"` (MobileBottomSheet).
  @prop {boolean} [flush=false] - nothing is padded or spaced. A drawer's
    panel drops its padding and gap (a hero photo runs edge to edge). Header,
    Toolbar, Body and Footer become bare block boxes, with no padding, gap,
    rule, tray or flex layout of their own (Body still takes the rest of the
    panel and scrolls), so each holds one row the page lays out itself: a
    command palette's search row, results and key hints.
  @prop {boolean} [floating=false] - drawer only: a glass panel that floats
    `--space-3` in from the edge, `--container-drawer` wide, rounded and
    shadowed. Only Dialog.Body scrolls, as in a dialog, so Header and Footer
    stay pinned (FilterDrawer). With `sheet`, below sm it floats
    `--space-2` above the bottom edge, at most 85dvh.
  @prop {boolean} [closeButton=true] - false drops the built-in close button,
    for a panel that renders its own. It must then render a visible one:
    Escape and a press outside are not enough on a touch screen.

  The rest set the look of a panel that isn't a plain centred dialog. A
  command palette and a phone's bottom sheet are dialogs too: they get the
  focus trap, scroll lock, Escape and focus return from here.

  @prop {'center' | 'top' | 'bottom'} [placement='center'] - dialog only.
    `top`: the panel's top edge is 15vh down, centred across (a command
    palette), at most 70dvh. `bottom`: a sheet that floats `--space-2` above
    the bottom edge and in from each side, full width whatever `size` says,
    at most 70dvh, at every viewport width; a `maxWidth` still narrows it.
    A right-hand rail that becomes a sheet only below sm is
    `variant="drawer" sheet` instead (FilterDrawer).
  @prop {CssLength} [maxWidth] - the panel's max-width as a CSS length, over
    `size`, for a width off the 28 / 42 / 56rem scale. The `--space-4`
    gutter (`--space-2` at the bottom) still applies, so `40rem` is
    min(40rem, 100vw − 2rem). Use tokens where one exists.
  @prop {CssLength} [maxHeight] - the panel's max-height as a CSS length, over
    the 85dvh (70dvh at top and bottom) default. It never runs past the room
    its placement leaves, the screen less the wrapper's gutter, so `48rem`
    on a 600px-tall screen still keeps the Footer in view. One that can't
    resolve (an undefined `var()`, or a token set on a page container,
    which the portal under <body> doesn't inherit) keeps the default.
    Write vh for a viewport height: a dvh value has no fallback in Safari
    < 15.4, Chrome < 108 or Firefox < 101, so there it drops the cap.
  @prop {'modal' | 'lg'} [radius='modal'] - dialog only: the corner,
    `--radius-modal` or the smaller `--radius-lg`.
  @prop {'elevated' | 'base' | 'glass'} [surface] - the panel's fill.
    `elevated` (`--color-surface-elevated`) is a dialog's and a drawer's;
    `base` is the page's own `--color-surface`; `glass` is
    `--material-glass` with a `--blur-xl` backdrop and a glass edge, the
    default for `floating`.
  @prop {'blur' | 'dim' | 'dark'} [overlay='blur'] - what covers the page.
    `blur`: `--color-surface-overlay` over a `--blur-md` blur. `dim`:
    `--color-overlay` at half strength, no blur. `dark`: `--color-overlay`,
    no blur.
  @prop {'auto' | 'drop' | 'rise' | 'none'} [motion='auto'] - dialog only.
    `auto`: the panel lifts in and the overlay fades in, on open only.
    `drop`: the panel falls 20px into place over 200ms while the overlay
    fades over 150ms, and leaves the same way (a command palette). `rise`:
    the panel rises 400px into place over 300ms while the overlay fades over
    200ms, and leaves the same way (a bottom sheet). `none`: it appears and
    goes at once. Under reduced motion `drop` and `rise` are instant, as the
    duration tokens make `auto`.
-->
<script lang="ts">
  import { type createDialog, melt } from '@melt-ui/svelte';
  import { getContext, setContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { prefersReducedMotion } from 'svelte/motion';
  import { fade, fly } from 'svelte/transition';
  import { XIcon } from '$lib/components/ui/Icon';
  import { forwardBrandTokens } from '$lib/utils/portal-brand';
  import type { CssLength } from './css-length';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'dialog' | 'drawer';
    sheet?: boolean;
    flush?: boolean;
    floating?: boolean;
    closeButton?: boolean;
    placement?: 'center' | 'top' | 'bottom';
    maxWidth?: CssLength;
    maxHeight?: CssLength;
    radius?: 'modal' | 'lg';
    surface?: 'elevated' | 'base' | 'glass';
    overlay?: 'blur' | 'dim' | 'dark';
    motion?: 'auto' | 'drop' | 'rise' | 'none';
  }

  const {
    children,
    size = 'md',
    variant = 'dialog',
    sheet = false,
    flush = false,
    floating = false,
    closeButton = true,
    placement = 'center',
    maxWidth,
    maxHeight,
    radius = 'modal',
    surface,
    overlay: overlayStyle = 'blur',
    motion = 'auto',
    class: className,
    ...restProps
  }: Props = $props();
  const {
    elements: { portalled, overlay, content, close },
    states: { open },
  } = getContext<ReturnType<typeof createDialog>>('DIALOG');
  /** Dialog.Root's `dismissible`: false while a request it started runs. */
  const dismissible = getContext<{ current: boolean } | undefined>('DIALOG_DISMISSIBLE');
  /** Where Dialog.Root finds the panel: by node, since a page's `id` replaces Melt's. */
  const panelNode = getContext<{ current: HTMLElement | null } | undefined>('DIALOG_PANEL');
  function registerPanel(node: HTMLElement) {
    if (panelNode) panelNode.current = node;
    return {
      destroy() {
        if (panelNode?.current === node) panelNode.current = null;
      },
    };
  }
  const drawer = $derived(variant === 'drawer');
  /** A drawer-only prop as a data attribute: present, or absent. */
  const drawerFlag = (on: boolean) => (drawer && on ? '' : undefined);
  /** A dialog-only prop as a data attribute: absent at its default. */
  const dialogValue = <T extends string>(value: T, fallback: T) =>
    !drawer && value !== fallback ? value : undefined;
  /**
   * What scrolls: `dialog` and `floating` scroll Body, `drawer` the whole
   * panel. Body, Form, Toolbar and Footer read it; in `drawer` Body and
   * Form stop being a box, a stacked Toolbar stops scrolling on its own, and
   * the close button turns sticky. The parts read `flush` from here too.
   */
  const layout = $derived(!drawer ? 'dialog' : floating ? 'floating' : 'drawer');
  setContext('DIALOG_LAYOUT', {
    get current() {
      return layout;
    },
    get flush() {
      return flush;
    },
  });
  const fill = $derived(surface ?? (drawer && floating ? 'glass' : 'elevated'));

  /**
   * `drop` and `rise`: the panel's fly and the overlay's fade, both ways, in
   * ms as Svelte's transitions take them. 200 is --duration-normal and 300
   * --duration-slow; 150, between --duration-fast and --duration-normal, is
   * the search palette's fade as it was measured. A token change does not
   * reach them.
   */
  const TRAVEL = {
    drop: { y: -20, duration: 200, overlay: 150 },
    rise: { y: 400, duration: 300, overlay: 200 },
  } as const;
  const travel = $derived(
    !drawer && (motion === 'drop' || motion === 'rise') && !prefersReducedMotion.current
      ? TRAVEL[motion]
      : undefined
  );
  // A JS transition, not a keyframe: it plays on close as well, which CSS
  // can't before the node is removed. Every other panel gets `{}`, which
  // Svelte finishes at once, so it still opens and closes synchronously.
  const panelMotion = (node: Element) =>
    travel ? fly(node, { y: travel.y, duration: travel.duration }) : {};
  const overlayMotion = (node: Element) => (travel ? fade(node, { duration: travel.overlay }) : {});
</script>

{#if $open}
  <div use:melt={$portalled} use:forwardBrandTokens>
    <div
      use:melt={$overlay}
      class="dialog-overlay"
      data-variant={variant}
      data-floating={drawerFlag(floating)}
      data-overlay={overlayStyle === 'blur' ? undefined : overlayStyle}
      data-motion={dialogValue(motion, 'auto')}
      transition:overlayMotion
    ></div>
    <div class="dialog-content-wrapper" data-placement={dialogValue(placement, 'center')}>
      <div
        use:melt={$content}
        use:registerPanel
        {...restProps}
        class={['dialog-content', className]}
        data-size={size}
        data-variant={variant}
        data-sheet={drawerFlag(sheet)}
        data-flush={drawerFlag(flush)}
        data-floating={drawerFlag(floating)}
        data-placement={dialogValue(placement, 'center')}
        data-radius={dialogValue(radius, 'modal')}
        data-surface={fill}
        data-motion={dialogValue(motion, 'auto')}
        style:max-width={maxWidth}
        style:--dialog-max-height={maxHeight}
        style:max-height={maxHeight ? 'var(--dialog-max)' : undefined}
        transition:panelMotion
      >
        {@render children()}
        {#if closeButton}
          <button
            use:melt={$close}
            class="dialog-close"
            data-layout={layout}
            aria-label="Close"
            disabled={dismissible ? !dismissible.current : false}
          >
            <XIcon size={18} />
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Overlay ──────────────────────────────────────────────────────── */
  .dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal-backdrop);
    background: var(--color-surface-overlay);
    backdrop-filter: blur(var(--blur-md));
    -webkit-backdrop-filter: blur(var(--blur-md));
    animation: overlay-in var(--duration-normal) var(--ease-out) both;
  }

  .dialog-overlay[data-overlay='dim'],
  .dialog-overlay[data-overlay='dark'] {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .dialog-overlay[data-overlay='dim'] {
    background: color-mix(in srgb, var(--color-overlay) 50%, transparent);
  }

  .dialog-overlay[data-overlay='dark'] {
    background: var(--color-overlay);
  }

  /* ── Centering wrapper ────────────────────────────────────────────── */
  .dialog-content-wrapper {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }

  .dialog-content-wrapper[data-placement='top'] {
    align-items: flex-start;
    padding-top: 15vh;
  }

  .dialog-content-wrapper[data-placement='bottom'] {
    align-items: flex-end;
    padding: var(--space-2);
  }

  /* ── Content panel ────────────────────────────────────────────────── */
  .dialog-content {
    position: relative;
    background: var(--color-surface-elevated, var(--color-surface));
    border-radius: var(--radius-modal);
    box-shadow: var(--shadow-xl);
    border: var(--border-width) var(--border-style) var(--color-border);
    width: 100%;
    max-height: var(--dialog-default-max);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: content-in var(--duration-slow) var(--ease-out) both;
    /* Per placement: the default cap, and the room the wrapper leaves the
       panel (the screen less the wrapper's gutter), which a `maxHeight`
       never runs past. A `maxHeight` that can't resolve makes
       --dialog-max-height invalid, so the fallback takes the default cap:
       without it --dialog-max would be invalid too, and the inline
       max-height would compute to none. Both are in --dialog-dvh, below. */
    --dialog-dvh: 1dvh;
    --dialog-default-max: calc(85 * var(--dialog-dvh));
    --dialog-room: calc(100 * var(--dialog-dvh) - 2 * var(--space-4));
    --dialog-max: min(var(--dialog-max-height, var(--dialog-default-max)), var(--dialog-room));
  }

  /* An engine without dvh (Safari < 15.4, Chrome < 108, Firefox < 101)
     drops a dvh value, so every cap would be gone. A `max-height: 85vh`
     written before each one can't help: these are read through custom
     properties, and a var() always parses, so the dvh one would still win.
     The caps and rooms take their unit from here instead. */
  @supports not (height: 1dvh) {
    .dialog-content {
      --dialog-dvh: 1vh;
    }
  }

  /* A clipping panel with no Body (a ConfirmDialog: Header and Footer only)
     scrolls as a whole instead, so a long Description cannot push the
     Footer out of reach on a short screen: in a panel that clips, only
     Body shrinks. A drawer that scrolls as a whole already does. */
  .dialog-content:is([data-variant='dialog'], [data-floating]):not(
      :has(> :global(.dialog-body), > :global(.dialog-form) > :global(.dialog-body))
    ) {
    overflow-y: auto;
  }

  /* Size variants */
  .dialog-content[data-size='sm'] {
    max-width: 28rem;
  }
  .dialog-content[data-size='md'] {
    max-width: 42rem;
  }
  .dialog-content[data-size='lg'] {
    max-width: 56rem;
  }

  .dialog-content[data-placement='top'],
  .dialog-content[data-placement='bottom'] {
    --dialog-default-max: calc(70 * var(--dialog-dvh));
  }

  .dialog-content[data-placement='top'] {
    --dialog-room: calc(100 * var(--dialog-dvh) - 15vh - var(--space-4));
  }

  /* A sheet is full width (0,2,0, after data-size). */
  .dialog-content[data-placement='bottom'] {
    max-width: none;
    --dialog-room: calc(100 * var(--dialog-dvh) - 2 * var(--space-2));
  }

  .dialog-content[data-radius='lg'] {
    border-radius: var(--radius-lg);
  }

  /* `drop`, `rise` and `none` run no keyframe: drop and rise are Svelte
     transitions, so they play on close as well. */
  .dialog-overlay[data-motion],
  .dialog-content[data-motion] {
    animation: none;
  }

  /* ── Drawer variant ───────────────────────────────────────────────
     The common part of the three hand-built drawers' `:global()` rules
     (Customer, Media, Creator). Width stays with data-size: their own
     max-width lost to it on specificity, so `md` is what they render. The
     padding and gap are properties so the sticky close button below can
     sit against them. */
  .dialog-content[data-variant='drawer'] {
    --drawer-pad-block: var(--space-6);
    --drawer-pad-inline: var(--space-6);
    --drawer-gap: var(--space-5);
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: auto;
    height: 100%;
    --dialog-default-max: calc(100 * var(--dialog-dvh));
    --dialog-room: calc(100 * var(--dialog-dvh));
    gap: var(--drawer-gap);
    padding: var(--drawer-pad-block) var(--drawer-pad-inline);
    overflow-x: hidden;
    overflow-y: auto;
    border: none;
    border-left: var(--border-width) var(--border-style) var(--color-border);
    border-radius: 0;
    animation-name: drawer-in-right;
    animation-duration: var(--duration-slower);
  }

  .dialog-content[data-variant='drawer'][data-flush] {
    --drawer-pad-block: 0px;
    --drawer-pad-inline: 0px;
    --drawer-gap: 0px;
    gap: normal;
  }

  .dialog-overlay[data-variant='drawer']:not([data-floating]) {
    animation-duration: var(--duration-slow);
  }

  /* Floating: FilterDrawer's glass rail. It clips like a dialog, so only
     Body scrolls. 0,4,0 beats data-size, so the rail is
     --container-drawer wide whatever `size` says. */
  .dialog-content[data-variant='drawer'][data-floating] {
    top: var(--space-3);
    right: var(--space-3);
    bottom: var(--space-3);
    width: calc(100% - var(--space-6));
    max-width: var(--container-drawer);
    height: auto;
    --dialog-default-max: calc(100 * var(--dialog-dvh) - var(--space-6));
    --dialog-room: calc(100 * var(--dialog-dvh) - var(--space-6));
    gap: normal;
    padding: 0;
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--material-glass-border);
    border-radius: var(--radius-xl);
    animation-duration: var(--duration-slow);
    animation-timing-function: var(--ease-smooth);
  }

  /* Phone: a bottom sheet. `max-width: none` wins over data-size here
     (0,4,0 against 0,3,0), so the sheet is full-bleed at every width. */
  @media (--below-sm) {
    .dialog-content[data-variant='drawer'][data-sheet] {
      top: auto;
      left: 0;
      max-width: none;
      height: auto;
      --dialog-default-max: calc(90 * var(--dialog-dvh));
      --drawer-pad-block: var(--space-5);
      --drawer-pad-inline: var(--space-4);
      border-left: none;
      border-top: var(--border-width) var(--border-style) var(--color-border);
      border-radius: var(--radius-modal) var(--radius-modal) 0 0;
      animation-name: drawer-in-bottom;
    }

    .dialog-content[data-variant='drawer'][data-sheet][data-flush] {
      --drawer-pad-block: 0px;
      --drawer-pad-inline: 0px;
    }

    /* The floating sheet keeps its glass edge and round corners, inset
       --space-2 from three sides, and rises on a spring. */
    .dialog-content[data-variant='drawer'][data-sheet][data-floating] {
      left: var(--space-2);
      right: var(--space-2);
      bottom: var(--space-2);
      width: auto;
      --dialog-default-max: calc(85 * var(--dialog-dvh));
      --dialog-room: calc(100 * var(--dialog-dvh) - var(--space-2));
      padding: 0;
      border: var(--border-width) var(--border-style) var(--material-glass-border);
      border-radius: var(--radius-xl);
      animation-name: drawer-rise;
      animation-timing-function: var(--ease-spring);
    }
  }

  /* ── Surface ──────────────────────────────────────────────────────────
     After the drawer rules: glass recolours the drawer's edge too. A
     floating drawer is glass unless it says otherwise. */
  .dialog-content[data-surface='base'] {
    background: var(--color-surface);
  }

  .dialog-content[data-surface='glass'] {
    background: var(--material-glass);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border-color: var(--material-glass-border);
  }

  /* ── Close button ─────────────────────────────────────────────────── */
  .dialog-close {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      var(--transition-colors),
      var(--transition-shadow);
  }

  .dialog-close:hover {
    color: var(--color-text);
    background: var(--color-surface-secondary);
    border-color: var(--color-border-subtle);
  }

  .dialog-close:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
    border-color: var(--color-border-focus);
  }

  /* A drawer that scrolls as a whole would scroll an absolute close button
     out of sight (Creator measured it at y=-618). Here it is sticky and laid
     out first (`order`, so the DOM order, the tab order and the first focus
     stay as they are). Its margins put it where the absolute one sat,
     --space-3 in from the panel's top and right edges, and hand back the
     height and gap it takes in the column, so nothing below it moves. A
     sticky `top` counts from the panel's content edge, inside its padding,
     hence the padding taken off. */
  .dialog-close[data-layout='drawer'] {
    position: sticky;
    order: -1;
    flex: none;
    align-self: flex-end;
    top: calc(var(--space-3) - var(--drawer-pad-block));
    right: auto;
    margin-block: calc(var(--space-3) - var(--drawer-pad-block))
      calc(var(--drawer-pad-block) - var(--space-3) - var(--space-8) - var(--drawer-gap));
    margin-inline-end: calc(var(--space-3) - var(--drawer-pad-inline));
  }

  .dialog-close:active {
    background: var(--color-surface-tertiary);
  }

  .dialog-close:disabled {
    opacity: var(--opacity-50);
    cursor: not-allowed;
  }

  /* ── Entry animations ─────────────────────────────────────────────── */
  @keyframes overlay-in {
    from {
      opacity: 0;
    }
  }

  @keyframes content-in {
    from {
      opacity: 0;
      transform: translateY(var(--space-3)) scale(0.97);
    }
  }

  /* A drawer decelerates in from its edge; the sheet overshoots a little
     and settles (follow-through). */
  @keyframes drawer-in-right {
    0% {
      opacity: 0;
      transform: translateX(100%);
    }
    60% {
      opacity: 1;
    }
    100% {
      opacity: 1;
      transform: translateX(0);
    }
  }

  /* The spring easing supplies the floating sheet's overshoot. */
  @keyframes drawer-rise {
    0% {
      opacity: 0;
      transform: translateY(100%);
    }
    60% {
      opacity: 1;
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes drawer-in-bottom {
    0% {
      opacity: 0;
      transform: translateY(100%);
    }
    70% {
      opacity: 1;
      transform: translateY(-2%);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
