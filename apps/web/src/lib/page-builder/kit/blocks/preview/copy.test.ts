import { describe, expect, it } from 'vitest';
import { previewKind } from './copy';

/** A press that plays the preview, `seconds` long. */
const cut = (seconds: number | null) => ({ full: false, seconds });

describe('previewKind: what the clip is and how long (Codex-61zsk.73)', () => {
  it('says a watch for video and a listen for audio', () => {
    expect(previewKind('video', cut(30))).toBe('A 30-second watch');
    expect(previewKind('audio', cut(30))).toBe('A 30-second listen');
  });

  it('counts seconds under a minute and whole minutes from one', () => {
    expect(previewKind('video', cut(59))).toBe('A 59-second watch');
    expect(previewKind('video', cut(60))).toBe('A 1-minute watch');
    expect(previewKind('audio', cut(124))).toBe('A 2-minute listen');
  });

  it('takes "An" before a number said with a vowel', () => {
    expect(previewKind('video', cut(18))).toBe('An 18-second watch');
    expect(previewKind('audio', cut(8))).toBe('An 8-second listen');
    expect(previewKind('video', cut(11 * 60))).toBe('An 11-minute watch');
    expect(previewKind('video', cut(85 * 60))).toBe('An 85-minute watch');
  });

  it('a film that plays in full says its own length', () => {
    expect(previewKind('audio', { full: true, seconds: 300 })).toBe(
      'A 5-minute listen'
    );
  });

  it('says a short one when a preview’s length is not known', () => {
    expect(previewKind('video', cut(null))).toBe('A short watch');
    expect(previewKind('audio', cut(null))).toBe('A short listen');
  });

  // Only a preview, 30 seconds at most, is short; a full film may be any length.
  it('names no kind for a film that plays in full at a length not known', () => {
    expect(previewKind('video', { full: true, seconds: null })).toBeUndefined();
    expect(previewKind('audio', { full: true, seconds: null })).toBeUndefined();
  });
});
