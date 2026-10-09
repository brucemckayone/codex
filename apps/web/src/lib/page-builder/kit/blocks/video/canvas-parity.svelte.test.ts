/**
 * The canvas draws the public page (contract §6) — for the media blocks, apart
 * from what only a creator needs and a visitor must never see: an empty-media
 * prompt, and (Codex-61zsk.37) a film section with no film, which the public
 * page does not draw at all. Each such element is marked `data-lp-edit-only`;
 * this mirrors `PageRenderer.svelte.test.ts`'s identity check with them
 * removed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tick } from 'svelte';
import { parse } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { sampleContext, samplePage } from '../../model/sample';
import PageRenderer from '../../PageRenderer.svelte';
import type { PageEdit } from '../../page-context';
import { PREVIEW_PROMPT } from '../preview/definition';
import { VIDEO_PROMPT } from './definition';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

async function render(
  options: { edit?: PageEdit | null; still?: boolean } = {}
) {
  const page = samplePage('bold', ['video', 'preview', 'instructor', 'stats']);
  // No intro, reel, portrait, curriculum or numbers of the creator's own:
  // every block's empty state at once.
  const stats = page.sections.find((section) => section.type === 'stats');
  if (stats) stats.props = { heading: 'At a glance', live: true };
  app = mount(PageRenderer, {
    target: document.body,
    props: {
      page,
      context: { ...sampleContext(), stages: [] },
      edit: options.edit ?? null,
      still: options.still ?? false,
    },
  });
  flushSync();
  await tick();
  await Promise.resolve();
  flushSync();
  return document.body.querySelector('.lp') as HTMLElement;
}

const band = (root: HTMLElement, type: string) =>
  root.querySelector(`.lp-section[data-lp-type="${type}"]`);

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

type CssNode = {
  type: string;
  property?: string;
  value?: string;
  prelude?: { start: number; end: number };
  block?: { children: CssNode[] } | null;
};

/** What each selector of a component's <style> declares; comments stripped. */
function declarations(file: string): Map<string, Record<string, string>> {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), file),
    'utf8'
  );
  const squash = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const rules = new Map<string, Record<string, string>>();
  const visit = (nodes: CssNode[]) => {
    for (const node of nodes) {
      const children = node.block?.children ?? [];
      if (node.type === 'Rule' && node.prelude) {
        const selector = squash(
          source.slice(node.prelude.start, node.prelude.end)
        );
        const own = rules.get(selector) ?? {};
        for (const child of children)
          if (child.type === 'Declaration')
            own[child.property ?? ''] = squash(child.value ?? '');
        rules.set(selector, own);
      }
      visit(children);
    }
  };
  visit((parse(source, { modern: true }).css?.children ?? []) as CssNode[]);
  return rules;
}

describe('media blocks on the canvas', () => {
  it('draw the public markup, apart from what only a creator sees', async () => {
    const publicRoot = await render();
    expect(publicRoot.querySelector('[data-lp-edit-only]')).toBeNull();
    const publicHtml = withoutEditing(publicRoot, false);
    unmount(app);

    const canvas = await render({ edit: { commit: () => {} } });
    // Every media section with nothing to show asks for it there.
    for (const type of ['video', 'preview', 'instructor', 'stats']) {
      expect(
        band(canvas, type)?.querySelector('[data-lp-edit-only]'),
        type
      ).not.toBeNull();
    }
    expect(withoutEditing(canvas, true)).toBe(publicHtml);
  });

  it('with no clip, a film section draws nothing on the public page and its shape in a still thumbnail', async () => {
    const publicRoot = await render();
    for (const type of ['video', 'preview']) {
      expect(band(publicRoot, type)?.textContent?.trim(), type).toBe('');
    }
    unmount(app);

    const thumbnail = await render({ still: true });
    for (const [type, prompt] of [
      ['video', VIDEO_PROMPT],
      ['preview', PREVIEW_PROMPT],
    ]) {
      const section = band(thumbnail, type);
      expect(section?.querySelector('h2'), type).not.toBeNull();
      expect(section?.querySelector('.lp-media__plate'), type).not.toBeNull();
      // The prompt is the canvas's: a thumbnail is only a picture.
      expect(section?.textContent, type).not.toContain(prompt);
    }
  });

  it.each([
    ['VideoBlock.svelte', 'video-none'],
    ['../preview/PreviewBlock.svelte', 'preview-none'],
  ])('%s folds its band away on the public page when there is no clip', (file, marker) => {
    expect(
      declarations(file).get(
        `:global(.lp:not([data-lp-still]) .lp-section:has(> .lp-inner > .${marker}))`
      )
    ).toEqual({ display: 'none' });
  });
});
