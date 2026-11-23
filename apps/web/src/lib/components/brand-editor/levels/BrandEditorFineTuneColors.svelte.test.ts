/**
 * Fine-tune colours in its two places (the owner's, 2026-11-23: the hero is
 * edited in one place): the page's groups under Colours, the hero's own under
 * Hero > Hero colours, open, with the reel's ink warning.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { brandEditor } from '$lib/brand-editor';
import BrandEditorFineTuneColors from './BrandEditorFineTuneColors.svelte';

const ORG_ID = 'org-fine-tune';

function brand(
  tokenOverrides: Record<string, string | null>
): BrandEditorState {
  return {
    primaryColor: '#CB213C',
    secondaryColor: null,
    accentColor: null,
    backgroundColor: '#0F0000',
    fontBody: null,
    fontHeading: null,
    radius: 0.5,
    density: 1,
    logoUrl: null,
    darkOverrides: null,
    darkTokenOverrides: null,
    heroLayout: 'default',
    tokenOverrides,
  };
}

let component: ReturnType<typeof mount> | null = null;
function render(
  section: 'page' | 'hero',
  tokenOverrides: Record<string, string | null> = {}
) {
  brandEditor.open(ORG_ID, brand(tokenOverrides));
  component = mount(BrandEditorFineTuneColors, {
    target: document.body,
    props: { section },
  });
  flushSync();
}

const groups = () =>
  [...document.querySelectorAll('.fine-tune__group-label')].map((h) =>
    h.textContent?.trim()
  );

afterEach(() => {
  if (component) unmount(component);
  component = null;
  brandEditor.close();
  document.body.innerHTML = '';
});

describe('BrandEditorFineTuneColors', () => {
  test("the page's groups leave the hero's to the Hero section", () => {
    render('page');
    expect(groups()).toContain('Surfaces');
    expect(groups()).not.toContain('Hero');
  });

  test("the Hero section shows only the hero's colours, open", () => {
    render('hero');
    expect(groups()).toEqual(['Hero']);
    expect(document.body.textContent).toContain('Main Button');
    expect(document.querySelector('[data-ink-warning]')).toBeNull();
  });

  test('a hero colour the reel cannot carry over film is warned of there', () => {
    render('hero', { 'hero-title-color': '#6A0000' });
    expect(document.querySelector('[data-ink-warning]')?.textContent).toContain(
      'A hero text colour is hard to read over film'
    );
  });
});
