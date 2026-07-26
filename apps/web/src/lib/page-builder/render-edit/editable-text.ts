/**
 * Two-way inline-edit primitive for the WYSIWYG builder canvas
 * (Codex-2pryk.3.3 · WP-5).
 *
 * A Svelte action that owns an element's `textContent` so contenteditable text
 * survives Svelte re-renders WITHOUT caret loss — the classic framework↔
 * contenteditable hazard. It writes the model value into the DOM only when the
 * node is NOT focused (an inbound inspector edit), and emits on `input` (an
 * in-canvas edit). Inert on the public render (`editable = false`): it still
 * seeds textContent but the element carries no `contenteditable` attribute (set
 * by the caller), so no visitor can type into it.
 *
 * Pure DOM, no editor/store imports → public-bundle safe under `$lib/page-builder`.
 */
import type { Action } from 'svelte/action';

export interface EditableTextParams {
  /** The model value to display. */
  value: string;
  /** Whether the node is being edited in the builder canvas. */
  editable: boolean;
  /** Called with the node's text on every in-canvas edit. */
  onEdit?: (value: string) => void;
}

export const editableText: Action<HTMLElement, EditableTextParams> = (
  node,
  params
) => {
  let onEdit = params.onEdit;
  node.textContent = params.value ?? '';

  const handleInput = (): void => {
    onEdit?.(node.textContent ?? '');
  };
  node.addEventListener('input', handleInput);

  return {
    update(next: EditableTextParams) {
      onEdit = next.onEdit;
      // Model → DOM only when the node is not being typed into, so an inspector
      // edit reflects live but an in-canvas edit never resets the caret.
      if (
        document.activeElement !== node &&
        node.textContent !== (next.value ?? '')
      ) {
        node.textContent = next.value ?? '';
      }
    },
    destroy() {
      node.removeEventListener('input', handleInput);
    },
  };
};
