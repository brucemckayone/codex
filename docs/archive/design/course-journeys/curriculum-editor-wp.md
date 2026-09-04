# Curriculum Editor — Full-Stack WP Plan

**Bead:** `Codex-03cwh` (child of `Codex-a1tz6` P2 conformance) · **Status:** planned, build deferred
**Decision (2026-07-24):** scope + plan only this session; do NOT build (pending PR stack + 1–2 WP/session norm).
**Authoritative target:** `docs/design/course-journeys/prototype/course-editor.html` + SPEC §5 + the live schema.

---

## 1. Why this is a real WP (not "swap the seed")

The shipped editor `apps/web/src/routes/_org/[slug]/studio/journeys/[id]/curriculum/+page.svelte`
is an **aggressive-mode mock**: local `$state` seed of stages/practices + a `setTimeout`
`handleSave`. Its own header comment names the seam:

> INTEGRATION SEAM: WP-1 backs stages/practices and WP-5 BE adds a `getCourseCurriculum`
> query + stage/practice CRUD commands — swap the seed + `handleSave` for those.

But the mock also **models the domain wrong**, so wiring alone is insufficient:

| | Shipped mock | Schema + prototype (correct) |
|---|---|---|
| Practice identity | Free-text `{ id, title, contentType }` authored inline | A **JOIN to an existing `content` row** (`stage_practices.contentId` FK) |
| How you add one | Type a title, pick a type | **Content picker** — "Choose from your library or upload new" |
| Layout | Single-pane list | **Two-pane**: curriculum tree (left) + **inspector** (right) |

`course-editor.html` is explicit (lines ~285–287):
`media-slot … "linked content · tap to choose" … <button>Choose…</button>` and the callout
*"A practice points at one piece of content (video, audio or written). Pick from your
library or upload new — the same item can appear in more than one journey."*

So a faithful editor needs new backend **and** a rebuilt front end.

---

## 2. What already exists (verified from source)

**Schema — `packages/database/src/schema/journeys.ts`** (landed by WP-1, `Codex-2pryk.2.2`):

- `course_stages` — `id`, `courseId` (FK → `courses`, cascade), `name`, `gloss` (nullable),
  `sortOrder` (the gate order), `createdAt/updatedAt/deletedAt` (**soft delete**).
  Unique index `uq_course_stages_course_sort` on `(courseId, sortOrder)` **among non-deleted**.
- `stage_practices` — **join**: PK `(stageId, contentId)`, `sortOrder` (default 0).
  `stageId` FK → `course_stages` (cascade), `contentId` FK → `content` (cascade).
  **Hard-delete** of the association is intentional (join row, mirrors `content_categories`).

**Read (private) — `CourseJourneyService.loadStages(courseId)`** (`course-journey-service.ts:1439`):
loads the ordered non-deleted stages, each with its practices, already used by the
builder/dashboard/public reads. Reusable as the base for the editor read.

**MISSING (grep-confirmed — zero hits):** any `createStage / updateStage / reorderStage /
softDeleteStage / addPractice / removePractice / reorderPractices / getCourseCurriculum(ForEditor)`
method, any curriculum validation schema, any content-api curriculum write route.

**Space guard (HARDENING §5):** `content.orgId === course.orgId` is enforced **in the service
layer** via a `spaceWhere` predicate (mirrors `categories-service`). There is **no**
`syncContentCategories`-style helper — write each association explicitly.

---

## 3. Backend plan (`@codex/access` · `CourseJourneyService` or a new `CourseCurriculumService`)

> Placement: the curriculum is `CourseJourneyService`'s domain (it owns `loadStages`). Adding
> the CRUD there keeps the read/write together. If the file grows unwieldy, extract a
> `CourseCurriculumService` sharing the same db. Register in `service-registry.ts` either way.

### 3.1 Admin/editor read
`getCourseCurriculumForEditor(organizationId, courseId): Promise<EditorCurriculum>`
- Cross-org guard first: resolve `courses` scoped to `(id=courseId, organizationId, deletedAt IS NULL)`
  → `NotFoundError` on miss (same guard shape as `CourseInsightsService.getInsights`).
- Return non-deleted stages by `sortOrder`, each with its practices by `sortOrder`, **plus the
  content-picker metadata the inspector needs** (content `title`, `type`, `thumbnailUrl`,
  publish status) — a superset of the public `JourneyPracticeView` (which omits draft/media).
- New shared type `EditorStageView`/`EditorPracticeView` in `@codex/shared-types` (additive,
  structurally mirrored in `apps/web/src/lib/page-builder`, per the WP-0 freeze rule).

