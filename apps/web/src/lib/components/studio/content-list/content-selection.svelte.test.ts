/**
 * The content list's selection (Codex-a6ofh.3.5, owner D-b3): at most 15.
 */
import { describe, expect, it } from 'vitest';
import { ContentSelection } from './content-selection.svelte';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('ContentSelection', () => {
  it('toggles a piece on and off', () => {
    const selection = new ContentSelection();
    selection.toggle('p1');
    expect(selection.has('p1')).toBe(true);
    selection.toggle('p1');
    expect(selection.size).toBe(0);
  });

  it('holds 15 at most, and a 16th waits', () => {
    const selection = new ContentSelection();
    for (const id of ids(16)) selection.toggle(id);
    expect(selection.size).toBe(15);
    expect(selection.full).toBe(true);
    expect(selection.has('p16')).toBe(false);
  });

  it('the page box takes the page as far as the cap, and gives it back', () => {
    const selection = new ContentSelection(3);
    selection.toggle('x');
    selection.setPage(ids(5), true);
    expect(selection.ids).toEqual(['x', 'p1', 'p2']);
    selection.setPage(ids(5), false);
    expect(selection.ids).toEqual(['x']);
  });

  it('keeps only the pieces named: what an action left', () => {
    const selection = new ContentSelection();
    for (const id of ids(4)) selection.toggle(id);
    selection.keepOnly(['p2', 'p4', 'gone']);
    expect(selection.ids).toEqual(['p2', 'p4']);
  });
});
