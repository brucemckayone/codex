<!--
  @component RichTextEditor

  Tiptap-based WYSIWYG editor with configurable presets.
  Client-only — shows a skeleton during SSR, initialises on mount.

  @prop {string} content - JSON string (Tiptap document) or empty string
  @prop {'full' | 'minimal'} [preset='full'] - Extension set and toolbar
  @prop {string} [placeholder] - Placeholder text for empty editor
  @prop {number} [maxLength] - Character count limit
  @prop {string} [name] - Hidden textarea name for form submission
  @prop {(json: string) => void} [oninput] - Called when content changes
  @prop {Record<string, unknown>} [formFieldAttrs] - Spread attrs from form.fields.*.as()
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { getFullExtensions, getMinimalExtensions } from '$lib/editor/extensions.js';
  import { createSlashMenuRender } from '$lib/editor/slash-menu-render.svelte.js';
  import type { EditorPreset } from '$lib/editor/types.js';
  import EditorToolbar from './EditorToolbar.svelte';
  import BubbleMenuBar from './BubbleMenuBar.svelte';

  interface Props {
    content?: string;
    preset?: EditorPreset;
    placeholder?: string;
    maxLength?: number;
    name?: string;
    oninput?: (json: string) => void;
    formFieldAttrs?: Record<string, unknown>;
  }

  const {
    content = '',
    preset = 'full',
    placeholder = '',
    maxLength,
    name,
    oninput,
    formFieldAttrs,
  }: Props = $props();

  // svelte-ignore non_reactive_update
  let editorElement: HTMLDivElement;
  // svelte-ignore non_reactive_update
  let hiddenTextarea: HTMLTextAreaElement;
  // svelte-ignore non_reactive_update
  let bubbleMenuElement: HTMLDivElement;

  // The editor instance itself (set once on mount, never reassigned)
  let editorInstance: Editor | null = $state(null);

  // Transaction counter — increments on every editor state change.
  // This is the key to reactivity: Svelte 5 compares by value, and since the
  // Editor object reference never changes, we need a primitive that DOES change
  // to force the toolbar and other derived state to re-evaluate.
  let txVersion = $state(0);

  // Derived state that depends on txVersion so it re-evaluates on every transaction.
  const editor = $derived(txVersion >= 0 ? editorInstance : null);
  const charCount = $derived(
    txVersion >= 0
      ? (editorInstance?.storage?.characterCount?.characters?.() ?? 0)
      : 0
  );

  function parseContent(raw: string): Record<string, unknown> | string | undefined {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        return parsed;
      }
    } catch {
      // Not Tiptap JSON — treat as plain text so existing descriptions are preserved
    }
    // Return plain text as-is — Tiptap will convert it to a document
    return raw;
  }

  onMount(() => {
    // For the full preset, set up slash commands and bubble menu
    const isFull = preset === 'full';
    const slashCommandRender = isFull ? createSlashMenuRender() : undefined;

    const extensions = isFull
      ? getFullExtensions({
          placeholder,
          maxLength,
          slashCommandRender,
          bubbleMenuElement: bubbleMenuElement,
        })
      : getMinimalExtensions({ placeholder, maxLength });

    const initialContent = parseContent(content);

    const ed = new Editor({
      element: editorElement,
      extensions,
      content: initialContent,
      editorProps: {
        attributes: {
          class: 'rich-text-editor__content',
        },
      },
      onTransaction: () => {
        // Bump the version counter — forces all derived state to re-evaluate
        txVersion++;
      },
      onUpdate: ({ editor: updatedEd }) => {
        const json = JSON.stringify(updatedEd.getJSON());

        // Sync to hidden textarea for form submission
        if (hiddenTextarea) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
          )?.set;
          nativeInputValueSetter?.call(hiddenTextarea, json);
          hiddenTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        oninput?.(json);
      },
    });

    editorInstance = ed;

    return () => {
      ed.destroy();
      editorInstance = null;
    };
  });

  // Handle late-arriving content (e.g., form fields set after mount via $effect).
  // Only fires once: when the editor exists but is empty, and the content prop
  // arrives with a value. Prevents infinite loops by checking editor emptiness.
  let didSetDeferredContent = false;
  $effect(() => {
    if (editorInstance && content && !didSetDeferredContent) {
      const isEmpty = editorInstance.isEmpty;
      if (isEmpty) {
        const parsed = parseContent(content);
        if (parsed) {
          editorInstance.commands.setContent(parsed);
          didSetDeferredContent = true;
        }
      }
    }
  });
</script>

