/**
 * BrandEditorHeroText — the hero name/subheading save must not blank the form.
 *
 * The reported symptom (Codex-1g5lh.5) was that saving hero text DID reach the
 * live site while the two inputs in the editor went empty. Cause: the bare
 * `{...updateOrganizationForm}` spread installs kit's default attachment, which
 * calls `HTMLFormElement.reset()` after any submission that returned no issues.
 *
 * This file mounts the REAL component and asserts the real symptom — the values
 * are still in the boxes after a successful save, and a second save carries
 * them — against a transcription of kit 2.55.0's client form runtime
 * (`$tests/utils/fake-remote-form.svelte`). The double is needed because a
 * `.remote.ts` module loads its SERVER source under the global `$app/server`
 * mock, so the real `updateOrganizationForm` has no fields and no attachment
 * in a unit test.
 *
 * The `bare spread` case is asserted as a negative control in
 * `$lib/utils/__tests__/remote-form.test.ts`, which fails without the fix.
 *
 * SEPARATE from `BrandEditorHeroText.svelte.test.ts` on purpose: that file
 * mocks the same module to the shallow `__fixtures__/update-org-form.mock`
 * double and drives the lifecycle imperatively (`setPending` / `setResult`) to
 * cover seeding + the onsaved/error contract. A module can only be mocked one
 * way per test file, and a real submit round-trip is what this file needs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { FakeRemoteForm } from '$tests/utils/fake-remote-form.svelte';

vi.mock('$lib/remote/org.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return { updateOrganizationForm: createFakeRemoteForm() };
});

const { updateOrganizationForm } = await import('$lib/remote/org.remote');
const fake = updateOrganizationForm as unknown as FakeRemoteForm;

const BrandEditorHeroText = (await import('./BrandEditorHeroText.svelte'))
  .default;

/** Drain every pending microtask, then flush Svelte's effect queue. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('BrandEditorHeroText', () => {
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

  function render(props = { name: 'Blood & Bones', description: 'Old blurb' }) {
    component = mount(BrandEditorHeroText, { target: document.body, props });
    flushSync();
    const form = document.body.querySelector('form') as HTMLFormElement;
    const name = document.querySelector('#hero-text-name') as HTMLInputElement;
    const subheading = document.querySelector(
      '#hero-text-subheading'
    ) as HTMLTextAreaElement;
    return { form, name, subheading };
  }

  it('seeds both inputs from the current org values', () => {
    const { name, subheading } = render();
    expect(name.value).toBe('Blood & Bones');
    expect(subheading.value).toBe('Old blurb');
  });

  it('still shows the saved hero text after a successful save', async () => {
    const { form, name, subheading } = render();

    type(name, 'Of Blood and Bones');
    type(subheading, 'A new subheading');

    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await settle();

    expect(fake.submissions).toHaveLength(1);
    expect(fake.submissions[0].name).toBe('Of Blood and Bones');
    expect(fake.submissions[0].description).toBe('A new subheading');

    // The regression: kit's default attachment would have reset the <form>
    // here, emptying both controls and the reactive field state behind them.
    expect(fake.resetCount).toBe(0);
    expect(name.value).toBe('Of Blood and Bones');
    expect(subheading.value).toBe('A new subheading');
  });

  it('carries the same values into a second save', async () => {
    const { form, name } = render();

    type(name, 'Of Blood and Bones');
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await settle();
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await settle();

    expect(fake.submissions).toHaveLength(2);
    expect(fake.submissions[1].name).toBe('Of Blood and Bones');
  });

  it('fires onsaved once per successful save', async () => {
    const onsaved = vi.fn<() => void>();
    component = mount(BrandEditorHeroText, {
      target: document.body,
      props: { name: 'Blood & Bones', description: null, onsaved },
    });
    flushSync();
    const form = document.body.querySelector('form') as HTMLFormElement;

    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await settle();

    expect(onsaved).toHaveBeenCalledTimes(1);
  });
});
