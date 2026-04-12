# WP5: Organization & Creator Emails

**Parent spec**: `docs/email-notifications-design-spec.md`
**Priority**: P1-P2
**Dependencies**: WP1, WP2
**Estimated scope**: 7 files changed, ~250 lines of new code

---

## Goal

Wire organization membership emails (invitation, role change, removal) and media transcoding status emails (complete, failed) to their respective triggers in organization-api and media-api workers.

## Context

The organization-api worker handles member invitations, role changes, and removals via `OrganizationService` methods called from `workers/organization-api/src/routes/members.ts`. These methods currently return minimal data -- `inviteMember()` returns the created membership but not the invitee's email or org name, `updateMemberRole()` returns the updated membership but not the old role, and `removeMember()` returns void. The route handlers need richer return data to populate email tokens.

The media-api worker handles RunPod transcoding webhooks in `workers/media-api/src/routes/webhook.ts`. The webhook handler processes completed and failed transcoding jobs via `TranscodingService.handleWebhook()` but sends no notifications to creators. The handler has access to the media item ID and status, but needs a DB lookup to resolve the creator's email and the content title.

Neither worker currently has `WORKER_SHARED_SECRET` in its wrangler.jsonc config (media-api already has it; organization-api does not).

## Changes

### `packages/organization/src/services/organization-service.ts` (update)

**`inviteMember()`** -- Expand the return type to include data the route handler needs for the invitation email. The method already performs a transaction that looks up the user by email and creates the membership. Add org name and inviter name resolution within the existing transaction:

```typescript
async inviteMember(
  organizationId: string,
  input: { email: string; role: string },
  invitedBy: string
): Promise<{
  id: string;
  userId: string;
  role: string;
  status: string;
  joinedAt: Date;
  // New fields for email context
  inviteeEmail: string;
  inviteeName: string | null;
  orgName: string;
  inviterName: string | null;
}> {
  try {
    return await this.db.transaction(async (tx) => {
      // ... existing user lookup, membership check, insert ...

      // Resolve org name and inviter name for email context
      const [org, inviter] = await Promise.all([
        tx.query.organizations.findFirst({
          where: eq(organizations.id, organizationId),
          columns: { name: true },
        }),
        tx.query.users.findFirst({
          where: eq(users.id, invitedBy),
          columns: { name: true },
        }),
      ]);

      return {
        id: membership.id,
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.createdAt,
        // Email context
        inviteeEmail: input.email,
        inviteeName: user.name ?? null, // user already fetched above
        orgName: org?.name ?? 'Organization',
        inviterName: inviter?.name ?? null,
      };
    });
  } catch (error) {
    // ... existing error handling ...
  }
}
```

The `user` variable is already resolved earlier in the transaction (the `tx.query.users.findFirst` that looks up by email). Add `name` to the `columns` selection:

```typescript
const user = await tx.query.users.findFirst({
  where: eq(users.email, input.email),
  columns: { id: true, name: true }, // Add name
});
```

**`updateMemberRole()`** -- Capture the old role before the update so the route handler can include both old and new role in the email:

```typescript
async updateMemberRole(
  organizationId: string,
  userId: string,
  role: string
): Promise<{
  id: string;
  userId: string;
  role: string;
  status: string;
  joinedAt: Date;
  // New fields for email context
  previousRole: string;
  memberEmail: string;
  memberName: string | null;
  orgName: string;
}> {
  try {
    return await this.db.transaction(async (tx) => {
      const membership = await tx.query.organizationMemberships.findFirst({
        // ... existing lookup ...
      });

      if (!membership) throw new MemberNotFoundError(userId);

      const previousRole = membership.role; // Capture before update

      // ... existing safety check and update ...

      // Resolve email context
      const [member, org] = await Promise.all([
        tx.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { email: true, name: true },
        }),
        tx.query.organizations.findFirst({
          where: eq(organizations.id, organizationId),
          columns: { name: true },
        }),
      ]);

      return {
        id: updated.id,
        userId: updated.userId,
        role: updated.role,
        status: updated.status,
        joinedAt: updated.createdAt,
        previousRole,
        memberEmail: member?.email ?? '',
        memberName: member?.name ?? null,
        orgName: org?.name ?? 'Organization',
      };
    });
  } catch (error) {
    // ... existing error handling ...
  }
}
```