### 3.2 Write commands (all org+course scoped, space-guarded, transactional)
- `createStage(orgId, courseId, { name, gloss })` → append at `max(sortOrder)+1`.
- `renameStage(orgId, stageId, { name, gloss })`.
- `reorderStages(orgId, courseId, orderedStageIds[])` → rewrite `sortOrder` in one tx.
  **Unique-index hazard:** `(courseId, sortOrder)` is unique among non-deleted, so a naive
  per-row update collides mid-swap. Write all rows to a temporary offset (e.g. `+1000`) then
  to final values within the same tx, or order the updates to avoid transient collisions.
- `softDeleteStage(orgId, stageId)` → set `deletedAt`; its `stage_practices` rows are the join
  (leave or cascade — deleting the stage row later cascades; soft-delete keeps them, so filter
  by non-deleted stage on read).
- `addPractice(orgId, stageId, contentId)` → **space guard** (`content.orgId === course.orgId`
  via the stage's course), append at `max(sortOrder)+1`; PK collision = already attached (idempotent or 409).
- `removePractice(orgId, stageId, contentId)` → hard-delete the join row.
- `reorderPractices(orgId, stageId, orderedContentIds[])` → rewrite `sortOrder` in one tx
  (no unique index on practice sortOrder, so simpler than stages).

### 3.3 Validation (`@codex/validation/src/schemas/journeys.ts`)
One schema per command (uuid ids, `name` length ≤ 255 mirroring the column, `gloss` optional).
Mirror `journeyInsightsQuerySchema`'s org-resolver note: `organizationId` is for the resolver
only; the route re-derives `ctx.organizationId`.

### 3.4 content-api routes (`workers/content-api/src/routes/journeys.ts`, studio section)
`requireOrgManagement: true`, forward `ctx.organizationId` (NEVER the client value),
`rateLimit: 'api'`. Suggested paths under the existing studio group:
- `GET  /studio/journeys/:id/curriculum` → editor read
- `POST /studio/journeys/:id/curriculum/stages` (create) · `PATCH .../stages/:stageId` (rename)
- `POST .../stages/reorder` · `DELETE .../stages/:stageId`
- `POST .../stages/:stageId/practices` (add) · `DELETE .../stages/:stageId/practices/:contentId`
- `POST .../stages/:stageId/practices/reorder`
Resolve the course from the page id (`:id` = landing page → `subjectId`), org-scoped.

### 3.5 Content picker source
The inspector's "Choose…" needs the org's content list (video/audio/written). Confirm the
existing content-list read (likely `ContentService.list*` / a content-api public/studio list)
and reuse it — do **not** build a new content list. Flag as a build-time dependency to verify.

---

## 4. Front-end plan (`apps/web`)

- **API client** (`src/lib/server/api.ts`): add `access.getCourseCurriculum` + one method per command.
- **Remotes** (`src/lib/remote/journeys.remote.ts`): `getCourseCurriculum` query + command per
  write, all via the `resolveStudioOrg()` host-derived pattern (least-privilege; worker is the
  auth authority).
- **Component**: rebuild `curriculum/+page.svelte` to the prototype's **two-pane** shape —
  left: draggable stage/practice tree (reuse the existing reorder affordances + design tokens
  already in the file); right: **inspector** that, for a selected practice, shows the linked
  content (`media-slot`) + a "Choose…" **content-library picker** (Melt dialog/combobox), and
  for a selected stage, name + gloss. Replace the free-text practice title/type with the picker.
  Drop the mock seed + `handleSave`; drive off the query + commands with optimistic updates.
- Keep the existing admin/owner server gate (`+page.server.ts`) — it's already correct.

---

## 5. Tests (live-Postgres, unique-id-scoped, NO `cleanupDatabase`)

Mirror `packages/access/src/services/__tests__/course-round-d.integration.test.ts` /
`course-studio-management.integration.test.ts`:
- read returns ordered stages+practices with content metadata; excludes soft-deleted stages.
- each command: happy path + org isolation (foreign course/stage/content → 404/blocked).
- `reorderStages` does not violate the `(courseId, sortOrder)` unique index (the offset dance).
- `addPractice` space guard: content from another org is rejected.
- FE: extend `apps/web/src/lib/server/journeys/__tests__/round-d-seam.test.ts` for the remotes.

---

## 6. Suggested split (likely > 1 session)

- **WP-A (BE):** schema is done → service read + all commands + validation + routes + tests.
- **WP-B (FE):** two-pane rebuild + content picker + remotes, on top of WP-A.
This lets the BE land and be verified before the larger FE rebuild, matching the epic's
BE→FE worktree split.
