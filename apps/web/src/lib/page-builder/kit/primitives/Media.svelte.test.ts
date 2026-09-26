import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Media from './Media.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

describe('Media', () => {
  it('draws the image when there is one', () => {
    app = mount(Media, { target: document.body, props: { image: '/a.jpg' } });
    flushSync();
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
      '/a.jpg'
    );
    expect(document.body.querySelector('.lp-media__plate')).toBeNull();
  });

  it('falls back to the designed plate when the image fails, never a broken glyph', () => {
    app = mount(Media, {
      target: document.body,
      props: { image: '/gone.jpg' },
    });
    flushSync();
    document.body.querySelector('img')?.dispatchEvent(new Event('error'));
    flushSync();
    expect(document.body.querySelector('img')).toBeNull();
    expect(document.body.querySelector('.lp-media__plate')).not.toBeNull();
    expect(
      document.body.querySelector('.lp-media')?.hasAttribute('data-empty')
    ).toBe(true);
  });
});
