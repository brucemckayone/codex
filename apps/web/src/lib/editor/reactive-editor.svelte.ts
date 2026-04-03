/**
 * Svelte 5 reactive wrapper around Tiptap's Editor.
 *
 * Uses `createSubscriber` from svelte/reactivity to make the editor instance
 * reactive without stores. Any component that reads `reactiveEditor.instance`
 * will re-render when the editor state changes (bold toggled, text typed, etc).
 */

import { Editor, type EditorOptions } from '@tiptap/core';
import { createSubscriber } from 'svelte/reactivity';

export class ReactiveEditor {
  #editor: Editor;
  #subscribe: () => void;

  constructor(options: Partial<EditorOptions>) {
    this.#editor = new Editor(options);
    this.#subscribe = createSubscriber((update) => {
      this.#editor.on('transaction', update);
      return () => this.#editor.off('transaction', update);
    });
  }

  /** Access the editor instance. Reading this in a component triggers reactivity. */
  get instance(): Editor {
    this.#subscribe();
    return this.#editor;
  }

  destroy(): void {
    this.#editor.destroy();
  }
}
