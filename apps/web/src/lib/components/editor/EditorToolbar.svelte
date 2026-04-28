<!--
  @component EditorToolbar

  Formatting toolbar for the Tiptap rich text editor.
  Renders different button sets based on the preset.
  Includes an inline link popover instead of browser prompt.

  @prop {Editor} editor - The Tiptap editor instance
  @prop {'full' | 'minimal'} preset - Controls which buttons are shown
-->
<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { EditorPreset } from '$lib/editor/types';

  interface Props {
    editor: Editor;
    preset: EditorPreset;
  }

  const { editor, preset }: Props = $props();

  // Link popover state
  let showLinkPopover = $state(false);
  let linkUrl = $state('');
  // svelte-ignore non_reactive_update
  let linkInput: HTMLInputElement;
  // svelte-ignore non_reactive_update
  let linkBtnElement: HTMLButtonElement;

  function openLinkPopover() {
    linkUrl = editor.getAttributes('link').href ?? '';
    showLinkPopover = true;
    // Focus the input after Svelte renders the popover
    requestAnimationFrame(() => linkInput?.focus());
  }

  function applyLink() {
    if (linkUrl.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      let href = linkUrl.trim();
      // Auto-prepend https:// if user types a bare domain
      if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:')) {
        href = `https://${href}`;
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    showLinkPopover = false;
  }

  function removeLink() {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    showLinkPopover = false;
  }

  function handleLinkKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLink();
    } else if (e.key === 'Escape') {
      showLinkPopover = false;
      editor.chain().focus().run();
    }
  }
</script>

