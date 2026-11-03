import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Credentials from './Credentials.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

async function render(items: readonly string[], variant?: 'ledger' | 'chips') {
  app = mount(Credentials, {
    target: document.body,
    props: { items, variant },
  });
  flushSync();
  await tick();
}

const rows = () => [...document.body.querySelectorAll('li')];
const figureOf = (row: Element) =>
  row.querySelector('.creds__figure')?.textContent ?? null;
const wordsOf = (row: Element) =>
  row.querySelector('.creds__words')?.textContent ?? null;

const MIXED = [
  '20 years teaching',
  '4,000+ students',
  '98% finish the course',
  '2019 Yoga Alliance graduate',
  'Trained in Kyoto',
];

describe('Credentials — the ledger leads with the number', () => {
  it('sets a leading figure apart from its words, the rest as written', async () => {
    await render(MIXED);
    expect(rows().map(figureOf)).toEqual(['20', '4,000+', '98%', null, null]);
    expect(rows().map(wordsOf)).toEqual([
      'years teaching',
      'students',
      'finish the course',
      null,
      null,
    ]);
  });

  it('still reads each credential as one phrase, word for word', async () => {
    await render(MIXED);
    // A screen reader and a copy both get the credential as the guide wrote it.
    expect(rows().map((row) => row.textContent?.trim())).toEqual(MIXED);
  });

  it('is the default, and a ledger with no figures is plain rows', async () => {
    await render(['Trained in Kyoto', 'Yoga Alliance 500']);
    expect(
      document.body.querySelector('.creds')?.getAttribute('data-variant')
    ).toBe('ledger');
    expect(document.body.querySelector('.creds__figure')).toBeNull();
    expect(rows().map((row) => row.textContent?.trim())).toEqual([
      'Trained in Kyoto',
      'Yoga Alliance 500',
    ]);
  });

  it('leaves chips as written: short labels down the middle', async () => {
    await render(MIXED, 'chips');
    expect(document.body.querySelector('.creds__figure')).toBeNull();
    expect(rows().map((row) => row.textContent?.trim())).toEqual(MIXED);
  });

  it('never numbers them', async () => {
    await render(MIXED);
    expect(document.body.querySelector('ol')).toBeNull();
    expect(document.body.querySelector('ul')).not.toBeNull();
  });
});
