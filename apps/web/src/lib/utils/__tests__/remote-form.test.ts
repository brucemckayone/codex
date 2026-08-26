/**
 * `keepValuesOnSave` — the mechanism, exercised against a transcription of
 * SvelteKit 2.55.0's own client form runtime (see
 * `$tests/utils/fake-remote-form.svelte`).
 *
 * No Svelte component here: the attachment is invoked by hand, so this file
 * pins the BEHAVIOURAL difference between the two spreads without dragging in
 * a component tree. The same symptom is asserted end-to-end on a real
 * component in `BrandEditorHeroText.svelte.test.ts`.
 *
 * Codex-1g5lh.2 · Codex-1g5lh.5
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFakeRemoteForm,
  type FakeRemoteForm,
} from '$tests/utils/fake-remote-form.svelte';
import { keepValuesOnSave } from '../remote-form';

/** Drain every pending microtask (the fake's "network turn" is one of them). */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Pull the attachment out of a spread object and run it against `form`. */
function attach(
  attrs: Record<string | symbol, unknown>,
  form: HTMLFormElement
) {
  const keys = Object.getOwnPropertySymbols(attrs);
  expect(keys).toHaveLength(1);
  const attachment = attrs[keys[0]] as (node: HTMLFormElement) => void;
  attachment(form);
}

function buildForm(): { form: HTMLFormElement; title: HTMLInputElement } {
  document.body.innerHTML = '';
  const form = document.createElement('form');
  const title = document.createElement('input');
  title.name = 'title';
  // Deliberately the PROPERTY, not the attribute — this is what
  // `fields.title.as('text')` and `bind:value` both produce, and the reason
  // `reset()` blanks the control rather than restoring it.
  title.value = 'My great video';
  form.appendChild(title);
  document.body.appendChild(form);
  return { form, title };
}

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('keepValuesOnSave', () => {
  let fake: FakeRemoteForm;

  beforeEach(() => {
    fake = createFakeRemoteForm({ initial: { title: 'My great video' } });
  });

  it('returns a complete replacement for the bare spread', () => {
    const attrs = keepValuesOnSave(
      fake as unknown as Parameters<typeof keepValuesOnSave>[0]
    ) as unknown as Record<string, unknown>;

    expect(attrs.method).toBe('POST');
    expect(attrs.action).toBe(fake.action);
    expect(Object.getOwnPropertySymbols(attrs)).toHaveLength(1);
  });

  it('keeps the submitted values in the DOM after a successful save', async () => {
    const { form, title } = buildForm();
    attach(
      keepValuesOnSave(
        fake as unknown as Parameters<typeof keepValuesOnSave>[0]
      ) as unknown as Record<string | symbol, unknown>,
      form
    );

    submit(form);
    await settle();

    expect(fake.submissions).toEqual([{ title: 'My great video' }]);
    expect(fake.resetCount).toBe(0);
    expect(title.value).toBe('My great video');

    // The whole point: a SECOND save carries the same payload, instead of the
    // empty title the server rejected with "Title is required".
    submit(form);
    await settle();

    expect(fake.submissions).toEqual([
      { title: 'My great video' },
      { title: 'My great video' },
    ]);
  });

  it('NEGATIVE CONTROL: the bare spread blanks the same form', async () => {
    const { form, title } = buildForm();
    // `{...fake}` — exactly what the components did before this fix.
    attach({ ...(fake as unknown as Record<string | symbol, unknown>) }, form);

    submit(form);
    await settle();

    expect(fake.resetCount).toBe(1);
    expect(title.value).toBe('');

    submit(form);
    await settle();

    // This empty second payload is the reported bug.
    expect(fake.submissions[1]).toEqual({ title: '' });
  });

  it('does not reset when the submission came back with issues (kit parity)', async () => {
    const withIssues = createFakeRemoteForm({
      initial: { title: '' },
      respond: () => ({
        issues: { title: [{ message: 'Title is required' }] },
        result: { success: false },
      }),
    });
    const { form } = buildForm();
    attach(
      { ...(withIssues as unknown as Record<string | symbol, unknown>) },
      form
    );

    submit(form);
    await settle();

    expect(withIssues.resetCount).toBe(0);
  });
});
