/**
 * The media drawer's edit-in-place decisions (Codex-a6ofh.1.7), apart from
 * its I/O so each rule is tested on its own: whether a blur saves, what it
 * sends, and what the status line says while each field saves or fails.
 */

import * as m from '$paraglide/messages';

export type SaveField = 'title' | 'description';
export type FieldSave = 'idle' | 'saving' | 'saved' | 'failed';
/** A refusal the creator should read, not a generic "couldn't save". */
export type SaveRefusal = 'gone' | 'busy' | 'title-required' | null;

export type SavePlan =
  | { kind: 'skip' }
  | { kind: 'title-required' }
  | {
      kind: 'save';
      value: string;
      patch: { title: string } | { description: string | null };
    };

/**
 * What a blur of `field` does. Nothing when the draft matches what is saved,
 * or what is already on its way; an emptied title is refused (a title is
 * required); an emptied description clears it.
 */
export function planSave(
  field: SaveField,
  saved: { title: string; description?: string | null },
  draft: string,
  inFlight: string | null
): SavePlan {
  const value = draft.trim();
  const was = field === 'title' ? saved.title : (saved.description ?? '');
  if (value === was || value === inFlight) return { kind: 'skip' };
  if (field === 'title') {
    return value === ''
      ? { kind: 'title-required' }
      : { kind: 'save', value, patch: { title: value } };
  }
  return {
    kind: 'save',
    value,
    patch: { description: value === '' ? null : value },
  };
}

/** A save's refusal, by status: 404 the item went, 429 too many saves. */
export function refusalFor(status: number | undefined): SaveRefusal {
  if (status === 404) return 'gone';
  if (status === 429) return 'busy';
  return null;
}

/**
 * The status line. A failure stays until that same field saves: one field's
 * success never reads as the other's.
 */
export function saveStatusText(
  saves: Record<SaveField, FieldSave>,
  refusal: SaveRefusal
): { text: string; failed: boolean } | null {
  if (refusal === 'title-required') {
    return { text: m.media_drawer_title_required(), failed: true };
  }
  const failing = (['title', 'description'] as const).filter(
    (field) => saves[field] === 'failed'
  );
  if (failing.length > 0) {
    let text: string;
    if (refusal === 'gone') text = m.media_drawer_save_gone();
    else if (refusal === 'busy') text = m.media_drawer_save_busy();
    else if (failing.length === 2) text = m.media_drawer_save_failed_both();
    else if (failing[0] === 'title') text = m.media_drawer_save_failed_title();
    else text = m.media_drawer_save_failed_description();
    return { text, failed: true };
  }
  if (saves.title === 'saving' || saves.description === 'saving') {
    return { text: m.media_drawer_saving(), failed: false };
  }
  if (saves.title === 'saved' || saves.description === 'saved') {
    return { text: m.media_drawer_saved(), failed: false };
  }
  return null;
}
