import { type ImageRef, isImageRef } from '../../../page-images';
import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readItems, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export interface GalleryItem {
  image: ImageRef;
  caption?: string;
}

export type GalleryProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  items?: GalleryItem[];
};

/** The canvas prompt where the pictures would be — shown only while editing. */
export const GALLERY_EMPTY = 'Add your pictures, one at a time.';

export const MAX_GALLERY_ITEMS = 12;

export const galleryDefinition: BlockDefinition<GalleryProps> = {
  type: 'gallery',
  label: 'Gallery',
  description: 'Your own pictures, arranged to show what the course is like.',
  group: 'proof',
  icon: 'ImageIcon',
  layouts: [
    layout(
      'mosaic',
      'Mosaic',
      'Pictures of mixed sizes, with the first one largest.'
    ),
    layout('strip', 'Strip', 'A row of pictures that visitors swipe through.'),
    layout('grid', 'Grid', 'Pictures in even rows, all the same size.'),
  ],
  fields: [
    eyebrowField,
    headingField(120),
    { ...bodyField, maxLength: 300 },
    {
      key: 'items',
      label: 'Pictures',
      hint: 'Each picture with a short caption if you like. Describe what it shows.',
      control: 'items',
      maxItems: MAX_GALLERY_ITEMS,
      itemFields: [
        {
          key: 'image',
          label: 'Picture',
          control: 'image',
          // Each layout's frame at 1440 and 390, in the Style that cuts it
          // most; a mosaic's and a strip's is the tile that cuts it most.
          focalLayouts: {
            mosaic: [
              { at: 'wide', ratio: '3 / 5' },
              { at: 'phone', ratio: '13 / 5' },
            ],
            strip: [
              { at: 'wide', ratio: '4 / 5' },
              { at: 'phone', ratio: '4 / 5' },
            ],
            grid: [
              { at: 'wide', ratio: '4 / 3' },
              { at: 'phone', ratio: '4 / 3' },
            ],
          },
        },
        { key: 'caption', label: 'Caption', control: 'text', maxLength: 120 },
      ],
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: `Inside ${courseTitle}`,
  }),
  // No pictures: a sample can only point at keys that exist, and thumbnails
  // must never request made-up URLs. E4 designs how an empty gallery previews.
  sample: {
    heading: 'A look inside',
    body: 'The places, the materials and the people you will meet along the way.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 120),
      body: readText(raw, 'body', 300),
      items: readItems(
        raw,
        'items',
        (entry) =>
          isImageRef(entry.image)
            ? compact({
                image: entry.image,
                caption: readText(entry, 'caption', 120),
              })
            : null,
        MAX_GALLERY_ITEMS
      ),
    }),
};
