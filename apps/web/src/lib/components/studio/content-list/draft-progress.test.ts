/**
 * A draft's progress, from the row the content list holds (Codex-a6ofh.2.6):
 * the Publish step's own checks, so the list never disagrees with it.
 */
import { describe, expect, it } from 'vitest';
import type { ContentWithRelations } from '$lib/types';
import { draftRow, PAID, withMedia } from '../__fixtures__/draft-row';
import {
  draftMenuWords,
  draftProgress,
  draftStepWords,
} from './draft-progress';

describe('draftProgress: Write', () => {
  it('a video without its video is still being written, and Continue opens Write', () => {
    const progress = draftProgress(draftRow({}), 'ready');

    expect(progress?.writeDone).toBe(false);
    expect(progress?.href).toBe('/studio/content/c1/edit');
    expect(progress?.left.map((gap) => gap.gap)).toEqual(['MEDIA_REQUIRED']);
    expect(progress?.left[0]?.words).toBe('Add the video.');
  });

  it('a video whose video was deleted goes back to Write, and says so', () => {
    const progress = draftProgress(
      draftRow(withMedia('ready', new Date())),
      'ready'
    );

    expect(progress?.writeDone).toBe(false);
    expect(progress?.left[0]?.gap).toBe('MEDIA_DELETED');
    expect(progress?.left[0]?.words).toBe(
      'The video was deleted. Choose another.'
    );
  });

  it('audio that could not be prepared is Write’s to put right', () => {
    const progress = draftProgress(
      draftRow({ contentType: 'audio', ...withMedia('failed') }),
      'ready'
    );

    expect(progress?.writeDone).toBe(false);
    expect(progress?.left[0]?.words).toContain('audio couldn’t be prepared');
  });

  it('a video still being prepared has done its writing: Publish waits for it', () => {
    const progress = draftProgress(draftRow(withMedia('transcoding')), 'ready');

    expect(progress?.writeDone).toBe(true);
    expect(progress?.ready).toBe(false);
    expect(progress?.href).toBe('/studio/content/c1/edit?step=publish');
    expect(progress?.left.map((gap) => gap.gap)).toEqual(['MEDIA_NOT_READY']);
  });

  it('an article needs words to read, and nothing else for Write', () => {
    expect(
      draftProgress(draftRow({ contentType: 'written' }), 'ready')?.left[0]?.gap
    ).toBe('BODY_REQUIRED');
    const written = draftProgress(
      draftRow({ contentType: 'written', contentBody: 'Some words to read.' }),
      'ready'
    );
    expect(written?.writeDone).toBe(true);
    expect(written?.ready).toBe(true);
  });

  it('a type the editor does not know has no progress: it keeps the old form', () => {
    expect(
      draftProgress(draftRow({ contentType: 'podcast' }), 'ready')
    ).toBeNull();
  });
});

describe('draftProgress: Publish', () => {
  it('a free draft with its video ready is ready, and Continue opens Publish', () => {
    const progress = draftProgress(draftRow(withMedia('ready')), 'ready');

    expect(progress).toMatchObject({ writeDone: true, ready: true, left: [] });
    expect(progress?.href).toBe('/studio/content/c1/edit?step=publish');
  });

  it('a paid draft waits for payouts that are not set up', () => {
    const progress = draftProgress(
      draftRow({ ...withMedia('ready'), ...PAID }),
      'missing'
    );

    expect(progress?.writeDone).toBe(true);
    expect(progress?.ready).toBe(false);
    expect(progress?.left[0]).toMatchObject({
      gap: 'CREATOR_CONNECT_REQUIRED',
      fix: 'payouts',
    });
  });

  it('payouts never read are never taken for set up, and say they could not be checked', () => {
    const progress = draftProgress(
      draftRow({ ...withMedia('ready'), ...PAID }),
      'unread'
    );

    expect(progress?.ready).toBe(false);
    expect(progress?.left[0]?.words).toContain(
      'Couldn’t check your payout setup'
    );
  });

  it('a paid draft with payouts set up is ready', () => {
    expect(
      draftProgress(draftRow({ ...withMedia('ready'), ...PAID }), 'ready')
    ).toMatchObject({ ready: true, left: [] });
  });

  it('a paid draft is never ready before payouts are read, and says it is checking', () => {
    const progress = draftProgress(
      draftRow({ ...withMedia('ready'), ...PAID }),
      'loading'
    );

    expect(progress?.ready).toBe(false);
    expect(progress?.left[0]?.words).toBe('Checking your payout setup…');
  });

  it('a free draft does not wait for payouts, read or not', () => {
    for (const payouts of ['unread', 'loading'] as const) {
      expect(draftProgress(draftRow(withMedia('ready')), payouts)?.ready).toBe(
        true
      );
    }
  });

  it('a price under the floor is left to put right', () => {
    const progress = draftProgress(
      draftRow({ ...withMedia('ready'), ...PAID, priceCents: 50 }),
      'ready'
    );

    expect(progress?.left.map((gap) => gap.gap)).toEqual(['PRICE_REQUIRED']);
  });

  it('what Write must put right comes first', () => {
    const progress = draftProgress(
      draftRow({ contentType: 'written', ...PAID }),
      'missing'
    );

    expect(progress?.left.map((gap) => gap.gap)).toEqual([
      'BODY_REQUIRED',
      'CREATOR_CONNECT_REQUIRED',
    ]);
  });
});

describe('draftMenuWords', () => {
  const paidReady = draftRow({ ...withMedia('ready'), ...PAID });

  it('says payouts are not checked when that is all that is left', () => {
    const unread = draftProgress(paidReady, 'unread');
    const loading = draftProgress(paidReady, 'loading');
    expect(unread && draftMenuWords(unread, 'unread')).toContain(
      'Couldn’t check your payout setup'
    );
    expect(loading && draftMenuWords(loading, 'loading')).toBe(
      'Checking your payout setup…'
    );
  });

  it('keeps the count when more is left, and when payouts are really not set up', () => {
    const more = draftProgress(
      draftRow({ ...withMedia('transcoding'), ...PAID }),
      'unread'
    );
    const missing = draftProgress(paidReady, 'missing');
    expect(more && draftMenuWords(more, 'unread')).toBe(
      'Step 2 of 2 · 2 things left'
    );
    expect(missing && draftMenuWords(missing, 'missing')).toBe(
      'Step 2 of 2 · 1 thing left'
    );
  });
});

describe('draftStepWords', () => {
  it('says the step, what is left, or that it is ready', () => {
    const words = (row: ContentWithRelations, payouts: 'ready' | 'missing') => {
      const progress = draftProgress(row, payouts);
      return progress ? draftStepWords(progress) : null;
    };

    expect(words(draftRow({}), 'ready')).toBe('Step 1 of 2');
    expect(words(draftRow({ ...withMedia('transcoding') }), 'ready')).toBe(
      'Step 2 of 2 · 1 thing left'
    );
    expect(
      words(draftRow({ ...withMedia('transcoding'), ...PAID }), 'missing')
    ).toBe('Step 2 of 2 · 2 things left');
    expect(words(draftRow(withMedia('ready')), 'ready')).toBe(
      'Ready to publish'
    );
  });
});
