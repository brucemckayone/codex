import { describe, expect, it } from 'vitest';
import {
  inspectorPlacement,
  primaryAction,
  saveIndicator,
  statusChip,
} from './editor-state';
import { dropGap, gapToIndex, sectionLabel } from './outline';

describe('primaryAction', () => {
  const base = {
    hasUnpublishedChanges: false,
    busy: null,
    ready: true,
  } as const;

  it('offers Publish on a draft', () => {
    expect(primaryAction({ ...base, status: 'draft' })).toEqual({
      kind: 'publish',
      busy: false,
      disabled: false,
    });
  });

  it('offers Publish changes on a live page with edits', () => {
    expect(
      primaryAction({
        ...base,
        status: 'published',
        hasUnpublishedChanges: true,
      })
    ).toMatchObject({ kind: 'publish-changes', disabled: false });
  });

  it('shows a disabled Published on a live page with nothing to send', () => {
    expect(primaryAction({ ...base, status: 'published' })).toMatchObject({
      kind: 'published',
      disabled: true,
    });
  });

  it('is disabled while a transition runs', () => {
    expect(
      primaryAction({ ...base, status: 'draft', busy: 'publishing' })
    ).toMatchObject({ busy: true, disabled: true });
  });
});

describe('statusChip', () => {
  it('names the three states the creator needs', () => {
    expect(statusChip('draft', false)).toBe('draft');
    expect(statusChip('published', false)).toBe('live');
    expect(statusChip('published', true)).toBe('live-changes');
    expect(statusChip('archived', false)).toBe('archived');
  });
});

describe('saveIndicator', () => {
  it('reads Saving… for a pending or running save', () => {
    expect(
      saveIndicator({ saveStatus: 'pending', hasUnpublishedChanges: false })
    ).toBe('saving');
    expect(
      saveIndicator({ saveStatus: 'saving', hasUnpublishedChanges: false })
    ).toBe('saving');
  });

  it('never says Saved over unpublished changes on a live page', () => {
    expect(
      saveIndicator({ saveStatus: 'saved', hasUnpublishedChanges: true })
    ).toBe('hidden');
    expect(
      saveIndicator({ saveStatus: 'saved', hasUnpublishedChanges: false })
    ).toBe('saved');
  });

  it('surfaces a failure', () => {
    expect(
      saveIndicator({ saveStatus: 'error', hasUnpublishedChanges: true })
    ).toBe('error');
  });
});

describe('inspectorPlacement', () => {
  const at = (shellWidth: number, device: 'desktop' | 'tablet' | 'mobile') =>
    inspectorPlacement({
      shellWidth,
      outlineWidth: 256,
      inspectorWidth: 320,
      device,
    });

  it('docks at 1440 on desktop, becomes a drawer at 1280', () => {
    expect(at(1376, 'desktop')).toBe('docked');
    expect(at(1216, 'desktop')).toBe('drawer');
  });

  it('makes room for the tablet frame rather than squeezing it', () => {
    expect(at(1376, 'tablet')).toBe('drawer');
    expect(at(1600, 'tablet')).toBe('docked');
  });

  it('keeps it docked beside a phone frame', () => {
    expect(at(1216, 'mobile')).toBe('docked');
  });
});

describe('outline arithmetic', () => {
  const rows = [
    { top: 0, height: 40 },
    { top: 40, height: 40 },
    { top: 80, height: 40 },
  ];

  it('finds the gap nearest the pointer', () => {
    expect(dropGap(5, rows)).toBe(0);
    expect(dropGap(65, rows)).toBe(2);
    expect(dropGap(500, rows)).toBe(3);
  });

  it('converts a gap to the store’s after-removal index', () => {
    expect(gapToIndex(0, 3)).toBe(2);
    expect(gapToIndex(2, 0)).toBe(0);
    expect(gapToIndex(1, 1)).toBeNull();
    expect(gapToIndex(1, 2)).toBeNull();
  });

  it('prefers the creator’s name, else the plain type label', () => {
    expect(sectionLabel({ type: 'faq' })).toBe('Questions');
    expect(sectionLabel({ type: 'faq', name: '  Common worries ' })).toBe(
      'Common worries'
    );
  });
});
