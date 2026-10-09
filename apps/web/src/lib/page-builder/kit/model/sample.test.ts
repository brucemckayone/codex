import { describe, expect, it } from 'vitest';
import { isImageRef } from '../../page-images';
import { PAGE_STYLE_IDS, type SectionTypeId } from './ids';
import { type SamplePicture, samplePage, withSamplePictures } from './sample';
import type { KitPage } from './types';

const PICTURES: SamplePicture[] = Array.from({ length: 6 }, (_, i) => ({
  image: { key: `pictures/${i + 1}`, alt: `Picture ${i + 1}` },
  ...(i % 2 === 0 ? { caption: `Caption ${i + 1}` } : {}),
}));

const TYPES: SectionTypeId[] = [
  'hero',
  'text',
  'benefits',
  'story',
  'gallery',
  'faq',
];

/** Every picture anywhere in a value, in document order. */
function picturesIn(value: unknown): string[] {
  if (isImageRef(value)) return [value.key];
  if (Array.isArray(value)) return value.flatMap(picturesIn);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(picturesIn);
  }
  return [];
}

const props = (page: KitPage, type: SectionTypeId) =>
  page.sections.find((section) => section.type === type)?.props ?? {};

describe('samplePage', () => {
  it.each(
    PAGE_STYLE_IDS
  )('%s: the definitions’ own samples carry no pictures', (style) => {
    expect(picturesIn(samplePage(style).sections)).toEqual([]);
  });
});

describe('withSamplePictures', () => {
  const page = samplePage('bold', TYPES);
  const pictured = withSamplePictures(page, PICTURES);

  it('puts a picture in every picture field', () => {
    const story = props(pictured, 'story').steps as { image?: unknown }[];
    const benefits = props(pictured, 'benefits').items as { image?: unknown }[];
    expect(story.length).toBeGreaterThan(0);
    expect(story.every((step) => isImageRef(step.image))).toBe(true);
    expect(benefits.length).toBeGreaterThan(0);
    expect(benefits.every((item) => isImageRef(item.image))).toBe(true);
    expect(isImageRef(props(pictured, 'text').image)).toBe(true);
    const gallery = props(pictured, 'gallery').items as { image?: unknown }[];
    expect(gallery).toHaveLength(PICTURES.length);
    expect(gallery.every((item) => isImageRef(item.image))).toBe(true);
  });

  it('deals the pictures in turn down the page, so a gallery never repeats one', () => {
    const dealt = picturesIn(pictured.sections);
    expect(dealt).toEqual(
      dealt.map((_, i) => PICTURES[i % PICTURES.length].image.key)
    );
    const gallery = picturesIn(props(pictured, 'gallery'));
    expect(new Set(gallery).size).toBe(PICTURES.length);
  });

  it('gives a gallery picture its own caption, and none where it has none', () => {
    const items = props(pictured, 'gallery').items as {
      image: { key: string };
      caption?: string;
    }[];
    for (const item of items) {
      const source = PICTURES.find(
        (picture) => picture.image.key === item.image.key
      );
      expect(item.caption).toBe(source?.caption);
    }
    expect(items.some((item) => item.caption === undefined)).toBe(true);
  });

  it('keeps every other field and section as it was', () => {
    expect(props(pictured, 'hero')).toEqual(props(page, 'hero'));
    expect(props(pictured, 'faq')).toEqual(props(page, 'faq'));
    expect(props(pictured, 'story').heading).toBe(props(page, 'story').heading);
    const words = (steps: unknown) =>
      (steps as { heading: string; body?: string }[]).map(
        ({ heading, body }) => ({ heading, body })
      );
    expect(words(props(pictured, 'story').steps)).toEqual(
      words(props(page, 'story').steps)
    );
  });

  it('leaves the page it was given untouched; no pictures leaves it as it is', () => {
    const before = structuredClone(page);
    withSamplePictures(page, PICTURES);
    expect(page).toEqual(before);
    expect(withSamplePictures(page, [])).toBe(page);
  });
});