**`removeMember()`** -- Change return type from `void` to include removed member details for the email:

```typescript
async removeMember(
  organizationId: string,
  userId: string
): Promise<{
  memberEmail: string;
  memberName: string | null;
  orgName: string;
}> {
  try {
    return await this.db.transaction(async (tx) => {
      const membership = await tx.query.organizationMemberships.findFirst({
        // ... existing lookup ...
      });

      if (!membership) throw new MemberNotFoundError(userId);

      // ... existing safety check and soft-delete update ...

      // Resolve email context
      const [member, org] = await Promise.all([
        tx.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { email: true, name: true },
        }),
        tx.query.organizations.findFirst({
          where: eq(organizations.id, organizationId),
          columns: { name: true },
        }),
      ]);

      return {
        memberEmail: member?.email ?? '',
        memberName: member?.name ?? null,
        orgName: org?.name ?? 'Organization',
      };
    });
  } catch (error) {
    // ... existing error handling ...
  }
}
```

### `workers/organization-api/src/routes/members.ts` (update)

Add `sendEmailToWorker` calls after each mutation. The `procedure()` handler has access to `ctx.env` and `ctx.executionCtx` for fire-and-forget email sends.

**After `inviteMember()`:**

```typescript
import { sendEmailToWorker } from '@codex/worker-utils';

app.post(
  '/invite',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: z.object({ id: uuidSchema }),
      body: inviteMemberSchema,
    },
    successStatus: 201,
    handler: async (ctx) => {
      const result = await ctx.services.organization.inviteMember(
        ctx.input.params.id,
        ctx.input.body,
        ctx.user.id
      );

      // Send invitation email (P1 - transactional)
      ctx.executionCtx.waitUntil(
        sendEmailToWorker(ctx.env, ctx.executionCtx, {
          to: result.inviteeEmail,
          toName: result.inviteeName ?? undefined,
          templateName: 'org-member-invitation',
          category: 'transactional',
          organizationId: ctx.input.params.id,
          data: {
            inviterName: result.inviterName || 'A team member',
            orgName: result.orgName,
            roleName: result.role,
            acceptUrl: `${ctx.env.WEB_APP_URL}/organizations/${ctx.input.params.id}/accept`,
            expiryDays: '7',
          },
        })
      );

      return result;
    },
  })
);
```

**After `updateMemberRole()`:**

```typescript
app.patch(
  '/:userId',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: z.object({ id: uuidSchema, userId: userIdSchema }),
      body: updateMemberRoleSchema,
    },
    handler: async (ctx) => {
      const result = await ctx.services.organization.updateMemberRole(
        ctx.input.params.id,
        ctx.input.params.userId,
        ctx.input.body.role
      );

      // Send role-changed email (P3 - wired proactively)
      if (result.memberEmail) {
        ctx.executionCtx.waitUntil(
          sendEmailToWorker(ctx.env, ctx.executionCtx, {
            to: result.memberEmail,
            toName: result.memberName ?? undefined,
            templateName: 'member-role-changed',
            category: 'transactional',
            organizationId: ctx.input.params.id,
            data: {
              userName: result.memberName || 'there',
              orgName: result.orgName,
              oldRole: result.previousRole,
              newRole: result.role,
            },
          })
        );
      }

      return result;
    },
  })
);
```

**After `removeMember()`:**

```typescript
app.delete(
  '/:userId',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: z.object({ id: uuidSchema, userId: userIdSchema }),
    },
    successStatus: 204,
    handler: async (ctx) => {
      const result = await ctx.services.organization.removeMember(
        ctx.input.params.id,
        ctx.input.params.userId
      );

      // Send removal email (P3 - wired proactively)
      if (result.memberEmail) {
        ctx.executionCtx.waitUntil(
          sendEmailToWorker(ctx.env, ctx.executionCtx, {
            to: result.memberEmail,
            toName: result.memberName ?? undefined,
            templateName: 'member-removed',
            category: 'transactional',
            organizationId: ctx.input.params.id,
            data: {
              userName: result.memberName || 'there',
              orgName: result.orgName,
            },
          })
        );
      }

      return null;
    },
  })
);
```

