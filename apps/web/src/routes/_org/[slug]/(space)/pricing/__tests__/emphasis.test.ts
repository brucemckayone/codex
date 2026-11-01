import { describe, expect, it } from 'vitest';
import { emphasise } from '../emphasis';

const wait = (p: { plan: string; date: string }) =>
  `You keep ${p.plan} until ${p.date}; nothing is charged today.`;
/** A translation that puts the values the other way round. */
const reordered = (p: { plan: string; date: string }) =>
  `Until ${p.date} you keep ${p.plan}.`;

describe('emphasise', () => {
  it('splits a message around its emphasised values', () => {
    expect(
      emphasise(wait, { plan: 'Pro', date: '12 November' }, ['plan', 'date'])
    ).toEqual([
      { text: 'You keep ', strong: false },
      { text: 'Pro', strong: true },
      { text: ' until ', strong: false },
      { text: '12 November', strong: true },
      { text: '; nothing is charged today.', strong: false },
    ]);
  });

  it('follows the order the message puts the values in', () => {
    expect(
      emphasise(reordered, { plan: 'Pro', date: '12 November' }, ['plan'])
    ).toEqual([
      { text: 'Until 12 November you keep ', strong: false },
      { text: 'Pro', strong: true },
      { text: '.', strong: false },
    ]);
  });

  it('keeps a value as text, and drops a stray marker from it', () => {
    expect(
      emphasise(wait, { plan: '<b>Pro\u{E000}', date: 'soon' }, ['plan'])
    ).toEqual([
      { text: 'You keep ', strong: false },
      { text: '<b>Pro', strong: true },
      { text: ' until soon; nothing is charged today.', strong: false },
    ]);
  });
});
