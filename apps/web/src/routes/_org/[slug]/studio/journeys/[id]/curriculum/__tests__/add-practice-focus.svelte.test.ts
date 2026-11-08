/**
 * Studio → Journeys → Curriculum: where focus goes after the library picker
 * adds a practice (Codex-p10nx).
 *
 * Adding a practice selects it, and the stage inspector that held the Add
 * practice which opened the picker gives way to the practice's own: focus
 * had nowhere to go back to and fell to the page. From either Add, focus
 * now goes to the practice just added. A picker closed without a pick
 * changes nothing: focus goes back home.
 *
 * Mounts the real page; the journeys remote module (it imports
 * `$app/server`) is mocked with settled queries.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const practice = (n: number, title: string) => ({
  contentId: `00000000-0000-4000-8000-00000000030${n}`,
  title,
  contentType: 'video' as const,
  status: 'published',
  thumbnailUrl: null,
});
const fixtures = vi.hoisted(() => ({
  curriculum: null as unknown,
  options: [] as unknown[],
}));

vi.mock('$app/navigation', () => ({ beforeNavigate: vi.fn() }));
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock('$lib/remote/journeys.remote', () => ({
  getCourseCurriculum: vi.fn(() => ({
    current: fixtures.curriculum,
    error: undefined,
    loading: false,
  })),
  listCurriculumContentOptions: vi.fn(() => ({
    current: fixtures.options,
    error: undefined,
    loading: false,
  })),
  saveCourseCurriculum: vi.fn(),
}));

import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import CurriculumPage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  setPage('/studio/journeys/page-1/curriculum', { id: 'page-1' });
  fixtures.curriculum = {
    courseId: 'course-1',
    stages: [
      {
        id: '00000000-0000-4000-8000-000000000401',
        name: 'Arriving',
        gloss: 'Settling in',
        practices: [practice(1, 'Body Scan')],
      },
    ],
  };
  fixtures.options = [
    practice(1, 'Body Scan'),
    practice(2, 'Breathwork'),
    practice(3, 'Walking Meditation'),
  ];
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage() {
  component = mount(CurriculumPage, {
    target: document.body,
    props: { data: { org: { name: 'Hollow Oak Films' } } } as never,
  });
  flushSync();
}

const buttonWith = (
  scope: Document | Element,
  selector: string,
  text: string
) =>
  [...scope.querySelectorAll<HTMLButtonElement>(selector)].find((b) =>
    b.textContent?.includes(text)
  );
const dialog = () => document.querySelector<HTMLElement>('.dialog-content');
/** The practice's own button in the stage list, the first control of its row. */
const practiceButton = (title: string) =>
  buttonWith(document, '.prow__select', title);

/** Presses the Add from the keyboard's place (focus on it); the picker opens. */
async function openPicker(add: HTMLButtonElement | undefined) {
  if (!add) throw new Error('no Add practice button');
  add.focus();
  add.click();
  flushSync();
  const panel = dialog();
  if (!panel) throw new Error('the picker did not open');
  await vi.waitFor(() =>
    expect(panel.contains(document.activeElement)).toBe(true)
  );
  return panel;
}

async function pick(panel: HTMLElement, title: string) {
  buttonWith(panel, '.picker__opt', title)?.click();
  flushSync();
  await vi.waitFor(() => expect(dialog()).toBeNull());
}

describe('focus after the picker adds a practice', () => {
  test("from the stage inspector's Add practice: the practice added", async () => {
    mountPage();
    buttonWith(document, '.stage__select', 'Arriving')?.click();
    flushSync();
    const panel = await openPicker(
      buttonWith(document, '.insp__foot button', 'Add practice')
    );
    await pick(panel, 'Breathwork');

    expect(practiceButton('Breathwork')).toBeDefined();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(practiceButton('Breathwork'))
    );
  });

  test("from the stage's own Add a practice: the practice added", async () => {
    mountPage();
    const panel = await openPicker(
      document.querySelector<HTMLButtonElement>('.add-practice') ?? undefined
    );
    await pick(panel, 'Breathwork');

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(practiceButton('Breathwork'))
    );
  });

  test('a picker closed without a pick, even after an add, gives focus back to its Add', async () => {
    mountPage();
    const add =
      document.querySelector<HTMLButtonElement>('.add-practice') ?? undefined;
    await pick(await openPicker(add), 'Breathwork');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(practiceButton('Breathwork'))
    );

    const panel = await openPicker(add);
    panel.querySelector<HTMLButtonElement>('.dialog-close')?.click();
    flushSync();

    await vi.waitFor(() => expect(dialog()).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(add));
  });
});
