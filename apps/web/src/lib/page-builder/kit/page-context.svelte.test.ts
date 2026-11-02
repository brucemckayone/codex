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
import type { KitPageContext, OrgLogoSource, PageEdit } from './page-context';

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

async function render(props: {
  still?: boolean;
  edit?: PageEdit | null;
  orgLogo?: OrgLogoSource | null;
}) {
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

// Codex-61zsk.73: the hero's logo comes from the mount, as plain data.
describe('the page context’s logo', () => {
  const logo = { url: 'https://cdn.test/logo.svg', name: 'Studio Alpha' };

  it('is none when the mount passes none', async () => {
    expect((await render({}))?.orgLogo).toBeNull();
  });

  it('is the logo the mount passes, on the public page, a thumbnail and the canvas', async () => {
    expect((await render({ orgLogo: logo }))?.orgLogo).toEqual(logo);
    if (app) unmount(app);
    expect((await render({ orgLogo: logo, still: true }))?.orgLogo).toEqual(
      logo
    );
    if (app) unmount(app);
    expect(
      (await render({ orgLogo: logo, edit: { commit: () => {} } }))?.orgLogo
    ).toEqual(logo);
  });

  // The brand editor swaps or removes the logo while the page is up.
  it('follows the mount as the logo changes', async () => {
    const props = $state<{
      page: ReturnType<typeof samplePage>;
      context: ReturnType<typeof sampleContext>;
      orgLogo: OrgLogoSource | null;
    }>({
      page: samplePage('bold', ['hero']),
      context: sampleContext(),
      orgLogo: logo,
    });
    app = mount(PageRenderer, { target: document.body, props });
    flushSync();
    await tick();
    const context = provided.at(-1);
    props.orgLogo = { ...logo, url: 'https://cdn.test/new.png' };
    flushSync();
    expect(context?.orgLogo?.url).toBe('https://cdn.test/new.png');
    props.orgLogo = null;
    flushSync();
    expect(context?.orgLogo).toBeNull();
  });
});
