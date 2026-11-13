import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { draftRow } from '../../__fixtures__/draft-row';
import ContentThumb from '../ContentThumb.svelte';

/**
 * ContentThumb (Codex-a6ofh.3.6): a cover whose file fails to load shows the
 * type's icon in the same box, never the browser's broken-image glyph.
 */
describe('ContentThumb', () => {
  let component: ReturnType<typeof mount> | null = null;
  let target: HTMLElement;

  afterEach(() => {
    if (component) unmount(component);
    component = null;
    target?.remove();
  });

  function render(fields: Parameters<typeof draftRow>[0] = {}) {
    target = document.createElement('div');
    document.body.appendChild(target);
    component = mount(ContentThumb, {
      target,
      props: { piece: draftRow(fields) },
    });
    flushSync();
  }

  const box = () => target.querySelector('.thumb');
  // The badge always carries a small icon; the type icon is the box's own.
  const typeIcon = () => box()?.querySelector(':scope > svg');

  test('a cover shows, with no type icon over it', () => {
    render({ thumbnailUrl: '/cover.webp' });
    expect(box()?.querySelector('img')?.getAttribute('src')).toBe(
      '/cover.webp'
    );
    expect(typeIcon()).toBeNull();
  });

  test('a cover that fails to load shows the type icon in the same box', () => {
    render({ thumbnailUrl: '/missing.webp' });
    const img = box()?.querySelector('img');
    img?.dispatchEvent(new Event('error'));
    flushSync();

    expect(box()?.querySelector('img')).toBe(img);
    expect(img?.style.display).toBe('none');
    expect(typeIcon()).not.toBeNull();
  });

  test('no cover shows the type icon', () => {
    render({ thumbnailUrl: null });
    expect(box()?.querySelector('img')).toBeNull();
    expect(typeIcon()).not.toBeNull();
  });
});
