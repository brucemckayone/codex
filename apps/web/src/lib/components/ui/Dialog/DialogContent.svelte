<script lang="ts">
  import { browser } from '$app/environment';
  import { type createDialog, melt } from '@melt-ui/svelte';
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { XIcon } from '$lib/components/ui/Icon';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    size?: 'sm' | 'md' | 'lg';
  }

  const { children, size = 'md', class: className, ...restProps }: Props = $props();
  const {
    elements: { portalled, overlay, content, close },
    states: { open },
  } = getContext<ReturnType<typeof createDialog>>('DIALOG');

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
    <div use:melt={$overlay} class="dialog-overlay"></div>
    <div class="dialog-content-wrapper">
      <div
        use:melt={$content}
        class="dialog-content {className ?? ''}"
        data-size={size}
        {...restProps}
      >
        {@render children()}
        <button use:melt={$close} class="dialog-close" aria-label="Close">
          <XIcon size={18} />
        </button>
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
</style>
