/**
 * The note a leaving piece's page shows (Codex-a6ofh.6.7, mockup LN7, LN7b):
 * who still has it and why, until when, and what they may keep. The offer
 * is the worker's `leaving.download`, so the note never offers more.
 */
import { describe, expect, it } from 'vitest';
import type {
  ContentHeld,
  WithdrawnLeavingNote,
} from '$lib/server/content-detail';
import { leavingNoteOf } from './leaving-note';

const NOW = new Date('2026-11-20T12:00:00Z');
const leaving = (
  over: Partial<WithdrawnLeavingNote> = {}
): WithdrawnLeavingNote => ({
  leavesAt: '2026-12-17T00:00:00.000Z',
  download: null,
  sizeBytes: null,
  removedBy: 'Studio Alpha',
  ...over,
});
const bought: ContentHeld = { by: 'purchase', until: null };

describe('leavingNoteOf', () => {
  it('a buyer of a video with its file: LN7, word for word', () => {
    const note = leavingNoteOf(
      bought,
      leaving({ download: 'file', sizeBytes: 1.4 * 1024 ** 3 }),
      'video',
      NOW
    );
    expect(note.lead).toBe('This leaves Revelations on 17 December.');
    expect(note.removedBy).toBe('Studio Alpha has removed it.');
    expect(note.reason).toBe(
      'You bought it, so you can watch it until then, and download it to keep.'
    );
    expect(note.offer).toMatchObject({
      kind: 'file',
      label: 'Download (1.4 GB)',
    });
  });

  it('a buyer of an article: LN7b, Save as PDF', () => {
    const note = leavingNoteOf(
      bought,
      leaving({ download: 'print' }),
      'written',
      NOW
    );
    expect(note.reason).toBe(
      'You bought it, so you can read it until then, and save it as a PDF to keep.'
    );
    expect(note.offer).toMatchObject({ kind: 'print', label: 'Save as PDF' });
  });

  it('downloads off: the date and the reason, no offer', () => {
    const note = leavingNoteOf(bought, leaving(), 'audio', NOW);
    expect(note.reason).toBe(
      'You bought it, so you can listen to it until then.'
    );
    expect(note.offer).toBeNull();
  });

  it('a gift and a course each say why the reader has it', () => {
    expect(
      leavingNoteOf({ by: 'entitlement', until: null }, leaving(), 'video', NOW)
        .reason
    ).toBe('It was given to you, so you can watch it until then.');
    expect(
      leavingNoteOf({ by: 'course', until: null }, leaving(), 'video', NOW)
        .reason
    ).toBe("It's part of your course, so you can watch it until then.");
  });

  it('a subscriber is told the earlier end: its renewal, or the leave date', () => {
    const renewsFirst: ContentHeld = {
      by: 'subscription',
      until: '2026-12-03T00:00:00.000Z',
    };
    const leavesFirst: ContentHeld = {
      by: 'subscription',
      until: '2027-01-03T00:00:00.000Z',
    };
    expect(leavingNoteOf(renewsFirst, leaving(), 'video', NOW).reason).toBe(
      "It's included in your subscription until 3 December."
    );
    expect(leavingNoteOf(leavesFirst, leaving(), 'video', NOW).reason).toBe(
      "It's included in your subscription until 17 December."
    );
  });

  it('a file with no recorded size is still offered, unsized', () => {
    expect(
      leavingNoteOf(bought, leaving({ download: 'file' }), 'video', NOW).offer
        ?.label
    ).toBe('Download');
  });

  it('with no name to give, no "removed it" sentence', () => {
    expect(
      leavingNoteOf(bought, leaving({ removedBy: null }), 'video', NOW)
        .removedBy
    ).toBeNull();
  });
});
