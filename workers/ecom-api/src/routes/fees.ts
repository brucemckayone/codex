/**
 * Fee routes (Codex-2hxff.33; batch C1 Part B data design §1.8).
 *
 *   GET /fees/upcoming — the caller's fee rises that haven't started
 *
 * The Studio's note about an upcoming fee rise reads this: Billing and
 * Payouts with `?organizationId=` (the owner's rows for that organisation),
 * Earnings with none (the caller's rows as a creator, in every organisation
 * and on their own sales; owner decision Q3). Only the caller's own notices
 * are read, so no organisation role is needed: `?organizationId=` from
 * someone who doesn't own it finds nothing, never another person's rows.
 *
 * A rise shows from its first daily run, including when the caller's email
 * failed. Seeing the note isn't being told: only an accepted email or
 * support's mark is.
 *
 * Cache: `private`, one indexed read per visit. The page has Check again and
 * never re-checks by itself (the cost rule).
 */

import type { HonoEnv } from '@codex/shared-types';
import { upcomingFeesQuerySchema } from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const fees = new Hono<HonoEnv>();

fees.get(
  '/upcoming',
  procedure({
    policy: { auth: 'required', cache: 'private' },
    input: { query: upcomingFeesQuerySchema },
    handler: async (ctx) => {
      const items = await ctx.services.feeConfig.listUpcomingForUser(
        ctx.user.id,
        ctx.input.query.organizationId
      );
      // A person has a handful at most: one page, in the list envelope.
      return new PaginatedResult(items, {
        page: 1,
        limit: items.length,
        total: items.length,
        totalPages: 1,
      });
    },
  })
);

export default fees;
