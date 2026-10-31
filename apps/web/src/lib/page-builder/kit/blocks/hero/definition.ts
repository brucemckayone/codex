import {
  type ImageRef,
  isImageRef,
  resolvePageImageUrl,
} from '../../../page-images';
import type {
  JourneySalesContext,
  PreviewMedia,
  SellPreview,
} from '../../../render/types';
import {
  bodyField,
  ctaLabelField,
  eyebrowField,
  headingField,
  layout,
  noteField,
} from '../../model/fields';
import { compact, readBool, readOneOf, readText } from '../../model/read';
import { readStillFocus, type StillFocus } from '../../model/still-focus';
import type { BlockDefinition, FocalCrop } from '../../model/types';

export const HERO_MEDIA_MODES = ['auto', 'image', 'video', 'none'] as const;
export type HeroMediaMode = (typeof HERO_MEDIA_MODES)[number];

/**
 * Each layout's frame at 1440 and 390, in the Style that cuts it most. The
 * creator's own image and the course still are drawn in the same frames, so
 * one set of crops serves both points.
 */
const HERO_CROPS: Readonly<Record<string, readonly FocalCrop[]>> = {
  statement: [
    { at: 'wide', ratio: '7 / 3' },
    { at: 'phone', ratio: '4 / 3' },
  ],
  split: [
    { at: 'wide', ratio: '4 / 5' },
    { at: 'phone', ratio: '4 / 5' },
  ],
  cover: [
    { at: 'wide', ratio: '15 / 8' },
    { at: 'phone', ratio: '2 / 3' },
  ],
  centered: [
    { at: 'wide', ratio: '16 / 7' },
    { at: 'phone', ratio: '4 / 3' },
  ],
  poster: [
    { at: 'wide', ratio: '5 / 4' },
    { at: 'phone', ratio: '4 / 5' },
  ],
};

export type HeroProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  media?: HeroMediaMode;
  watchLabel?: string;
  /** Replaces the course hero still (contract A5); a clip still plays over it. */
  image?: ImageRef;
  /**
   * Where the course still, or the clip's poster, is cropped round on this
   * page, and which still that was (`model/still-focus.ts`, Codex-61zsk.73).
   */
  stillFocus?: StillFocus;
  /**
   * The org's logo shows above the eyebrow unless this is set. A switch
   * stores only `true` or nothing, so a default-on logo is stored inverted,
   * as video's `hideSpeaker` is (Codex-61zsk.73).
   */
  hideLogo?: boolean;
};

/** What the hero draws: its still, whether that is the creator's own image, and the clip over it. */
export interface HeroMedia {
  still: string | null;
  own: boolean;
  clip: PreviewMedia | null;
}

/**
 * The picture the hero draws and the clip that plays over it (`HeroBlock`),
 * shared with the inspector so a point is offered on the very still the
 * canvas shows. The creator's own image (contract A5) replaces the course
 * still, never the clip. `preview` is `undefined` until the streamed preview
 * settles: the awaited still then, which the preview can only add a clip to,
 * or a media-item poster where nothing was uploaded.
 */
export function heroMedia(
  content: Pick<HeroProps, 'media' | 'image'>,
  preview: SellPreview | null | undefined,
  context: Pick<JourneySalesContext, 'course' | 'mediaBaseUrl'>
): HeroMedia {
  const mode = content.media ?? 'auto';
  if (mode === 'none') return { still: null, own: false, clip: null };
  const own = resolvePageImageUrl(content.image, 'lg', context.mediaBaseUrl);
  const awaited = own ?? context.course.heroImageUrl ?? null;
  if (preview === undefined) {
    return { still: awaited, own: Boolean(own), clip: null };
  }
  return {
    still: own ?? preview?.heroImageUrl ?? awaited,
    own: Boolean(own),
    clip: mode === 'image' ? null : (preview?.heroClip ?? null),
  };
}

