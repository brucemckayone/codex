# The leaving notice (Codex-a6ofh.6)

When a creator deletes a piece that people own, it does not vanish. It goes off sale at once, leaves Revelations 30 days later, and every owner is emailed. Until then the creator can **Keep it**, and owners can keep a copy. This page is the reference the CLAUDE.md files point to: the rows, rules and routes of the leaving notice, in one place.

## The piece's states

| State | `content` row | Who sees it |
|---|---|---|
| Live | `status = 'published'`, `leaves_at` null | Everyone, on sale |
| Leaving | `status = 'archived'` (off sale), `leaves_at` set, `leaving_by_creator` and/or `leaving_by_org` | Its owners, until `leaves_at` |
| Removed with notice | `deleted_at` set, `leaves_at` kept | Nobody; an old link answers 410 with the notice line |
| Removed without notice | `deleted_at` set, `leaves_at` null | Nobody; an old link answers 410, no notice line |

- A leaving piece is never `published` (`check_content_leaving_not_published`).
- `content_leaving_notices` logs one row per holder per round: `leaving`, `reminder` (day 27), `staying` (after Keep) and `removed` (a takedown).

## Owner decisions

- 30 days' notice, and no refunds.
- The waiting state is off sale with `leaves_at`, never `deleted_at`. Every delete cancels open staying rows.
- An **owner** is a buyer not in dispute, a gift or grant of the piece, or a buyer (or grantee) of a course that holds it: `ownershipOf` (`packages/access/src/services/content-access/content-owner.ts`). A course or tier subscriber is never an owner, so is never offered a download. Codex-7ekt7 (subscribers keep it until renewal) is a later bead.
- An org admin's delete gives notice too (2026-11-19). A delete of a piece already leaving adds the org's side to the creator's, with no new round (2026-11-20). A takedown is platform-owner only and immediate (D4).
- The creator's "Owners can download it" setting is locked while the piece is leaving (409 `CONTENT_LEAVING`).
- An old link to a removed piece answers 410 for every once-published piece. The notice line shows only for a piece that left with notice, and the page never names it (2026-11-24).

## content-api routes

| Method | Path | Policy | Behaviour |
|---|---|---|---|
| PATCH | `/api/content/:id` | `auth: 'required'`, creator/admin | A leaving piece cannot change org, personal included (409 `CONTENT_LEAVING`, "Keep it first") |
| DELETE | `/api/content/:id` | `auth: 'required'`, `strict` | 200 `{ data: { outcome, leavesAt, holders } }`: `deleted` (nobody holds it: soft-deleted at once, its cover cleared) or `leaving` (off sale, its owners keep it until `leavesAt`, each emailed; the cover kept). 409 `CONTENT_LEAVING_TOO_SOON` (`retryAt`) for a new notice period under `LEAVING_ROUND_GAP_HOURS` after the last one that emailed anyone. No `successStatus`: a 204 would hand the client null |
| POST | `/api/content/:id/keep` | `auth: 'required'` | Clears the date; it stays off sale, and whoever may have heard is told it stays. 200 `{ data: { kept, staying, stillLeavingBy } }`; `kept: false` (nothing written) if it was not leaving. It withdraws only the creator's delete: if an org admin deleted it too it still leaves (`kept: false`, `stillLeavingBy: 'org'`). 403 `CONTENT_LEAVE_NOT_YOURS` for a leave holding only an org admin's delete |
| POST | `/internal/content/leaving-sweep` (`CONTENT_LEAVING_SWEEP_ROUTE`) | `auth: 'worker'` | One tick of the sweep (below). Strict empty body (a field is a 400). **Synchronous** (owner): answers `{ data: ContentLeavingSweepReport }` once the tick is done |
| GET | `/api/access/content/:id/download` | `auth: 'required'`, `strict` (20/min) | An owner's copy of a leaving video or audio piece: `LeavingDownloadResponse` `{ url, filename, sizeBytes, expiresAt }`, a 15-minute signed GET of `media_items.r2_key` with `response-content-disposition: attachment`, saved as the slug plus the original's extension. Only while leaving, with `owners_can_download` on, for an owner (`leavingDownloadOf`). Every refusal is the same 404, an article's and a lost original's included. Logs `content.leaving_download` with `{ contentId, sizeBytes }` only; `private, no-store` |
| GET | `/api/access/content/print` | `auth: 'required'`, `api` | `?slug` + exactly one of `orgId` or `creatorId` (`withdrawnContentQuerySchema`). A leaving article for its owner's print view: `LeavingPrintResponse` `{ contentId, title, creatorName, body }`, under the download's eligibility (`'print'` only). Every refusal is the same 404; `private, no-store` |
| GET | `/api/access/content/withdrawn` | `auth: 'required'` | Also answers `leaving: { leavesAt, download, sizeBytes } \| null` (WP-7), `download` being `leavingDownloadOf`'s answer |
| GET | `/api/content/public/removed` | `auth: 'none'`, `api`, `cache: 'public'` | `?slug` + exactly one of `orgId` or `creatorId`. `{ removed, leftWithNotice }` for a once-published piece at that key, never anything of the piece (`ContentService.removedPiece`) |

