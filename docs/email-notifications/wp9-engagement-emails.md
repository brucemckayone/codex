# WP9: Engagement Emails (P3)

**Parent spec**: `docs/email-notifications-design-spec.md`
**Priority**: P3
**Dependencies**: WP4, WP5, WP1, WP2
**Estimated scope**: 6 files created/changed, ~450 lines of new code

---

## Goal

Wire the two remaining P3 engagement email triggers: content publish notifications to subscribers and a weekly digest cron job, so the platform proactively re-engages users when new content appears.

## Context

Content publishing happens in `workers/content-api/src/routes/content.ts` via `POST /api/content/:id/publish`. The handler calls `ctx.services.content.publish()`, then fires `bumpOrgContentVersion()` via `waitUntil()` -- but no subscriber notifications are sent. The published content result includes `organizationId`, `title`, `slug`, and `creatorId`.

The weekly digest needs a Cloudflare Cron Trigger on notifications-api. The worker config is at `workers/notifications-api/wrangler.jsonc` (JSONC format) and currently has no `triggers` or cron configuration. The Cloudflare Workers runtime supports a `scheduled` export handler alongside the `fetch` handler.

The `sendEmailToWorker()` helper (from WP1, defined in `packages/worker-utils/src/email/send-email.ts`) wraps `waitUntil()`, HMAC header generation, and error suppression for fire-and-forget email sending from any worker.

Templates `new-content-published` and `weekly-digest` are seeded in WP2 with status `active`. The `new-content-published` template uses tokens: `userName`, `contentTitle`, `creatorName`, `contentUrl`, `contentDescription`. The `weekly-digest` template uses tokens: `userName`, `newContentCount`, `topContent`, `platformUrl`.

Org lifecycle emails (member role change, member removal) -- templates #17 and #18 -- are already handled by WP5's organization-api handlers. WP9 only covers templates #15 (`new-content-published`) and #16 (`weekly-digest`).

## Changes

### `workers/content-api/src/routes/content.ts` (update)

After `ContentService.publish()` succeeds in the `/:id/publish` handler, add subscriber notification logic. The notification is fire-and-forget via `waitUntil()`:

```typescript
import { sendEmailToWorker } from '@codex/worker-utils';
import { contentAccess, users } from '@codex/database/schema';
import { eq, and, isNull, ne } from 'drizzle-orm';

// --- Inside /:id/publish handler, after bumpOrgContentVersion() ---

// Fire-and-forget: notify subscribers of new content
if (result.organizationId) {
  ctx.executionCtx.waitUntil(
    notifySubscribersOfPublish(ctx.env, ctx.executionCtx, {
      contentTitle: result.title,
      contentDescription: result.description ?? '',
      contentId: result.id,
      contentSlug: result.slug,
      creatorId: ctx.user.id,
      creatorName: ctx.user.name ?? 'A creator',
      organizationId: result.organizationId,
    }).catch((err: unknown) => {
      ctx.obs?.warn('Subscriber notification failed', {
        error: err instanceof Error ? err.message : String(err),
        contentId: result.id,
      });
    })
  );
}
```

The `notifySubscribersOfPublish` function is defined at the top of the file (or in a separate `utils/` file within the content-api worker). It queries subscribers and sends batched notifications:

