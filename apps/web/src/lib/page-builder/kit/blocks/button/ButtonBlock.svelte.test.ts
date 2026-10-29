/**
 * The Button section (03 X64, Codex-61zsk.53), drawn as the page draws it
 * (through `PageRenderer`, so its anchors, its fold and its offer are the
 * page's own): one ask, wherever it is put, going where the creator said.
 */
import { tick } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPlayerCore } from '$lib/components/player/load-core';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { COPY } from '../../model/copy';
import {
  SAMPLE_OFFER_STATES,
  type SampleOfferState,
  sampleContext,
  samplePage,
} from '../../model/sample';
import type { KitPage } from '../../model/types';
import PageRenderer from '../../PageRenderer.svelte';
import type { PageEdit } from '../../page-context';
import { BUTTON_COPY, BUTTON_LABELS } from './copy';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

const FILM = { playlistUrl: '/preview.m3u8', posterUrl: null };

/** Studio's problem, the Button, then the offer and the closing ask. */
function page(buttonProps: Record<string, unknown> = {}): KitPage {
  const base = samplePage('studio', ['problem', 'button', 'pricing', 'cta']);
  return {
    ...base,
    sections: base.sections.map((s) =>
      s.type === 'button' ? { ...s, props: buttonProps } : s
    ),
  };
}

async function render({
  props = {},
  offer = 'tiers',
  edit = null,
  reel = null,
  attached,
  pageOverride,
  pinned = false,
}: {
  props?: Record<string, unknown>;
  offer?: SampleOfferState;
  edit?: PageEdit | null;
  reel?: typeof FILM | null;
  attached?: boolean;
  pageOverride?: KitPage;
  /** `purchasable` pinned true, as the studio canvas pins it (builder-context). */
  pinned?: boolean;
} = {}) {
  const context = sampleContext({
    offer,
    media: { reel },
    course:
      attached === undefined
        ? {}
        : { filmsAttached: { hero: false, intro: false, reel: attached } },
  });
  app = mount(PageRenderer, {
    target: document.body,
    props: {
      page: pageOverride ?? page(props),
      context: pinned ? { ...context, purchasable: true } : context,
      edit,
      sticky: false,
    },
  });
  flushSync();
  await tick();
  await Promise.resolve();
  flushSync();
  return document.body.querySelector('.lp') as HTMLElement;
}

const button = () =>
  document.body.querySelector<HTMLElement>(
    '.lp-section[data-lp-type="button"]'
  );
const editing: PageEdit = { commit: () => {} };

describe('ButtonBlock: join (the default)', () => {
  it.each(
    SAMPLE_OFFER_STATES
  )('%s: draws exactly the closing ask’s offer, so the two can never disagree', async (offer) => {
    await render({ offer });
    const own = button()?.querySelector('.cta__offer, .lp-actions');
    const ask = document.body.querySelector(
      '.lp-section[data-lp-type="cta"] :is(.cta__offer, .lp-actions)'
    );
    expect(own, offer).not.toBeNull();
    // The same ask, the same words: the Button carries "Join now" where the
    // closing ask's sample carries none of its own either.
    expect(own?.outerHTML.replaceAll('data-lp-type="button"', '')).toBe(
      ask?.outerHTML.replaceAll('data-lp-type="cta"', '')
    );
  });

  it('says "Join now" by default and the creator’s words when given, and "Continue" to a member', async () => {
    await render({ offer: 'buy' });
    expect(button()?.querySelector('.lp-button')?.textContent?.trim()).toBe(
      BUTTON_LABELS.join
    );
    unmount(app);
    await render({ offer: 'buy', props: { ctaLabel: 'Start this week' } });
    expect(button()?.querySelector('.lp-button')?.textContent?.trim()).toBe(
      'Start this week'
    );
    unmount(app);
    await render({ offer: 'enrolled', props: { ctaLabel: 'Start this week' } });
    expect(button()?.querySelector('.lp-button')?.textContent?.trim()).toBe(
      COPY.cta.continue
    );
  });

  it('on the canvas with no price, says where the price will come from; a visitor never sees it', async () => {
    await render({ offer: 'unknown', edit: editing });
    expect(button()?.textContent).toContain(BUTTON_COPY.noPrice);
    unmount(app);
    await render({ offer: 'unknown' });
    expect(button()?.textContent).not.toContain(BUTTON_COPY.noPrice);
    unmount(app);
    await render({ offer: 'tiers', edit: editing });
    expect(button()?.textContent).not.toContain(BUTTON_COPY.noPrice);
  });

  // The canvas pins `purchasable` true, so a course with no way in still
  // draws "Join now" there. The Pricing section draws it closed (PricingBlock,
  // Codex-36vjw); the Button keeps its note, as pricingView still calls the
  // course unpriced here.
  it('on the canvas, a course with no way in still says where the price will come from', async () => {
    await render({ offer: 'unavailable', edit: editing, pinned: true });
    expect(button()?.textContent).toContain(BUTTON_COPY.noPrice);
    unmount(app);
    await render({ offer: 'unavailable' });
    expect(button()?.textContent).not.toContain(BUTTON_COPY.noPrice);
  });
});

