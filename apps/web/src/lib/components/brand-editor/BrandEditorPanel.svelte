<!--
  @component BrandEditorPanel

  Floating glass panel for the brand editor. Renders outside .org-layout
  so it uses system tokens, not org brand overrides.

  States: closed (hidden), open (full panel), minimized (compact bar).
  Content transitions slide horizontally on level navigation.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { brandEditor } from '$lib/brand-editor';
  import Button from '$lib/components/ui/Button/Button.svelte';

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
</script>

{#if brandEditor.isOpen}
  <div
    class="brand-panel"
    role="dialog"
    aria-label="Brand editor"
    transition:fly={{ y: 40, duration: 300, opacity: 0 }}
  >
    {#if header}
      <div class="brand-panel__header">
        {@render header()}
      </div>
    {/if}

    <div class="brand-panel__content">
      {#key brandEditor.level}
        <div class="brand-panel__level" in:fly={{ x: 80, duration: 200, opacity: 0 }}>
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
  </div>
{:else if brandEditor.isMinimized}
  <div
    class="brand-bar"
    transition:fly={{ y: 20, duration: 200, opacity: 0 }}
  >
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
      class="brand-bar__expand"
      onclick={() => brandEditor.expand()}
      aria-label="Expand brand editor"
    >
      ▲
    </button>
  </div>
{/if}

<style>
  /* ── Full Panel ──────────────────────────────────────────────── */

  .brand-panel {
    position: fixed;
    bottom: var(--space-4);
    right: var(--space-4);
    width: 360px;
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
  }

  .brand-panel__footer {
    flex-shrink: 0;
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--color-border-subtle);
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
    height: 48px;
    padding: 0 var(--space-4);

    background: var(--material-glass);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border: 1px solid var(--material-glass-border);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-xl);
  }

  .brand-bar__icon {
    font-size: var(--text-lg);
  }

  .brand-bar__dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background-color: var(--color-brand-accent);
  }

  .brand-bar__expand {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
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

  /* ── Mobile ──────────────────────────────────────────────────── */

  @media (max-width: 639px) {
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
