/**
 * One editor session per visit (Codex-a6ofh.2.3): a move inside the route
 * changes the key, the navigation that mounted it does not. Kit calls
 * `afterNavigate` only for navigations that land after the mount, never on
 * mount itself, so a mount made after its navigation landed (the org edit
 * route, once its read answers) hears no call for it: its first call is a
 * move (the visual check, 2026-11-09: the first "Open it to update" did
 * nothing).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Landed = { type: string; to: object | null };
const nav = vi.hoisted(() => ({
  after: [] as Array<(navigation: Landed) => void>,
  /** `navigating.to`: where the navigation in flight is going, or null. */
  inFlight: null as object | null,
}));
vi.mock('$app/navigation', () => ({
  afterNavigate: (callback: (navigation: Landed) => void) => {
    nav.after.push(callback);
  },
}));
vi.mock('$app/state', () => ({
  navigating: {
    get to() {
      return nav.inFlight;
    },
  },
}));

const { editorVisit } = await import('./editor-visit.svelte');

const land = (navigation: Landed) => {
  for (const callback of nav.after) callback(navigation);
};

beforeEach(() => {
  nav.after.length = 0;
  nav.inFlight = null;
});

describe('editorVisit', () => {
  it('mounted during a navigation: that one landing is its own, each after is a move', () => {
    const mounting = { url: 'edit' };
    nav.inFlight = mounting;
    const visit = editorVisit();
    nav.inFlight = null;

    land({ type: 'link', to: mounting });
    expect(visit.key).toBe(0);
    land({ type: 'goto', to: { url: 'edit' } });
    expect(visit.key).toBe(1);
    land({ type: 'popstate', to: { url: 'edit' } });
    expect(visit.key).toBe(2);
  });

  it('mounted after its navigation landed: the first one it hears is a move', () => {
    const visit = editorVisit();

    land({ type: 'goto', to: { url: 'edit' } });
    expect(visit.key).toBe(1);
  });

  it('the app’s first page is never a move', () => {
    const visit = editorVisit();

    land({ type: 'enter', to: { url: 'edit' } });
    expect(visit.key).toBe(0);
  });
});
