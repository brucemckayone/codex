import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import DialogFormElement from './DialogFormElement.svelte';

/**
 * Dialog.Form is the `<form>` that sits between Dialog.Content and
 * Body/Footer. Like DialogBody it reads no Dialog context, so it mounts
 * directly. Its layout (the flex column it passes down) is proven in a real
 * browser by the Dialog stories; jsdom has no layout, so this pins the
 * element, its attributes and its submit wiring.
 */

describe('Dialog.Form', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders a form with .dialog-form around its children', () => {
    const children = createRawSnippet(() => ({
      render: () => '<p data-testid="form-content">Fields</p>',
    }));

    component = mount(DialogFormElement, {
      target: document.body,
      props: { children },
    });

    const form = document.body.querySelector('form.dialog-form');
    expect(form).toBeTruthy();
    expect(form?.querySelector('[data-testid="form-content"]')).toBeTruthy();
  });

  test('passes onsubmit through and leaves preventDefault to the handler', () => {
    const onsubmit = vi.fn((e: SubmitEvent) => e.preventDefault());
    const children = createRawSnippet(() => ({
      render: () => '<button type="submit">Save</button>',
    }));

    component = mount(DialogFormElement, {
      target: document.body,
      props: { children, onsubmit },
    });

    const form = document.body.querySelector('form');
    const event = new Event('submit', { bubbles: true, cancelable: true });
    form?.dispatchEvent(event);

    expect(onsubmit).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test('forwards id, novalidate and a custom class onto the form', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>x</span>',
    }));

    component = mount(DialogFormElement, {
      target: document.body,
      props: { children, id: 'tier-form', novalidate: true, class: 'extra' },
    });

    const form = document.body.querySelector('#tier-form');
    expect(form?.tagName).toBe('FORM');
    expect(form?.hasAttribute('novalidate')).toBe(true);
    expect(form?.classList.contains('dialog-form')).toBe(true);
    expect(form?.classList.contains('extra')).toBe(true);
  });
});
