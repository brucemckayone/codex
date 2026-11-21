import { describe, expect, it } from 'vitest';
import { tabTarget } from './tab-trap';

describe('tabTarget', () => {
  const stops = ['pause', 'sound', 'close'] as const;

  it('brings focus in from outside: to the first stop, or the last going back', () => {
    expect(tabTarget(stops, 'page', { back: false, inside: false })).toBe(
      'pause'
    );
    expect(tabTarget(stops, 'page', { back: true, inside: false })).toBe(
      'close'
    );
  });

  it('wraps at the ends', () => {
    expect(tabTarget(stops, 'close', { back: false, inside: true })).toBe(
      'pause'
    );
    expect(tabTarget(stops, 'pause', { back: true, inside: true })).toBe(
      'close'
    );
    // The modal itself holds focus as it opens: back goes to the last stop.
    expect(
      tabTarget(stops, 'dialog', { back: true, inside: true, root: 'dialog' })
    ).toBe('close');
  });

  it('leaves every other move to the browser', () => {
    expect(tabTarget(stops, 'pause', { back: false, inside: true })).toBeNull();
    expect(tabTarget(stops, 'sound', { back: true, inside: true })).toBeNull();
    expect(tabTarget([], 'page', { back: false, inside: false })).toBeNull();
  });
});
