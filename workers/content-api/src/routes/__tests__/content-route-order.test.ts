/**
 * Content router — registration-order contract.
 *
 * Hono resolves routes in REGISTRATION order, so a static child registered
 * BELOW a `/:id` sibling is unreachable: the dynamic route matches first with
 * `id` bound to the static segment.
 *
 * The bug this locks: `GET /api/content/browse` sat below `GET /api/content/:id`,
 * so every browse request was matched as `id = "browse"`, failed that route's
 * UUID params schema, and returned
 *   422 {"code":"VALIDATION_ERROR","details":[{"path":"params.id",
 *        "message":"Invalid ID format"}]}
 * — reproduced with curl against the running worker. On /explore that surfaced
 * to any SIGNED-IN user as a full-page 500 "Invalid request data" the moment
 * they picked "Most Popular" or "Top Selling", both of which are only offered to
 * authenticated users, i.e. two clicks from the filter drawer.
 *
 * Asserting order rather than a request keeps this free of DB/KV/session setup
 * while still being the real contract: `app.routes` is Hono's own registration
 * list, so this fails if anyone re-adds a static path below `/:id` — the general
 * bug class, not just the one instance.
 */

import { describe, expect, it } from 'vitest';
import contentRoutes from '../content';

/** A path segment Hono treats as a parameter (`:id`, `:contentId`, …). */
function isDynamic(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith(':'));
}

/** First segment after the leading slash, e.g. '/browse' → 'browse'. */
function firstSegment(path: string): string {
  return path.split('/')[1] ?? '';
}

describe('content router — static routes must precede dynamic siblings', () => {
  const routes = contentRoutes.routes;

  it('registers GET /browse before GET /:id', () => {
    const gets = routes.filter((r) => r.method === 'GET');
    const browseIndex = gets.findIndex((r) => r.path === '/browse');
    const idIndex = gets.findIndex((r) => r.path === '/:id');

    expect(browseIndex).toBeGreaterThanOrEqual(0);
    expect(idIndex).toBeGreaterThanOrEqual(0);
    // Strictly before — equal or after means /browse is shadowed by /:id and
    // 422s on `params.id`.
    expect(browseIndex).toBeLessThan(idIndex);
  });

  it('no static first-segment route is shadowed by an earlier dynamic route (same method)', () => {
    const shadowed: string[] = [];

    for (const route of routes) {
      if (isDynamic(route.path)) continue;
      const segment = firstSegment(route.path);
      // '' is the router root ('/'), which no `/:id` pattern can shadow.
      if (segment === '') continue;

      const ownIndex = routes.indexOf(route);
      const shadowedBy = routes.find((other, otherIndex) => {
        if (otherIndex >= ownIndex) return false;
        if (other.method !== route.method) return false;
        if (!isDynamic(other.path)) return false;
        // A dynamic route shadows this one when it has the same segment count
        // and its FIRST segment is the parameter.
        const otherSegments = other.path.split('/');
        return (
          otherSegments.length === route.path.split('/').length &&
          otherSegments[1]?.startsWith(':')
        );
      });

      if (shadowedBy) {
        shadowed.push(
          `${route.method} ${route.path} is shadowed by the earlier ${shadowedBy.method} ${shadowedBy.path}`
        );
      }
    }

    expect(shadowed).toEqual([]);
  });
});
