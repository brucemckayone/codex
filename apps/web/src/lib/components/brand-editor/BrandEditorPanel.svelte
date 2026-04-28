<!--
  @component BrandEditorPanel

  Floating glass panel for the brand editor. Renders outside .org-layout
  so it uses system tokens, not org brand overrides.

  States: closed (hidden), open (full panel), minimized (compact bar).
  Content transitions slide horizontally on level navigation.

  Semantics: the panel is a persistent floating toolbox that coexists with
  the page — NOT a blocking modal. It is exposed as an <aside> landmark
  (implicit role="complementary") rather than role="dialog" so screen
  readers don't announce the page as modally blocked.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { brandEditor } from '$lib/brand-editor';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import { ChevronUpIcon } from '$lib/components/ui/Icon';

  interface Props {
    /** Content rendered inside the scrollable area (level components). */
    children?: Snippet;
    /** Header snippet (breadcrumb + controls). */
    header?: Snippet;
    /** Footer snippet (dirty indicator + save/reset). */
    footer?: Snippet;
    /** Save handler, wired to the minimized bar's Save button. */
    onsave?: () => void;
    /** Whether a save is in progress (disables minimized Save). */
    saving?: boolean;
  }

  const { children, header, footer, onsave, saving = false }: Props = $props();

  const headerLabelId = 'brand-editor-landmark-label';
</script>

{#if brandEditor.isOpen}
  <aside
    class="brand-panel"
    aria-labelledby={headerLabelId}
  >
    <span id={headerLabelId} class="sr-only">
      Brand editor — {brandEditor.currentLevel.label}
    </span>
    {#if header}
      <div class="brand-panel__header">
        {@render header()}
      </div>
    {/if}

    <div class="brand-panel__content">
      {#key brandEditor.level}
        <div class="brand-panel__level">
          {#if children}
            {@render children()}
          {/if}
        </div>
      {/key}
    </div>

    {#if footer}
      <div class="brand-panel__footer">
        {@render footer()}
      </div>
    {/if}
  </aside>
{:else if brandEditor.isMinimized}
  <aside class="brand-bar" aria-label="Brand editor — minimized">
    <span class="brand-bar__icon" aria-hidden="true">🎨</span>

    {#if brandEditor.isDirty}
      <span class="brand-bar__dot" aria-label="Unsaved changes"></span>
    {/if}

    {#if brandEditor.isDirty}
      <Button variant="primary" size="xs" loading={saving} onclick={() => onsave?.()}>
        Save
      </Button>
    {/if}

    <button
      type="button"
      class="brand-bar__expand"
      onclick={() => brandEditor.expand()}
      aria-label="Expand brand editor"
    >
      <ChevronUpIcon size={16} />
    </button>
  </aside>
{/if}

<style>
  /* ── Full Panel ──────────────────────────────────────────────── */

  .brand-panel {
    position: fixed;
    bottom: var(--space-4);
    right: var(--space-4);
    width: min(360px, calc(100% - var(--space-8)));
    max-height: 85vh;
    z-index: var(--z-modal);

    display: flex;
    flex-direction: column;

    background: var(--material-glass);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border: 1px solid var(--material-glass-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl);

    overflow: hidden;

    animation: brand-panel-enter var(--duration-slow) var(--ease-smooth) both;
  }

  .brand-panel__header {
    flex-shrink: 0;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .brand-panel__content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
  }

  .brand-panel__level {
    padding: var(--space-4);
    animation: brand-panel-level-enter var(--duration-normal) var(--ease-out) both;
  }

  .brand-panel__footer {
    flex-shrink: 0;
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--color-border-subtle);
  }

  @keyframes brand-panel-enter {
    from {
      transform: translateY(var(--space-10));
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @keyframes brand-panel-level-enter {
    from {
      transform: translateX(var(--space-20));
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  /* ── Minimized Bar ───────────────────────────────────────────── */

  .brand-bar {
    position: fixed;
    bottom: var(--space-4);
    right: var(--space-4);
    z-index: var(--z-modal);

    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--space-12);
    padding: 0 var(--space-4);

    background: var(--material-glass);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border: 1px solid var(--material-glass-border);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-xl);

    animation: brand-bar-enter var(--duration-normal) var(--ease-smooth) both;
  }

  @keyframes brand-bar-enter {
    from {
      transform: translateY(var(--space-5));
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .brand-bar__icon {
    font-size: var(--text-lg);
  }

  .brand-bar__dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background-color: var(--color-brand-accent);
  }

  .brand-bar__expand {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    border-radius: var(--radius-full);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: var(--text-sm);
    transition: var(--transition-colors);
  }

  .brand-bar__expand:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .brand-bar__expand:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── Mobile ──────────────────────────────────────────────────── */

  @media (--below-sm) {
    .brand-panel {
      left: var(--space-2);
      right: var(--space-2);
      bottom: 0;
      width: auto;
      max-height: 70vh;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    }
  }
</style>