describe('ButtonBlock: section', () => {
  it('jumps to the section’s anchor on this page, with no price beside it', async () => {
    await render({
      props: { action: { kind: 'section', target: 'sample-pricing' } },
    });
    const link = button()?.querySelector('a.lp-button');
    expect(link?.getAttribute('href')).toBe('#pricing');
    expect(link?.textContent?.trim()).toBe(BUTTON_LABELS.section);
    expect(button()?.querySelector('.cta__offer, .cta__price')).toBeNull();
    expect(document.getElementById('pricing')).not.toBeNull();
  });

  it('a section that is hidden or gone: a visitor sees no Button, the canvas says why', async () => {
    const hidden = page({
      action: { kind: 'section', target: 'sample-pricing' },
    });
    const pricing = hidden.sections.find((s) => s.type === 'pricing');
    if (pricing) pricing.enabled = false;
    await render({ pageOverride: hidden });
    expect(button()).toBeNull();
    unmount(app);
    await render({ pageOverride: hidden, edit: editing });
    expect(button()?.textContent).toContain(BUTTON_COPY.deadSection);
    unmount(app);
    await render({ props: { action: { kind: 'section', target: 'deleted' } } });
    expect(button()).toBeNull();
  });
});

describe('ButtonBlock: preview', () => {
  // Fetched ahead, as the page's first sight of the button does.
  beforeAll(async () => {
    await loadPlayerCore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('plays the preview film in the shared player, with no price beside it', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    await render({
      props: { action: { kind: 'preview' } },
      reel: FILM,
      attached: true,
    });
    const press =
      button()?.querySelector<HTMLButtonElement>('button.lp-button');
    expect(press?.textContent?.trim()).toBe(BUTTON_LABELS.preview);
    expect(button()?.querySelector('.cta__price')).toBeNull();
    press?.click();
    flushSync();
    await tick();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // The theatre: the same player as a framed film, started by the press.
    expect(dialog?.querySelector('.player video')).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    // Escape dismisses it, and the focus is the button's again.
    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    flushSync();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(press);
  });

  it('on the canvas it plays nothing', async () => {
    await render({
      props: { action: { kind: 'preview' } },
      reel: FILM,
      attached: true,
      edit: editing,
    });
    button()?.querySelector<HTMLButtonElement>('button.lp-button')?.click();
    flushSync();
    await tick();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('a page with no film: a visitor sees no Button, the canvas says why', async () => {
    await render({ props: { action: { kind: 'preview' } }, attached: false });
    expect(button()).toBeNull();
    unmount(app);
    // Known only once the stream settles: the page folds it then, before
    // the bands resolve again (Codex-61zsk.57).
    await render({ props: { action: { kind: 'preview' } } });
    expect(button()).toBeNull();
    unmount(app);
    await render({
      props: { action: { kind: 'preview' } },
      attached: false,
      edit: editing,
    });
    expect(button()?.textContent).toContain(BUTTON_COPY.noPreview);
  });

  it('a film that arrives although none was attached: the Button plays it, as its section shows it', async () => {
    await render({
      props: { action: { kind: 'preview' } },
      reel: FILM,
      attached: false,
    });
    expect(button()?.querySelector('button.lp-button')).not.toBeNull();
    expect(button()?.querySelector('.button-none')).toBeNull();
  });
});

describe('ButtonBlock: link', () => {
  it('opens an https address in a new tab, apart from the page, and says so', async () => {
    await render({
      props: {
        action: { kind: 'link', href: 'https://example.com/retreat' },
        ctaLabel: 'The retreat',
      },
    });
    const link = button()?.querySelector('a.lp-button');
    expect(link?.getAttribute('href')).toBe('https://example.com/retreat');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener');
    expect(link?.getAttribute('aria-label')).toBe(
      `The retreat ${BUTTON_COPY.newTab}`
    );
    expect(button()?.querySelector('.cta__price')).toBeNull();
  });

  it('a stored link it cannot trust is never drawn for a visitor', async () => {
    for (const href of [
      'http://example.com',
      'javascript:alert(1)',
      'https://u:p@example.com',
    ]) {
      await render({ props: { action: { kind: 'link', href } } });
      expect(button(), href).toBeNull();
      expect(document.body.innerHTML).not.toContain(href);
      unmount(app);
      app = null;
    }
    await render({
      props: { action: { kind: 'link', href: 'javascript:alert(1)' } },
      edit: editing,
    });
    expect(button()?.textContent).toContain(BUTTON_COPY.unreadable);
    expect(document.body.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
