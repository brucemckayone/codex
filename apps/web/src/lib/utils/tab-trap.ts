/**
 * Where Tab goes in a modal that keeps it inside (IntroVideoModal's rule,
 * and the Showreel theatre's): from outside the modal, to its first stop
 * (its last, going back); forward from its last stop, to its first; back
 * from its first stop, or from the modal itself, to its last. Anywhere else
 * null: the browser moves focus on its own.
 */
export function tabTarget<T>(
  stops: readonly T[],
  at: unknown,
  { back, inside, root }: { back: boolean; inside: boolean; root?: unknown }
): T | null {
  const first = stops[0];
  const last = stops.at(-1);
  if (first === undefined || last === undefined) return null;
  if (!inside) return back ? last : first;
  if (back && (at === first || at === root)) return last;
  if (!back && at === last) return first;
  return null;
}
