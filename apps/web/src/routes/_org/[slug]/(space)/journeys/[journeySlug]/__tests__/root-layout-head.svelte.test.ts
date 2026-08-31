/**
 * The ROOT layout's two page-overridable head tags (O32, WP-G).
 *
 * WHY THIS FILE EXISTS AT ALL. `routes/+layout.svelte` emitted
 * `<meta name="description">` and `og:type` as fixed literals on every page.
 * `<svelte:head>` dedupes only `<title>`, so a page that set its own did not
 * override them — it APPENDED, and the layout's tag came FIRST. Measured on a
 * live journey sell page before the fix, in document order:
 *
 *     meta[property="og:type"]  ["website", "product"]
 *     meta[name="description"]  ["Discover transformative content from
 *                                 independent creators", "<the course lede>"]
 *
 * A parser takes the FIRST value of a repeated Open Graph property, so the sell
 * page's `og:type="product"` was dead on arrival and every journey page's search
 * snippet was shadowed by the generic platform tagline.
 *
 * The fix has TWO halves and they must hold together:
 *   · the journey page STOPS emitting both tags — asserted next door in
 *     `sell-page-head.svelte.test.ts` ("emits NEITHER description NOR og:type");
 *   · this layout emits exactly one of each, FROM `page.data.pageMeta` — which
 *     is what is asserted here.
 * Nothing else in the app mounted this layout, so before this file the second
 * half was entirely unguarded: someone could restore the literal and the only
 * failure would be over in the journey test, reading like a journey bug.
 *
 * BOTH DIRECTIONS MATTER, and the second is the dangerous one. A layout that
 * only ever renders `pageMeta` would leave every page that publishes none with
 * NO description at all — worse than the duplication this replaces. So the
 * fallback case is asserted as hard as the override case.
 *
 * WHY IT LIVES IN THIS DIRECTORY. Round-2 file ownership put `routes/+layout.svelte`
 * in WP-G's hands only for this one change, and `src/routes/__tests__/` belongs to
 * nobody. It should MOVE to `src/routes/__tests__/root-layout-head.svelte.test.ts`
 * the moment that directory has an owner — the test is about the root layout, not
 * about journeys.
 */
import {
  type ComponentProps,
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from 'svelte';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// `page.data` is the ONE input under test: it is the merged data of every load
// for the current route, so a page-level load's `pageMeta` is visible here. A
// getter (not a captured value) so each case can re-point it before mounting.
const { dataRef } = vi.hoisted(() => ({
  dataRef: { current: {} as Record<string, unknown> },
}));

vi.mock('$app/state', () => ({
  page: {
    get data() {
      return dataRef.current;
    },
    get url() {
      return new URL('http://lvh.me:3010/');
    },
  },
}));

// The layout's navigation wiring is not what this file is about, and the real
// implementations need an initialised router.
vi.mock('$app/navigation', () => ({
  afterNavigate: vi.fn(),
  onNavigate: vi.fn(),
  invalidate: vi.fn(),
}));

// Identity-guard side effect (Codex-1g5lh.17) — called synchronously in the
// layout's script body. Stubbed so it does not touch localStorage here.
vi.mock('$lib/client/user-scoped-state', () => ({
  reconcileStateOwner: vi.fn(),
}));

// Chrome components. Stubbed so this test mounts the HEAD, not the whole UI kit
// — each of the three pulls in its own subtree, and none of them touches the
// tags under test. A Svelte 5 client component is just `(anchor, props) => void`,
// so a no-op function is a valid one; a `createRawSnippet` here is NOT, because
// the layout renders these as `<SkipLink />` and a snippet rendered as a
// component dies inside `get_next_sibling`.
vi.mock('$lib/components/ui', () => {
  const Noop = () => {};
  return { NavigationProgress: Noop, SkipLink: Noop, Toaster: Noop };
});

import Layout from '../../../../../../+layout.svelte';

/** The literal every page falls back to, and which no page may be denied. */
const PLATFORM_DEFAULT =
  'Discover transformative content from independent creators';

let component: ReturnType<typeof mount> | null = null;
let baselineHead: Element[] = [];

function render(data: Record<string, unknown>): void {
  dataRef.current = data;
  const props = {
    // The layout's own `data` prop is the ROOT load's return (`{ user }`);
    // `pageMeta` deliberately arrives via `page.data`, not through here, because
    // the value belongs to the PAGE and the root load can never see it.
    data: { user: null },
    children: createRawSnippet(() => ({ render: () => '<main></main>' })),
    // Cast once, through `unknown` rather than `any`: `LayoutData` carries the
    // whole generated tree and this fixture supplies only the two props the
    // layout actually reads. Mirrors the sibling head test's single cast.
  } as unknown as ComponentProps<typeof Layout>;
  component = mount(Layout, { target: document.body, props });
  flushSync();
}

/** EVERY matching tag, in document order — the count is the whole point. */
function metas(key: string): string[] {
  return [
    ...document.head.querySelectorAll(
      `meta[name="${key}"], meta[property="${key}"]`
    ),
  ].map((el) => el.getAttribute('content') ?? '');
}

beforeAll(() => {
  baselineHead = [...document.head.children];
});

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  if (component) {
    unmount(component);
    component = null;
  }
  // Svelte's head anchors can outlive an unmount; a leaked tag would make the
  // next case pass for the wrong reason — and "how many tags" is what is being
  // measured, so a leak here would be indistinguishable from the bug.
  for (const el of [...document.head.children]) {
    if (!baselineHead.includes(el)) el.remove();
  }
});

describe('root layout <svelte:head>', () => {
  it('renders the page description when a load published one', () => {
    render({ pageMeta: { description: 'Slow work, close to the bone.' } });

    expect(metas('description')).toEqual(['Slow work, close to the bone.']);
  });

  it('renders the page og:type when a load published one', () => {
    render({ pageMeta: { ogType: 'product' } });

    // The tag Round 1 added to the sell page, which this is what makes live.
    expect(metas('og:type')).toEqual(['product']);
  });

  it('falls back to the platform default when a page publishes NOTHING', () => {
    // The direction that must never break: most surfaces publish no `pageMeta`,
    // and a page with no description is worse than one with two.
    render({ user: null });

    expect(metas('description')).toEqual([PLATFORM_DEFAULT]);
    expect(metas('og:type')).toEqual(['website']);
  });

  it('falls back when pageMeta exists but its fields are EMPTY strings', () => {
    // `||`, not `??`. A `??` here would publish `<meta content="">` for any load
    // that returned an empty derivation — silently de-describing the page.
    render({ pageMeta: { description: '', ogType: '' } });

    expect(metas('description')).toEqual([PLATFORM_DEFAULT]);
    expect(metas('og:type')).toEqual(['website']);
  });

  it('emits exactly ONE of each — never a second appended tag', () => {
    render({ pageMeta: { description: 'One only.', ogType: 'product' } });

    expect(metas('description')).toHaveLength(1);
    expect(metas('og:type')).toHaveLength(1);
  });

  it('keeps og:site_name a literal — it names the platform, not the page', () => {
    // Deliberately NOT page-overridable, and `ContentDetailView` relies on this
    // layout owning it. A page-supplied `pageMeta` must not disturb it.
    render({ pageMeta: { description: 'Anything.', ogType: 'product' } });

    expect(metas('og:site_name')).toEqual(['Revelations']);
  });

  it('survives a page.data with no pageMeta key at all', () => {
    // An error page renders with the failed load's data missing entirely, so
    // this is the 404/500 path — it must still carry a description.
    render({});

    expect(metas('description')).toEqual([PLATFORM_DEFAULT]);
  });
});
