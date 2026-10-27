/**
 * Creator Studio Sales — server load (Codex-2hxff.21)
 *
 * The solo creator's own sales outside any organisation (`GET /sales/me` +
 * `GET /sales/me/stats`). The org Studio's Sales page, cut down to orgless
 * purchases of the caller's content.
 *
 * Data strategy (Shell + Stream): nothing here shapes the page, so nothing is
 * awaited. The KPIs and the ledger both stream behind skeletons. Neither is
 * cached: these are money figures and must be current.
 *
 * A failed stream resolves to `null`, never to an empty list, so the page can
 * say "couldn't load" rather than "no sales yet".
 */
import type { DateRange } from '@codex/shared-types';
import { logger } from '$lib/observability';
import { getMySalesStats, listMySales } from '$lib/remote/sales.remote';
import type { PageServerLoad } from './$types';

const LIMIT = 20;

const RANGES = ['7', '30', '90', 'all'] as const satisfies readonly DateRange[];
const STATUSES = [
  'all',
  'completed',
  'refunded',
  'disputed',
  'failed',
  'pending',
] as const;

type StatusFilter = (typeof STATUSES)[number];

function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** The start of the date-range window, as `fromDate` (none for all time). */
function fromDateFor(range: DateRange): string | undefined {
  if (range === 'all') return undefined;
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - Number(range));
  return from.toISOString();
}

export const load: PageServerLoad = async ({ url, locals, depends }) => {
  depends('cache:studio-page:sales');

  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1
  );
  const range = pick(url.searchParams.get('range'), RANGES, '30');
  const status: StatusFilter = pick(
    url.searchParams.get('status'),
    STATUSES,
    'all'
  );
  const fromDate = fromDateFor(range);

  function logFailure(what: string) {
    return (err: unknown) => {
      logger.error(`creator-sales-load:${what} failed`, {
        errorId: locals.requestId ?? crypto.randomUUID(),
        error: err instanceof Error ? err.message : String(err),
        userId: locals.user?.id,
      });
      return null;
    };
  }

  return {
    filters: { page, range, status },
    sales: listMySales({
      page,
      limit: LIMIT,
      ...(status !== 'all' && { status }),
      ...(fromDate && { fromDate }),
    }).catch(logFailure('listMySales')),
    stats: getMySalesStats({ ...(fromDate && { fromDate }) }).catch(
      logFailure('getMySalesStats')
    ),
  };
};
