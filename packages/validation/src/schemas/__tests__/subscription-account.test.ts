/**
 * The inputs of Keep current plan (Codex-2hxff.16) and of the account page's
 * course subscription routes (Codex-2hxff.52).
 */
import { describe, expect, it } from 'vitest';
import {
  courseSubscriptionParamsSchema,
  keepCurrentPlanSchema,
  listMyCourseSubscriptionsQuerySchema,
} from '../subscription';

const ID = '11111111-1111-4111-8111-111111111111';

describe('keepCurrentPlanSchema', () => {
  it('takes the organisation id', () => {
    expect(keepCurrentPlanSchema.parse({ organizationId: ID })).toEqual({
      organizationId: ID,
    });
  });

  it.each([
    ['no organisation', {}],
    ['an organisation that is not a uuid', { organizationId: 'hollow-oak' }],
  ])('refuses %s', (_, body) => {
    expect(keepCurrentPlanSchema.safeParse(body).success).toBe(false);
  });
});

describe('courseSubscriptionParamsSchema', () => {
  it('takes a uuid and refuses anything else', () => {
    expect(
      courseSubscriptionParamsSchema.parse({ courseSubscriptionId: ID })
    ).toEqual({ courseSubscriptionId: ID });
    expect(
      courseSubscriptionParamsSchema.safeParse({
        courseSubscriptionId: 'sub_1Abc',
      }).success
    ).toBe(false);
  });
});

describe('listMyCourseSubscriptionsQuerySchema', () => {
  it('defaults to the first page and coerces the query strings', () => {
    const page = listMyCourseSubscriptionsQuerySchema.parse({});
    expect(page.page).toBe(1);
    expect(page.limit).toEqual(expect.any(Number));
    expect(
      listMyCourseSubscriptionsQuerySchema.parse({ page: '2', limit: '5' })
    ).toEqual({ page: 2, limit: 5 });
  });

  it('refuses a page below 1', () => {
    expect(
      listMyCourseSubscriptionsQuerySchema.safeParse({ page: '0' }).success
    ).toBe(false);
  });
});
