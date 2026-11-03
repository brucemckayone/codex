import { describe, expect, it } from 'vitest';
import { planSave, refusalFor, saveStatusText } from './drawer-save';

const saved = { title: 'Tour', description: 'Old words' };

describe('planSave', () => {
  it('saves nothing for an unchanged draft, or one already on its way', () => {
    expect(planSave('title', saved, '  Tour ', null)).toEqual({ kind: 'skip' });
    expect(planSave('title', saved, 'New', 'New')).toEqual({ kind: 'skip' });
  });

  it('refuses an emptied title, and clears an emptied description', () => {
    expect(planSave('title', saved, '   ', null)).toEqual({
      kind: 'title-required',
    });
    expect(planSave('description', saved, '', null)).toEqual({
      kind: 'save',
      value: '',
      patch: { description: null },
    });
  });

  it('sends the trimmed value of the one field changed', () => {
    expect(planSave('title', saved, ' Studio tour ', null)).toEqual({
      kind: 'save',
      value: 'Studio tour',
      patch: { title: 'Studio tour' },
    });
    expect(
      planSave('description', { title: 'T', description: null }, 'Words', null)
    ).toMatchObject({
      patch: { description: 'Words' },
    });
  });
});

describe('refusalFor', () => {
  it('names a gone item and a rate limit; anything else is a plain failure', () => {
    expect(refusalFor(404)).toBe('gone');
    expect(refusalFor(429)).toBe('busy');
    expect(refusalFor(500)).toBeNull();
    expect(refusalFor(undefined)).toBeNull();
  });
});

describe('saveStatusText', () => {
  const idle = { title: 'idle', description: 'idle' } as const;

  it('says nothing before any save', () => {
    expect(saveStatusText(idle, null)).toBeNull();
  });

  it("keeps one field's failure over the other's success, naming the field", () => {
    expect(
      saveStatusText({ title: 'failed', description: 'saved' }, null)
    ).toEqual({
      text: "Couldn't save the title. Leave the box to try again.",
      failed: true,
    });
    expect(
      saveStatusText({ title: 'failed', description: 'failed' }, null)?.text
    ).toBe(
      "Couldn't save the title or the description. Leave each box to try again."
    );
  });

  it('says why a refusal happened when it knows', () => {
    expect(
      saveStatusText({ title: 'failed', description: 'idle' }, 'gone')?.text
    ).toContain('deleted');
    expect(
      saveStatusText({ title: 'idle', description: 'failed' }, 'busy')?.text
    ).toContain('Too many saves');
    expect(saveStatusText(idle, 'title-required')).toEqual({
      text: 'A title is required, so the saved one is back.',
      failed: true,
    });
  });

  it('reads Saving while one is on its way, then Saved', () => {
    expect(
      saveStatusText({ title: 'saving', description: 'saved' }, null)?.text
    ).toBe('Saving…');
    expect(
      saveStatusText({ title: 'saved', description: 'idle' }, null)?.text
    ).toBe('Saved');
  });
});
