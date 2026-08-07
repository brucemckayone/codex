import { afterEach, describe, expect, test } from 'vitest';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import PageHeader from './PageHeader.svelte';

/**
 * PageHeader unit tests.
 *
 * PageHeader went from 7 call sites to 16+ when the studio's hand-rolled
 * headers were folded into it, so its contract is now load-bearing:
 *  - exactly one heading, at the level the surrounding layout expects
 *  - optional slots stay absent when not passed (no empty containers)
 *  - the kicker switches element type on `kickerHref`
 *  - `class` forwarding never stringifies `undefined` into the DOM (R13)
 */

const span = (text: string) =>
  createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('PageHeader', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  const render = (props: Record<string, unknown>) => {
    component = mount(PageHeader, { target: document.body, props });
    return document.querySelector('.page-header');
  };

  test('renders the title as an h1 by default', () => {
    render({ title: 'Payouts' });

    const title = document.querySelector('.page-header__title');
    expect(title?.tagName.toLowerCase()).toBe('h1');
    expect(title?.textContent).toBe('Payouts');
  });

  test('omits kicker, description, meta and actions when not passed', () => {
    render({ title: 'Payouts' });

    expect(document.querySelector('.page-header__kicker')).toBeNull();
    expect(document.querySelector('.page-header__description')).toBeNull();
    expect(document.querySelector('.page-header__meta')).toBeNull();
    expect(document.querySelector('.page-header__actions')).toBeNull();
  });

  test('renders the kicker as a paragraph without kickerHref', () => {
    render({ title: 'Payouts', kicker: 'Money' });

    const kicker = document.querySelector('.page-header__kicker');
    expect(kicker?.tagName.toLowerCase()).toBe('p');
    expect(kicker?.textContent).toBe('Money');
    expect(kicker?.classList.contains('page-header__kicker--link')).toBe(false);
  });

  test('renders the kicker as a back link when kickerHref is set', () => {
    render({
      title: 'Email templates',
      kicker: 'Settings',
      kickerHref: '/studio/settings',
    });

    const kicker = document.querySelector('.page-header__kicker');
    expect(kicker?.tagName.toLowerCase()).toBe('a');
    expect(kicker?.getAttribute('href')).toBe('/studio/settings');
    expect(kicker?.classList.contains('page-header__kicker--link')).toBe(true);
    // The chevron replaces the "you are here" rule.
    expect(kicker?.querySelector('svg')).toBeTruthy();
  });

  test('renders the description when passed', () => {
    render({ title: 'Sales', description: 'Every purchase taken this period.' });

    expect(document.querySelector('.page-header__description')?.textContent).toBe(
      'Every purchase taken this period.'
    );
  });

  test('renders meta and actions into their own containers', () => {
    render({
      title: 'Team',
      meta: span('4 members'),
      actions: span('Invite'),
    });

    expect(document.querySelector('.page-header__meta')?.textContent).toContain(
      '4 members'
    );
    expect(document.querySelector('.page-header__actions')?.textContent).toContain(
      'Invite'
    );
  });

  test('reflects variant on data-variant and defaults to "default"', () => {
    expect(render({ title: 'Team' })?.getAttribute('data-variant')).toBe('default');
    unmount(component!);
    component = null;
    document.body.innerHTML = '';

    expect(render({ title: 'Team', variant: 'compact' })?.getAttribute('data-variant')).toBe(
      'compact'
    );
  });

  test('compact drops to an h2 so a layout keeps the only h1', () => {
    render({ title: 'Team revenue share', variant: 'compact' });

    expect(document.querySelector('.page-header__title')?.tagName.toLowerCase()).toBe('h2');
  });

  test('headingLevel overrides the variant default in both directions', () => {
    render({ title: 'Nested', variant: 'compact', headingLevel: 1 });
    expect(document.querySelector('.page-header__title')?.tagName.toLowerCase()).toBe('h1');

    unmount(component!);
    component = null;
    document.body.innerHTML = '';

    render({ title: 'Top level', headingLevel: 2 });
    expect(document.querySelector('.page-header__title')?.tagName.toLowerCase()).toBe('h2');
  });

  test('reflects divider on data-divider and defaults to true', () => {
    expect(render({ title: 'Team' })?.getAttribute('data-divider')).toBe('true');
    unmount(component!);
    component = null;
    document.body.innerHTML = '';

    expect(render({ title: 'Settings', divider: false })?.getAttribute('data-divider')).toBe(
      'false'
    );
  });

  test('forwards a class prop', () => {
    expect(render({ title: 'Team', class: 'custom-header' })?.classList.contains('custom-header')).toBe(
      true
    );
  });

  // R13 regression guard: `class="page-header {className}"` would emit the
  // literal string "undefined" whenever the prop is omitted.
  test('does not emit the literal "undefined" class when class is omitted', () => {
    const header = render({ title: 'Team' });

    expect(header?.classList.contains('undefined')).toBe(false);
    expect(header?.getAttribute('class')).not.toContain('undefined');
  });

  test('passes through HTML attributes to the header element', () => {
    const header = render({ title: 'Team', id: 'team-header', 'data-testid': 'ph' });

    expect(header?.getAttribute('id')).toBe('team-header');
    expect(header?.getAttribute('data-testid')).toBe('ph');
  });
});
