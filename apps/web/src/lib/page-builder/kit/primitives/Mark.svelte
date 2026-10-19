<!--
  @component Mark

  One of the kit's marks (`model/marks.ts`), drawn in `currentColor` at
  `size`. Decoration: the item's name is what reads, and every platform icon
  is already hidden from assistive technology (`IconBase`).
-->
<script lang="ts">
  import {
    CalendarIcon,
    CheckIcon,
    ClockIcon,
    CompassIcon,
    FileTextIcon,
    FilmIcon,
    HeartIcon,
    MoonIcon,
    MusicIcon,
    SparkleIcon,
    SunIcon,
    UsersIcon,
  } from '$lib/components/ui/Icon';
  import type { MarkId } from '../model/marks';

  interface Props {
    mark: MarkId;
    size?: string;
  }

  const { mark, size = '1em' }: Props = $props();

  const ICONS = {
    check: CheckIcon,
    sparkle: SparkleIcon,
    heart: HeartIcon,
    clock: ClockIcon,
    calendar: CalendarIcon,
    compass: CompassIcon,
    users: UsersIcon,
    page: FileTextIcon,
    film: FilmIcon,
    music: MusicIcon,
    sun: SunIcon,
    moon: MoonIcon,
  } as const satisfies Record<MarkId, unknown>;

  const Icon = $derived(ICONS[mark]);
</script>

<Icon {size} />