### `workers/media-api/src/routes/webhook.ts` (update)

After the `service.handleWebhook(result.data)` call processes a completed or failed transcoding job, resolve the creator's email and send the appropriate notification. The webhook handler already has the `c.env` context and validated payload.

```typescript
import { sendEmailToWorker } from '@codex/worker-utils';
import { createDbClient } from '@codex/database';
import { mediaItems, content, users } from '@codex/database/schema';
import { eq } from 'drizzle-orm';

// --- Inside the webhook handler, after service.handleWebhook(result.data) ---

// Send transcoding status email to creator (non-blocking)
if (result.data.status === 'completed' || result.data.status === 'failed') {
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const db = createDbClient(c.env);

        // Resolve: media item -> content -> creator
        const mediaId = result.data.mediaId ?? result.data.output?.mediaId;
        if (!mediaId) return;

        const mediaItem = await db.query.mediaItems.findFirst({
          where: eq(mediaItems.id, mediaId),
          columns: { contentId: true },
        });
        if (!mediaItem?.contentId) return;

        const contentItem = await db.query.content.findFirst({
          where: eq(content.id, mediaItem.contentId),
          columns: { title: true, creatorId: true },
        });
        if (!contentItem?.creatorId) return;

        const creator = await db.query.users.findFirst({
          where: eq(users.id, contentItem.creatorId),
          columns: { email: true, name: true },
        });
        if (!creator) return;

        if (result.data.status === 'completed') {
          // Transcoding complete (P2)
          const duration = result.data.output?.duration;
          const durationFormatted = duration
            ? `${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, '0')}`
            : 'N/A';

          await sendEmailToWorker(c.env, c.executionCtx, {
            to: creator.email,
            toName: creator.name ?? undefined,
            templateName: 'transcoding-complete',
            category: 'transactional',
            data: {
              userName: creator.name || 'Creator',
              contentTitle: contentItem.title,
              contentUrl: `${c.env.WEB_APP_URL}/studio/content/${mediaItem.contentId}`,
              duration: durationFormatted,
            },
          });
        } else {
          // Transcoding failed (P2)
          // User-friendly error summary -- never expose raw stack traces
          const errorSummary = result.data.error
            ? 'There was a problem processing your video. This may be due to an unsupported format or a temporary service issue.'
            : 'An unexpected error occurred during video processing.';

          await sendEmailToWorker(c.env, c.executionCtx, {
            to: creator.email,
            toName: creator.name ?? undefined,
            templateName: 'transcoding-failed',
            category: 'transactional',
            data: {
              userName: creator.name || 'Creator',
              contentTitle: contentItem.title,
              errorSummary,
              retryUrl: `${c.env.WEB_APP_URL}/studio/content/${mediaItem.contentId}/media`,
            },
          });
        }
      } catch {
        // Email send is non-critical -- don't affect 200 response to RunPod
      }
    })()
  );
}
```

### `workers/organization-api/wrangler.jsonc` (update)

Add `WORKER_SHARED_SECRET` to the development `[vars]` section:

```jsonc
// In [vars] section:
"WORKER_SHARED_SECRET": "test-worker-shared-secret"
```

Production: set via `wrangler secret put WORKER_SHARED_SECRET --env production`.

### `workers/media-api/wrangler.jsonc` (verify)

Already has `WORKER_SHARED_SECRET` in vars. No changes needed.

### `workers/organization-api/src/types.ts` (verify)

The organization-api worker uses `HonoEnv` directly (from `@codex/shared-types`), which already includes `WORKER_SHARED_SECRET` in its `Bindings` type. No type changes are needed. The `sendEmailToWorker` helper accepts `env: Bindings` which already has the secret.

### `workers/media-api/src/types.ts` (verify)

Same as above -- `HonoEnv` already includes `WORKER_SHARED_SECRET`. No type changes needed.

---

## Verification

### Unit Tests

**`packages/organization/src/services/__tests__/organization-service.test.ts`** (extend):

- `inviteMember()` returns `inviteeEmail`, `inviteeName`, `orgName`, `inviterName` alongside existing fields
- `updateMemberRole()` returns `previousRole`, `memberEmail`, `memberName`, `orgName`
- `removeMember()` returns `memberEmail`, `memberName`, `orgName` instead of void
- Existing tests still pass (return type is a superset of the old shape)

