/**
 * A write that arrives after the creator has moved on (Codex-61zsk review).
 *
 * An image upload takes seconds, and the creator is free to select another
 * section meanwhile. The inspector that started it is gone by then, and its
 * props used to follow the PARENT: the finished upload was written to
 * whichever section was selected when it landed, replacing that section's own
 * image. It must land on the section it was started for.
 */
import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFINITIONS,
  PageRenderer,
  SECTION_TYPE_IDS,
  sampleContext,
} from '$lib/page-builder/kit';
import { upgradePage } from '$lib/page-builder/kit/model/upgrade';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Inspector from './Inspector.svelte';

const PAGE_ID = '00000000-0000-4000-8000-0000000000c3';
const KEY = `landing-pages/${PAGE_ID}/images/00000000-0000-4000-8000-0000000000c4`;

/** An upload the test finishes by hand, after moving the selection. */
const remote = vi.hoisted(() => ({
  result: undefined as unknown,
  finish: null as null | (() => void),
}));

vi.mock('$lib/remote/page-images.remote', () => {
  const instance = {
    get result() {
      return remote.result;
    },
    pending: 0,
    fields: {
      pageId: {
        as: (type: string, value: string) => ({ type, name: 'pageId', value }),
      },
      image: {
        as: (type: string) => ({ type, name: 'image' }),
        issues: () => undefined,
      },
    },
    enhance: (
      callback: (opts: {
        form: HTMLFormElement;
        submit: () => Promise<void>;
      }) => Promise<void>
    ) => ({
      method: 'POST',
      onsubmit: (event: SubmitEvent) => {
        event.preventDefault();
        void callback({
          form: event.currentTarget as HTMLFormElement,
          submit: () =>
            new Promise<void>((resolve) => {
              remote.finish = () => {
                remote.result = {
                  outcome: 'uploaded',
                  key: KEY,
                  url: `https://cdn.test/${KEY}/md.webp`,
                };
                resolve();
              };
            }),
        });
      },
    }),
  };
  return { uploadPageImageForm: { for: () => instance } };
});

class OnScreen {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', OnScreen);
  remote.result = undefined;
  remote.finish = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (app) unmount(app);
  app = null;
  pageBuilder.close();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

function hero(id: string): PageSection {
  return { id, type: 'hero', enabled: true, props: { heading: id } };
}

function render(sections: PageSection[], selectedId: string) {
  pageBuilder.open(PAGE_ID, {
    pageType: 'course',
    slug: 'quiet-hours',
    title: 'Quiet Hours',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides: null,
    design: { style: 'bold' },
    sections,
  } as PageBuilderState);
  pageBuilder.selectSection(selectedId);
  app = mount(Inspector, {
    target: document.body,
    props: {
      get page() {
        const pending = pageBuilder.pending;
        return upgradePage({
          design: pending?.design,
          sections: pending?.sections,
        });
      },
      get selectedId() {
        return pageBuilder.selectedSectionId;
      },
      context: sampleContext(),
      onDuplicate: vi.fn(),
      onToggle: vi.fn(),
      onDelete: vi.fn(),
      onChangeStyle: vi.fn(),
    },
  });
  flushSync();
}

function stored(id: string): PageSection | undefined {
  return pageBuilder.pending?.sections.find((s) => s.id === id);
}

function startUpload(): void {
  const form = document.body.querySelector('form.image__actions');
  if (!form) throw new Error('no image field on screen');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  flushSync();
}

async function finishUpload(): Promise<void> {
  if (!remote.finish) throw new Error('no upload in flight');
  remote.finish();
  await tick();
  await Promise.resolve();
  await tick();
  flushSync();
}

describe('a write that arrives after the creator has moved on', () => {
  it('lands the upload on the section it was started for', async () => {
    render([hero('hero-a'), hero('hero-b')], 'hero-a');
    startUpload();

    pageBuilder.selectSection('hero-b');
    flushSync();
    await finishUpload();

    expect(stored('hero-a')?.props.image).toEqual({ key: KEY });
    expect(stored('hero-b')?.props.image).toBeUndefined();
  });

  it('writes nothing when that section was deleted meanwhile', async () => {
    render([hero('hero-a'), hero('hero-b')], 'hero-a');
    startUpload();

    pageBuilder.removeSection('hero-a');
    flushSync();
    await finishUpload();

    expect(stored('hero-a')).toBeUndefined();
    expect(stored('hero-b')?.props.image).toBeUndefined();
  });
});

describe('the background image, a control every section shares', () => {
  const backgroundControl = () =>
    document.body.querySelector<HTMLElement>('[data-control="background"]');

  it('is offered exactly where the page draws one: every type but the hero and the call to action', () => {
    // Nothing here needs the layout thumbnails, so they never come on screen.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    );
    const offered: string[] = [];
    const drawn: string[] = [];
    for (const type of SECTION_TYPE_IDS) {
      const section = {
        id: `s-${type}`,
        type,
        enabled: true,
        props: { ...DEFINITIONS[type].sample, background: { key: KEY } },
      };
      render([section], section.id);
      if (backgroundControl()) offered.push(type);
      if (app) unmount(app);
      pageBuilder.close();

      app = mount(PageRenderer, {
        target: document.body,
        props: {
          page: { design: { style: 'bold' }, sections: [section] },
          context: sampleContext({ mediaBaseUrl: 'https://cdn.test' }),
          still: true,
        },
      });
      flushSync();
      if (document.body.querySelector('.lp-section[data-lp-on-media]'))
        drawn.push(type);
      unmount(app);
      app = null;
      document.body.innerHTML = '';
    }
    expect(offered).toEqual(
      SECTION_TYPE_IDS.filter((t) => t !== 'hero' && t !== 'cta')
    );
    expect(offered).toEqual(drawn);
  });

  it('uploads a decorative background under one label, and removes it', async () => {
    render([{ id: 'f', type: 'faq', enabled: true, props: {} }], 'f');
    const control = backgroundControl();
    const group = control?.querySelector<HTMLElement>('.image[role="group"]');
    const heading = document.getElementById(
      group?.getAttribute('aria-labelledby') ?? ''
    );
    expect(heading?.textContent?.trim()).toBe('Background image');
    // The heading names the field; the field draws no second label.
    expect(control?.querySelector('.image__label')).toBeNull();

    startUpload();
    await finishUpload();
    expect(stored('f')?.props.background).toEqual({ key: KEY });

    control?.querySelector<HTMLButtonElement>('.image__btn--quiet')?.click();
    flushSync();
    expect(stored('f')?.props).not.toHaveProperty('background');
  });
});
