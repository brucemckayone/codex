/**
 * Where focus goes when a dialog's own action removes the control that
 * opened it. The dialog gives focus back to its opener when that is still
 * on the page; a delete or a revoke takes it away, and focus fell to the
 * page, or to the first control of a drawer around it (Codex-p10nx).
 *
 * The next item's equivalent control, else the previous item's, else the
 * first fallback that can take focus: the list's add button, then the
 * section's heading (given `tabindex="-1"`).
 *
 * `controls` holds the equivalent control of every item LEFT, in list
 * order, and `removedAt` is where the removed item stood among them: the
 * next item now stands there.
 */
export function survivingFocus(
  controls: readonly Element[],
  removedAt: number,
  ...fallbacks: (Element | null | undefined)[]
): HTMLElement | null {
  const next = controls[removedAt];
  const previous = removedAt > 0 ? controls[removedAt - 1] : undefined;
  return [next, previous, ...fallbacks].find(canTakeFocus) ?? null;
}

/** On the page, enabled, and not inside an inert subtree. */
function canTakeFocus(el: Element | null | undefined): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.isConnected &&
    !el.matches(':disabled') &&
    !el.closest('[inert]')
  );
}
