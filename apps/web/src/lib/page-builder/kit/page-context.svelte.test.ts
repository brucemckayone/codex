/**
 * The page context's `still`: whether the page is being looked at rather than
 * read (Codex-61zsk.37). Only then may a block draw what stands in for missing
 * media — a plate, a frame waiting for a picture — so it must be true in every
 * still thumbnail and on the canvas, and false on the public page. The root's
 * `data-lp-still` is the same fact for CSS; the two never disagree.
 */
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { sampleContext, samplePage } from './model/sample';
import PageRenderer from './PageRenderer.svelte';
import type { KitPageContext, PageEdit } from './page-context';

// Every context PageRenderer provides, exactly as it provides it.
const provided: KitPageContext[] = [];

vi.mock('./page-context', async (importOriginal) => {
  const real = await importOriginal<typeof import('./page-context')>();
  return {
    ...real,
    setKitPage: (context: KitPageContext) => {
      provided.push(context);
      real.setKitPage(context);
    },
  };
});

let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  provided.length = 0;
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

async function render(props: { still?: boolean; edit?: PageEdit | null }) {
  app = mount(PageRenderer, {
    target: document.body,
    props: {
      page: samplePage('bold', ['hero']),
      context: sampleContext(),
      ...props,
    },
  });
  flushSync();
  await tick();
  const context = provided.at(-1);
  const root = document.body.querySelector('.lp');
  expect(context?.still, 'the context agrees with the root flag').toBe(
    root?.hasAttribute('data-lp-still')
  );
  return context;
}

describe('the page context', () => {
  it('is not still on the public page', async () => {
    expect((await render({}))?.still).toBe(false);
  });

  it('is still in a thumbnail', async () => {
    expect((await render({ still: true }))?.still).toBe(true);
  });

  it('is still on the canvas, which the editor never plays', async () => {
    expect((await render({ edit: { commit: () => {} } }))?.still).toBe(true);
  });
});
