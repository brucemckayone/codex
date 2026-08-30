/**
 * Section-type ICONS for the journey builder's studio UI (Codex-1khpv).
 *
 * The catalogue's `SectionDefinition.icon` is a raw glyph string — `◇`, `◍`, `⊞`,
 * `✦` — and it reached the DOM as a TEXT NODE in the sections rail, the add-section
 * picker and the inspector header, while the SAME rail already drew 17 real SVG
 * icons through `IconBase`. That is the whole defect: eleven icons bypassing the
 * design system in studio UI, one of them (`guide: '☺'`, U+263A) genuinely
 * emoji-capable, so it took Apple's colour emoji presentation and the rail showed a
 * yellow smiley among monochrome strokes.
 *
 * WHY THE MAP LIVES HERE AND NOT IN THE CATALOGUE. `$lib/page-builder/section-catalog.ts`
 * is the CE-4-scanned PUBLIC_LIB_ROOT: its own header states "types + pure helpers
 * only, no component imports", and the public journey renderer imports it for
 * `resolveVariant` / `resolveDesign`. Typing `icon` as a `Component` there would
 * pull eleven Svelte components into the PUBLIC visitor chunk to draw studio-only
 * UI. So the catalogue keeps a pure string key (`type`) and the component mapping
 * lives in the editor bundle — exactly the split `$lib/config/rail-icons.ts` uses
 * for the nav rail.
 *
 * EVERY ICON IS DECORATIVE. `IconBase` sets `aria-hidden="true"` itself, and each
 * render site puts the section's real label in adjacent text, so the icon leaves
 * the accessible name rather than joining it — the rail row is announced as "Hero",
 * not "◇ Hero".
 *
 * No new SVG was authored: all eleven come from the existing `ui/Icon` barrel, so
 * the studio gains no bespoke icon language of its own.
 */

import type { CourseSectionType } from '@codex/shared-types';
import type { Component } from 'svelte';
import {
  CircleIcon,
  CompassIcon,
  FileTextIcon,
  FilmIcon,
  HeartIcon,
  LayoutGridIcon,
  LayoutListIcon,
  MaximizeIcon,
  MenuIcon,
  PlayIcon,
  SparkleIcon,
  UserIcon,
  UsersIcon,
} from '$lib/components/ui/Icon';
import type { IconProps } from '$lib/components/ui/Icon/types';

/**
 * One icon per catalogue section type, chosen for what the section IS rather than
 * for a resemblance to the retired glyph:
 *
 * | type | icon | why |
 * |---|---|---|
 * | hero | Maximize | the opening plate, edge to edge |
 * | introVideo | Film | the sell film |
 * | ache | Heart | the problem or longing the journey speaks to |
 * | turn | Compass | the shift on offer — a change of direction |
 * | reel | Play | a practice preview, playable |
 * | map | LayoutList | the stages-and-practices spine |
 * | feel | LayoutGrid | the "what's inside" ledger |
 * | proof | Users | other people's words |
 * | guide | User | the one person who holds it |
 * | faq | FileText | written answers |
 * | invite | Sparkle | the offer, and the closest survivor of `✦` |
 *
 * `proof`/`guide` are deliberately the Users/User pair: the sections differ by
 * exactly that — many voices vouching versus one person present.
 */
export const SECTION_ICONS: Readonly<
  Record<CourseSectionType, Component<IconProps>>
> = {
  hero: MaximizeIcon,
  introVideo: FilmIcon,
  ache: HeartIcon,
  turn: CompassIcon,
  reel: PlayIcon,
  map: LayoutListIcon,
  feel: LayoutGridIcon,
  proof: UsersIcon,
  guide: UserIcon,
  faq: FileTextIcon,
  invite: SparkleIcon,
};

/**
 * The icon for a section type. TOTAL — an unknown/widened type gets a neutral
 * circle rather than nothing, because the rail must still render a row for a
 * section this deployment's catalogue does not know (the same forward-compatibility
 * `resolveVariant` and the renderer's unknown-type skip provide).
 */
export function sectionIcon(type: string): Component<IconProps> {
  return (
    (SECTION_ICONS as Record<string, Component<IconProps> | undefined>)[type] ??
    CircleIcon
  );
}

/**
 * The drag GRIP on a sections-rail row.
 *
 * It was `⠿` U+283F — a BRAILLE PATTERNS codepoint (Braille Pattern Dots-123456)
 * pressed into service as a decorative grip. It is `aria-hidden` at both render
 * sites, so it was never announced, but a Braille codepoint standing in for an
 * icon is the same design-system bypass as the eleven above. There is no
 * grip/six-dot icon in the barrel; the three-line `MenuIcon` is the conventional
 * reorder handle and is what the rail now draws.
 */
export const SECTION_GRIP_ICON: Component<IconProps> = MenuIcon;
