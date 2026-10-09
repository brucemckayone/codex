/**
 * The kit's use of the canvas inline-edit seam (`render/editable.ts`).
 *
 * The seam builds the attribute bag (plain-text paste, spellcheck, textbox
 * role) and returns `{}` off the canvas, so public markup carries no editing
 * attribute at all. Its accessible NAME is resolved through the legacy
 * catalogue, which does not know the kit's types, so the kit re-states the
 * name from its own definitions: "Pricing — Heading", never "pricing — Heading".
 *
 * Each field's `maxLength` rides along, so the canvas stops where the
 * inspector's input stops instead of taking text the block then cuts.
 */
import type { HTMLAttributes } from 'svelte/elements';
import { type EditLimit, editFieldAttrs } from '../../render/editable';
import { DEFINITIONS, fieldOf } from '../model/catalog';
import type { SectionTypeId } from '../model/ids';
import type { BlockEdit } from '../model/types';

function fieldAttrs(
  type: SectionTypeId,
  key: string,
  edit: BlockEdit,
  limit: EditLimit | undefined
): HTMLAttributes<HTMLElement> {
  return {
    ...editFieldAttrs(type, key, true, edit.commit, limit),
    'aria-label': `${DEFINITIONS[type].label} — ${fieldOf(type, key)?.label ?? key}`,
  };
}

export function editAttrs(
  type: SectionTypeId,
  key: string | undefined,
  edit: BlockEdit | null | undefined
): HTMLAttributes<HTMLElement> {
  if (!edit || !key) return {};
  const maxLength = fieldOf(type, key)?.maxLength;
  return fieldAttrs(type, key, edit, maxLength ? { maxLength } : undefined);
}

/**
 * The stored value of a multi-paragraph field. The editable element holds one
 * `<p>` per paragraph, so its `textContent` would run them together; the value
 * is re-joined with the blank line that `paragraphs()` splits on.
 */
function joinParagraphs(el: HTMLElement): string {
  const parts = Array.from(el.children)
    .map((child) => child.textContent?.trim() ?? '')
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join('\n\n') : (el.textContent ?? '');
}

/** The same bag for a multi-paragraph field, measured as it is stored. */
export function editParagraphAttrs(
  type: SectionTypeId,
  key: string | undefined,
  edit: BlockEdit | null | undefined
): HTMLAttributes<HTMLElement> {
  if (!edit || !key) return {};
  const maxLength = fieldOf(type, key)?.maxLength;
  const limit = maxLength
    ? { maxLength, measure: (el: HTMLElement) => joinParagraphs(el).length }
    : undefined;
  return {
    ...fieldAttrs(type, key, edit, limit),
    oninput: (event) => {
      const value = joinParagraphs(event.currentTarget as HTMLElement);
      edit.commit(key, limit ? value.slice(0, limit.maxLength) : value);
    },
  };
}