```typescript
interface PublishNotificationContext {
  contentTitle: string;
  contentDescription: string;
  contentId: string;
  contentSlug: string | null;
  creatorId: string;
  creatorName: string;
  organizationId: string;
}

/**
 * Notify subscribers of newly published content.
 *
 * Subscribers are users who have existing contentAccess records in the
 * same organization (they have previously accessed or purchased content).
 * Sends marketing-category emails (respects opt-out).
 * Batched to max 50 concurrent sends.
 */
async function notifySubscribersOfPublish(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  context: PublishNotificationContext
): Promise<void> {
  const db = createDbClient(env);

  // Query subscribers: users with contentAccess records in this org,
  // excluding the publishing creator themselves.
  // Join with users table to get email and name.
  const subscribers = await db
    .selectDistinctOn([contentAccess.userId], {
      userId: contentAccess.userId,
      email: users.email,
      name: users.name,
    })
    .from(contentAccess)
    .innerJoin(users, eq(contentAccess.userId, users.id))
    .where(
      and(
        eq(contentAccess.organizationId, context.organizationId),
        ne(contentAccess.userId, context.creatorId),
        isNull(contentAccess.deletedAt)
      )
    )
    .limit(500); // Safety limit -- extremely large orgs need a queue-based approach

  if (subscribers.length === 0) return;

  // Build the content URL
  // Note: We don't have the org slug here, so use the generic content URL.
  // The template can link to the content via ID or slug.
  const contentPath = context.contentSlug
    ? `/content/${context.contentSlug}`
    : `/content/${context.contentId}`;
  const contentUrl = `${env.WEB_APP_URL}${contentPath}`;

  // Batch sends (max 50 concurrent)
  const BATCH_SIZE = 50;
  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map((subscriber) =>
        sendEmailToWorker(env, executionCtx, {
          to: subscriber.email,
          toName: subscriber.name ?? undefined,
          templateName: 'new-content-published',
          category: 'marketing',
          userId: subscriber.userId,
          organizationId: context.organizationId,
          data: {
            userName: subscriber.name || 'there',
            contentTitle: context.contentTitle,
            creatorName: context.creatorName,
            contentUrl,
            contentDescription: context.contentDescription,
          },
        })
      )
    );
  }
}
```

**Note on `createDbClient`**: The publish handler already runs inside a `procedure()` context with access to `ctx.services` and `ctx.env`. The subscriber query uses `createDbClient(env)` (HTTP client) because it is a read-only query that runs in the fire-and-forget `waitUntil()` path -- it does not need the procedure's service registry. This is consistent with the `bumpOrgContentVersion()` pattern already in the file.

### `workers/notifications-api/wrangler.jsonc` (update)

Add cron trigger for the weekly digest. In JSONC format, add a top-level `triggers` block:

```jsonc
{
  // ... existing config ...

  // Cron Triggers
  "triggers": {
    "crons": ["0 9 * * 1"]
  },

  // ... rest of config ...
}
```

This fires every Monday at 09:00 UTC. The cron schedule applies to all environments by default. For production, the `env.production` block inherits the trigger. For local development, manual triggering via the dev-only endpoint is preferred.

### `workers/notifications-api/src/index.ts` (update)

Add the `scheduled` export handler alongside the existing `fetch` export. Also mount the dev-only digest trigger endpoint:

```typescript
import {
  createEnvValidationMiddleware,
  createKvCheck,
  createWorker,
  standardDatabaseCheck,
} from '@codex/worker-utils';
import previewRoutes from './routes/preview';
import templateRoutes from './routes/templates';
import { handleWeeklyDigest } from './handlers/weekly-digest';

// ... existing app setup ...

// Dev-only manual digest trigger
app.post(
  '/internal/trigger-digest',
  procedure({
    policy: { auth: 'worker' },
    handler: async (ctx) => {
      // Only allow in development/test environments
      if (ctx.env.ENVIRONMENT === 'production') {
        return { triggered: false, reason: 'Not available in production' };
      }

      ctx.executionCtx.waitUntil(handleWeeklyDigest(ctx.env));
      return { triggered: true };
    },
  })
);

// ... existing route mounts ...

// Export with scheduled handler
export default {
  fetch: app.fetch,
  scheduled: async (
    _event: ScheduledEvent,
    env: HonoEnv['Bindings'],
    ctx: ExecutionContext
  ) => {
    ctx.waitUntil(handleWeeklyDigest(env));
  },
};
```

### `workers/notifications-api/src/handlers/weekly-digest.ts` (new)

The weekly digest handler queries opted-in users, fetches recent content, and sends batched digest emails:

