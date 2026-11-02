/**
 * The inspector's "Or a number" (Codex-61zsk.73), drawn by the field control
 * the studio draws every item field with: a labelled text box, its hint
 * read with it, that takes no more than a figure keeps. It lives beside the
 * field control because the kit may not import the editor, not even in a
 * test (`check:brand-boundary`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { benefitsDefinition } from '$lib/page-builder/kit/blocks/benefits/definition';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FieldControl from './FieldControl.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

const FIELD = benefitsDefinition.fields
  .find((field) => field.key === 'items')
  ?.itemFields?.find((field) => field.key === 'figure');

function render(value: unknown, changes: unknown[]): HTMLInputElement {
  if (!FIELD) throw new Error('the benefits items have no figure field');
  app = mount(FieldControl, {
    target: document.body,
    props: {
      field: FIELD,
      value,
      onChange: (next: unknown) => changes.push(next),
    },
  });
  flushSync();
  const input = document.body.querySelector('input');
  if (!input) throw new Error('no text box drawn');
  return input;
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('the figure field', () => {
  it('is a text box named by its label, with its hint as its description', () => {
    const input = render('24', []);
    expect(input.type).toBe('text');
    expect(input.value).toBe('24');
    expect(
      document.body.querySelector(`label[for="${input.id}"]`)?.textContent
    ).toBe('Or a number');
    const described = document.getElementById(
      input.getAttribute('aria-describedby') ?? ''
    );
    expect(described?.textContent).toContain(
      'Up to 4 characters with a digit, like 24 or 98%. It shows instead of the mark, so write the name to read on from it.'
    );
  });

  it('takes at most four characters', () => {
    expect(render(undefined, []).getAttribute('maxlength')).toBe('4');
  });

  it('writes what is typed, and clearing it takes the figure away, so the mark shows again', () => {
    const changes: unknown[] = [];
    const input = render('24', changes);
    type(input, '98%');
    type(input, '');
    expect(changes).toEqual(['98%', undefined]);
  });
});
