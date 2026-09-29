/**
 * The pure decisions the editor chrome renders from — kept out of the
 * components so each state is unit-tested rather than screenshot-checked.
 */
import type { PageStatus } from '@codex/shared-types';
import type { AutosaveStatus } from '$lib/page-builder/autosave.svelte';
import type { SessionBusy } from './builder-session.svelte';

export type Device = 'desktop' | 'tablet' | 'mobile';
export const DEVICES: readonly Device[] = ['desktop', 'tablet', 'mobile'];

/**
 * A device frame's width in CSS pixels (contract §7). Desktop has none: it is
 * the full width the canvas has. Pixels, not rem — these are devices.
 */
export const FRAME_WIDTH: Readonly<Record<Device, number | null>> = {
  desktop: null,
  tablet: 820,
  mobile: 390,
};

/** Below this, a "desktop" canvas stops being a desktop in any honest sense. */
const DESKTOP_MIN_WIDTH = 720;
/** The quiet margin around a tablet or mobile frame, both sides together. */
const FRAME_MARGIN = 48;

export type EditorTab = 'page' | 'style' | 'offer' | 'settings';
export const EDITOR_TABS: readonly EditorTab[] = [
  'page',
  'style',
  'offer',
  'settings',
];

export type PrimaryKind = 'publish' | 'publish-changes' | 'published';

export interface PrimaryAction {
  kind: PrimaryKind;
  busy: boolean;
  disabled: boolean;
}

/**
 * The top bar's one primary button: Publish (not live) · Publish changes
 * (live, with edits) · a disabled Published (live, nothing to send).
 */
export function primaryAction(input: {
  status: PageStatus;
  hasUnpublishedChanges: boolean;
  busy: SessionBusy;
  ready: boolean;
}): PrimaryAction {
  const kind: PrimaryKind =
    input.status !== 'published'
      ? 'publish'
      : input.hasUnpublishedChanges
        ? 'publish-changes'
        : 'published';
  const busy = input.busy !== null;
  return { kind, busy, disabled: !input.ready || busy || kind === 'published' };
}

export type StatusChip = 'draft' | 'live' | 'live-changes' | 'archived';

export function statusChip(
  status: PageStatus,
  hasUnpublishedChanges: boolean
): StatusChip {
  if (status === 'published') {
    return hasUnpublishedChanges ? 'live-changes' : 'live';
  }
  return status === 'archived' ? 'archived' : 'draft';
}

export type SaveIndicator = 'hidden' | 'saving' | 'saved' | 'error';

/**
 * "Saving… / Saved / Couldn't save — Retry". Hidden while a live page holds
 * unpublished changes: nothing is saved then, and "Saved" would be a lie.
 */
export function saveIndicator(input: {
  saveStatus: AutosaveStatus;
  hasUnpublishedChanges: boolean;
}): SaveIndicator {
  if (input.saveStatus === 'error') return 'error';
  if (input.saveStatus === 'pending' || input.saveStatus === 'saving') {
    return 'saving';
  }
  if (input.saveStatus === 'saved' && !input.hasUnpublishedChanges) {
    return 'saved';
  }
  return 'hidden';
}

/**
 * Docked beside the canvas, or an overlay drawer when docking would leave the
 * page less room than the chosen device needs — the canvas renders at true
 * scale, so it cannot shrink to make space.
 */
export function inspectorPlacement(input: {
  shellWidth: number;
  outlineWidth: number;
  inspectorWidth: number;
  device: Device;
}): 'docked' | 'drawer' {
  const frame = FRAME_WIDTH[input.device];
  const needed = frame === null ? DESKTOP_MIN_WIDTH : frame + FRAME_MARGIN;
  const left = input.shellWidth - input.outlineWidth - input.inspectorWidth;
  return left >= needed ? 'docked' : 'drawer';
}