```typescript
import { createDbClient } from '@codex/database';
import {
  notificationPreferences,
  content,
  users,
  emailAuditLogs,
} from '@codex/database/schema';
import { eq, and, gte, isNull, desc, or, sql } from 'drizzle-orm';
import { getServiceUrl } from '@codex/constants';
import type { HonoEnv } from '@codex/shared-types';
import { createWorkerAuthHeaders } from '@codex/security';

const BATCH_SIZE = 50;
const MAX_CONTENT_ITEMS = 5;
const DIGEST_LOOKBACK_DAYS = 7;

/**
 * Handle the weekly digest cron job.
 *
 * 1. Check if any new content was published in the last 7 days.
 * 2. If not, skip entirely (no emails, no audit entries).
 * 3. Query users who have NOT opted out of digest emails.
 * 4. For each user, render and send the weekly-digest template.
 * 5. Log completion.
 *
 * Individual send failures do NOT abort the batch -- each send is
 * wrapped in a try/catch and failures are logged.
 */
export async function handleWeeklyDigest(
  env: HonoEnv['Bindings']
): Promise<void> {
  const db = createDbClient(env);

  // 1. Query new content published in the last 7 days
  const since = new Date();
  since.setDate(since.getDate() - DIGEST_LOOKBACK_DAYS);

  const recentContent = await db
    .select({
      id: content.id,
      title: content.title,
      slug: content.slug,
      creatorId: content.creatorId,
      organizationId: content.organizationId,
      publishedAt: content.publishedAt,
    })
    .from(content)
    .where(
      and(
        eq(content.status, 'published'),
        gte(content.publishedAt, since),
        isNull(content.deletedAt)
      )
    )
    .orderBy(desc(content.publishedAt))
    .limit(MAX_CONTENT_ITEMS);

  // 2. Skip if no new content
  if (recentContent.length === 0) {
    // No-op -- nothing to digest
    return;
  }

  // Resolve creator names for the content items
  const creatorIds = [...new Set(recentContent.map((c) => c.creatorId))];
  const creators = creatorIds.length > 0
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          sql`${users.id} IN ${creatorIds}`
        )
    : [];

  const creatorMap = new Map(creators.map((c) => [c.id, c.name ?? 'A creator']));

  // Build topContent array for template
  const topContent = recentContent.map((c) => ({
    title: c.title,
    creatorName: creatorMap.get(c.creatorId) ?? 'A creator',
    url: c.slug
      ? `${env.WEB_APP_URL}/content/${c.slug}`
      : `${env.WEB_APP_URL}/content/${c.id}`,
  }));

  // 3. Query users who have NOT opted out of digest.
  // Users with no preference row default to opted-in (DB default: emailDigest=true).
  // We need: users WITH a pref row where emailDigest=true, OR users WITHOUT a pref row.
  const digestUsers = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .leftJoin(
      notificationPreferences,
      eq(users.id, notificationPreferences.userId)
    )
    .where(
      or(
        isNull(notificationPreferences.userId), // No pref row -> default opted-in
        eq(notificationPreferences.emailDigest, true) // Explicit opt-in
      )
    );

  if (digestUsers.length === 0) {
    return;
  }

  // 4. Send digest emails in batches
  const notificationsUrl = getServiceUrl('NOTIFICATIONS', env);
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < digestUsers.length; i += BATCH_SIZE) {
    const batch = digestUsers.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (user) => {
        try {
          const response = await fetch(`${notificationsUrl}/internal/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...createWorkerAuthHeaders(env.WORKER_SHARED_SECRET),
            },
            body: JSON.stringify({
              to: user.email,
              toName: user.name ?? undefined,
              templateName: 'weekly-digest',
              category: 'digest',
              userId: user.userId,
              data: {
                userName: user.name || 'there',
                newContentCount: String(recentContent.length),
                topContent: JSON.stringify(topContent),
                platformUrl: env.WEB_APP_URL,
              },
            }),
          });

          if (!response.ok) {
            throw new Error(`Send failed: ${response.status}`);
          }

          return { success: true };
        } catch (err) {
          // Individual failure -- logged but does not abort batch
          return { success: false, error: err };
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        successCount++;
      } else {
        failCount++;
      }
    }
  }

  // 5. Log digest run completion as an audit entry
  await db.insert(emailAuditLogs).values({
    templateName: 'weekly-digest',
    recipientEmail: 'digest-cron@system',
    status: failCount === 0 ? 'success' : 'failed',
    error: failCount > 0
      ? `Digest completed with ${failCount} failures out of ${successCount + failCount} total`
      : null,
    metadata: JSON.stringify({
      type: 'digest-run',
      contentCount: recentContent.length,
      recipientCount: digestUsers.length,
      successCount,
      failCount,
      runAt: new Date().toISOString(),
    }),
  });
}
```

**Key design decisions:**

- The digest handler calls `POST /internal/send` on its own worker (notifications-api calls itself). This ensures each email goes through the full pipeline: template resolution, preference re-check, branding injection, audit logging, and retry. An alternative would be to call `NotificationsService.sendEmail()` directly, but the HTTP endpoint keeps the architecture consistent with how every other worker sends emails.

- The `topContent` data is passed as a JSON-serialised string because the `internalSendEmailSchema` data field is `Record<string, string | number | boolean>`. The template renderer must handle JSON arrays in its rendering logic (or the template HTML can iterate via a simple repeated block pattern). If the renderer does not support array iteration, a simpler approach is to format `topContent` as a pre-rendered HTML snippet:

```typescript
const topContentHtml = topContent
  .map((c) => `<li><a href="${c.url}">${c.title}</a> by ${c.creatorName}</li>`)
  .join('');
