/** The two sides of a before-and-after, as every layout addresses them. */
export type Side = 'before' | 'after';

export const SIDES: readonly Side[] = ['before', 'after'];

export type SideLines = Readonly<Record<Side, readonly string[]>>;
export type SideLabels = Readonly<Record<Side, string | undefined>>;

/** The label's DOM id — unique on the page because section anchors are. */
export function sideLabelId(anchor: string, side: Side): string {
  return `${anchor}-${side}`;
}
