/**
 * PlanPicker (Codex-2hxff.91): the ONE tier list both editors and the delete
 * dialog render. Rows are cheapest first; "and above" sits on every row but
 * the dearest and is drawn as current when the ticks equal it; hidden ticks
 * are announced, not dropped; disabled means nothing can be pressed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import PlanPicker from './PlanPicker.svelte';

const TIERS = [
  { id: 'premium', name: 'Premium', priceMonthly: 2000 },
  { id: 'basic', name: 'Basic', priceMonthly: 500 },
  { id: 'pro', name: 'Pro', priceMonthly: 1200 },
];

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
  const onToggle = vi.fn();
  const onSelectFromTier = vi.fn();
  component = mount(PlanPicker, {
    target: document.body,
    props: {
      tiers: TIERS,
      selected: [],
      onToggle,
      onSelectFromTier,
      ...props,
    } as never,
  });
  flushSync();
  return { onToggle, onSelectFromTier };
}

const rowButtons = () => [
  ...document.querySelectorAll<HTMLButtonElement>('button.tier'),
];
const aboveButtons = () => [
  ...document.querySelectorAll<HTMLButtonElement>('button.tier__above'),
];

describe('PlanPicker', () => {
  it('lists the tiers cheapest first, with their ticks', () => {
    render({ selected: ['pro'] });
    expect(
      rowButtons().map((b) => b.querySelector('.tier__name')?.textContent)
    ).toEqual(['Basic', 'Pro', 'Premium']);
    expect(rowButtons().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('offers "and above" on every row but the dearest, and marks the current shape', () => {
    render({ selected: ['pro', 'premium'] });
    const above = aboveButtons();
    expect(above.map((b) => b.getAttribute('aria-label'))).toEqual([
      m.plan_picker_and_above_aria({ tierName: 'Basic' }),
      m.plan_picker_and_above_aria({ tierName: 'Pro' }),
    ]);
    // Heard, not just coloured: `aria-current` is announced.
    expect(above.map((b) => b.getAttribute('aria-current'))).toEqual([
      null,
      'true',
    ]);
  });

  it('names the group on its wrapper and keeps the rows a list', () => {
    render({ label: 'Tiers that include this' });
    const group = document.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Tiers that include this');
    expect(group?.classList.contains('plan-picker')).toBe(true);
    const list = document.querySelector('ul.tiers');
    expect(list?.hasAttribute('role')).toBe(false);
    expect(list?.querySelectorAll(':scope > li')).toHaveLength(3);
  });

  it('reports which row or shortcut was pressed', () => {
    const { onToggle, onSelectFromTier } = render({});
    rowButtons()[2].click();
    aboveButtons()[0].click();
    expect(onToggle).toHaveBeenCalledWith('premium');
    expect(onSelectFromTier).toHaveBeenCalledWith('basic');
  });

  it('has no shortcut when the host gives none (the delete dialog)', () => {
    render({ onSelectFromTier: undefined });
    expect(aboveButtons()).toHaveLength(0);
  });

  it('says how many hidden tiers it keeps', () => {
    render({ selected: ['pro', 'retired-1', 'retired-2'] });
    expect(document.body.textContent).toContain(
      m.plan_picker_hidden_other({ count: 2 })
    );
  });

  it('disables every control when not loaded or saving', () => {
    const { onToggle } = render({ disabled: true });
    expect([...rowButtons(), ...aboveButtons()].every((b) => b.disabled)).toBe(
      true
    );
    rowButtons()[0].click();
    expect(onToggle).not.toHaveBeenCalled();
  });
});