// Pass as: topContent: topContentHtml
```

This approach is recommended because the template renderer uses simple `{{token}}` substitution without loops.

- The subscriber query for the digest uses a LEFT JOIN to include users without a preferences row (they default to opted-in per the DB schema `default(true)`). Users who have explicitly set `emailDigest: false` are excluded.

- The 500-user safety limit from content publish notifications does not apply to the digest -- the digest queries all opted-in users. For extremely large platforms, this should eventually be replaced with a cursor-based approach or a queue worker. For initial launch, the batch approach is sufficient.

### `workers/content-api/src/routes/content.ts` -- import additions

Add the necessary imports at the top of the file:

```typescript
import { createDbClient } from '@codex/database';
import { sendEmailToWorker } from '@codex/worker-utils';
import { contentAccess, users } from '@codex/database/schema';
import { ne, isNull as drizzleIsNull } from 'drizzle-orm';
```

Note: Some of these imports (`eq`, `and`) may already exist. Only add the missing ones. The `createDbClient` import is already used by `bumpOrgContentVersion` if it accesses the DB (check -- if `bumpOrgContentVersion` only uses KV, then `createDbClient` is new here).

### `workers/notifications-api/wrangler.jsonc` -- environment-specific notes

The cron trigger fires in all environments. The production environment configuration already exists. In development, the cron will not fire (Wrangler does not run cron triggers locally). Use the `/internal/trigger-digest` endpoint for local testing.

---

## Verification

### Unit Tests

**`workers/notifications-api/src/handlers/__tests__/weekly-digest.test.ts`** (new):

- With 3 recent content items and 5 opted-in users: all 5 receive digest emails
- With 0 recent content items: function returns early, no emails sent, no audit log entry
- With 0 opted-in users (all opted out): function returns early after content query, no emails sent
- With 1 failed send out of 5: function completes, audit log shows failure count
- Digest data includes top 5 content items with correct titles and URLs
- Users with `emailDigest: false` preference are NOT included in the query
- Users with no preference row ARE included (default opt-in)

**`workers/content-api/src/routes/__tests__/content-publish-notify.test.ts`** (new):

- Publishing content with 3 subscribers: 3 email sends triggered
- Publishing content with 0 subscribers: no email sends, no errors
- Publishing content by a creator: creator is excluded from subscriber list
- Email sends use `category: 'marketing'` (opt-out respected by notifications-api)
- Failed subscriber notification does not affect the publish response (fire-and-forget)

### Integration Tests

**Content publish notification:**

1. Seed: create org, create creator, create 3 users with `contentAccess` records in the org.
2. Set one user's `emailMarketing` to `false`.
3. Publish content via `POST /api/content/:id/publish`.
4. Verify `POST /internal/send` called 2 times (3 subscribers minus 1 opted-out, minus 0 because the creator is excluded from subscribers since they are the publisher).
5. Verify audit log entries: 2 with `status: 'success'`, 0 with `status: 'skipped'` (preference check happens inside notifications-api).
6. Actually the opt-out user will have a `skipped` audit entry because the preference check is in notifications-api `sendEmail()`. So verify 3 `POST /internal/send` calls total, with 2 `success` and 1 `skipped` in audit.

**Weekly digest:**

1. Seed: create 5 users, set one user's `emailDigest: false`.
2. Seed: publish 3 content items with `publishedAt` in last 7 days.
3. Trigger digest: `POST /internal/trigger-digest` with HMAC headers.
4. Verify 4 emails sent (5 users minus 1 opted-out).
5. Verify digest audit log entry exists with correct `successCount`.
6. Delete recent content (or set `publishedAt` to 14 days ago).
7. Trigger digest again.
8. Verify no emails sent, no new audit log entry (clean skip).

### Manual Verification

**Content publish notification:**

1. Run `pnpm dev` from monorepo root.
2. Login as `creator@test.com` / `Test1234!`.
3. Publish a content item via the studio.
4. Check console output for `notifications-api` -- verify subscriber email send attempts logged.
5. Verify no errors in `content-api` console (fire-and-forget should not crash).

**Weekly digest:**

1. With `pnpm dev` running, trigger the digest manually:
   ```bash
   curl -X POST http://localhost:42075/internal/trigger-digest \
     -H "Content-Type: application/json" \
     -H "X-Worker-Auth: <hmac-headers>"
   ```
   (Or use the test helper that generates HMAC headers.)
2. Check console output for `notifications-api` -- verify digest emails logged.
3. If no recent content exists, verify the handler logs a clean skip (no errors).
4. Seed recent content, re-trigger, verify emails sent.

### Playwright/Chrome DevTools

No frontend changes in WP9 -- verification is backend-only. The digest and publish notifications are background tasks that produce audit log entries visible in WP8's audit log viewer. After WP8 and WP9 are both complete:

1. Navigate to studio > settings > Email Audit.
2. Verify `new-content-published` and `weekly-digest` entries appear after triggering the respective flows.
3. Filter by template name (if filter is available) or visually scan for the template names.

---

## Review Checklist

- [ ] Subscriber query is properly scoped by `organizationId` -- no cross-org data leakage
- [ ] Publisher (creator) is excluded from their own subscriber notification list
- [ ] `sendEmailToWorker()` is used (not direct `fetch()`) for content publish notifications
- [ ] Publish notification uses `category: 'marketing'` (opt-out respected)
- [ ] Digest uses `category: 'digest'` (opt-out respected)
- [ ] Batching caps at 50 concurrent sends per batch -- prevents resource exhaustion
- [ ] 500-subscriber safety limit on publish notifications (for initial launch)
- [ ] Digest skips cleanly when no content published in last 7 days (no audit log, no errors)
- [ ] Digest skips cleanly when no opted-in users exist
- [ ] One failed send does NOT abort the batch (`Promise.allSettled`, not `Promise.all`)
- [ ] Cron trigger syntax `0 9 * * 1` is valid for Cloudflare Workers (Monday 09:00 UTC)
- [ ] Dev-only trigger endpoint gated by `ENVIRONMENT !== 'production'` check
- [ ] Digest handler calls `POST /internal/send` (self-invocation) to go through full email pipeline
- [ ] `topContent` data formatted as pre-rendered HTML snippet (not JSON array) for simple token substitution
- [ ] Digest completion logged as audit entry with run metadata
- [ ] `wrangler.jsonc` cron trigger uses JSONC-compatible syntax (`"triggers"` block)
- [ ] No `console.log` in production code -- uses `ObservabilityClient` or structured logging
- [ ] No `as any` type casts
- [ ] Fire-and-forget pattern: subscriber notification errors are caught and logged, never thrown to the publish handler

---

## Acceptance Criteria

- [ ] Publishing content triggers `new-content-published` emails to subscribers in the same org
- [ ] Publisher is excluded from their own notification list
- [ ] Marketing opt-out is respected for publish notifications (opted-out users do not receive email)
- [ ] Weekly digest cron trigger fires every Monday at 09:00 UTC
- [ ] Digest includes up to 5 new content items from the past 7 days
- [ ] Digest skips entirely when no new content was published (no emails, no errors)
- [ ] Digest opt-out is respected (`emailDigest: false` users excluded)
- [ ] Users with no preference row receive the digest (default opt-in)
- [ ] Batching handles large subscriber/user lists without resource exhaustion
- [ ] Individual send failures do not abort the batch
- [ ] All emails produce audit log entries
- [ ] Digest run completion is logged as an audit entry with metadata (counts, timestamp)
- [ ] Dev-only `/internal/trigger-digest` endpoint exists for manual testing
- [ ] Dev-only endpoint is blocked in production
