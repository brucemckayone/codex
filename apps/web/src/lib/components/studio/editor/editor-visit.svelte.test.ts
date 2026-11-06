/**
 * One editor session per visit (Codex-a6ofh.2.3): a move inside the route
 * changes the key, the navigation that mounted it does not.
 */
import { describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ after: [] as Array<() => void> }));
vi.mock('$app/navigation', () => ({
  afterNavigate: (callback: () => void) => {
    nav.after.push(callback);
  },
}));

const { editorVisit } = await import('./editor-visit.svelte');

describe('editorVisit', () => {
  it('keeps its key for the visit that mounted it, and moves it on each move after', () => {
    const visit = editorVisit();
    const navigated = () => {
      for (const callback of nav.after) callback();
    };
    navigated();
    expect(visit.key).toBe(0);
    navigated();
    expect(visit.key).toBe(1);
    navigated();
    expect(visit.key).toBe(2);
  });
});
