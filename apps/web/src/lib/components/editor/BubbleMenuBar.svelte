<!--
  @component BubbleMenuBar

  Contextual formatting toolbar that appears when text is selected.
  Shows inline marks (bold, italic, strike, code, link).
  The BubbleMenu extension handles positioning and visibility.

  @prop {Editor} editor - The Tiptap editor instance
-->
<script lang="ts">
  import type { Editor } from '@tiptap/core';

  interface Props {
    editor: Editor;
  }

  const { editor }: Props = $props();

  let showLinkInput = $state(false);
  let linkUrl = $state('');
  // svelte-ignore non_reactive_update
  let linkInput: HTMLInputElement;

  function toggleLink() {
    if (editor.isActive('link')) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    linkUrl = '';
    showLinkInput = true;
    requestAnimationFrame(() => linkInput?.focus());
  }

  function applyLink() {
    let href = linkUrl.trim();
    if (!href) {
      showLinkInput = false;
      editor.chain().focus().run();
      return;
    }
    if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:')) {
      href = `https://${href}`;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    showLinkInput = false;
  }

  function handleLinkKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLink();
    } else if (e.key === 'Escape') {
      showLinkInput = false;
      editor.chain().focus().run();
    }
  }
</script>

<div class="bubble-menu">
  {#if showLinkInput}
    <input
      bind:this={linkInput}
      bind:value={linkUrl}
      type="url"
      id="bubble-menu-link"
      name="link-url"
      autocomplete="url"
      class="bubble-link-input"
      placeholder="https://..."
      onkeydown={handleLinkKeydown}
    />
    <button type="button" class="bubble-btn" onclick={applyLink} title="Apply">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </button>
  {:else}
    <button
      type="button"
      class="bubble-btn"
      data-active={editor.isActive('bold') || undefined}
      onclick={() => editor.chain().focus().toggleBold().run()}
      title="Bold"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      </svg>
    </button>

    <button
      type="button"
      class="bubble-btn"
      data-active={editor.isActive('italic') || undefined}
      onclick={() => editor.chain().focus().toggleItalic().run()}
      title="Italic"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" />
      </svg>
    </button>

    <button
      type="button"
      class="bubble-btn"
      data-active={editor.isActive('strike') || undefined}
      onclick={() => editor.chain().focus().toggleStrike().run()}
      title="Strikethrough"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><line x1="4" y1="12" x2="20" y2="12" />
      </svg>
    </button>

    <button
      type="button"
      class="bubble-btn"
      data-active={editor.isActive('code') || undefined}
      onclick={() => editor.chain().focus().toggleCode().run()}
      title="Inline code"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    </button>

    <span class="bubble-separator" aria-hidden="true"></span>

    <button
      type="button"
      class="bubble-btn"
      data-active={editor.isActive('link') || undefined}
      onclick={toggleLink}
      title={editor.isActive('link') ? 'Remove link' : 'Add link'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .bubble-menu {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background-color: var(--color-neutral-900);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }

  .bubble-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-neutral-300);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .bubble-btn:hover {
    background-color: var(--color-neutral-800);
    color: var(--color-text-on-brand);
  }

  .bubble-btn[data-active] {
    background-color: var(--color-interactive-hover);
    color: var(--color-text-on-brand);
  }

  .bubble-separator {
    width: var(--border-width);
    height: var(--space-4);
    background-color: var(--color-neutral-700);
    margin: 0 var(--space-1);
  }

  .bubble-link-input {
    width: 180px;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    border: var(--border-width) var(--border-style) var(--color-neutral-600);
    border-radius: var(--radius-sm);
    background-color: var(--color-neutral-800);
    color: var(--color-text-on-brand);
    outline: none;
  }

  .bubble-link-input:focus {
    border-color: var(--color-border-focus);
  }

  .bubble-link-input::placeholder {
    color: var(--color-neutral-500);
  }
</style>
