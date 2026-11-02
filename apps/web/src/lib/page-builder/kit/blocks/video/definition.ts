import {
  bodyField,
  ctaLabelField,
  eyebrowField,
  headingField,
  layout,
  noteField,
} from '../../model/fields';
import { compact, readBool, readText } from '../../model/read';
import { readStillFocus, type StillFocus } from '../../model/still-focus';
import type { BlockDefinition, BlockField } from '../../model/types';

export type VideoProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  caption?: string;
  /** Who speaks in the film; the page's guide when blank (Codex-61zsk.73). */
  speaker?: string;
  /**
   * Leave the speaker off, so the line gives the length alone. A switch
   * writes `true` or nothing, so the key says HIDE: absent, every section,
   * an existing one too, names who speaks.
   */
  hideSpeaker?: boolean;
  /** Where the film's poster is cropped round on this page (`model/still-focus.ts`). */
  stillFocus?: StillFocus;
};

/**
 * The canvas's words for a screen with no film yet (creator-facing, A1),
 * naming the slot as the Media panel does. Non-breaking spaces keep
 * "Settings → Media" on one line.
 */
export const VIDEO_PROMPT = 'Add your intro film in Settings → Media.';

/**
 * The common button keys for the sections whose job is not the sale (video,
 * sneak peek, about you, numbers). Their button appears only once the creator
 * writes one, so a page does not grow a "Join now" under every band.
 */
export const optionalCtaFields: readonly BlockField[] = [
  {
    ...ctaLabelField,
    hint: 'Optional. Write button text to add a way to join here. Members always see "Continue".',
  },
  {
    ...noteField,
    hint: 'Optional. A short reassurance under that button, like "Start whenever you like".',
  },
];

export const videoDefinition: BlockDefinition<VideoProps> = {
  type: 'video',
  label: 'Video',
  description: 'Your introduction film, shown large.',
  group: 'opening',
  icon: 'FilmIcon',
  layouts: [
    layout(
      'theatre',
      'Big screen',
      'Your words first, then the film on a wide screen with the play button in the middle.'
    ),
    layout(
      'split',
      'Side by side',
      'The film as the larger half, with your words beside it.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 400 },
    {
      key: 'caption',
      label: 'Caption under the film',
      hint: 'Optional. One line about the film, like where it was made.',
      control: 'text',
      inline: true,
      maxLength: 140,
    },
    {
      key: 'speaker',
      label: 'Speaker',
      hint: "Optional. Leave it blank to use the guide's name from your About you section.",
      control: 'text',
      maxLength: 60,
    },
    {
      key: 'hideSpeaker',
      label: "Hide who's speaking",
      hint: "Shows the film's length only.",
      control: 'toggle',
    },
    ...optionalCtaFields,
    {
      key: 'introVideoMediaId',
      label: 'Introduction film',
      hint: 'The same film as in Settings → Media.',
      control: 'media',
      mediaSlot: 'introVideoMediaId',
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: `A first look at ${courseTitle}`,
    body: 'A short film about how the course works, who it is for and what your first week looks like.',
  }),
  sample: {
    heading: 'Two minutes, from me to you',
    body: 'How the six weeks are built, and what a morning in the course looks like.',
    caption: 'Filmed on the first morning of the spring group.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 400),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      caption: readText(raw, 'caption', 140),
      speaker: readText(raw, 'speaker', 60),
      hideSpeaker: readBool(raw, 'hideSpeaker'),
      stillFocus: readStillFocus(raw.stillFocus),
    }),
  // The film's poster. Every screen is 16:9, a film's own shape, so the
  // poster is shown whole, except in Bold's theatre from a wide screen, 21:9:
  // only there does a point steer it, and elsewhere the control explains
  // itself (VideoBlock's `--_ratio`).
  stillFocus: {
    focalLayouts: {
      theatre: [{ at: 'wide', ratio: '21 / 9', styles: ['bold'] }],
    },
    still: (_raw, preview) => preview?.intro?.posterUrl ?? null,
  },
};
