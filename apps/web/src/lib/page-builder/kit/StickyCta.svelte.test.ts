import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { sampleContext } from './model/sample';
import StickyCta from './StickyCta.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

describe('StickyCta', () => {
  // `PageRenderer` passes the Style's scheme, else `base`; the bar's own
  // default is the same, so a host that passes none draws the org's raised
  // card (owner, D9), never a dark band the org's site does not show.
  it('defaults to the base scheme, as PageRenderer does', () => {
    app = mount(StickyCta, {
      target: document.body,
      props: { context: sampleContext({ offer: 'tiers' }) },
    });
    flushSync();
    expect(
      document.body.querySelector('.lp-sticky')?.getAttribute('data-lp-scheme')
    ).toBe('base');
  });
});
