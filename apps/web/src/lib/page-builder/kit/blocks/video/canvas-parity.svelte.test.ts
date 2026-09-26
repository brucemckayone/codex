/**
 * The canvas draws the public page (contract §6) — for the media blocks, apart
 * from their empty-media prompts, the one element a creator needs and a
 * visitor must never see. Each is marked `data-lp-edit-only`; this mirrors
 * `PageRenderer.svelte.test.ts`'s identity check with that element removed.
 */
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { sampleContext, samplePage } from '../../model/sample';
import PageRenderer from '../../PageRenderer.svelte';
import type { PageEdit } from '../../page-context';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

async function render(edit: PageEdit | null) {
  const page = samplePage('bold', ['video', 'preview', 'instructor', 'stats']);
  // No intro, reel, portrait, curriculum or numbers of the creator's own:
  // every block's empty state at once.
  const stats = page.sections.find((section) => section.type === 'stats');
  if (stats) stats.props = { heading: 'At a glance', live: true };
  app = mount(PageRenderer, {
    target: document.body,
    props: { page, context: { ...sampleContext(), stages: [] }, edit },
  });
  flushSync();
  await tick();
  await Promise.resolve();
  flushSync();
  return document.body.querySelector('.lp') as HTMLElement;
}

function withoutEditing(root: HTMLElement, dropCanvasOnly: boolean): string {
  const copy = root.cloneNode(true) as HTMLElement;
  if (dropCanvasOnly) {
    for (const el of copy.querySelectorAll('[data-lp-edit-only]')) el.remove();
  }
  for (const el of copy.querySelectorAll('[contenteditable]')) {
    for (const attr of [
      'contenteditable',
      'spellcheck',
      'role',
      'aria-label',
      'data-field',
    ]) {
      el.removeAttribute(attr);
    }
  }
  for (const el of [copy, ...copy.querySelectorAll('*')]) {
    for (const attr of [
      'data-lp-section',
      'data-lp-selected',
      'data-lp-editing',
      'data-lp-still',
    ]) {
      el.removeAttribute(attr);
    }
  }
  copy.querySelector('.lp-sticky')?.remove();
  return copy.innerHTML.replace(/<!--[\s\S]*?-->/g, '');
}

describe('media blocks on the canvas', () => {
  it('draw the public markup, apart from the prompts only a creator sees', async () => {
    const publicRoot = await render(null);
    expect(publicRoot.querySelector('[data-lp-edit-only]')).toBeNull();
    const publicHtml = withoutEditing(publicRoot, false);
    unmount(app);

    const canvas = await render({ commit: () => {} });
    expect(canvas.querySelectorAll('[data-lp-edit-only]').length).toBe(4);
    expect(withoutEditing(canvas, true)).toBe(publicHtml);
  });
});
