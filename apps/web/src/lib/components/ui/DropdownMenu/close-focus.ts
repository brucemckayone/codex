/**
 * Whether a menu's close may give its trigger focus: only from the menu,
 * or from nowhere. Melt's default gives the trigger focus at every close,
 * whatever has it by then. An item that opens a dialog has handed focus to
 * the dialog a millisecond before: the trigger, behind the overlay, took
 * it, focus-trap pulled it back without preventScroll, and a Body-less
 * confirm opened scrolled down to its Footer (Codex-vlphc review G5-C-L1).
 * Focus inside the menu is the usual close: Melt's menu keeps a focus trap
 * of its own while it is open.
 */
export function returnsToTrigger(
  active: Element | null,
  menu: Element | null
): boolean {
  return (
    !active || active === active.ownerDocument.body || !!menu?.contains(active)
  );
}
