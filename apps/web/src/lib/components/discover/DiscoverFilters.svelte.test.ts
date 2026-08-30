/**
 * The client-side search floor, proved against a REAL search input
 * (Codex-k618q · WP6).
 *
 * `/discover` is the worst of the search surfaces: its SearchPill is
 * DEBOUNCED-LIVE, so before the gate every 300ms of typing wrote `?q=` and
 * re-ran `+page.server.ts` — including the one- and two-character prefixes of
 * every word anyone ever searched for. pg_trgm cannot serve those from its
 * index (a trigram is three characters; below three there is nothing to probe
 * the GIN index with), so each one cost a sequential scan of the whole table.
 *
 * These tests drive the actual input element and assert on `onChange` — the
 * callback that navigates — so they prove the QUERY IS NOT ISSUED rather than
 * re-testing `gateSearchQuery` in disguise (that lives in
 * packages/validation/src/shared/search-schema.test.ts).
 *
 * Falsifiability:
 *   • `does not fire below three` goes red if the `isSearchQueryBelowFloor`
 *     guard is removed from either handler.
 *   • `fires at exactly three` goes red if the floor is raised, or if someone
 *     "fixes" the guard into a blanket `if (below) return` on every commit.
 *   • `editing down to two characters HOLDS` goes red if the hold collapses
 *     into a clear — the failure mode where the URL drops `q`, which navigates,
 *     which re-renders the box from the URL and empties it mid-edit.
 *   • `clearing the field still commits` goes red if the hold swallows the
 *     clear, which would make an active search impossible to remove.
 */

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import DiscoverFilters from './DiscoverFilters.svelte';

const DEBOUNCE_MS = 300;

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) {
    unmount(component);
    component = null;
  }
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function input(): HTMLInputElement {
  const el = document.body.querySelector<HTMLInputElement>(
    '.search-pill__input'
  );
  if (!el) throw new Error('search input not rendered');
  return el;
}

/** Type one character the way a browser does: set value, then fire `input`. */
function typeChar(char: string) {
  const el = input();
  el.value = `${el.value}${char}`;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function typeText(text: string) {
  for (const char of text) typeChar(char);
}

/** Delete `count` characters, as a backspace would. */
function backspace(count: number) {
  const el = input();
  el.value = el.value.slice(0, Math.max(0, el.value.length - count));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function setValue(next: string) {
  const el = input();
  el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function render(q: string, onChange: (next: unknown) => void) {
  component = mount(DiscoverFilters, {
    target: document.body,
    props: {
      values: { q, type: 'all' as const, sort: 'newest' as const },
      resultCount: 12,
      onChange,
    },
  });
  flushSync();
}

/** Let every pending debounce flush, so "not called" means never called. */
function settle() {
  vi.advanceTimersByTime(DEBOUNCE_MS * 4);
  flushSync();
}

describe('DiscoverFilters — the client-side search floor', () => {
  test('does not fire below three characters', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render('', onChange);

    typeText('B');
    settle();
    expect(onChange).not.toHaveBeenCalled();

    typeText('o');
    settle();
    expect(onChange).not.toHaveBeenCalled();

    // The partial word must survive in the box — holding is not clearing.
    expect(input().value).toBe('Bo');
  });

  test('fires at exactly three characters, with the trimmed query', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render('', onChange);

    typeText('Bon');
    settle();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'Bon' })
    );
  });

  test('whitespace does not count towards the floor', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render('', onChange);

    typeText('  B  ');
    settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  test('editing an active query down to two characters HOLDS, not clears', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render('Bones', onChange);
    expect(input().value).toBe('Bones');

    backspace(3); // 'Bones' → 'Bo'
    settle();

    // Committing here would delete `q` from the URL, which navigates, which
    // re-renders the input from the URL — the box would empty itself under
    // someone who was only mid-edit.
    expect(onChange).not.toHaveBeenCalled();
    expect(input().value).toBe('Bo');
  });

  test('clearing the field still commits, so a search can be removed', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render('Bones', onChange);

    setValue('');
    settle();

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ q: '' }));
  });

  test('a longer query still fires exactly once per settled edit', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render('', onChange);

    typeText('Bones');
    settle();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'Bones' })
    );
  });
});
