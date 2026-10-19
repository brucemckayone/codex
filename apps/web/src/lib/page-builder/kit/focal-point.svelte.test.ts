/**
 * Every picture a creator uploads is steered by its focal point wherever the
 * kit draws it (Codex-61zsk.58): the hero's own image, Text's, a benefit's, a
 * story moment's, a gallery picture, the closing ask's background and any
 * section's background. A picture with no point draws as it did before focal
 * points, with no `object-position` at all. And every image field says where
 * its layouts cut it, so a new one cannot ship without a focal point.
 */
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { ImageRef } from '../page-images';
import { DEFINITIONS } from './model/catalog';
import { SECTION_LAYOUTS, type SectionTypeId } from './model/ids';
import { sampleContext } from './model/sample';
import type { BlockField, KitPage } from './model/types';
import PageRenderer from './PageRenderer.svelte';

const CDN = 'https://cdn.example';
const KEY = 'landing-pages/page-1/images/image-1';
const POINT = { x: 64, y: 36 };

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

type Props = Record<string, unknown>;
const sample = (type: SectionTypeId): Props => ({
  ...DEFINITIONS[type].sample,
});
/** The sample's entries under `key`, each given `image`. */
const eachWith = (type: SectionTypeId, key: string, image: ImageRef): Props => {
  const props = sample(type);
  const entries = (props[key] as Props[] | undefined) ?? [];
  return { ...props, [key]: entries.map((entry) => ({ ...entry, image })) };
};

/** Where each upload lives in its section's props, and the layouts that draw it. */
const PLACES: {
  type: SectionTypeId;
  layouts: readonly string[];
  props: (image: ImageRef) => Props;
}[] = [
  {
    type: 'hero',
    layouts: SECTION_LAYOUTS.hero,
    props: (image) => ({ ...sample('hero'), image }),
  },
  {
    type: 'text',
    layouts: SECTION_LAYOUTS.text,
    props: (image) => ({ ...sample('text'), image }),
  },
  {
    type: 'benefits',
    layouts: ['grid', 'bento'],
    props: (image) => eachWith('benefits', 'items', image),
  },
  {
    type: 'story',
    layouts: SECTION_LAYOUTS.story,
    props: (image) => eachWith('story', 'steps', image),
  },
  // The gallery's sample has no pictures of its own, so it is given three.
  {
    type: 'gallery',
    layouts: SECTION_LAYOUTS.gallery,
    props: (image) => ({
      ...sample('gallery'),
      items: [{ image }, { image }, { image }],
    }),
  },
  {
    type: 'cta',
    layouts: ['band'],
    props: (image) => ({ ...sample('cta'), background: image }),
  },
  // Picture crops only at full width; its other layouts show it whole.
  {
    type: 'picture',
    layouts: ['full'],
    props: (image) => ({ ...sample('picture'), image }),
  },
  // A section's own background (`SectionShell`), on a type with no picture of its own.
  {
    type: 'problem',
    layouts: SECTION_LAYOUTS.problem,
    props: (image) => ({ ...sample('problem'), background: image }),
  },
];

async function draw(type: SectionTypeId, layout: string, props: Props) {
  const page: KitPage = {
    design: { style: 'bold' },
    sections: [{ id: 's1', type, enabled: true, variant: layout, props }],
  };
  app = mount(PageRenderer, {
    target: document.body,
    props: {
      page,
      context: sampleContext({ offer: 'tiers', mediaBaseUrl: CDN }),
    },
  });
  flushSync();
  await tick();
  flushSync();
  // The creator's own pictures: every variant of the one key.
  return [...document.body.querySelectorAll<HTMLImageElement>('img')].filter(
    (img) => img.getAttribute('src')?.startsWith(`${CDN}/${KEY}`)
  );
}

describe('the focal point (Codex-61zsk.58)', () => {
  const cases = PLACES.flatMap(({ type, layouts, props }) =>
    layouts.map((layout) => [type, layout, props] as const)
  );

  it.each(
    cases
  )('%s in %s steers each of its pictures by the point', async (type, layout, props) => {
    const pictures = await draw(
      type,
      layout,
      props({ key: KEY, focus: POINT })
    );
    expect(pictures.length).toBeGreaterThan(0);
    for (const img of pictures)
      expect(img.style.objectPosition).toBe('64% 36%');
  });

  it.each(
    cases
  )('%s in %s draws a picture with no point as before', async (type, layout, props) => {
    const pictures = await draw(type, layout, props({ key: KEY }));
    expect(pictures.length).toBeGreaterThan(0);
    for (const img of pictures) expect(img.style.objectPosition).toBe('');
  });
});

describe('every image field says where its layouts cut it', () => {
  const imageFields = Object.values(DEFINITIONS).flatMap((definition) =>
    definition.fields
      .flatMap((field): BlockField[] => [field, ...(field.itemFields ?? [])])
      .filter((field) => field.control === 'image')
      .map((field) => [definition.type, field.key, field] as const)
  );

  it('finds the uploads', () => {
    expect(imageFields.map(([type, key]) => `${type}.${key}`).sort()).toEqual([
      'benefits.image',
      'cta.background',
      'gallery.image',
      'hero.image',
      'picture.image',
      'story.image',
      'text.image',
    ]);
  });

  it.each(imageFields)('%s.%s', (type, _key, field) => {
    const cuts = Object.entries(field.focalLayouts ?? {});
    expect(cuts.length, 'a layout that cuts it').toBeGreaterThan(0);
    for (const [layout, crops] of cuts) {
      // A layout the block has, and one the field is shown in.
      expect(SECTION_LAYOUTS[type]).toContain(layout);
      if (field.layouts) expect(field.layouts).toContain(layout);
      expect(crops.length, layout).toBeGreaterThan(0);
      expect(new Set(crops.map((crop) => crop.at)).size, layout).toBe(
        crops.length
      );
      for (const { ratio } of crops)
        expect(ratio, layout).toMatch(/^\d+(\.\d+)? \/ \d+(\.\d+)?$/);
    }
  });
});
