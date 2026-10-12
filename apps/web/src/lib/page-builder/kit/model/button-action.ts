/**
 * Where a Button section goes (03 X64, Codex-61zsk.53), read tolerantly.
 *
 * The action is one of a proven set (`BUTTON_ACTION_IDS`), never a free URL
 * standing in for the page's own ask:
 *   join    — the closing ask's path: checkout, "Continue" for a member, or
 *             the closed notice, with the price line (the default)
 *   section — a section on this page, by section id; no price
 *   preview — the page's preview film; no price
 *   link    — an https address, opened apart from the page; no price
 *
 * The write boundary (`@codex/validation` `buttonActionSchema`) refuses
 * anything else; this reader treats the stored value as untrusted anyway, as
 * every prop reader does, and a value it cannot read is the default, `join`.
 * Pure TS with no zod, because it ships in the public bundle.
 */
import { BUTTON_ACTION_IDS, type ButtonActionId } from './ids';

export type ButtonAction =
  | { kind: 'join' }
  | { kind: 'section'; target: string }
  | { kind: 'preview' }
  | { kind: 'link'; href: string };

/** The longest link a Button may hold (twin of `BUTTON_HREF_MAX`). */
const HREF_MAX = 2000;

/**
 * The Button's link rule, twin of `@codex/validation` `isButtonHref` (a
 * parity test runs both over the same table): a full https address with a
 * host and no credentials.
 */
export function isButtonHref(value: string): boolean {
  if (value.length > HREF_MAX) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

function isActionId(value: unknown): value is ButtonActionId {
  return (
    typeof value === 'string' &&
    (BUTTON_ACTION_IDS as readonly string[]).includes(value)
  );
}

/**
 * The stored action, or `undefined` when there is none or it cannot be read
 * (an unknown kind, a section with no target, a link that is not https).
 * `undefined` is the default: the button joins.
 */
export function readButtonAction(value: unknown): ButtonAction | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (!isActionId(raw.kind)) return undefined;
  switch (raw.kind) {
    case 'join':
      return { kind: 'join' };
    case 'preview':
      return { kind: 'preview' };
    case 'section':
      return typeof raw.target === 'string' && raw.target.length > 0
        ? { kind: 'section', target: raw.target }
        : undefined;
    case 'link':
      return typeof raw.href === 'string' && isButtonHref(raw.href.trim())
        ? { kind: 'link', href: raw.href.trim() }
        : undefined;
  }
}

/** Every action reads as one of the set: no action is `join`. */
export function actionKind(action: ButtonAction | undefined): ButtonActionId {
  return action?.kind ?? 'join';
}
