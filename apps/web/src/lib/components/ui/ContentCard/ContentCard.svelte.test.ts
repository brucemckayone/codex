import { afterEach, describe, expect, test } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import ContentCard from './ContentCard.svelte';

/**
 * ContentCard shape-system unit tests (WP-7).
 *
 * These run under jsdom, which does NOT apply component `<style>` rules or
 * compute `:hover` styles. So we assert the DOM CONTRACT the CSS keys on —
 * `data-shape` / `data-chrome` attributes and the `cc--title-in-cover`
 * class + overlay structure — rather than computed geometry. The visual
 * geometry (aspect-ratio, transparent→hover) is verified end-to-end in the
 * epic's Playwright gate (WP-12).
 */

const base = { id: 'c1', title: 'Test Content' } as const;

function render(props: Record<string, unknown>) {
  return mount(ContentCard, {
    target: document.body,
    props: { ...base, ...props },
  });
}

const card = () => document.querySelector<HTMLElement>('.cc');

describe('ContentCard — shape prop', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test.each([
    ['16:9'],
    ['1:1'],
    ['3:4'],
    ['3:2'],
  ] as const)('shape="%s" emits matching data-shape', (shape) => {
    component = render({ shape });
    expect(card()?.getAttribute('data-shape')).toBe(shape);
  });

  test('no shape and no normalizeRatio emits no data-shape (default cascade)', () => {
    component = render({ contentType: 'video' });
    expect(card()?.hasAttribute('data-shape')).toBe(false);
  });

  test('normalizeRatio={true} is a backward-compatible alias for shape="16:9"', () => {
    component = render({ normalizeRatio: true });
    expect(card()?.getAttribute('data-shape')).toBe('16:9');
  });

  test('explicit shape wins over normalizeRatio', () => {
    component = render({ normalizeRatio: true, shape: '3:4' });
    expect(card()?.getAttribute('data-shape')).toBe('3:4');
  });
});

describe('ContentCard — chrome prop', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('default chrome ("auto") emits no data-chrome attribute', () => {
    component = render({});
    expect(card()?.hasAttribute('data-chrome')).toBe(false);
  });

  test('chrome="transparent" emits data-chrome the CSS hover rule keys on', () => {
    component = render({ chrome: 'transparent' });
    expect(card()?.getAttribute('data-chrome')).toBe('transparent');
  });

  test('chrome="solid" emits data-chrome="solid"', () => {
    component = render({ chrome: 'solid' });
    expect(card()?.getAttribute('data-chrome')).toBe('solid');
  });
});

describe('ContentCard — article title-in-cover', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('article + shape="1:1" auto-enables the title-in-cover overlay', () => {
    component = render({
      contentType: 'article',
      shape: '1:1',
      description: 'An excerpt that should not surface as a body paragraph.',
    });
    const el = card();
    expect(el?.classList.contains('cc--title-in-cover')).toBe(true);
    // Title still renders (moved into the scrimmed overlay body)...
    expect(document.querySelector('.cc__title')?.textContent).toContain(
      'Test Content'
    );
    // ...and the plain body excerpt is suppressed in favour of the cover.
    expect(document.querySelector('.cc__description')).toBeNull();
  });

  test('article + shape="3:4" with no image renders the brand gradient cover', () => {
    component = render({
      contentType: 'article',
      shape: '3:4',
      thumbnail: null,
    });
    expect(document.querySelector('.cc__thumb .cc__cover--brand')).toBeTruthy();
    // No file-text placeholder icon — the cover stands in for the image.
    expect(document.querySelector('.cc__placeholder')).toBeNull();
  });

  test('article + shape="3:4" WITH an image renders the image over an always-present brand cover', () => {
    component = render({
      contentType: 'article',
      shape: '3:4',
      thumbnail: 'https://cdn.example/img.jpg',
    });
    expect(document.querySelector('img.cc__image')).toBeTruthy();
    // The brand cover is ALWAYS painted behind the (promoted) image — not
    // hidden — so a load error, even pre-hydration / no-JS, falls back to the
    // gradient with no onerror handler required.
    const brandCover = document.querySelector('.cc__cover--brand');
    expect(brandCover).toBeTruthy();
    expect(brandCover?.classList.contains('hidden')).toBe(false);
  });

  test('article without a shape does NOT enable title-in-cover (default cascade)', () => {
    component = render({
      contentType: 'article',
      description: 'This excerpt should still render in the body.',
    });
    const el = card();
    expect(el?.classList.contains('cc--title-in-cover')).toBe(false);
    expect(document.querySelector('.cc__description')?.textContent).toContain(
      'This excerpt should still render'
    );
  });

  test('list variant does NOT enable title-in-cover; body description renders', () => {
    component = render({
      contentType: 'article',
      variant: 'list',
      description: 'This excerpt should still render in the body.',
    });
    const el = card();
    expect(el?.classList.contains('cc--title-in-cover')).toBe(false);
    expect(document.querySelector('.cc__description')?.textContent).toContain(
      'This excerpt should still render'
    );
  });

  test('titleInCover={false} forces the overlay off even for a shaped article', () => {
    component = render({
      contentType: 'article',
      shape: '3:4',
      titleInCover: false,
    });
    expect(card()?.classList.contains('cc--title-in-cover')).toBe(false);
  });

  test('titleInCover={true} forces the overlay on for a non-article type', () => {
    component = render({
      contentType: 'video',
      shape: '16:9',
      titleInCover: true,
    });
    expect(card()?.classList.contains('cc--title-in-cover')).toBe(true);
  });

  // ── Browse-grid opt-in (explore/library/discover pass shape="3:4" +
  //    titleInCover): every type joins the title-in-cover treatment with its
  //    own per-type flair. This is the homogenisation feature. ──
  test('opt-in video tile → title-in-cover with the play-ring flair (no audio disc)', () => {
    component = render({
      contentType: 'video',
      shape: '3:4',
      titleInCover: true,
    });
    expect(card()?.classList.contains('cc--title-in-cover')).toBe(true);
    expect(document.querySelector('.cc__flair-ring')).toBeTruthy();
    expect(document.querySelector('.cc__flair-disc')).toBeNull();
  });

  test('opt-in audio tile → play disc flair, and the below-cover audio overlay is suppressed', () => {
    component = render({
      contentType: 'audio',
      shape: '3:4',
      titleInCover: true,
    });
    expect(card()?.classList.contains('cc--title-in-cover')).toBe(true);
    expect(document.querySelector('.cc__flair-disc')).toBeTruthy();
    // Superseded by the flair — the old audio-media overlay must not render.
    expect(document.querySelector('.cc__audio-overlay')).toBeNull();
  });

  test('imageless article tile → dropcap flair with the uppercased initial', () => {
    component = render({
      contentType: 'article',
      shape: '3:4',
      title: 'deep work',
      thumbnail: null,
    });
    const dropcap = document.querySelector('.cc__flair-dropcap');
    expect(dropcap).toBeTruthy();
    expect(dropcap?.textContent).toBe('D');
  });

  test('title-in-cover always paints a brand cover behind the image (JS-free fallback)', () => {
    component = render({
      contentType: 'video',
      shape: '3:4',
      titleInCover: true,
      thumbnail: 'https://cdn.example/v.jpg',
    });
    expect(document.querySelector('.cc__cover--brand')).toBeTruthy();
    expect(document.querySelector('img.cc__image')).toBeTruthy();
  });
});
