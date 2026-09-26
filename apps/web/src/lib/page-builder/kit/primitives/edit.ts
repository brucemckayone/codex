/**
 * The kit's use of the canvas inline-edit seam (`render/editable.ts`).
 *
 * The seam builds the attribute bag (plain-text paste, spellcheck, textbox
 * role) and returns `{}` off the canvas, so public markup carries no editing
 * attribute at all. Its accessible NAME is resolved through the legacy
 * catalogue, which does not know the kit's types, so the kit re-states the
 * name from its own definitions: "Pricing — Heading", never "pricing — Heading".
 */
import type { HTMLAttributes } from 'svelte/elements';
import { editFieldAttrs } from '../../render/editable';
import { DEFINITIONS, fieldOf } from '../model/catalog';
import type { SectionTypeId } from '../model/ids';
import type { BlockEdit } from '../model/types';

export function editAttrs(
  type: SectionTypeId,
  key: string | undefined,
  edit: BlockEdit | null | undefined
): HTMLAttributes<HTMLElement> {
  if (!edit || !key) return {};
  return {
    ...editFieldAttrs(type, key, true, edit.commit),
    'aria-label': `${DEFINITIONS[type].label} — ${fieldOf(type, key)?.label ?? key}`,
  };
}

/**
 * The same bag for a multi-paragraph field. The editable element holds one
 * `<p>` per paragraph, so its `textContent` would run them together; the value
 * is re-joined with the blank line that `paragraphs()` splits on.
 */
export function editParagraphAttrs(
  type: SectionTypeId,
  key: string | undefined,
  edit: BlockEdit | null | undefined
): HTMLAttributes<HTMLElement> {
  const attrs = editAttrs(type, key, edit);
  if (!edit || !key) return attrs;
  return {
    ...attrs,
    oninput: (event) => {
      const el = event.currentTarget as HTMLElement;
      const parts = Array.from(el.children)
        .map((child) => child.textContent?.trim() ?? '')
        .filter((part) => part.length > 0);
      edit.commit(
        key,
        parts.length > 0 ? parts.join('\n\n') : (el.textContent ?? '')
      );
    },
  };
}