export const heroDefinition: BlockDefinition<HeroProps> = {
  type: 'hero',
  label: 'Hero',
  description:
    'The first thing visitors see: your promise and the button to join.',
  group: 'opening',
  icon: 'SparkleIcon',
  max: 1,
  layouts: [
    layout(
      'statement',
      'Statement',
      'Your headline as big as it gets, with the image running full width below.'
    ),
    layout(
      'split',
      'Side by side',
      'Words on one side, your image or clip on the other.'
    ),
    layout(
      'cover',
      'Full-screen image',
      'Your image fills the screen with the words over it.'
    ),
    layout(
      'centered',
      'Centred',
      'Everything centred, with a wide image underneath.'
    ),
    layout(
      'poster',
      'Poster',
      'Your headline as large as it goes, set around an image that runs off the edge.'
    ),
  ],
  fields: [
    {
      key: 'hideLogo',
      label: 'Hide your logo',
      hint: 'Your logo shows above the headline when your organisation has one.',
      control: 'toggle',
    },
    eyebrowField,
    {
      ...headingField(120),
      label: 'Headline',
      hint: 'Leave empty to use the course title.',
    },
    { ...bodyField, label: 'Text under the headline', maxLength: 400 },
    ctaLabelField,
    noteField,
    {
      key: 'secondaryLabel',
      label: 'Second button text',
      hint: 'Optional, for example "See what is inside".',
      control: 'text',
      maxLength: 40,
    },
    {
      key: 'secondaryHref',
      label: 'Second button link',
      hint: 'A web address, or a section on this page such as #curriculum.',
      control: 'url',
      maxLength: 500,
    },
    {
      key: 'heroMediaId',
      label: 'Hero image or clip',
      control: 'media',
      mediaSlot: 'heroMediaId',
    },
    {
      key: 'image',
      label: 'Your own image',
      hint: 'Replaces the course image here. When the hero plays a clip, pick "The image only" below to show this instead.',
      control: 'image',
      decorative: true,
      focalLayouts: HERO_CROPS,
    },
    {
      key: 'media',
      label: 'What to show',
      control: 'select',
      options: [
        {
          value: 'auto',
          label: 'The clip if there is one, otherwise the image',
        },
        { value: 'image', label: 'The image only' },
        { value: 'video', label: 'The clip, playing silently' },
        { value: 'none', label: 'No image' },
      ],
    },
    {
      key: 'watchLabel',
      label: 'Play button text',
      hint: 'Shown when the hero plays a clip. Leave empty for "Watch the film".',
      control: 'text',
      maxLength: 40,
    },
  ],
  starter: ({ courseTitle, courseLede }) => ({
    heading: courseTitle,
    body:
      courseLede?.trim() ||
      `Everything you need to begin ${courseTitle}, one clear step at a time.`,
  }),
  sample: {
    heading: 'Find your steady ground',
    body: 'A six-week practice for calmer mornings, clearer thinking and a body that feels like home.',
    note: 'Start whenever you like.',
    secondaryLabel: 'See what is inside',
    secondaryHref: '#curriculum',
    media: 'auto',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 120),
      body: readText(raw, 'body', 400),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      secondaryLabel: readText(raw, 'secondaryLabel', 40),
      secondaryHref: readText(raw, 'secondaryHref', 500),
      media: readOneOf(raw, 'media', HERO_MEDIA_MODES),
      watchLabel: readText(raw, 'watchLabel', 40),
      image: isImageRef(raw.image) ? raw.image : undefined,
      stillFocus: readStillFocus(raw.stillFocus),
      hideLogo: readBool(raw, 'hideLogo'),
    }),
  // The journey's still (its uploaded hero, or the hero clip's poster) as
  // `HeroBlock` picks it (`heroMedia`), offered under "Hero image or clip".
  // None where the creator's own image replaces it, where the hero shows no
  // media, or where the clip plays in the frame, which a point never crops.
  stillFocus: {
    under: 'heroMediaId',
    focalLayouts: HERO_CROPS,
    still: (raw, preview, context) => {
      const media = heroMedia(heroDefinition.coerce(raw), preview, context);
      return media.own || media.clip ? null : media.still;
    },
  },
};
