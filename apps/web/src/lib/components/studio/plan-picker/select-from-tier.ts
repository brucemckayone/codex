/**
 * The tier picker's rules, shared by every Studio editor that ticks tiers
 * (Codex-2hxff.91): the film editor, the course builder, the delete dialog's
 * "move them to", and the create dialog's preview.
 *
 * ONE yardstick for "dearer": the monthly price, strictly higher (owner
 * decision U1). The "and above" shortcut and the guidance note both use it,
 * so the shortcut can never produce a guidance note. Equal prices are not
 * dearer.
 *
 * A selection is the item's FULL set of tier ids. It can hold ticks on tiers
 * that are not options here (an inactive tier, kept for its existing
 * subscribers): every helper below keeps those untouched, so a save never
 * drops a tick the creator could not see.
 */

/** What the picker needs of a tier. */
export interface PickerTier {
  id: string;
  name: string;
  /** GBP pence a month. */
  priceMonthly: number;
  /** Display order, the tie-break between equal prices. */
  sortOrder?: number | null;
}

const LOCALE = 'en-GB';
const conjunction = new Intl.ListFormat(LOCALE, {
  style: 'long',
  type: 'conjunction',
});
const disjunction = new Intl.ListFormat(LOCALE, {
  style: 'long',
  type: 'disjunction',
});

/** "Basic and Pro" (or, with `'or'`, "Basic or Pro"). */
export function joinNames(
  names: readonly string[],
  type: 'and' | 'or' = 'and'
): string {
  return (type === 'and' ? conjunction : disjunction).format(names);
}

/**
 * Cheapest first. Equal prices keep display order (`sortOrder`, then the
 * order given), so the list never reshuffles between renders.
 */
export function tiersByPrice<T extends PickerTier>(tiers: readonly T[]): T[] {
  return tiers
    .map((tier, index) => ({ tier, index }))
    .sort(
      (a, b) =>
        a.tier.priceMonthly - b.tier.priceMonthly ||
        (a.tier.sortOrder ?? 0) - (b.tier.sortOrder ?? 0) ||
        a.index - b.index
    )
    .map(({ tier }) => tier);
}

/** `b` costs strictly more a month than `a`. */
export function isDearer(a: PickerTier, b: PickerTier): boolean {
  return b.priceMonthly > a.priceMonthly;
}

/**
 * The ids "{tier} and above" ticks: that tier and every option strictly
 * dearer than it, cheapest first. `[]` when `tierId` is not an option.
 */
export function andAboveIds(
  tierId: string,
  tiers: readonly PickerTier[]
): string[] {
  const from = tiers.find((t) => t.id === tierId);
  if (!from) return [];
  return tiersByPrice(tiers)
    .filter((t) => t.id === tierId || isDearer(from, t))
    .map((t) => t.id);
}

/** Whether a row offers the shortcut: something is dearer than it. */
export function offersAndAbove(
  tierId: string,
  tiers: readonly PickerTier[]
): boolean {
  return andAboveIds(tierId, tiers).length > 1;
}

/** Ticks on tiers that are not options here (hidden tiers). */
export function hiddenTierIds(
  selected: readonly string[],
  tiers: readonly PickerTier[]
): string[] {
  const options = new Set(tiers.map((t) => t.id));
  return selected.filter((id) => !options.has(id));
}

/**
 * Apply "{tier} and above" to a selection: the options become exactly that
 * tier and every dearer one (cheaper ones are unticked), and ticks on hidden
 * tiers are kept. A snapshot: a tier created later is not added.
 */
export function selectFromTier(
  selected: readonly string[],
  tierId: string,
  tiers: readonly PickerTier[]
): string[] {
  const above = andAboveIds(tierId, tiers);
  if (above.length === 0) return [...selected];
  return [...hiddenTierIds(selected, tiers), ...above];
}

/** Tick or untick one tier. */
export function toggleTierId(
  selected: readonly string[],
  tierId: string
): string[] {
  return selected.includes(tierId)
    ? selected.filter((id) => id !== tierId)
    : [...selected, tierId];
}

/**
 * Whether the ticks on the options are exactly "{tier} and above", so the
 * picker can mark that shortcut as the current shape.
 */
export function isAndAboveSelection(
  selected: readonly string[],
  tierId: string,
  tiers: readonly PickerTier[]
): boolean {
  const above = andAboveIds(tierId, tiers);
  if (above.length < 2) return false;
  const options = new Set(tiers.map((t) => t.id));
  const visible = selected.filter((id) => options.has(id));
  return (
    visible.length === above.length && above.every((id) => visible.includes(id))
  );
}

/** One per-item guidance note: `dearer` lacks the item that `cheaper` have. */
export interface ItemGap<T extends PickerTier = PickerTier> {
  dearer: T;
  /** The ticked options cheaper than `dearer`, cheapest first. */
  cheaper: T[];
}

/**
 * The per-item guidance notes ("Pro doesn't include this film, but Basic
 * does."): every unticked option that costs more than a ticked one, cheapest
 * first. `[]` for any "and above" shape, and for nothing ticked.
 */
export function itemGaps<T extends PickerTier>(
  selected: readonly string[],
  tiers: readonly T[]
): ItemGap<T>[] {
  const sorted = tiersByPrice(tiers);
  const ticked = sorted.filter((t) => selected.includes(t.id));
  const gaps: ItemGap<T>[] = [];
  for (const tier of sorted) {
    if (selected.includes(tier.id)) continue;
    const cheaper = ticked.filter((t) => isDearer(t, tier));
    if (cheaper.length > 0) gaps.push({ dearer: tier, cheaper });
  }
  return gaps;
}
