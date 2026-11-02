/**
 * A curriculum layout's phone fold giving way under a visitor's focus (03 X57,
 * Codex-61zsk.73). When the section widens past phone width the toggles go,
 * and a visitor whose focus sat on one would be thrown to the page's start:
 * the layout reads which stage held it before the fold opens, then hands it to
 * that stage's words once the stages lie open. The timeline and the cards
 * share this; `stage` and `words` are each layout's own selectors.
 */

/** Which stage holds the visitor's focus, if any: its index, or -1. */
export function focusedStage(root: HTMLElement, stage: string): number {
  const active = document.activeElement;
  const held = active && root.contains(active) ? active.closest(stage) : null;
  return held ? [...root.querySelectorAll(stage)].indexOf(held) : -1;
}

/** The fold gave way under a visitor's focus: their stage's words take it. */
export function keepPlace(
  root: HTMLElement,
  index: number,
  stage: string,
  words: string
): void {
  const held = root.querySelectorAll<HTMLElement>(stage)[index];
  const target = held?.querySelector<HTMLElement>(words) ?? held;
  if (!target) return;
  target.tabIndex = -1;
  target.addEventListener('blur', () => target.removeAttribute('tabindex'), {
    once: true,
  });
  target.focus({ preventScroll: true });
}
