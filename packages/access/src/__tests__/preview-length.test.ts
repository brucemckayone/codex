/**
 * How long a film's public preview runs (Codex-61zsk.73): the one length the
 * org intro film and a course's sales clips both say, as the transcoder cuts
 * it — from a tenth of the way in, for up to 30 seconds.
 */

import { describe, expect, it } from 'vitest';
import { previewLength } from '../preview-length';

describe('previewLength', () => {
  it('runs a film under 30 seconds from a tenth of the way in to its end', () => {
    expect(previewLength(20)).toBe(18);
  });

  // The transcoder truncates the tenth (`int(duration * 0.1)`, main.py
  // `create_preview`): 2.5s in starts at 2, 1.9s in at 1. Rounding would
  // start them at 3 and 2, and name a preview a second shorter than the cut.
  it('starts from the whole second the tenth falls in, as the transcoder truncates it', () => {
    expect(previewLength(25)).toBe(23);
    expect(previewLength(19)).toBe(18);
  });

  it('runs a 30-second film from 3 seconds in, so for 27', () => {
    expect(previewLength(30)).toBe(27);
  });

  it('runs a long film for the full 30 seconds', () => {
    expect(previewLength(300)).toBe(30);
  });

  it('says no length for a film whose length is unknown', () => {
    expect(previewLength(null)).toBeNull();
  });
});
