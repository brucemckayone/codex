import { type ImageRef, isImageRef } from '../../../page-images';
import { layout } from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type PictureProps = {
  /** The creator's own upload, with its focal point and size (03 X64). */
  image?: ImageRef;
  caption?: string;
};

/** The canvas's prompt where the picture would be — shown only while editing. */
export const PICTURE_PROMPT = 'Add a picture: tap here, then choose one.';

/** The canvas's faint caption line, in "Beside its caption" only. */
export const CAPTION_PROMPT = 'Add a caption';

export const pictureDefinition: BlockDefinition<PictureProps> = {
  type: 'picture',
  label: 'Picture',
  description:
    'One picture on its own, in the column, across the page or beside a caption.',
  group: 'basics',
  icon: 'ImageIcon',
  layouts: [
    layout(
      'contained',
      'In the column',
      'The whole picture at its own shape, never cropped.'
    ),
    layout(
      'full',
      'Full width',
      'Edge to edge across the page, cropped around the point you choose.'
    ),
    layout(
      'beside',
      'Beside its caption',
      'The picture with its words at its foot, like a label in a gallery.'
    ),
  ],
  fields: [
    {
      key: 'image',
      label: 'Picture',
      control: 'image',
      focalLayouts: {
        full: [
          { at: 'wide', ratio: '2 / 1' },
          { at: 'tablet', ratio: '3 / 2' },
          { at: 'phone', ratio: '4 / 5' },
        ],
      },
    },
    {
      key: 'caption',
      label: 'Caption',
      hint: 'Optional. A line under the picture, never over it.',
      control: 'text',
      inline: true,
      maxLength: 200,
    },
  ],
  starter: () => ({}),
  sample: {},
  coerce: (raw) =>
    compact({
      image: isImageRef(raw.image) ? raw.image : undefined,
      caption: readText(raw, 'caption', 200),
    }),
};
