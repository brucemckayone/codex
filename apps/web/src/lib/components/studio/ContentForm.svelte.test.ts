/**
 * ContentForm — an edit-mode save must not blank the form.
 *
 * The reported symptom (Codex-1g5lh.2) was a repeated content-update failure
 * whose response payload carried `Title is required` / `Slug is required`, from
 * a form the creator had visibly filled in. Cause: the bare `{...form}` spread
 * installs kit's default attachment, which calls `HTMLFormElement.reset()`
 * after any submission that returned no issues. Every control here is driven by
 * `fields.<name>.as(...)`, so their DOM default is `''` — the first save
 * emptied the form and re-derived the field state from it, and the NEXT save
 * posted the empties the server then rejected. Because kit skips the reset when
 * a submission DID return issues, the form then stayed blank and every further
 * click re-posted the same empty payload.
 *
 * The assertions below are the symptom itself: the values are still in the
 * boxes after a successful save, and a second save carries them. The runtime is
 * a transcription of kit 2.55.0's client form runtime
 * (`$tests/utils/fake-remote-form.svelte`) — a `.remote.ts` module loads its
 * SERVER source under the global `$app/server` mock, so the real
 * `updateContentForm` has no fields and no submit attachment in a unit test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { FakeRemoteForm } from '$tests/utils/fake-remote-form.svelte';

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  beforeNavigate: vi.fn(),
  invalidateAll: vi.fn(),
  invalidate: vi.fn(),
  afterNavigate: vi.fn(),
  preloadData: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
}));

vi.mock('$lib/remote/content.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return {
    createContentForm: createFakeRemoteForm(),
    updateContentForm: createFakeRemoteForm(),
    uploadThumbnailForm: createFakeRemoteForm(),
    deleteContent: vi.fn(),
    deleteThumbnailCommand: vi.fn(),
    publishContent: vi.fn(),
    unpublishContent: vi.fn(),
    checkContentSlug: vi.fn(async () => ({ available: true })),
  };
});

vi.mock('$lib/remote/subscription.remote', () => ({
  getMyConnectStatus: () => ({ current: undefined, loading: false }),
  listTiers: () => ({ current: [], loading: false }),
}));

vi.mock('$lib/remote/library.remote', () => ({
  getStreamingUrl: () => ({ current: undefined, loading: false }),
}));

vi.mock('$lib/remote/categories.remote', () => ({
  getCategories: () => ({ current: [], loading: false }),
  createCategoryInline: vi.fn(),
}));

const { updateContentForm } = await import('$lib/remote/content.remote');
const fake = updateContentForm as unknown as FakeRemoteForm;

const ContentForm = (await import('./ContentForm.svelte')).default;

const CONTENT = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Breathwork for beginners',
  slug: 'breathwork-for-beginners',
  description: 'A gentle start.',
  contentType: 'video',
  status: 'published',
  visibility: 'public',
  priceCents: 0,
  mediaItemId: null,
  contentBody: '',
  contentBodyJson: null,
  category: '',
  categoryIds: [],
  tags: [],
  thumbnailUrl: null,
  shaderPreset: null,
  featured: false,
  includedInTierId: null,
};

/** Drain every pending microtask, then flush Svelte's effect queue. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function type(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('ContentForm (edit mode)', () => {
  // biome-ignore lint/suspicious/noExplicitAny: mount()'s component handle
  let component: any;

  beforeEach(() => {
    fake.__reset();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
  });

  function render() {
    component = mount(ContentForm, {
      target: document.body,
      props: {
        // biome-ignore lint/suspicious/noExplicitAny: trimmed ContentWithRelations
        content: CONTENT as any,
        organizationId: '22222222-2222-4222-8222-222222222222',
        orgSlug: 'studio-alpha',
      },
    });
    flushSync();
    return {
      form: document.body.querySelector('form') as HTMLFormElement,
      title: document.querySelector('#title') as HTMLInputElement,
      slug: document.querySelector('#slug') as HTMLInputElement,
    };
  }

  it('seeds title and slug from the content being edited', () => {
    const { title, slug } = render();
    expect(title.value).toBe('Breathwork for beginners');
    expect(slug.value).toBe('breathwork-for-beginners');
  });

  it('still holds title and slug after a successful save', async () => {
    const { form, title, slug } = render();

    type(title, 'Breathwork for everyone');
    // SlugField re-derives the slug from the title until the slug is edited by
    // hand (SlugField.svelte:41-49), so the slug follows — in edit mode too.
    flushSync();

    submit(form);
    await settle();

    expect(fake.submissions).toHaveLength(1);
    expect(fake.submissions[0].title).toBe('Breathwork for everyone');
    expect(fake.submissions[0].slug).toBe('breathwork-for-everyone');

    // The regression: kit's default attachment would have reset the <form>
    // here, blanking every control and the field state derived from it.
    expect(fake.resetCount).toBe(0);
    expect(title.value).toBe('Breathwork for everyone');
    expect(slug.value).toBe('breathwork-for-everyone');
  });

  it('a second save carries title and slug, not the empties the server rejected', async () => {
    const { form } = render();

    submit(form);
    await settle();
    submit(form);
    await settle();

    expect(fake.submissions).toHaveLength(2);
    expect(fake.submissions[1].title).toBe('Breathwork for beginners');
    expect(fake.submissions[1].slug).toBe('breathwork-for-beginners');
  });

  it('submits exactly one payload per submit event — no retry loop', async () => {
    const { form } = render();

    submit(form);
    await settle();

    expect(fake.submissions).toHaveLength(1);
  });
});