<div class="editor-toolbar" role="toolbar" aria-label="Text formatting">
  <!-- Bold -->
  <button
    type="button"
    class="toolbar-btn"
    data-active={editor.isActive('bold') || undefined}
    onclick={() => editor.chain().focus().toggleBold().run()}
    title="Bold"
    aria-pressed={editor.isActive('bold')}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  </button>

  <!-- Italic -->
  <button
    type="button"
    class="toolbar-btn"
    data-active={editor.isActive('italic') || undefined}
    onclick={() => editor.chain().focus().toggleItalic().run()}
    title="Italic"
    aria-pressed={editor.isActive('italic')}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  </button>

  {#if preset === 'full'}
    <!-- Strike -->
    <button
      type="button"
      class="toolbar-btn"
      data-active={editor.isActive('strike') || undefined}
      onclick={() => editor.chain().focus().toggleStrike().run()}
      title="Strikethrough"
      aria-pressed={editor.isActive('strike')}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><line x1="4" y1="12" x2="20" y2="12" />
      </svg>
    </button>

    <span class="toolbar-separator" aria-hidden="true"></span>

    <!-- Headings -->
    <button
      type="button"
      class="toolbar-btn"
      data-active={editor.isActive('heading', { level: 1 }) || undefined}
      onclick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      title="Heading 1"
      aria-pressed={editor.isActive('heading', { level: 1 })}
    >
      <span class="toolbar-text">H1</span>
    </button>
    <button
      type="button"
      class="toolbar-btn"
      data-active={editor.isActive('heading', { level: 2 }) || undefined}
      onclick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      title="Heading 2"
      aria-pressed={editor.isActive('heading', { level: 2 })}
    >
      <span class="toolbar-text">H2</span>
    </button>
    <button
      type="button"
      class="toolbar-btn"
      data-active={editor.isActive('heading', { level: 3 }) || undefined}
      onclick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      title="Heading 3"
      aria-pressed={editor.isActive('heading', { level: 3 })}
    >
      <span class="toolbar-text">H3</span>
    </button>

    <span class="toolbar-separator" aria-hidden="true"></span>
  {/if}

  <!-- Bullet List -->
  <button
    type="button"
    class="toolbar-btn"
    data-active={editor.isActive('bulletList') || undefined}
    onclick={() => editor.chain().focus().toggleBulletList().run()}
    title="Bullet list"
    aria-pressed={editor.isActive('bulletList')}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  </button>

  <!-- Ordered List -->
  <button
    type="button"
    class="toolbar-btn"
    data-active={editor.isActive('orderedList') || undefined}
    onclick={() => editor.chain().focus().toggleOrderedList().run()}
    title="Numbered list"
    aria-pressed={editor.isActive('orderedList')}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" />
      <path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  </button>

  <!-- Link (with inline popover) -->
  <div class="toolbar-link-wrapper">
    <button
      bind:this={linkBtnElement}
      type="button"
      class="toolbar-btn"
      data-active={editor.isActive('link') || undefined}
      onclick={openLinkPopover}
      title="Link"
      aria-pressed={editor.isActive('link')}
      aria-expanded={showLinkPopover}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>

    {#if showLinkPopover}
      <div class="link-popover" role="dialog" aria-label="Insert link">
        <input
          bind:this={linkInput}
          bind:value={linkUrl}
          type="url"
          id="editor-toolbar-link"
          name="link-url"
          autocomplete="url"
          class="link-input"
          placeholder="https://example.com"
          onkeydown={handleLinkKeydown}
        />
        <button
          type="button"
          class="link-action-btn link-action-btn--apply"
          onclick={applyLink}
          title="Apply link"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
        {#if editor.isActive('link')}
          <button
            type="button"
            class="link-action-btn link-action-btn--remove"
            onclick={removeLink}
            title="Remove link"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if preset === 'full'}
    <span class="toolbar-separator" aria-hidden="true"></span>

    <!-- Blockquote -->
    <button
      type="button"
      class="toolbar-btn"
      data-active={editor.isActive('blockquote') || undefined}
      onclick={() => editor.chain().focus().toggleBlockquote().run()}
      title="Blockquote"
      aria-pressed={editor.isActive('blockquote')}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z" />
      </svg>
    </button>

    <!-- Code -->
    <button
      type="button"
      class="toolbar-btn"
      data-active={editor.isActive('codeBlock') || undefined}
      onclick={() => editor.chain().focus().toggleCodeBlock().run()}
      title="Code block"
      aria-pressed={editor.isActive('codeBlock')}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    </button>

    <!-- Horizontal Rule -->
    <button
      type="button"
      class="toolbar-btn"
      onclick={() => editor.chain().focus().setHorizontalRule().run()}
      title="Horizontal rule"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="2" y1="12" x2="22" y2="12" />
      </svg>
    </button>

    <span class="toolbar-separator" aria-hidden="true"></span>
  {/if}

  <!-- Undo -->
  <button
    type="button"
    class="toolbar-btn"
    onclick={() => editor.chain().focus().undo().run()}
    disabled={!editor.can().undo()}
    title="Undo"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  </button>

  <!-- Redo -->
  <button
    type="button"
    class="toolbar-btn"
    onclick={() => editor.chain().focus().redo().run()}
    disabled={!editor.can().redo()}
    title="Redo"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  </button>
</div>

<style>
  .editor-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-bottom: none;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background-color: var(--color-surface);
  }

  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .toolbar-btn:hover:not(:disabled) {
    background-color: var(--color-surface-secondary, var(--color-neutral-100));
    color: var(--color-text);
  }

  .toolbar-btn[data-active] {
    background-color: var(--color-brand-primary-subtle);
    color: var(--color-interactive-active);
  }

  .toolbar-btn:disabled {
    opacity: var(--opacity-40);
    cursor: not-allowed;
  }

  .toolbar-text {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-bold);
    line-height: var(--leading-none);
  }

  .toolbar-separator {
    width: var(--border-width);
    height: var(--space-5);
    background-color: var(--color-border);
    margin: 0 var(--space-1);
  }

  /* Link popover */
  .toolbar-link-wrapper {
    position: relative;
  }

  .link-popover {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    z-index: var(--z-dropdown, 10);
    white-space: nowrap;
  }

  .link-input {
    width: 240px;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-background);
    color: var(--color-text);
    outline: none;
  }

  .link-input:focus {
    border-color: var(--color-border-focus);
    box-shadow: var(--shadow-focus-ring);
  }

  .link-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .link-action-btn--apply {
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .link-action-btn--apply:hover {
    background-color: var(--color-interactive-hover);
  }

  .link-action-btn--remove {
    background-color: var(--color-error-100);
    color: var(--color-error-600);
  }

  .link-action-btn--remove:hover {
    background-color: var(--color-error-200);
  }

</style>
