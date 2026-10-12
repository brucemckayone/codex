/**
 * What the Button's action picker writes (03 X64), as pure functions so the
 * rule "nothing invalid is ever written" can be held against the write
 * boundary's own schema (`@codex/validation` `buttonActionSchema`).
 */
import {
  BUTTON_ACTION_IDS,
  type ButtonAction,
  type ButtonActionId,
  isButtonHref,
} from '$lib/page-builder/kit';

/** A write to make, or none yet (a link still being typed, no section to go to). */
export type ActionWrite =
  | { write: true; value: ButtonAction | undefined }
  | { write: false };

/**
 * The write for a kind just picked. `join` is the default and is stored as no
 * action at all; a section goes to the first other section until another is
 * picked; a link waits for a full https address.
 */
export function chooseAction(
  kind: ButtonActionId,
  { firstTarget, href }: { firstTarget?: string; href: string }
): ActionWrite {
  switch (kind) {
    case 'join':
      return { write: true, value: undefined };
    case 'section':
      return firstTarget
        ? { write: true, value: { kind: 'section', target: firstTarget } }
        : { write: false };
    case 'preview':
      return { write: true, value: { kind: 'preview' } };
    case 'link':
      return linkWrite(href);
  }
}

/** A typed address becomes the action only once it is a full https one. */
export function linkWrite(href: string): ActionWrite {
  const trimmed = href.trim();
  return isButtonHref(trimmed)
    ? { write: true, value: { kind: 'link', href: trimmed } }
    : { write: false };
}

/**
 * The kinds the picker lists. Preview only once the journey has a film to
 * play, or when the Button already stores one, so the creator can see what it
 * is and change it.
 */
export function actionKinds(
  hasFilm: boolean,
  stored: ButtonActionId | undefined
): ButtonActionId[] {
  return BUTTON_ACTION_IDS.filter(
    (kind) => kind !== 'preview' || hasFilm || stored === 'preview'
  );
}