<div class="rich-text-editor" class:rich-text-editor--minimal={preset === 'minimal'}>
  {#if editor}
    <EditorToolbar {editor} {preset} />
  {/if}

  <div
    bind:this={editorElement}
    class="rich-text-editor__wrapper"
    class:rich-text-editor__wrapper--loading={!editor}
  ></div>

  <!-- Bubble menu: shown on text selection (full preset only).
       BubbleMenu extension controls visibility; we just provide the element. -->
  {#if preset === 'full'}
    <div bind:this={bubbleMenuElement}>
      {#if editor}
        <BubbleMenuBar {editor} />
      {/if}
    </div>
  {/if}

  {#if maxLength && editor}
    <div class="rich-text-editor__footer">
      <span
        class="rich-text-editor__char-count"
        data-warning={charCount > maxLength * 0.9 || undefined}
        data-error={charCount > maxLength || undefined}
      >
        {charCount.toLocaleString()}/{maxLength.toLocaleString()}
      </span>
    </div>
  {/if}

  <!-- Hidden textarea bridges Tiptap to the form() progressive enhancement pattern -->
  {#if name || formFieldAttrs}
    <textarea
      bind:this={hiddenTextarea}
      class="sr-only"
      tabindex={-1}
      aria-hidden="true"
      {name}
      {...formFieldAttrs}
    ></textarea>
  {/if}
</div>

<style>
  .rich-text-editor {
    width: 100%;
  }

  .rich-text-editor__wrapper {
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    background-color: var(--color-background);
    min-height: 300px;
    overflow-y: auto;
    transition: var(--transition-colors);
  }

  .rich-text-editor--minimal .rich-text-editor__wrapper {
    min-height: 120px;
  }

  .rich-text-editor__wrapper--loading {
    border-radius: var(--radius-md);
  }

  .rich-text-editor__wrapper:focus-within {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  /* ProseMirror content area */
  .rich-text-editor__wrapper :global(.rich-text-editor__content) {
    padding: var(--space-3) var(--space-4);
    min-height: inherit;
    outline: none;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text);
  }

  .rich-text-editor--minimal .rich-text-editor__wrapper :global(.rich-text-editor__content) {
    min-height: 120px;
  }

  /* Placeholder */
  .rich-text-editor__wrapper :global(.rich-text-editor__content p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    color: var(--color-text-muted);
    pointer-events: none;
    height: 0;
  }

  /* Prose typography */
  .rich-text-editor__wrapper :global(h1) { font-size: var(--text-2xl); font-weight: var(--font-bold); margin: var(--space-4) 0 var(--space-2); }
  .rich-text-editor__wrapper :global(h2) { font-size: var(--text-xl); font-weight: var(--font-semibold); margin: var(--space-3) 0 var(--space-2); }
  .rich-text-editor__wrapper :global(h3) { font-size: var(--text-lg); font-weight: var(--font-semibold); margin: var(--space-3) 0 var(--space-2); }
  .rich-text-editor__wrapper :global(p) { margin: var(--space-2) 0; line-height: var(--leading-relaxed); }

  /* Lists — override reset.css which strips list-style globally */
  .rich-text-editor__wrapper :global(ul) {
    padding-left: var(--space-6);
    margin: var(--space-2) 0;
    list-style-type: disc;
  }
  .rich-text-editor__wrapper :global(ol) {
    padding-left: var(--space-6);
    margin: var(--space-2) 0;
    list-style-type: decimal;
  }
  .rich-text-editor__wrapper :global(li) { margin: var(--space-1) 0; }
  .rich-text-editor__wrapper :global(li p) { margin: 0; }

  .rich-text-editor__wrapper :global(code) {
    font-family: var(--font-mono, monospace);
    background-color: var(--color-surface-secondary, var(--color-surface));
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    font-size: 0.9em;
  }
  .rich-text-editor__wrapper :global(pre) {
    background-color: var(--color-surface-secondary, var(--color-surface));
    padding: var(--space-4);
    border-radius: var(--radius-md);
    overflow-x: auto;
    margin: var(--space-3) 0;
  }
  .rich-text-editor__wrapper :global(pre code) { background: none; padding: 0; }
  .rich-text-editor__wrapper :global(blockquote) {
    border-left: var(--border-width-thick) var(--border-style) var(--color-brand-primary-subtle);
    padding-left: var(--space-4);
    margin: var(--space-3) 0;
    color: var(--color-text-secondary);
  }
  .rich-text-editor__wrapper :global(a) { color: var(--color-interactive-hover); text-decoration: underline; cursor: pointer; }
  .rich-text-editor__wrapper :global(strong) { font-weight: var(--font-bold); }
  .rich-text-editor__wrapper :global(hr) {
    border: none;
    border-top: var(--border-width) var(--border-style) var(--color-border);
    margin: var(--space-4) 0;
  }
  .rich-text-editor__wrapper :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md);
    margin: var(--space-3) 0;
  }

  /* Footer */
  .rich-text-editor__footer {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-1) var(--space-2);
  }

  .rich-text-editor__char-count {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .rich-text-editor__char-count[data-warning] {
    color: var(--color-warning-600);
  }

  .rich-text-editor__char-count[data-error] {
    color: var(--color-error-600);
  }


</style>
