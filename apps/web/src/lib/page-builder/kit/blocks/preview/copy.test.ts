import { describe, expect, it } from 'vitest';
import { previewKind } from './copy';

describe('previewKind: what the clip is and how long (Codex-61zsk.73)', () => {
  it('says a watch for video and a listen for audio', () => {
    expect(previewKind('video', 30)).toBe('A 30-second watch');
    expect(previewKind('audio', 30)).toBe('A 30-second listen');
  });

  it('counts seconds under a minute and whole minutes from one', () => {
    expect(previewKind('video', 59)).toBe('A 59-second watch');
    expect(previewKind('video', 60)).toBe('A 1-minute watch');
    expect(previewKind('audio', 124)).toBe('A 2-minute listen');
  });

  it('takes "An" before a number said with a vowel', () => {
    expect(previewKind('video', 18)).toBe('An 18-second watch');
    expect(previewKind('audio', 8)).toBe('An 8-second listen');
    expect(previewKind('video', 11 * 60)).toBe('An 11-minute watch');
    expect(previewKind('video', 85 * 60)).toBe('An 85-minute watch');
  });

  it('says a short one when the length is not known', () => {
    expect(previewKind('video', null)).toBe('A short watch');
    expect(previewKind('audio', null)).toBe('A short listen');
  });
});
