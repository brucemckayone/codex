import { layout } from '../../model/fields';
import { compact, readBool } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type BreakProps = {
  /** The Style's own small mark in the middle of the pause. Off by default. */
  mark?: boolean;
};

/** The canvas's chip on a Break, for its size label (`SPACING_OPTIONS`). */
export function breakChip(size: string): string {
  return `Pause · ${size}. Visitors see only the space.`;
}

export const breakDefinition: BlockDefinition<BreakProps> = {
  type: 'break',
  label: 'Break',
  description: 'A pause between sections: space in the page’s own rhythm.',
  group: 'basics',
  icon: 'MoreHorizontalIcon',
  layouts: [
    layout(
      'space',
      'Space',
      'Room to breathe, on the ground of the section above.'
    ),
  ],
  fields: [
    {
      key: 'mark',
      label: 'Show a small mark in the middle',
      hint: 'Drawn the way this style marks a pause.',
      control: 'toggle',
      // Clean is parted by air, and Path's route already runs through the
      // pause: neither has a mark to draw (03 X64).
      styles: ['studio', 'bold', 'quiet', 'poster', 'soft', 'cinematic'],
    },
  ],
  starter: () => ({}),
  sample: {},
  coerce: (raw) => compact({ mark: readBool(raw, 'mark') }),
};
