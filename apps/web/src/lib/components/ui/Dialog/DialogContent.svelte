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
    `dialog`: centred, at most 85vh; the panel clips and only Dialog.Body
    scrolls, so Header and Footer stay in view.
    `drawer`: a full-height panel on the right edge that slides in, padded
    `--space-6` with a `--space-5` gap. The WHOLE panel scrolls, as the
    hand-built drawers did: Dialog.Body and Dialog.Form lay their children
    straight into it (`display: contents`), so a section, a `margin-top:
    auto` actions row or a sticky bar sits exactly where it would as a direct
    child. Below the sm breakpoint it fills the screen.
  @prop {boolean} [sheet=false] - drawer only: below the sm breakpoint, a
    bottom sheet instead (full width, at most 90vh, rounded top, slides up),
    padded `--space-5 --space-4`.
  @prop {boolean} [flush=false] - drawer only: no padding and no gap, for a
    panel whose first child runs edge to edge (a hero photo).
  @prop {boolean} [floating=false] - drawer only: a glass panel that floats
    `--space-3` in from the edge, `--container-drawer` wide, rounded and
    shadowed. Only Dialog.Body scrolls, as in a dialog, so Header and Footer
    stay pinned (FilterDrawer). With `sheet`, below sm it floats
    `--space-2` above the bottom edge, at most 85dvh.
  @prop {boolean} [closeButton=true] - false drops the built-in close button,
    for a panel that renders its own. It must then render a visible one:
    Escape and a press outside are not enough on a touch screen.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { type createDialog, melt } from '@melt-ui/svelte';
  import { getContext, setContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { XIcon } from '$lib/components/ui/Icon';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'dialog' | 'drawer';
    sheet?: boolean;
    flush?: boolean;
    floating?: boolean;
    closeButton?: boolean;
  }

  const {
    children,
    size = 'md',
    variant = 'dialog',
    sheet = false,
    flush = false,
    floating = false,
    closeButton = true,
    class: className,
    ...restProps
  }: Props = $props();
  const {
    elements: { portalled, overlay, content, close },
    states: { open },
  } = getContext<ReturnType<typeof createDialog>>('DIALOG');
  /** Dialog.Root's `dismissible`: false while a request it started runs. */
  const dismissible = getContext<{ current: boolean } | undefined>('DIALOG_DISMISSIBLE');
  const drawer = $derived(variant === 'drawer');
  /**
   * What scrolls: `dialog` and `floating` scroll Body, `drawer` the whole
   * panel. Body, Form and Footer read it; in `drawer` Body and Form stop
   * being a box.
   */
  const layout = $derived(!drawer ? 'dialog' : floating ? 'floating' : 'drawer');
  setContext('DIALOG_LAYOUT', {
    get current() {
      return layout;
    },
  });

  /**
   * Forward org brand tokens into the portalled dialog.
   *
   * Melt UI portals render at <body>, escaping the .org-layout subtree that
   * carries [data-org-brand], [data-org-bg] and --brand-* inline styles.
   * This action copies those attributes + styles onto the portal container
   * so the full org-brand.css derivation engine activates inside the dialog.
   */
  function forwardBrandTokens(node: HTMLElement) {
    if (!browser) return;

    const orgLayout = document.querySelector<HTMLElement>('.org-layout');
    if (!orgLayout) return;

    // Copy data attributes that activate org-brand.css rules
    if (orgLayout.hasAttribute('data-org-brand')) {
      node.setAttribute('data-org-brand', '');
    }
    if (orgLayout.hasAttribute('data-org-bg')) {
      node.setAttribute('data-org-bg', '');
    }

    // Copy the --brand-* inline custom properties
    const style = orgLayout.style;
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      if (prop.startsWith('--brand-')) {
        node.style.setProperty(prop, style.getPropertyValue(prop));
      }
    }

    // Inherit the org font so text renders correctly
    node.style.fontFamily = 'inherit';
  }
</script>

{#if $open}
  <div use:melt={$portalled} use:forwardBrandTokens>
    <div
      use:melt={$overlay}
      class="dialog-overlay"
      data-variant={variant}
      data-floating={drawer && floating ? '' : undefined}
    ></div>
    <div class="dialog-content-wrapper">
      <div
        use:melt={$content}
        class="dialog-content {className ?? ''}"
        data-size={size}
        data-variant={variant}
        data-sheet={drawer && sheet ? '' : undefined}
        data-flush={drawer && flush ? '' : undefined}
        data-floating={drawer && floating ? '' : undefined}
        {...restProps}
      >
        {@render children()}
        {#if closeButton}
          <button
            use:melt={$close}
            class="dialog-close"
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

  /* ── Content panel ────────────────────────────────────────────────── */
  .dialog-content {
    position: relative;
    background: var(--color-surface-elevated, var(--color-surface));
    border-radius: var(--radius-modal);
    box-shadow: var(--shadow-xl);
    border: var(--border-width) var(--border-style) var(--color-border);
    width: 100%;
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: content-in var(--duration-slow) var(--ease-out) both;
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

  /* ── Drawer variant ───────────────────────────────────────────────
     The common part of the three hand-built drawers' `:global()` rules
     (Customer, Media, Creator). Width stays with data-size: their own
     max-width lost to it on specificity, so `md` is what they render. */
  .dialog-content[data-variant='drawer'] {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: auto;
    height: 100%;
    max-height: 100vh;
    gap: var(--space-5);
    padding: var(--space-6);
    overflow-x: hidden;
    overflow-y: auto;
    border: none;
    border-left: var(--border-width) var(--border-style) var(--color-border);
    border-radius: 0;
    animation-name: drawer-in-right;
    animation-duration: var(--duration-slower);
  }

  .dialog-content[data-variant='drawer'][data-flush] {
    gap: normal;
    padding: 0;
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
    max-height: calc(100dvh - var(--space-6));
    gap: normal;
    padding: 0;
    overflow: hidden;
    background: var(--material-glass);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
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
      max-height: 90vh;
      padding: var(--space-5) var(--space-4);
      border-left: none;
      border-top: var(--border-width) var(--border-style) var(--color-border);
      border-radius: var(--radius-modal) var(--radius-modal) 0 0;
      animation-name: drawer-in-bottom;
    }

    .dialog-content[data-variant='drawer'][data-sheet][data-flush] {
      padding: 0;
    }

    /* The floating sheet keeps its glass edge and round corners, inset
       --space-2 from three sides, and rises on a spring. */
    .dialog-content[data-variant='drawer'][data-sheet][data-floating] {
      left: var(--space-2);
      right: var(--space-2);
      bottom: var(--space-2);
      width: auto;
      max-height: 85dvh;
      padding: 0;
      border: var(--border-width) var(--border-style) var(--material-glass-border);
      border-radius: var(--radius-xl);
      animation-name: drawer-rise;
      animation-timing-function: var(--ease-spring);
    }
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
