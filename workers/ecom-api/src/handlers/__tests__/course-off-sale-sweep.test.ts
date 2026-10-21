/**
 * The hourly course off-sale sweep (Codex-2hxff.64): it cancels what a
 * creator's removal left, at most COURSE_OFF_SALE_SWEEP_LIMIT per hour, and
 * never throws, so the payouts sweep's pool is always released after it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  COURSE_OFF_SALE_SWEEP_LIMIT,
  runCourseOffSaleSweep,
} from '../course-off-sale-sweep';

function makeServices(
  impl: () => Promise<{ cancelled: number; failed: number; remaining: number }>
) {
  return {
    courseSubscription: { cancelForCoursesOffSale: vi.fn(impl) },
  } as unknown as Parameters<typeof runCourseOffSaleSweep>[0] & {
    courseSubscription: { cancelForCoursesOffSale: ReturnType<typeof vi.fn> };
  };
}

describe('runCourseOffSaleSweep', () => {
  it('cancels every off-sale course, not just one creator’s, up to the hourly limit', async () => {
    const services = makeServices(async () => ({
      cancelled: 3,
      failed: 0,
      remaining: 0,
    }));
    const obs = { info: vi.fn(), error: vi.fn() };

    await runCourseOffSaleSweep(services, obs);

    expect(
      services.courseSubscription.cancelForCoursesOffSale
    ).toHaveBeenCalledWith({ limit: COURSE_OFF_SALE_SWEEP_LIMIT });
    expect(obs.info).toHaveBeenCalledWith('course off-sale sweep ran', {
      cancelled: 3,
      failed: 0,
      remaining: 0,
    });
  });

  it('stays quiet when there is nothing to do', async () => {
    const services = makeServices(async () => ({
      cancelled: 0,
      failed: 0,
      remaining: 0,
    }));
    const obs = { info: vi.fn(), error: vi.fn() };

    await runCourseOffSaleSweep(services, obs);

    expect(obs.info).not.toHaveBeenCalled();
  });

  it('a failure is logged, never thrown, so the next hour retries', async () => {
    const services = makeServices(async () => {
      throw new Error('database asleep');
    });
    const obs = { info: vi.fn(), error: vi.fn() };

    await expect(runCourseOffSaleSweep(services, obs)).resolves.toBeUndefined();
    expect(obs.error).toHaveBeenCalledWith(
      'course off-sale sweep failed',
      expect.objectContaining({ error: 'database asleep' })
    );
  });
});