## admin-api routes

All under `requireOrgManagement`, except the takedown, which is `{ auth: 'platform_owner', rateLimit: 'strict' }` with no org policy.

| Method | Path | Behaviour |
|---|---|---|
| DELETE | `/api/admin/content/:contentId` | 200 `{ data: { outcome, leavesAt, holders } }`: the creator's delete. A held piece leaves in 30 days, its owners emailed; the leave holds the org's delete |
| POST | `/api/admin/content/:contentId/keep` | 200 `{ data: { kept, staying, stillLeavingBy } }`: withdraws the org's delete. If the creator deleted it too it still leaves (`kept: false`, `stillLeavingBy: 'creator'`). 403 `CONTENT_LEAVE_NOT_YOURS` for a leave holding only the creator's delete |
| POST | `/api/admin/content/:contentId/takedown` | 200 `{ data: { holders } }`: a legal or policy removal, deleted at once whoever holds it; each holder gets the `removed` email |

## Services

- **`@codex/content`:** `deleteOrLeave`, `keepLeaving`, `takedownPiece` (`content-leaving.ts`); `ContentService.completeLeaving` (the day-30 conditional delete, unscoped by design, called only from the sweep); `ContentService.removedPiece`.
- **`@codex/admin` `AdminContentManagementService`:**
  - `deleteContent(organizationId, contentId)`: the creator's delete (`deleteOrLeave`). Returns `DeleteContentResult & { creatorId }`.
  - `keepContent(organizationId, contentId)`: withdraws the org's delete (`keepLeaving`). Returns `{ kept, staying, stillLeavingBy }`; 403 `LeaveNotYoursError`.
  - `takedownContent(contentId)`: `takedownPiece`, NOT scoped (the `platform_owner` route's alone). Deleted at once, notices in flight cancelled, a `removed` row per holder. Returns `{ holders, organizationId, creatorId }`.
  - `refreshAfterChange(piece, reason, waitUntil)`: the caches a delete, Keep or takedown changes, for the route's `ctx.background`. Settles only once every refresh has (`Promise.allSettled`), each failure logged.
- **`@codex/access` `ContentAccessService`:**
  - `getLeavingDownload(userId, contentId)`: the download above. Same KV revocation check as `getStreamingUrl`, then `leavingDownloadOf` (`content-access/leaving-download.ts`), then an R2 HEAD of the original (missing: a warn and the 404; a failed HEAD: an error log and a 500, never the 404). Every refusal is one `ContentNotFoundError`, and every row found runs the same owner reads, offering or not.
  - `getLeavingPrint(userId, query)`: the print view, only when `leavingDownloadOf` says `'print'`. Every refusal is one `ContentNotFoundError`, keyed on the slug.
- **Service registry:** `ctx.services.contentLeaving` serves content-api's leaving-sweep worker route only, since it sweeps every creator's notices.
- **`@codex/cloudflare-clients`:**
  - `R2Service.objectExists(key)` is a `head` with no body; `R2SigningClient` has the same method.
  - `generateSignedUrl(key, expirySeconds, contentDisposition?)`: the disposition rides signed as `response-content-disposition`, e.g. `attachment;filename="x.mp4"`. Write it with no space after the `;`, because a `+` on the wire would not match the signature.
- **`@codex/purchase`:** a history row's `contentState` is `available`, leaving `on` a day, or removed `on` a day; removed wins (`purchase-history.ts`).

## The sweep

media-api's hourly maintenance run calls content-api's `POST /internal/content/leaving-sweep` first: one signed, awaited call (`TranscodingService`'s `contentLeaving` sweeper, built when `WORKER_SHARED_SECRET` is set).

- It is the run's longest call, up to `LEAVING_SWEEP_CALL_TIMEOUT_MS` (6 min).
- Its report is the run's `contentLeaving`: null when it did not run or failed.
- A failure is `failedSteps: ['contentLeaving']`, and the steps after it still run.

It is not RunPod's work. When RunPod or `DATABASE_URL` is not set up, or the run's services can't be built, `scheduled()` asks for the sweep alone (`runContentLeavingAlone`). That logs `content_leaving.swept_alone` with the report, or `transcoding.maintenance_step_failed` `{ step: 'contentLeaving' }`. So a transcoding config fault never stops the owners' emails or the day-30 deletes.

- Without `WORKER_SHARED_SECRET` there is no sweeper: `content_leaving.sweeper_unavailable` at error, once.
- A test of `scheduled()` must drop the secret or intercept `fetch`. With a dev stack listening on content-api's port, the call would run a real sweep on a shared database.

One tick, in order:

1. **`contentLeaving.sendDue()`:**
   - Cancels notices that are no longer true, with a warn, and abandons ones whose tries ran out.
   - Claims the rest under SKIP LOCKED, counting the try first, with a 6 h lease.
   - Bumps each claimed `leaving` notice's owner's library, at most `LEAVING_SWEEP_LIBRARY_BUMPS_PER_TICK`.
   - Sends 8 at a time through `sendEmailToWorkerAwaited`. Each batch's people are read again just before it goes, so an account erased meanwhile has no address. No batch starts after the 4 min budget.
   - A claim whose send never started, there or after a break, is given back untried.
   - The takedown email asks for the platform's own template (`platformTemplate`).
   - Each answer is written only while the notice is open.
2. **`addReminders()`:** the day-27 rows, read from the holders now.
3. **`content.completeLeaving(50)`:**
   - Its ids are logged at once, and each piece's cover is cleaned up.
   - Every owner's library is bumped, in pages with no 500 cap (`contentLeaving.bumpOwnersOf`), at most `LEAVING_SWEEP_COMPLETION_BUMPS_PER_TICK`. The rest are named in one warn.
   - One `afterBulkChange(..., 'content_deleted', obs, { holders: false })` covers everything else.

Limits and links:
- The caps are a sum against the 10,000 subrequests of one invocation (`@codex/constants` `content-leaving.ts`).
- A step that throws before its work starts fails the tick (500), and the next tick takes it up. The lease keeps overlapping ticks from sending a notice twice.
- An org link is built only while the org is live; a deleted org's piece links the owner's library and is named by its creator.
- Links are built from `ENVIRONMENT`'s name (`leavingNoticeLinkFor`).

## Web

- **Studio:** the delete dialog gives notice, the row says when the piece leaves and who was emailed, and Keep it withdraws the delete. A fresh read that must not refresh the page's own read is a `command()` returning only the fields it needs (`readPublishState`, `readLeaveState` in `content.remote.ts`), because `refresh()` of a failed query hands the page a new one. "Needs you" counts leaving pieces first (`CONTENT_ATTENTION_KINDS`), with the first leave date (`leavingFirst`).
- **The piece's page:** the note names the day, who removed it, why this reader has it, and the offer (`leaving-note.ts`).
  - **Download:** `GET <page>/download?id=` (`redirectToLeavingDownload`). It answers a 302 to the signed link with no-store, asked for at the click so the link never sits in page data. The link carries `data-sveltekit-reload`, because the client router cannot follow a server route's redirect. A refusal goes back to the page with a 303. Any other failure is logged and comes back with `?download=failed`.
  - **Print:** the print view is `<page>/print`.
- **Library:** a leaving piece's card says "Leaving {date}" (`getLibraryAccessState`). Disputed comes first. A subscription's leaving piece shows the earlier end, the leave or the renewal, and nothing while the period is unknown.
- **Old links:** both detail loaders call `answerIfRemoved` after every lookup missed. It throws a 410 that `ContentGone.svelte` draws. A failed read is logged, and the 404 stands.
- **Locally,** the download plays in the tab. `DevR2Signer` returns a plain dev-cdn link without the signed disposition; production's R2 link saves as a file.
