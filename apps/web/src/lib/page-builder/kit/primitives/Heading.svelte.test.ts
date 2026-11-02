/**
 * A heading's `lead` (Codex-61zsk.73): words read as the start of the
 * heading, as part of it ("24 practices to keep"), drawn on a line of their
 * own and never weighed with the words its size is fitted to.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { componentRules } from '../blocks/testing';
import Heading from './Heading.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

function render(props: ComponentProps<typeof Heading>): HTMLElement {
  app = mount(Heading, { target: document.body, props });
  flushSync();
  const heading = document.body.querySelector<HTMLElement>('.lp-heading');
  if (!heading) throw new Error('no heading drawn');
  return heading;
}

const WORDS = {
  level: 3,
  size: 'title',
  text: 'practices to keep',
  type: 'benefits',
} as const;

describe('Heading: a lead', () => {
  it('is read first, as part of the heading, with a real space before the words', () => {
    const heading = render({ ...WORDS, lead: '24' });
    expect(heading.tagName).toBe('H3');
    expect(heading.textContent).toBe('24 practices to keep');
    const lead = heading.firstElementChild;
    expect(lead?.matches('.lp-heading__lead')).toBe(true);
    expect(lead?.textContent).toBe('24');
    // Words, not decoration.
    expect(heading.querySelector('[aria-hidden]')).toBeNull();
  });

  it('is never weighed with the words: the heading is fitted to its words alone', () => {
    const run = (heading: HTMLElement) =>
      [
        '--lp-heading-run-text',
        '--lp-heading-run-caps',
        '--lp-heading-run-chars',
      ].map((name) => heading.style.getPropertyValue(name));
    const plain = run(render(WORDS));
    if (app) unmount(app);
    app = null;
    const led = run(render({ ...WORDS, lead: '2400' }));
    expect(led).toEqual(plain);
    expect(plain[0]).not.toBe('');
  });

  it('stands on a line of its own', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const rule = componentRules(join(here, 'Heading.svelte')).find(
      (r) => r.selector === '.lp-heading__lead'
    );
    expect(rule?.decls.get('display')).toBe('block');
  });

  it('without one, draws exactly its words, as every heading has', () => {
    const heading = render(WORDS);
    expect(heading.textContent).toBe('practices to keep');
    expect(heading.children).toHaveLength(0);
  });
});
