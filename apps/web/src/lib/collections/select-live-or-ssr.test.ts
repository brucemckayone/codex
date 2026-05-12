import { describe, expect, it } from 'vitest';
import { selectLiveOrSsr } from './select-live-or-ssr';

const item = (id: string) => ({ id });

describe('selectLiveOrSsr', () => {
  it('returns live data when both are populated', () => {
    const live = [item('live-1'), item('live-2')];
    const ssr = [item('ssr-1')];
    expect(selectLiveOrSsr(live, ssr)).toBe(live);
  });

  it('returns live data when SSR is empty (genuinely empty result set scenario after live mutation added items)', () => {
    const live = [item('live-1')];
    expect(selectLiveOrSsr(live, [])).toBe(live);
  });

  it('returns live empty when both are empty (genuinely empty result set)', () => {
    const live: ReturnType<typeof item>[] = [];
    const ssr: ReturnType<typeof item>[] = [];
    expect(selectLiveOrSsr(live, ssr)).toBe(live);
  });

  it('mid-hydrate window: falls back to SSR when live is empty but SSR has items', () => {
    // This is the load-bearing case: TanStack Query observer microtask has
    // not yet fired, so the live query reads `[]` even though setQueryData
    // already landed. SSR is authoritative until the observer catches up.
    const live: ReturnType<typeof item>[] = [];
    const ssr = [item('ssr-1'), item('ssr-2')];
    expect(selectLiveOrSsr(live, ssr)).toBe(ssr);
  });

  it('preserves reference identity (no array spreads) so downstream derivations are stable', () => {
    const live = [item('a')];
    const ssr = [item('b')];
    const out = selectLiveOrSsr(live, ssr);
    expect(out).toBe(live);

    const live2: ReturnType<typeof item>[] = [];
    const out2 = selectLiveOrSsr(live2, ssr);
    expect(out2).toBe(ssr);
  });

  it('regression guard: empty live + empty SSR must NOT loop or throw', () => {
    expect(() => selectLiveOrSsr([], [])).not.toThrow();
    expect(selectLiveOrSsr([], [])).toEqual([]);
  });

  it('user-reported scenario: explore SSR renders cards, live query observer lags, cards remain visible', () => {
    // Simulates the 2026-05-12 explore flash-empty: server load returned 6
    // content items, client hydrates the collection synchronously, but the
    // live query bound to that collection still emits `[]` for one
    // microtask. Without this rule, the page would render the empty state.
    const ssrPayload = Array.from({ length: 6 }, (_, i) =>
      item(`content-${i}`)
    );
    const liveDuringMicrotaskGap: ReturnType<typeof item>[] = [];
    expect(selectLiveOrSsr(liveDuringMicrotaskGap, ssrPayload)).toEqual(
      ssrPayload
    );
  });

  it('post-hydrate steady state: live query has caught up, SSR is bypassed', () => {
    // After the observer fires, live === ssr (or live has additional items
    // from optimistic mutations). Either way, live wins.
    const live = [item('content-0'), item('content-1')];
    const ssr = [item('content-0'), item('content-1')];
    expect(selectLiveOrSsr(live, ssr)).toBe(live);
  });
});
