/**
 * Queue › Price moves names the hourly run's size from the Studio note's
 * `PRICE_EMAILS_PER_RUN`, the server's `PRICE_MOVES_PER_RUN`, never a number
 * of its own: the words said "about 1,500 an hour" while the server sent
 * 1,125 a run.
 *
 * The constant is set to a number nothing else uses, so a line can pass
 * only by following it.
 */

import { describe, expect, test, vi } from 'vitest';

vi.mock('$lib/components/studio/price-note-view', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('$lib/components/studio/price-note-view')
  >()),
  PRICE_EMAILS_PER_RUN: 2345,
}));

import { JORDAN, stoppedChange } from '../__fixtures__/support-fixtures';
import { restartedNotice, stoppedFacts } from '../price-moves-view';

const RESTARTED = stoppedChange({
  restart: {
    requestedAt: '2026-11-05T13:12:00.000Z',
    by: JORDAN,
    at: '2026-11-05T14:00:00.000Z',
  },
});

describe('the run’s size follows PRICE_EMAILS_PER_RUN', () => {
  test('on a restarted change’s card', () => {
    expect(stoppedFacts(RESTARTED)[2].text).toContain('about 2,345 an hour');
  });

  test('in the notice Restart leaves', () => {
    expect(
      restartedNotice(RESTARTED, '2026-11-05T14:00:00.000Z').text
    ).toContain('about 2,345 an hour');
  });
});