**`workers/organization-api/src/routes/__tests__/members.test.ts`** (new or extend):

- POST `/invite` calls `sendEmailToWorker` with `org-member-invitation` template and correct tokens (`inviterName`, `orgName`, `roleName`, `acceptUrl`, `expiryDays`)
- PATCH `/:userId` calls `sendEmailToWorker` with `member-role-changed` template and correct tokens (`oldRole`, `newRole`)
- DELETE `/:userId` calls `sendEmailToWorker` with `member-removed` template
- All email sends are non-blocking (handler returns response before email resolves)

**`workers/media-api/src/routes/__tests__/webhook.test.ts`** (extend):

- Completed transcoding triggers `transcoding-complete` email with `userName`, `contentTitle`, `contentUrl`, `duration`
- Failed transcoding triggers `transcoding-failed` email with user-friendly `errorSummary` (not raw error)
- Missing media item: no email sent, webhook still returns 200
- Missing creator: no email sent, webhook still returns 200

### Integration Tests

- Invite member via API, verify `org-member-invitation` audit log entry with correct `acceptUrl` and `orgName`
- Change member role, verify `member-role-changed` audit log with both `oldRole` and `newRole`
- Remove member, verify `member-removed` audit log entry
- Simulate RunPod webhook with completed status, verify `transcoding-complete` audit log
- Simulate RunPod webhook with failed status, verify `transcoding-failed` audit log with sanitized error

### Manual Verification

**Organization emails:**

1. As org admin (creator@test.com / Test1234!), invite a member: `POST /api/organizations/:id/members/invite` with `{ "email": "user@test.com", "role": "creator" }`
2. Check console output for `org-member-invitation` email with correct `acceptUrl`, `orgName`, `roleName`
3. Change the member's role: `PATCH /api/organizations/:id/members/:userId` with `{ "role": "admin" }`
4. Check console output for `member-role-changed` email showing old and new roles
5. Remove the member: `DELETE /api/organizations/:id/members/:userId`
6. Check console output for `member-removed` email
7. Query `email_audit_logs` for all three template names

**Transcoding emails:**

1. Upload media via content-api (triggers transcoding via media-api)
2. Wait for RunPod webhook callback (or simulate with curl to `/api/transcoding/webhook`)
3. Check console output for `transcoding-complete` or `transcoding-failed` email
4. Query `email_audit_logs` for the template name

### Playwright/Chrome DevTools (for frontend)

No frontend changes in this work packet.

---

## Review Checklist

- [ ] All `sendEmailToWorker` calls are inside `waitUntil()` -- never blocking HTTP responses
- [ ] `inviteMember()` return type is backward-compatible (superset of original)
- [ ] `removeMember()` return type change from `void` to object: verify all call sites are updated
- [ ] `updateMemberRole()` captures `previousRole` before the update statement
- [ ] Transcoding email context resolution (`mediaItems` -> `content` -> `users`) uses read-only queries (no `createPerRequestDbClient` needed, `createDbClient` is sufficient)
- [ ] Transcoding `errorSummary` is always user-friendly -- never raw RunPod error messages or stack traces
- [ ] Duration formatting handles edge cases (zero seconds, very long videos)
- [ ] `WORKER_SHARED_SECRET` added to organization-api wrangler.jsonc
- [ ] No `as any` type casts
- [ ] No `console.log` -- use `obs?.info/warn/error` for structured logging
- [ ] Email context resolution failures are caught silently, never breaking primary handler logic

---

## Acceptance Criteria

- [ ] Invitation email sent with correct accept URL when member invited
- [ ] Invitation email includes inviter name, org name, and role
- [ ] Transcoding complete email sent to creator when RunPod reports ready
- [ ] Transcoding complete email includes duration in `mm:ss` format
- [ ] Transcoding failed email sent with user-friendly error summary (never raw errors)
- [ ] Role change email sent with both old and new role (P3, wired proactively)
- [ ] Removal email sent with org name (P3, wired proactively)
- [ ] All emails are non-blocking (`waitUntil`)
- [ ] All emails have corresponding `email_audit_logs` entries
- [ ] `removeMember()` return type change does not break the DELETE handler's 204 response
