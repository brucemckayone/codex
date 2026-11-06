/**
 * SlugField without a form (Codex-a6ofh.2.4): the Publish step's host holds
 * the slug. A slug typed here goes on only once it is one the API takes, so
 * a half-typed `my-` is never saved; a slug the host moves (a title it
 * follows) shows at once.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const check = vi.hoisted(() => ({ slug: vi.fn() }));
vi.mock('$lib/remote/content.remote', () => ({
  checkContentSlug: (...args: unknown[]) => check.slug(...args),
}));
vi.mock('$app/state', () => ({
  page: { url: new URL('https://alpha.lvh.me/studio/content/c1/edit') },
}));
const told = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock('$lib/observability', () => ({ logger: told }));

const SlugField = (await import('./SlugField.svelte')).default;
const Host = (await import('./__tests__/SlugFieldHost.test.svelte')).default;

let component: ReturnType<typeof mount> | null = null;
const input = () => document.querySelector<HTMLInputElement>('input#slug');
function typeSlug(value: string) {
  const field = input();
  if (!field) throw new Error('no slug field');
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** The field without a form, holding `value` (`runes` unless given). */
function render(props: Record<string, unknown> = {}) {
  component = mount(SlugField, {
    target: document.body,
    props: {
      value: 'runes',
      onchange: vi.fn(),
      orgSlug: 'alpha',
      organizationId: 'org-1',
      contentId: 'c1',
      ...props,
    },
  });
  flushSync();
}

beforeEach(() => {
  vi.useFakeTimers();
  check.slug.mockResolvedValue({ available: true });
});
afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('SlugField without a form', () => {
  test('a slug typed here goes on once the API would take it', () => {
    const onchange = vi.fn();
    render({ onchange });
    expect(input()?.value).toBe('runes');

    typeSlug('my-');
    expect(onchange).not.toHaveBeenCalled();
    expect(input()?.getAttribute('aria-invalid')).toBe('true');
    expect(document.body.textContent).toContain(
      m.studio_content_form_slug_shape()
    );

    typeSlug('My-Runes');
    expect(onchange).toHaveBeenLastCalledWith('my-runes');
    expect(document.body.textContent).not.toContain(
      m.studio_content_form_slug_shape()
    );
  });

  test('a slug the host moves shows at once, over what was half-typed', () => {
    component = mount(Host, { target: document.body, props: {} });
    flushSync();
    typeSlug('my-');
    const move = document.querySelector<HTMLButtonElement>('[data-move]');
    move?.click();
    flushSync();
    expect(input()?.value).toBe('runes-all-three');
    expect(input()?.hasAttribute('aria-invalid')).toBe(false);
  });

  test('the address shown is the real one, on its own host', () => {
    render();
    expect(document.querySelector('.url-preview')?.textContent).toMatch(
      /alpha\.lvh\.me\/.*runes$/
    );
  });

  test('a check still out for an earlier slug never answers for one too short to check', async () => {
    const answer = Promise.withResolvers<{ available: boolean }>();
    check.slug.mockReturnValueOnce(answer.promise);
    render();
    typeSlug('ab');
    await vi.advanceTimersByTimeAsync(800);
    expect(check.slug).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: 'ab' })
    );

    typeSlug('a');
    answer.resolve({ available: false });
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(document.body.textContent).not.toContain(
      m.studio_content_form_slug_taken()
    );
  });

  test('a check that fails says so, and is logged without the slug typed', async () => {
    check.slug.mockRejectedValueOnce({
      status: 503,
      body: { message: 'Service unavailable' },
    });
    render();
    typeSlug('my-spring-course');
    await vi.advanceTimersByTimeAsync(800);
    flushSync();
    expect(document.body.textContent).toContain(
      m.studio_content_form_slug_check_failed()
    );
    expect(told.error).toHaveBeenCalledWith(
      'studio_editor.slug_check_failed',
      expect.objectContaining({ contentId: 'c1', status: 503 })
    );
    expect(JSON.stringify(told.error.mock.calls)).not.toContain(
      'my-spring-course'
    );
  });

  test('the host is told while what is on screen is not a slug, and once it is', () => {
    const oninvalid = vi.fn();
    render({ oninvalid });
    typeSlug('my spring');
    expect(oninvalid).toHaveBeenLastCalledWith(true);
    typeSlug('my-spring');
    expect(oninvalid).toHaveBeenLastCalledWith(false);
  });

  test('gone with a bad slug on screen, it tells the host that has gone too', () => {
    const oninvalid = vi.fn();
    render({ oninvalid });
    typeSlug('my spring');
    expect(oninvalid).toHaveBeenLastCalledWith(true);
    if (component) unmount(component);
    component = null;
    expect(oninvalid).toHaveBeenLastCalledWith(false);
  });
});
