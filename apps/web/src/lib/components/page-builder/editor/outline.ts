/**
 * What the outline, the canvas toolbar and the picker say about a section, and
 * the index arithmetic behind reordering it.
 */
import type { Component } from 'svelte';
import * as Icons from '$lib/components/ui/Icon';
import type { IconProps } from '$lib/components/ui/Icon/types';
import { DEFINITIONS, isSectionTypeId } from '$lib/page-builder/kit';

const ICONS: Readonly<Record<string, Component<IconProps>>> = { ...Icons };

/** The creator's own name for a section, else its type's plain label. */
export function sectionLabel(section: { type: string; name?: string }): string {
  const name = section.name?.trim();
  if (name) return name;
  return isSectionTypeId(section.type)
    ? DEFINITIONS[section.type].label
    : section.type;
}

/** The Icon component a definition names; a page icon for anything unknown. */
export function sectionIcon(type: string): Component<IconProps> {
  const name = isSectionTypeId(type) ? DEFINITIONS[type].icon : '';
  return ICONS[name] ?? Icons.FileTextIcon;
}

/**
 * Where a dragged row would land: the gap (0…rows.length) nearest the
 * pointer, measured against each row's vertical midpoint.
 */
export function dropGap(
  pointerY: number,
  rows: readonly { top: number; height: number }[]
): number {
  const index = rows.findIndex((row) => pointerY < row.top + row.height / 2);
  return index === -1 ? rows.length : index;
}

/**
 * The store's `moveSectionTo` takes the index AFTER removal; a gap is counted
 * BEFORE it. Returns null when the drop would leave the row where it is.
 */
export function gapToIndex(from: number, gap: number): number | null {
  const to = gap > from ? gap - 1 : gap;
  return to === from ? null : to;
}
