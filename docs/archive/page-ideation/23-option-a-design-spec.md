# Option A: Section Picker — Full Design Specification

**Date**: 2026-04-04
**Status**: Design complete — ready for implementation planning
**Prerequisite**: [22-page-builder-investigation.md](22-page-builder-investigation.md)

---

## Table of Contents

1. [File Map: Created vs Modified](#1-file-map)
2. [Database Layer](#2-database-layer)
3. [Shared Types](#3-shared-types)
4. [Validation Layer](#4-validation-layer)
5. [Service Layer](#5-service-layer)
6. [Worker API Layer](#6-worker-api-layer)
7. [Cache Integration](#7-cache-integration)
8. [Constants Changes](#8-constants-changes)
9. [Service Registry Changes](#9-service-registry-changes)
10. [Frontend — Types & Section Registry](#10-frontend-types--section-registry)
11. [Frontend — Section Components](#11-frontend-section-components)
12. [Frontend — Page Renderer](#12-frontend-page-renderer)
13. [Frontend — Modified Server Loads](#13-frontend-modified-server-loads)
14. [Frontend — Studio Pages Editor](#14-frontend-studio-pages-editor)
15. [Frontend — Remote Functions](#15-frontend-remote-functions)
16. [Frontend — Navigation Changes](#16-frontend-navigation-changes)
17. [Testing Strategy](#17-testing-strategy)
18. [Migration & Rollout](#18-migration--rollout)

---

## 1. File Map

### New Files (Created)

| Layer | File | Mirrors Pattern From |
|-------|------|---------------------|
| **Database** | `packages/database/src/schema/pages.ts` | `schema/settings.ts` |
| **Database** | `packages/database/src/migrations/XXXX_add_page_layouts.sql` | Existing migration files |
| **Shared Types** | `packages/shared-types/src/page-layout.ts` | `api-responses.ts` (BrandingSettingsResponse) |
| **Validation** | `packages/validation/src/schemas/page-layout.ts` | `schemas/settings.ts` (updateBrandingSchema) |
| **Service** | `packages/page-layout/src/index.ts` | `packages/platform-settings/src/index.ts` |
| **Service** | `packages/page-layout/src/errors.ts` | `packages/platform-settings/src/errors.ts` |
| **Service** | `packages/page-layout/src/services/page-layout-service.ts` | `branding-settings-service.ts` |
| **Service** | `packages/page-layout/package.json` | `packages/platform-settings/package.json` |
| **Service** | `packages/page-layout/tsconfig.json` | `packages/platform-settings/tsconfig.json` |
| **Service** | `packages/page-layout/vite.config.page-layout.ts` | `vite.config.platform-settings.ts` |
| **Service** | `packages/page-layout/vitest.config.page-layout.ts` | `vitest.config.platform-settings.ts` |
| **Worker** | `workers/organization-api/src/routes/pages.ts` | `routes/settings.ts` |
| **Frontend** | `apps/web/src/lib/page-builder/types.ts` | `lib/brand-editor/types.ts` |
| **Frontend** | `apps/web/src/lib/page-builder/registry.ts` | N/A (new pattern) |
| **Frontend** | `apps/web/src/lib/page-builder/section-schemas.ts` | N/A (section metadata) |
| **Frontend** | `apps/web/src/lib/page-builder/defaults.ts` | N/A (default layouts) |
| **Frontend** | `apps/web/src/lib/page-builder/page-editor-store.svelte.ts` | `brand-editor-store.svelte.ts` |
| **Frontend** | `apps/web/src/lib/components/page-builder/PageRenderer.svelte` | N/A (core renderer) |
| **Frontend** | `apps/web/src/lib/components/page-builder/SectionWrapper.svelte` | N/A (CSS scoping) |
| **Frontend** | `apps/web/src/lib/components/sections/Hero.svelte` | Current `+page.svelte` hero |
| **Frontend** | `apps/web/src/lib/components/sections/ContentGrid.svelte` | Current `+page.svelte` grid |
| **Frontend** | `apps/web/src/lib/components/sections/ContentCarousel.svelte` | N/A |
| **Frontend** | `apps/web/src/lib/components/sections/CreatorSpotlight.svelte` | N/A |
| **Frontend** | `apps/web/src/lib/components/sections/TextBlock.svelte` | N/A |
| **Frontend** | `apps/web/src/lib/components/sections/CtaBanner.svelte` | N/A |
| **Frontend** | `apps/web/src/lib/components/sections/Categories.svelte` | N/A |
| **Frontend** | `apps/web/src/lib/components/sections/Faq.svelte` | N/A |
| **Frontend** | `apps/web/src/lib/components/sections/Testimonials.svelte` | N/A |
| **Frontend** | `apps/web/src/lib/components/sections/Spacer.svelte` | N/A |
| **Frontend** | `apps/web/src/lib/remote/pages.remote.ts` | `remote/branding.remote.ts` |
| **Frontend** | `apps/web/src/routes/_org/[slug]/studio/pages/+layout.svelte` | `studio/settings/+layout.svelte` |
| **Frontend** | `apps/web/src/routes/_org/[slug]/studio/pages/+layout.server.ts` | `studio/settings/+layout.server.ts` |
| **Frontend** | `apps/web/src/routes/_org/[slug]/studio/pages/+page.svelte` | N/A (page list) |
| **Frontend** | `apps/web/src/routes/_org/[slug]/studio/pages/+page.server.ts` | N/A |
| **Frontend** | `apps/web/src/routes/_org/[slug]/studio/pages/[pageSlug]/+page.svelte` | N/A (editor) |
| **Frontend** | `apps/web/src/routes/_org/[slug]/studio/pages/[pageSlug]/+page.server.ts` | N/A |
| **Frontend** | `apps/web/src/lib/components/studio/PageEditor.svelte` | Brand editor panel (adapted) |
| **Frontend** | `apps/web/src/lib/components/studio/SectionPicker.svelte` | N/A |
| **Frontend** | `apps/web/src/lib/components/studio/SectionSettings.svelte` | Brand editor level components |

### Modified Files (Existing)

| Layer | File | Change |
|-------|------|--------|
| **Database** | `packages/database/src/schema/index.ts` | Add `export * from './pages'` |
| **Shared Types** | `packages/shared-types/src/index.ts` | Add page-layout exports |
| **Validation** | `packages/validation/src/index.ts` | Add page-layout schema exports |
| **Constants** | `packages/constants/src/limits.ts` | Add `PAGE_LAYOUT_CACHE_SECONDS` |
| **Constants** | `packages/cache/src/cache-keys.ts` | Add `PAGE_LAYOUT` cache type |
| **Worker** | `workers/organization-api/src/index.ts` | Mount page routes |
| **Worker** | `workers/organization-api/package.json` | Add `@codex/page-layout` dep |
| **Service Registry** | `packages/worker-utils/src/procedure/service-registry.ts` | Add `pageLayout` getter |
| **Frontend** | `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` | Replace hardcoded layout with PageRenderer |
| **Frontend** | `apps/web/src/routes/_org/[slug]/(space)/+page.server.ts` | Fetch layout config + section data |
| **Frontend** | `apps/web/src/lib/config/navigation.ts` | Add "Pages" to studio sidebar |
| **Frontend** | `apps/web/src/lib/types.ts` | Add page layout types |

---

## 2. Database Layer

### New File: `packages/database/src/schema/pages.ts`

Follows the exact pattern from `settings.ts` — pgTable, relations, type exports.

```typescript
import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './content';

// ============================================================================
// PAGE LAYOUTS — Configurable org page structure
// ============================================================================

export const pageLayouts = pgTable(
  'page_layouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    creatorId: uuid('creator_id').notNull(),

    // Page identity
    slug: text('slug').notNull(),        // 'home', 'about', etc.
    title: text('title').notNull(),

    // Layout data (working draft)
    layout: jsonb('layout').notNull().$type<PageLayoutJson>(),

    // Published snapshot (what visitors see)
    publishedLayout: jsonb('published_layout').$type<PageLayoutJson>(),

    // Version tracking
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('draft'),

    publishedAt: timestamp('published_at', { withTimezone: true }),

    // Standard timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // One active page per slug per org (soft delete safe)
    uniqueIndex('idx_unique_page_layout_slug_per_org')
      .on(table.organizationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),

    index('idx_page_layouts_org_id').on(table.organizationId),
    index('idx_page_layouts_status').on(table.organizationId, table.status),

    check(
      'check_page_layout_status',
      sql`${table.status} IN ('draft', 'published')`
    ),
  ]
);

export const pageLayoutRelations = relations(pageLayouts, ({ one }) => ({
  organization: one(organizations, {
    fields: [pageLayouts.organizationId],
    references: [organizations.id],
  }),
}));

// Version history for rollback
export const pageLayoutVersions = pgTable(
  'page_layout_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    pageLayoutId: uuid('page_layout_id')
      .notNull()
      .references(() => pageLayouts.id, { onDelete: 'cascade' }),

    version: integer('version').notNull(),
    layout: jsonb('layout').notNull().$type<PageLayoutJson>(),

    createdBy: uuid('created_by').notNull(),
    changeSummary: text('change_summary'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_page_layout_versions_page_id').on(table.pageLayoutId),
    uniqueIndex('idx_page_layout_versions_unique').on(
      table.pageLayoutId,
      table.version
    ),
  ]
);

export const pageLayoutVersionRelations = relations(
  pageLayoutVersions,
  ({ one }) => ({
    pageLayout: one(pageLayouts, {
      fields: [pageLayoutVersions.pageLayoutId],
      references: [pageLayouts.id],
    }),
  })
);

// Pre-built templates
export const pageTemplates = pgTable(
  'page_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    thumbnailUrl: text('thumbnail_url'),
    layout: jsonb('layout').notNull().$type<PageLayoutJson>(),
    category: text('category').notNull(), // 'creator', 'educator', 'podcaster'
    isSystem: integer('is_system').notNull().default(1), // 1 = system, 0 = user-saved
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_page_templates_category').on(table.category),
  ]
);

// ============================================================================
// JSON types (used by $type<>() above)
// ============================================================================

export interface PageLayoutJson {
  sections: PageSectionJson[];
  metadata?: {
    template?: string;
    lastEditedBy?: string;
  };
}

export interface PageSectionJson {
  id: string;
  type: string;
  order: number;
  variant?: string;
  data: Record<string, unknown>;
  styles?: PageSectionStylesJson;
}

export interface PageSectionStylesJson {
  cssVariables?: Record<string, string>;
  containerWidth?: 'narrow' | 'wide' | 'full';
  paddingY?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  background?: 'transparent' | 'surface' | 'muted' | 'brand' | 'accent' | 'dark' | 'custom';
}

// ============================================================================
// Type exports (Drizzle inference)
// ============================================================================

export type PageLayout = typeof pageLayouts.$inferSelect;
export type NewPageLayout = typeof pageLayouts.$inferInsert;
export type PageLayoutVersion = typeof pageLayoutVersions.$inferSelect;
export type NewPageLayoutVersion = typeof pageLayoutVersions.$inferInsert;
export type PageTemplate = typeof pageTemplates.$inferSelect;
```

### Modified: `packages/database/src/schema/index.ts`

```typescript
// Add this line alongside existing exports:
export * from './pages';
```

### Migration SQL

```sql
-- Migration: add_page_layouts

CREATE TABLE page_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  layout JSONB NOT NULL,
  published_layout JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT check_page_layout_status CHECK (status IN ('draft', 'published'))
);

CREATE UNIQUE INDEX idx_unique_page_layout_slug_per_org
  ON page_layouts (organization_id, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_page_layouts_org_id ON page_layouts (organization_id);
CREATE INDEX idx_page_layouts_status ON page_layouts (organization_id, status);

CREATE TABLE page_layout_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_layout_id UUID NOT NULL REFERENCES page_layouts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  layout JSONB NOT NULL,
  created_by UUID NOT NULL,
  change_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_layout_versions_page_id ON page_layout_versions (page_layout_id);
CREATE UNIQUE INDEX idx_page_layout_versions_unique ON page_layout_versions (page_layout_id, version);

CREATE TABLE page_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  layout JSONB NOT NULL,
  category TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_templates_category ON page_templates (category);
```

---

## 3. Shared Types

### New File: `packages/shared-types/src/page-layout.ts`

Follows the pattern from `api-responses.ts` — response interfaces used across workers and frontend.

```typescript
// ============================================================================
// Section types (shared vocabulary between backend and frontend)
// ============================================================================

export type SectionType =
  | 'hero'
  | 'content_grid'
  | 'content_carousel'
  | 'creator_spotlight'
  | 'text_block'
  | 'cta_banner'
  | 'categories'
  | 'faq'
  | 'testimonials'
  | 'spacer';

export type ContainerWidth = 'narrow' | 'wide' | 'full';
export type PaddingY = 'none' | 'sm' | 'md' | 'lg' | 'xl';
export type SectionBackground =
  | 'transparent'
  | 'surface'
  | 'muted'
  | 'brand'
  | 'accent'
  | 'dark'
  | 'custom';

export type PageLayoutStatus = 'draft' | 'published';

// ============================================================================
// Section styles
// ============================================================================

export interface SectionStyles {
  cssVariables?: Record<string, string>;
  containerWidth?: ContainerWidth;
  paddingY?: PaddingY;
  background?: SectionBackground;
}

// ============================================================================
// Section definition
// ============================================================================

export interface PageSection {
  id: string;
  type: SectionType;
  order: number;
  variant?: string;
  data: Record<string, unknown>;
  styles?: SectionStyles;
}

// ============================================================================
// Page layout structure
// ============================================================================

export interface PageLayoutConfig {
  sections: PageSection[];
  metadata?: {
    template?: string;
    lastEditedBy?: string;
  };
}

// ============================================================================
// API response types
// ============================================================================

export interface PageLayoutResponse {
  id: string;
  organizationId: string;
  slug: string;
  title: string;
  layout: PageLayoutConfig;
  publishedLayout: PageLayoutConfig | null;
  version: number;
  status: PageLayoutStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageLayoutSummaryResponse {
  id: string;
  slug: string;
  title: string;
  status: PageLayoutStatus;
  version: number;
  sectionCount: number;
  publishedAt: string | null;
  updatedAt: string;
}

export interface PublishedPageLayoutResponse {
  layout: PageLayoutConfig;
  updatedAt: string;
}

export interface PageTemplateResponse {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  layout: PageLayoutConfig;
  category: string;
}
```

### Modified: `packages/shared-types/src/index.ts`

```typescript
// Add alongside existing exports:
export * from './page-layout';
```

---

## 4. Validation Layer

### New File: `packages/validation/src/schemas/page-layout.ts`

Follows the exact pattern from `schemas/settings.ts` — input schemas, type exports, defaults.

```typescript
import { z } from 'zod';
import { uuidSchema, createSlugSchema, createSanitizedStringSchema } from '../primitives';

// ============================================================================
// Section type enum
// ============================================================================

export const sectionTypeSchema = z.enum([
  'hero',
  'content_grid',
  'content_carousel',
  'creator_spotlight',
  'text_block',
  'cta_banner',
  'categories',
  'faq',
  'testimonials',
  'spacer',
]);

export const containerWidthSchema = z.enum(['narrow', 'wide', 'full']);
export const paddingYSchema = z.enum(['none', 'sm', 'md', 'lg', 'xl']);
export const sectionBackgroundSchema = z.enum([
  'transparent', 'surface', 'muted', 'brand', 'accent', 'dark', 'custom',
]);

// ============================================================================
// Section styles
// ============================================================================

export const sectionStylesSchema = z.object({
  cssVariables: z.record(z.string(), z.string()).optional(),
  containerWidth: containerWidthSchema.optional(),
  paddingY: paddingYSchema.optional(),
  background: sectionBackgroundSchema.optional(),
}).strict();

// ============================================================================
// Section definition
// ============================================================================

export const pageSectionSchema = z.object({
  id: z.string().min(1).max(64),
  type: sectionTypeSchema,
  order: z.number().int().min(0).max(50),
  variant: z.string().max(50).optional(),
  data: z.record(z.string(), z.unknown()),
  styles: sectionStylesSchema.optional(),
});

// ============================================================================
// Page layout config
// ============================================================================

export const pageLayoutConfigSchema = z.object({
  sections: z.array(pageSectionSchema).max(25), // Shopify-style limit
  metadata: z.object({
    template: z.string().max(100).optional(),
    lastEditedBy: z.string().max(100).optional(),
  }).optional(),
});

// ============================================================================
// API input schemas
// ============================================================================

/** POST /api/organizations/:id/pages */
export const createPageLayoutSchema = z.object({
  slug: createSlugSchema(100),
  title: createSanitizedStringSchema(1, 200, 'Title'),
  layout: pageLayoutConfigSchema,
  templateId: uuidSchema.optional(), // If starting from a template
});

export type CreatePageLayoutInput = z.infer<typeof createPageLayoutSchema>;

/** PATCH /api/organizations/:id/pages/:pageId */
export const updatePageLayoutSchema = z.object({
  title: createSanitizedStringSchema(1, 200, 'Title').optional(),
  layout: pageLayoutConfigSchema.optional(),
});

export type UpdatePageLayoutInput = z.infer<typeof updatePageLayoutSchema>;

/** POST /api/organizations/:id/pages/:pageId/publish */
export const publishPageLayoutSchema = z.object({
  changeSummary: z.string().trim().max(500).optional(),
});

export type PublishPageLayoutInput = z.infer<typeof publishPageLayoutSchema>;

/** GET /api/organizations/:id/pages (query params) */
export const listPageLayoutsSchema = z.object({
  status: z.enum(['draft', 'published', 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListPageLayoutsInput = z.infer<typeof listPageLayoutsSchema>;

/** GET /api/organizations/public/:slug/pages/:pageSlug */
export const getPublicPageLayoutSchema = z.object({
  slug: z.string().min(1).max(100),    // org slug (from URL param)
  pageSlug: z.string().min(1).max(100), // page slug
});

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_HOME_LAYOUT: z.infer<typeof pageLayoutConfigSchema> = {
  sections: [
    {
      id: 'default-hero',
      type: 'hero',
      order: 0,
      variant: 'centered',
      data: {
        useOrgName: true,
        useOrgDescription: true,
        ctaText: 'Explore Content',
        ctaLink: '/explore',
      },
    },
    {
      id: 'default-grid',
      type: 'content_grid',
      order: 1,
      data: {
        title: 'Featured Content',
        source: 'newest',
        limit: 6,
        columns: 3,
      },
    },
  ],
};
```

### Modified: `packages/validation/src/index.ts`

```typescript
// Add alongside existing exports:
export * from './schemas/page-layout';
```

---

## 5. Service Layer

### New Package: `packages/page-layout/`

Follows the exact structure of `packages/platform-settings/`.

#### `packages/page-layout/src/errors.ts`

```typescript
import {
  ConflictError,
  InternalServiceError,
  NotFoundError,
} from '@codex/service-errors';

export class PageLayoutNotFoundError extends NotFoundError {
  constructor(identifier: string, organizationId: string) {
    super(`Page layout not found: ${identifier}`, {
      identifier,
      organizationId,
    });
  }
}

export class PageLayoutSlugConflictError extends ConflictError {
  constructor(slug: string, organizationId: string) {
    super(`Page layout with slug "${slug}" already exists`, {
      slug,
      organizationId,
    });
  }
}

export class PageLayoutPublishError extends InternalServiceError {
  constructor(pageLayoutId: string, reason: string) {
    super(`Failed to publish page layout: ${reason}`, {
      pageLayoutId,
      hint: 'Check that the layout has at least one section.',
    });
  }
}
```

#### `packages/page-layout/src/services/page-layout-service.ts`

Follows `BrandingSettingsService` — constructor pattern, BaseService extension, upsert, error handling.

```typescript
import type { dbHttp, dbWs } from '@codex/database';
import { schema } from '@codex/database';
import { BaseService } from '@codex/service-errors';
import type {
  PageLayoutConfig,
  PageLayoutResponse,
  PageLayoutSummaryResponse,
  PublishedPageLayoutResponse,
  PageTemplateResponse,
} from '@codex/shared-types';
import type {
  CreatePageLayoutInput,
  UpdatePageLayoutInput,
  PublishPageLayoutInput,
  ListPageLayoutsInput,
} from '@codex/validation';
import { and, eq, isNull, desc, count, sql } from 'drizzle-orm';
import {
  PageLayoutNotFoundError,
  PageLayoutSlugConflictError,
  PageLayoutPublishError,
} from '../errors';

export interface PageLayoutServiceConfig {
  db: typeof dbHttp | typeof dbWs;
  environment: string;
  organizationId: string;
}

export class PageLayoutService extends BaseService {
  private readonly organizationId: string;

  constructor(config: PageLayoutServiceConfig) {
    super(config);
    this.organizationId = config.organizationId;
  }

  // ──────────────────────────────────────────────────────────────────────
  // GET — Single page layout (draft view, for editor)
  // ──────────────────────────────────────────────────────────────────────

  async get(pageLayoutId: string): Promise<PageLayoutResponse> {
    try {
      const result = await this.db
        .select()
        .from(schema.pageLayouts)
        .where(
          and(
            eq(schema.pageLayouts.id, pageLayoutId),
            eq(schema.pageLayouts.organizationId, this.organizationId),
            isNull(schema.pageLayouts.deletedAt)
          )
        )
        .limit(1);

      const row = result[0];
      if (!row) {
        throw new PageLayoutNotFoundError(pageLayoutId, this.organizationId);
      }

      return this.mapToResponse(row);
    } catch (error) {
      this.handleError(error, 'get');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // GET BY SLUG — For editor (draft) and public (published)
  // ──────────────────────────────────────────────────────────────────────

  async getBySlug(slug: string): Promise<PageLayoutResponse> {
    try {
      const result = await this.db
        .select()
        .from(schema.pageLayouts)
        .where(
          and(
            eq(schema.pageLayouts.slug, slug),
            eq(schema.pageLayouts.organizationId, this.organizationId),
            isNull(schema.pageLayouts.deletedAt)
          )
        )
        .limit(1);

      const row = result[0];
      if (!row) {
        throw new PageLayoutNotFoundError(slug, this.organizationId);
      }

      return this.mapToResponse(row);
    } catch (error) {
      this.handleError(error, 'getBySlug');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // GET PUBLISHED — What visitors see (returns null if unpublished)
  // ──────────────────────────────────────────────────────────────────────

  async getPublished(slug: string): Promise<PublishedPageLayoutResponse | null> {
    try {
      const result = await this.db
        .select({
          publishedLayout: schema.pageLayouts.publishedLayout,
          updatedAt: schema.pageLayouts.updatedAt,
        })
        .from(schema.pageLayouts)
        .where(
          and(
            eq(schema.pageLayouts.slug, slug),
            eq(schema.pageLayouts.organizationId, this.organizationId),
            eq(schema.pageLayouts.status, 'published'),
            isNull(schema.pageLayouts.deletedAt)
          )
        )
        .limit(1);

      const row = result[0];
      if (!row?.publishedLayout) return null;

      return {
        layout: row.publishedLayout as PageLayoutConfig,
        updatedAt: row.updatedAt.toISOString(),
      };
    } catch (error) {
      this.handleError(error, 'getPublished');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // LIST — All page layouts for this org
  // ──────────────────────────────────────────────────────────────────────

  async list(input: ListPageLayoutsInput): Promise<{
    items: PageLayoutSummaryResponse[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    try {
      const conditions = [
        eq(schema.pageLayouts.organizationId, this.organizationId),
        isNull(schema.pageLayouts.deletedAt),
      ];

      if (input.status !== 'all') {
        conditions.push(eq(schema.pageLayouts.status, input.status));
      }

      const where = and(...conditions);
      const offset = (input.page - 1) * input.limit;

      const [rows, totalResult] = await Promise.all([
        this.db
          .select()
          .from(schema.pageLayouts)
          .where(where)
          .orderBy(desc(schema.pageLayouts.updatedAt))
          .limit(input.limit)
          .offset(offset),
        this.db
          .select({ count: count() })
          .from(schema.pageLayouts)
          .where(where),
      ]);

      const total = totalResult[0]?.count ?? 0;

      return {
        items: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          status: row.status as 'draft' | 'published',
          version: row.version,
          sectionCount: (row.layout as PageLayoutConfig)?.sections?.length ?? 0,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        })),
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          totalPages: Math.ceil(total / input.limit),
        },
      };
    } catch (error) {
      this.handleError(error, 'list');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // CREATE
  // ──────────────────────────────────────────────────────────────────────

  async create(
    input: CreatePageLayoutInput,
    creatorId: string
  ): Promise<PageLayoutResponse> {
    try {
      // Check slug uniqueness
      const existing = await this.db
        .select({ id: schema.pageLayouts.id })
        .from(schema.pageLayouts)
        .where(
          and(
            eq(schema.pageLayouts.slug, input.slug),
            eq(schema.pageLayouts.organizationId, this.organizationId),
            isNull(schema.pageLayouts.deletedAt)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        throw new PageLayoutSlugConflictError(input.slug, this.organizationId);
      }

      const result = await this.db
        .insert(schema.pageLayouts)
        .values({
          organizationId: this.organizationId,
          creatorId,
          slug: input.slug,
          title: input.title,
          layout: input.layout,
          status: 'draft',
          version: 1,
        })
        .returning();

      const row = result[0];
      if (!row) {
        throw new PageLayoutPublishError('unknown', 'Insert returned no rows');
      }

      this.obs.info('Page layout created', {
        organizationId: this.organizationId,
        pageLayoutId: row.id,
        slug: input.slug,
      });

      return this.mapToResponse(row);
    } catch (error) {
      this.handleError(error, 'create');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // UPDATE (draft only — does NOT publish)
  // ──────────────────────────────────────────────────────────────────────

  async update(
    pageLayoutId: string,
    input: UpdatePageLayoutInput
  ): Promise<PageLayoutResponse> {
    try {
      const updateValues: Record<string, unknown> = {};

      if (input.title !== undefined) updateValues.title = input.title;
      if (input.layout !== undefined) updateValues.layout = input.layout;

      if (Object.keys(updateValues).length === 0) {
        return this.get(pageLayoutId);
      }

      updateValues.updatedAt = new Date();

      const result = await this.db
        .update(schema.pageLayouts)
        .set(updateValues)
        .where(
          and(
            eq(schema.pageLayouts.id, pageLayoutId),
            eq(schema.pageLayouts.organizationId, this.organizationId),
            isNull(schema.pageLayouts.deletedAt)
          )
        )
        .returning();

      const row = result[0];
      if (!row) {
        throw new PageLayoutNotFoundError(pageLayoutId, this.organizationId);
      }

      this.obs.info('Page layout updated', {
        organizationId: this.organizationId,
        pageLayoutId,
        updatedFields: Object.keys(updateValues),
      });

      return this.mapToResponse(row);
    } catch (error) {
      this.handleError(error, 'update');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // PUBLISH — Snapshot layout → publishedLayout, bump version
  // ──────────────────────────────────────────────────────────────────────

  async publish(
    pageLayoutId: string,
    input: PublishPageLayoutInput,
    publishedBy: string
  ): Promise<PageLayoutResponse> {
    try {
      // Fetch current state
      const current = await this.get(pageLayoutId);

      if ((current.layout as PageLayoutConfig).sections.length === 0) {
        throw new PageLayoutPublishError(
          pageLayoutId,
          'Cannot publish a page with no sections'
        );
      }

      const newVersion = current.version + 1;

      // Update page + create version history (sequential: version depends on update)
      const result = await this.db
        .update(schema.pageLayouts)
        .set({
          publishedLayout: current.layout,
          status: 'published',
          version: newVersion,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.pageLayouts.id, pageLayoutId),
            eq(schema.pageLayouts.organizationId, this.organizationId),
            isNull(schema.pageLayouts.deletedAt)
          )
        )
        .returning();

      const row = result[0];
      if (!row) {
        throw new PageLayoutNotFoundError(pageLayoutId, this.organizationId);
      }

      // Save version history (fire-and-forget is fine here)
      await this.db.insert(schema.pageLayoutVersions).values({
        pageLayoutId,
        version: newVersion,
        layout: current.layout as Record<string, unknown>,
        createdBy: publishedBy,
        changeSummary: input.changeSummary ?? null,
      });

      this.obs.info('Page layout published', {
        organizationId: this.organizationId,
        pageLayoutId,
        version: newVersion,
      });

      return this.mapToResponse(row);
    } catch (error) {
      this.handleError(error, 'publish');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // DELETE (soft)
  // ──────────────────────────────────────────────────────────────────────

  async delete(pageLayoutId: string): Promise<void> {
    try {
      const result = await this.db
        .update(schema.pageLayouts)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.pageLayouts.id, pageLayoutId),
            eq(schema.pageLayouts.organizationId, this.organizationId),
            isNull(schema.pageLayouts.deletedAt)
          )
        )
        .returning({ id: schema.pageLayouts.id });

      if (result.length === 0) {
        throw new PageLayoutNotFoundError(pageLayoutId, this.organizationId);
      }

      this.obs.info('Page layout deleted', {
        organizationId: this.organizationId,
        pageLayoutId,
      });
    } catch (error) {
      this.handleError(error, 'delete');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // TEMPLATES — List system templates
  // ──────────────────────────────────────────────────────────────────────

  async listTemplates(category?: string): Promise<PageTemplateResponse[]> {
    try {
      const conditions = [eq(schema.pageTemplates.isSystem, 1)];
      if (category) {
        conditions.push(eq(schema.pageTemplates.category, category));
      }

      const rows = await this.db
        .select()
        .from(schema.pageTemplates)
        .where(and(...conditions))
        .orderBy(schema.pageTemplates.name);

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        thumbnailUrl: row.thumbnailUrl,
        layout: row.layout as PageLayoutConfig,
        category: row.category,
      }));
    } catch (error) {
      this.handleError(error, 'listTemplates');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────

  private mapToResponse(row: typeof schema.pageLayouts.$inferSelect): PageLayoutResponse {
    return {
      id: row.id,
      organizationId: row.organizationId,
      slug: row.slug,
      title: row.title,
      layout: row.layout as PageLayoutConfig,
      publishedLayout: (row.publishedLayout as PageLayoutConfig) ?? null,
      version: row.version,
      status: row.status as 'draft' | 'published',
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
```

#### `packages/page-layout/src/index.ts`

```typescript
export {
  PageLayoutNotFoundError,
  PageLayoutSlugConflictError,
  PageLayoutPublishError,
} from './errors';

export {
  PageLayoutService,
  type PageLayoutServiceConfig,
} from './services/page-layout-service';
```

---

## 6. Worker API Layer

### New File: `workers/organization-api/src/routes/pages.ts`

Follows the exact pattern from `routes/settings.ts` — procedure(), policy, input validation.

```typescript
import { Hono } from 'hono';
import type { HonoEnv } from '@codex/shared-types';
import { procedure, PaginatedResult } from '@codex/worker-utils';
import { VersionedCache } from '@codex/cache';
import {
  createPageLayoutSchema,
  updatePageLayoutSchema,
  publishPageLayoutSchema,
  listPageLayoutsSchema,
  uuidSchema,
} from '@codex/validation';
import { z } from 'zod';

const app = new Hono<HonoEnv>();

const pageIdSchema = z.object({ id: uuidSchema, pageId: uuidSchema });
const orgIdSchema = z.object({ id: uuidSchema });

// ─────────────────────────────────────────────────────────────
// GET /api/organizations/:id/pages — List page layouts
// ─────────────────────────────────────────────────────────────

app.get(
  '/',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdSchema, query: listPageLayoutsSchema },
    handler: async (ctx) => {
      const result = await ctx.services.pageLayout.list(ctx.input.query);
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

// ─────────────────────────────────────────────────────────────
// GET /api/organizations/:id/pages/:pageId — Get single layout
// ─────────────────────────────────────────────────────────────

app.get(
  '/:pageId',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: pageIdSchema },
    handler: async (ctx) => {
      return await ctx.services.pageLayout.get(ctx.input.params.pageId);
    },
  })
);

// ─────────────────────────────────────────────────────────────
// POST /api/organizations/:id/pages — Create page layout
// ─────────────────────────────────────────────────────────────

app.post(
  '/',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdSchema, body: createPageLayoutSchema },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.pageLayout.create(
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);

// ─────────────────────────────────────────────────────────────
// PATCH /api/organizations/:id/pages/:pageId — Update draft
// ─────────────────────────────────────────────────────────────

app.patch(
  '/:pageId',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: pageIdSchema, body: updatePageLayoutSchema },
    handler: async (ctx) => {
      return await ctx.services.pageLayout.update(
        ctx.input.params.pageId,
        ctx.input.body
      );
    },
  })
);

// ─────────────────────────────────────────────────────────────
// POST /api/organizations/:id/pages/:pageId/publish — Publish
// ─────────────────────────────────────────────────────────────

app.post(
  '/:pageId/publish',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: pageIdSchema, body: publishPageLayoutSchema },
    handler: async (ctx) => {
      const result = await ctx.services.pageLayout.publish(
        ctx.input.params.pageId,
        ctx.input.body,
        ctx.user.id
      );

      // Invalidate cache after publish
      invalidatePageLayoutCache(ctx, ctx.input.params.id);

      return result;
    },
  })
);

// ─────────────────────────────────────────────────────────────
// DELETE /api/organizations/:id/pages/:pageId — Soft delete
// ─────────────────────────────────────────────────────────────

app.delete(
  '/:pageId',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true, rateLimit: 'auth' },
    input: { params: pageIdSchema },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.pageLayout.delete(ctx.input.params.pageId);

      // Invalidate cache after delete
      invalidatePageLayoutCache(ctx, ctx.input.params.id);

      return null;
    },
  })
);

// ─────────────────────────────────────────────────────────────
// GET /api/organizations/:id/pages/templates — List templates
// ─────────────────────────────────────────────────────────────

app.get(
  '/templates',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: orgIdSchema,
      query: z.object({ category: z.string().max(50).optional() }),
    },
    handler: async (ctx) => {
      return await ctx.services.pageLayout.listTemplates(
        ctx.input.query.category
      );
    },
  })
);

// ─────────────────────────────────────────────────────────────
// PUBLIC: GET /api/organizations/public/:slug/pages/:pageSlug
// ─────────────────────────────────────────────────────────────
// Note: This endpoint goes in organizations.ts (public routes)
// since it doesn't require auth. See section 6 notes below.

// ─────────────────────────────────────────────────────────────
// Cache invalidation helper
// ─────────────────────────────────────────────────────────────

function invalidatePageLayoutCache(
  ctx: {
    env: { CACHE_KV?: KVNamespace };
    executionCtx: { waitUntil(promise: Promise<unknown>): void };
  },
  orgId: string
): void {
  if (ctx.env.CACHE_KV) {
    const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
    ctx.executionCtx.waitUntil(cache.invalidate(orgId));
  }
}

export default app;
```

### Public Endpoint Addition to `routes/organizations.ts`

The public page layout endpoint needs to be added to the existing organizations route file (alongside `getPublicInfo`), since it's unauthenticated:

```typescript
// Add to workers/organization-api/src/routes/organizations.ts

// GET /api/organizations/public/:slug/pages/:pageSlug
app.get(
  '/public/:slug/pages/:pageSlug',
  procedure({
    policy: { auth: 'none', rateLimit: 'public' },
    input: {
      params: z.object({
        slug: z.string().min(1).max(255),
        pageSlug: z.string().min(1).max(100),
      }),
    },
    handler: async (ctx) => {
      // Resolve org from slug
      const org = await ctx.services.organization.getBySlug(
        ctx.input.params.slug
      );
      if (!org) return null;

      // Create page layout service scoped to this org
      // (Note: This requires creating PageLayoutService inline since
      // service registry needs orgId which comes from the public slug)
      const { PageLayoutService } = await import('@codex/page-layout');
      const pageLayoutService = new PageLayoutService({
        db: ctx.services.organization['db'], // Access shared DB
        environment: ctx.env.ENVIRONMENT ?? 'development',
        organizationId: org.id,
      });

      return await pageLayoutService.getPublished(ctx.input.params.pageSlug);
    },
  })
);
```

### Modified: `workers/organization-api/src/index.ts`

```typescript
// Add import
import pageRoutes from './routes/pages';

// Add route mount (alongside existing routes)
app.route('/api/organizations/:id/pages', pageRoutes);
```

---

## 7. Cache Integration

### Pattern

Follows the exact `BRAND_KV` caching pattern — the published layout JSON is cached in `CACHE_KV` with version-based invalidation.

**Read path** (visitor request):
1. Server load calls `getPublicPageLayout(orgSlug, pageSlug)`
2. Remote function checks `CACHE_KV` for `page:{orgId}:{slug}` via VersionedCache
3. On hit: return cached layout (sub-millisecond)
4. On miss: fetch from API → cache for next request

**Write path** (admin publishes):
1. API handler calls `pageLayoutService.publish()`
2. After success: `cache.invalidate(orgId)` bumps version
3. Next visitor request triggers fresh fetch + cache

### Frontend Cache Integration

In the server load function (`+page.server.ts`), the layout fetch uses `depends('cache:page-layout')` for SvelteKit invalidation, same as the org layout uses `depends('cache:org-versions')`.

```typescript
// In +page.server.ts
depends('cache:page-layout');

// On visibility change (in org layout, already exists):
// invalidate('cache:page-layout') triggers re-fetch
```

---

## 8. Constants Changes

### Modified: `packages/constants/src/limits.ts`

```typescript
// Add to CACHE_TTL:
export const CACHE_TTL = {
  BRAND_CACHE_SECONDS: 604800,
  BRAND_CACHE_REFRESH_MS: 86400000,
  PAGE_LAYOUT_CACHE_SECONDS: 3600,  // 1 hour (layouts change more often than brands)
} as const;
```

### Modified: `packages/cache/src/cache-keys.ts`

```typescript
// Add to CacheType:
export const CacheType = {
  // ... existing types ...
  PAGE_LAYOUT: 'page:layout',
  COLLECTION_PAGE_LAYOUTS: (orgId: string) => `org:${orgId}:pages`,
};
```

---

## 9. Service Registry Changes

### Modified: `packages/worker-utils/src/procedure/service-registry.ts`

Add `pageLayout` getter following the exact pattern of the `settings` getter:

```typescript
// Add import at top
import { PageLayoutService } from '@codex/page-layout';

// Add to ServiceRegistry interface
interface ServiceRegistry {
  // ... existing services ...
  pageLayout: PageLayoutService;
}

// Add getter inside createServiceRegistry function
let _pageLayout: PageLayoutService | undefined;

const registry: ServiceRegistry = {
  // ... existing getters ...

  get pageLayout() {
    if (!_pageLayout) {
      if (!organizationId) {
        throw new Error(
          'organizationId required for pageLayout service. ' +
          'Use policy.requireOrgMembership or extract from request params.'
        );
      }
      _pageLayout = new PageLayoutService({
        db: getSharedDb(),
        environment: getEnvironment(),
        organizationId,
      });
    }
    return _pageLayout;
  },
};
```

---

## 10. Frontend — Types & Section Registry

### New File: `apps/web/src/lib/page-builder/types.ts`

```typescript
import type {
  PageSection,
  PageLayoutConfig,
  SectionType,
  SectionStyles,
  SectionBackground,
  ContainerWidth,
  PaddingY,
} from '@codex/shared-types';
import type { Component } from 'svelte';

// Re-export shared types for convenience
export type {
  PageSection,
  PageLayoutConfig,
  SectionType,
  SectionStyles,
  SectionBackground,
  ContainerWidth,
  PaddingY,
};

/** Props that every section component receives */
export interface SectionComponentProps {
  data: Record<string, unknown>;
  variant?: string;
  /** Pre-fetched data from server load (content items, creators, etc.) */
  serverData?: unknown;
}

/** Metadata about a section type (for the editor UI) */
export interface SectionSchema {
  type: SectionType;
  label: string;
  description: string;
  icon: string;
  variants: { id: string; label: string; description: string }[];
  defaultData: Record<string, unknown>;
  /** Field definitions for the settings panel */
  fields: SectionField[];
  /** Whether this section needs server-side data fetching */
  needsServerData: boolean;
}

export interface SectionField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'toggle' | 'color' | 'url' | 'array';
  options?: { value: string; label: string }[];
  default?: unknown;
  min?: number;
  max?: number;
  placeholder?: string;
}

/** Registry entry mapping type string to Svelte component */
export type SectionRegistry = Record<SectionType, Component<SectionComponentProps>>;
```

### New File: `apps/web/src/lib/page-builder/registry.ts`

Static import registry — all components loaded at build time. Follows the Svelte 5 pattern from the investigation: no dynamic imports, no async, SSR-safe on Workers.

```typescript
import type { SectionRegistry } from './types';

// Static imports — Vite tree-shakes at build time
import Hero from '$lib/components/sections/Hero.svelte';
import ContentGrid from '$lib/components/sections/ContentGrid.svelte';
import ContentCarousel from '$lib/components/sections/ContentCarousel.svelte';
import CreatorSpotlight from '$lib/components/sections/CreatorSpotlight.svelte';
import TextBlock from '$lib/components/sections/TextBlock.svelte';
import CtaBanner from '$lib/components/sections/CtaBanner.svelte';
import Categories from '$lib/components/sections/Categories.svelte';
import Faq from '$lib/components/sections/Faq.svelte';
import Testimonials from '$lib/components/sections/Testimonials.svelte';
import Spacer from '$lib/components/sections/Spacer.svelte';

export const sectionRegistry: SectionRegistry = {
  hero: Hero,
  content_grid: ContentGrid,
  content_carousel: ContentCarousel,
  creator_spotlight: CreatorSpotlight,
  text_block: TextBlock,
  cta_banner: CtaBanner,
  categories: Categories,
  faq: Faq,
  testimonials: Testimonials,
  spacer: Spacer,
};
```

### New File: `apps/web/src/lib/page-builder/section-schemas.ts`

Metadata for the editor UI — what fields each section type exposes.

```typescript
import type { SectionSchema } from './types';

export const sectionSchemas: SectionSchema[] = [
  {
    type: 'hero',
    label: 'Hero Banner',
    description: 'Full-width introduction with heading, description, and CTA',
    icon: 'layout',
    variants: [
      { id: 'centered', label: 'Centered', description: 'Content stacked centrally' },
      { id: 'split', label: 'Split', description: 'Text left, visual right' },
      { id: 'minimal', label: 'Minimal', description: 'Clean heading only' },
    ],
    defaultData: {
      useOrgName: true,
      useOrgDescription: true,
      heading: '',
      subheading: '',
      ctaText: 'Explore Content',
      ctaLink: '/explore',
    },
    fields: [
      { key: 'useOrgName', label: 'Use org name as heading', type: 'toggle', default: true },
      { key: 'heading', label: 'Custom heading', type: 'text', placeholder: 'Override org name...' },
      { key: 'useOrgDescription', label: 'Use org description', type: 'toggle', default: true },
      { key: 'subheading', label: 'Custom subheading', type: 'textarea', placeholder: 'Override...' },
      { key: 'ctaText', label: 'Button text', type: 'text', default: 'Explore Content' },
      { key: 'ctaLink', label: 'Button link', type: 'url', default: '/explore' },
    ],
    needsServerData: false,
  },
  {
    type: 'content_grid',
    label: 'Content Grid',
    description: 'Display content items in a responsive grid',
    icon: 'grid',
    variants: [
      { id: 'default', label: 'Standard', description: 'Equal-sized cards' },
      { id: 'featured', label: 'Featured', description: 'First item larger' },
    ],
    defaultData: {
      title: 'Featured Content',
      source: 'newest',
      limit: 6,
      columns: 3,
      showPrice: true,
      showCreator: true,
    },
    fields: [
      { key: 'title', label: 'Section title', type: 'text', default: 'Featured Content' },
      {
        key: 'source', label: 'Content source', type: 'select',
        options: [
          { value: 'newest', label: 'Newest' },
          { value: 'oldest', label: 'Oldest' },
          { value: 'title', label: 'Alphabetical' },
        ],
      },
      { key: 'limit', label: 'Items to show', type: 'number', min: 1, max: 12, default: 6 },
      {
        key: 'columns', label: 'Columns', type: 'select',
        options: [
          { value: '2', label: '2 columns' },
          { value: '3', label: '3 columns' },
          { value: '4', label: '4 columns' },
        ],
      },
      { key: 'showPrice', label: 'Show price badges', type: 'toggle', default: true },
      { key: 'showCreator', label: 'Show creator info', type: 'toggle', default: true },
    ],
    needsServerData: true,
  },
  {
    type: 'content_carousel',
    label: 'Content Carousel',
    description: 'Horizontal scrollable content row',
    icon: 'rows',
    variants: [
      { id: 'default', label: 'Standard', description: 'Scrollable row with arrows' },
    ],
    defaultData: {
      title: 'New Releases',
      source: 'newest',
      limit: 8,
      showPrice: true,
    },
    fields: [
      { key: 'title', label: 'Section title', type: 'text', default: 'New Releases' },
      {
        key: 'source', label: 'Content source', type: 'select',
        options: [
          { value: 'newest', label: 'Newest' },
          { value: 'oldest', label: 'Oldest' },
          { value: 'title', label: 'Alphabetical' },
        ],
      },
      { key: 'limit', label: 'Items to show', type: 'number', min: 3, max: 20, default: 8 },
      { key: 'showPrice', label: 'Show price badges', type: 'toggle', default: true },
    ],
    needsServerData: true,
  },
  {
    type: 'creator_spotlight',
    label: 'Creator Spotlight',
    description: 'Showcase the people behind the content',
    icon: 'users',
    variants: [
      { id: 'cards', label: 'Cards', description: 'Profile cards with avatar and bio' },
      { id: 'avatars', label: 'Avatar Row', description: 'Compact circular avatars' },
    ],
    defaultData: {
      title: 'Meet Our Creators',
      limit: 3,
    },
    fields: [
      { key: 'title', label: 'Section title', type: 'text', default: 'Meet Our Creators' },
      { key: 'limit', label: 'Creators to show', type: 'number', min: 1, max: 6, default: 3 },
    ],
    needsServerData: true,
  },
  {
    type: 'text_block',
    label: 'Text Section',
    description: 'Rich text content area',
    icon: 'type',
    variants: [
      { id: 'default', label: 'Standard', description: 'Centered text block' },
      { id: 'wide', label: 'Wide', description: 'Full-width text' },
    ],
    defaultData: {
      heading: '',
      body: '',
      alignment: 'center',
    },
    fields: [
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'body', label: 'Body text', type: 'textarea' },
      {
        key: 'alignment', label: 'Alignment', type: 'select',
        options: [
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Centre' },
          { value: 'right', label: 'Right' },
        ],
      },
    ],
    needsServerData: false,
  },
  {
    type: 'cta_banner',
    label: 'Call to Action',
    description: 'Prominent banner with button',
    icon: 'megaphone',
    variants: [
      { id: 'default', label: 'Standard', description: 'Centred with brand background' },
      { id: 'split', label: 'Split', description: 'Text left, button right' },
    ],
    defaultData: {
      heading: 'Ready to get started?',
      subheading: '',
      buttonText: 'Sign Up',
      buttonLink: '/register',
    },
    fields: [
      { key: 'heading', label: 'Heading', type: 'text', default: 'Ready to get started?' },
      { key: 'subheading', label: 'Subheading', type: 'text' },
      { key: 'buttonText', label: 'Button text', type: 'text', default: 'Sign Up' },
      { key: 'buttonLink', label: 'Button link', type: 'url', default: '/register' },
    ],
    needsServerData: false,
  },
  {
    type: 'categories',
    label: 'Categories',
    description: 'Browse content by category',
    icon: 'tag',
    variants: [
      { id: 'pills', label: 'Pills', description: 'Horizontal scrollable chips' },
      { id: 'cards', label: 'Cards', description: 'Grid of category cards' },
    ],
    defaultData: {
      title: 'Browse by Topic',
      showCounts: true,
    },
    fields: [
      { key: 'title', label: 'Section title', type: 'text', default: 'Browse by Topic' },
      { key: 'showCounts', label: 'Show content counts', type: 'toggle', default: true },
    ],
    needsServerData: true,
  },
  {
    type: 'faq',
    label: 'FAQ',
    description: 'Expandable question and answer pairs',
    icon: 'help-circle',
    variants: [
      { id: 'default', label: 'Accordion', description: 'Expandable items' },
    ],
    defaultData: {
      title: 'Frequently Asked Questions',
      items: [
        { question: 'What is included?', answer: 'Describe your offering...' },
      ],
    },
    fields: [
      { key: 'title', label: 'Section title', type: 'text', default: 'FAQ' },
      { key: 'items', label: 'Questions', type: 'array' },
    ],
    needsServerData: false,
  },
  {
    type: 'testimonials',
    label: 'Testimonials',
    description: 'Customer quotes and social proof',
    icon: 'quote',
    variants: [
      { id: 'default', label: 'Cards', description: 'Quote cards in a grid' },
      { id: 'carousel', label: 'Carousel', description: 'Rotating quotes' },
    ],
    defaultData: {
      title: 'What People Say',
      items: [
        { quote: 'Amazing content!', author: 'Jane D.', role: 'Student' },
      ],
    },
    fields: [
      { key: 'title', label: 'Section title', type: 'text', default: 'What People Say' },
      { key: 'items', label: 'Testimonials', type: 'array' },
    ],
    needsServerData: false,
  },
  {
    type: 'spacer',
    label: 'Spacer',
    description: 'Visual breathing room between sections',
    icon: 'minus',
    variants: [],
    defaultData: {
      height: 'md',
    },
    fields: [
      {
        key: 'height', label: 'Height', type: 'select',
        options: [
          { value: 'sm', label: 'Small' },
          { value: 'md', label: 'Medium' },
          { value: 'lg', label: 'Large' },
          { value: 'xl', label: 'Extra Large' },
        ],
      },
    ],
    needsServerData: false,
  },
];

/** Get schema for a section type */
export function getSectionSchema(type: string): SectionSchema | undefined {
  return sectionSchemas.find((s) => s.type === type);
}
```

### New File: `apps/web/src/lib/page-builder/defaults.ts`

```typescript
import type { PageLayoutConfig } from './types';
import { DEFAULT_HOME_LAYOUT } from '@codex/validation';

/**
 * Returns the default layout for a page slug.
 * Used when no page_layouts record exists for this org.
 */
export function getDefaultLayout(pageSlug: string): PageLayoutConfig {
  if (pageSlug === 'home') {
    return DEFAULT_HOME_LAYOUT;
  }

  // Other pages get a minimal default
  return {
    sections: [
      {
        id: 'default-text',
        type: 'text_block',
        order: 0,
        data: {
          heading: 'New Page',
          body: 'Start adding sections to build your page.',
          alignment: 'center',
        },
      },
    ],
  };
}
```

---

## 11. Frontend — Section Components

Each section component follows the ContentCard.svelte pattern: typed `Props` interface, `$props()`, scoped `<style>`, design tokens only.

### Example: `apps/web/src/lib/components/sections/Hero.svelte`

Extracted from the current `+page.svelte` hero section.

```svelte
<script lang="ts">
  import type { SectionComponentProps } from '$lib/page-builder/types';
  import type { OrganizationData } from '$lib/types';
  import { page } from '$app/state';

  interface Props extends SectionComponentProps {
    /** Org data passed from layout for useOrgName/useOrgDescription */
    org?: OrganizationData;
  }

  let { data, variant = 'centered', org }: Props = $props();

  const heading = $derived(
    data.useOrgName && org?.name ? org.name : (data.heading as string) || ''
  );
  const subheading = $derived(
    data.useOrgDescription && org?.description
      ? org.description
      : (data.subheading as string) || ''
  );
  const ctaText = $derived((data.ctaText as string) || 'Explore Content');
  const ctaLink = $derived((data.ctaLink as string) || '/explore');
  const logoUrl = $derived(org?.logoUrl);
</script>

{#if variant === 'split'}
  <div class="hero hero--split">
    <div class="hero__text">
      {#if logoUrl}
        <img src={logoUrl} alt="" class="hero__logo" />
      {/if}
      <h1 class="hero__title">{heading}</h1>
      {#if subheading}
        <p class="hero__description">{subheading}</p>
      {/if}
      <a href={ctaLink} class="hero__cta">{ctaText}</a>
    </div>
    <div class="hero__visual">
      <!-- Gradient or image placeholder -->
    </div>
  </div>
{:else if variant === 'minimal'}
  <div class="hero hero--minimal">
    <h1 class="hero__title">{heading}</h1>
    {#if subheading}
      <p class="hero__description">{subheading}</p>
    {/if}
    <a href={ctaLink} class="hero__cta">{ctaText}</a>
  </div>
{:else}
  <!-- Default: centered -->
  <div class="hero hero--centered">
    <div class="hero__inner">
      {#if logoUrl}
        <img src={logoUrl} alt="" class="hero__logo" />
      {/if}
      <h1 class="hero__title">{heading}</h1>
      {#if subheading}
        <p class="hero__description">{subheading}</p>
      {/if}
      <a href={ctaLink} class="hero__cta">{ctaText}</a>
    </div>
  </div>
{/if}

<style>
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--space-16) var(--space-4);
    background: linear-gradient(
      135deg,
      var(--color-brand-primary) 0%,
      var(--color-brand-primary-hover) 100%
    );
    color: var(--color-text-on-brand);
    position: relative;
    overflow: hidden;
  }

  .hero__inner {
    max-width: 720px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    z-index: 1;
  }

  .hero__logo {
    width: var(--space-20);
    height: var(--space-20);
    border-radius: var(--radius-full);
    object-fit: cover;
    border: 3px solid var(--color-text-on-brand);
  }

  .hero__title {
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    line-height: var(--leading-tight);
  }

  .hero__description {
    font-size: var(--text-lg);
    opacity: 0.9;
    max-width: 560px;
  }

  .hero__cta {
    display: inline-flex;
    padding: var(--space-3) var(--space-6);
    background: var(--color-text-on-brand);
    color: var(--color-brand-primary);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-lg);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .hero__cta:hover {
    opacity: 0.9;
  }

  /* Split variant */
  .hero--split {
    flex-direction: row;
    text-align: left;
    padding: var(--space-12) var(--space-8);
    gap: var(--space-8);
  }

  .hero--split .hero__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
  }

  .hero--split .hero__visual {
    flex: 1;
    min-height: 300px;
    border-radius: var(--radius-xl);
    background: var(--color-brand-primary-subtle);
  }

  /* Minimal variant */
  .hero--minimal {
    padding: var(--space-12) var(--space-4);
    background: transparent;
    color: var(--color-text);
  }

  .hero--minimal .hero__title {
    font-size: var(--text-3xl);
  }

  .hero--minimal .hero__cta {
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
  }

  @media (max-width: 768px) {
    .hero--split {
      flex-direction: column;
      text-align: center;
    }

    .hero--split .hero__text {
      align-items: center;
    }
  }
</style>
```

### Other Section Components (Summary)

Each follows the same pattern. Here's what each renders:

| Component | Renders | Server Data |
|-----------|---------|-------------|
| `ContentGrid.svelte` | Grid of ContentCard components, title, "View All" link | Content items from API |
| `ContentCarousel.svelte` | Horizontal scrollable row with arrow navigation | Content items from API |
| `CreatorSpotlight.svelte` | Creator avatars, names, roles, content counts | Creator list from API |
| `TextBlock.svelte` | Heading + body text with alignment | None (static) |
| `CtaBanner.svelte` | Branded banner with heading + CTA button | None (static) |
| `Categories.svelte` | Horizontal pill chips or category cards | Category list from API |
| `Faq.svelte` | Accordion with expandable Q&A pairs | None (static, data in config) |
| `Testimonials.svelte` | Quote cards or rotating carousel | None (static, data in config) |
| `Spacer.svelte` | Empty div with configurable height | None |

---

## 12. Frontend — Page Renderer

### New File: `apps/web/src/lib/components/page-builder/PageRenderer.svelte`

The core component that iterates sections and resolves components.

```svelte
<script lang="ts">
  import { sectionRegistry } from '$lib/page-builder/registry';
  import SectionWrapper from './SectionWrapper.svelte';
  import type { PageLayoutConfig, SectionComponentProps } from '$lib/page-builder/types';
  import type { OrganizationData } from '$lib/types';

  interface Props {
    layout: PageLayoutConfig;
    sectionData: Record<string, unknown>;
    org?: OrganizationData;
  }

  let { layout, sectionData, org }: Props = $props();
</script>

{#each layout.sections as section (section.id)}
  {@const Component = sectionRegistry[section.type]}
  {#if Component}
    <SectionWrapper {section}>
      <Component
        data={section.data}
        variant={section.variant}
        serverData={sectionData[section.id]}
        {org}
      />
    </SectionWrapper>
  {/if}
{/each}
```

### New File: `apps/web/src/lib/components/page-builder/SectionWrapper.svelte`

CSS variable scoping per section.

```svelte
<script lang="ts">
  import type { PageSection } from '$lib/page-builder/types';
  import type { Snippet } from 'svelte';

  interface Props {
    section: PageSection;
    children: Snippet;
  }

  let { section, children }: Props = $props();

  const BACKGROUND_MAP: Record<string, string> = {
    surface: 'var(--color-surface)',
    muted: 'var(--color-surface-muted)',
    brand: 'var(--color-brand-primary)',
    accent: 'var(--color-brand-accent)',
    dark: 'var(--color-surface-inverse)',
  };

  const styleString = $derived(buildStyles());

  function buildStyles(): string {
    const parts: string[] = [];

    // Background preset → CSS variable
    const bg = section.styles?.background;
    if (bg && bg !== 'transparent' && bg !== 'custom') {
      const bgValue = BACKGROUND_MAP[bg];
      if (bgValue) parts.push(`--section-bg: ${bgValue}`);
    }

    // Custom CSS variables
    if (section.styles?.cssVariables) {
      for (const [key, value] of Object.entries(section.styles.cssVariables)) {
        parts.push(`${key}: ${value}`);
      }
    }

    return parts.join('; ');
  }
</script>

<section
  class="page-section"
  class:narrow={section.styles?.containerWidth === 'narrow'}
  class:full={section.styles?.containerWidth === 'full'}
  class:pad-none={section.styles?.paddingY === 'none'}
  class:pad-sm={section.styles?.paddingY === 'sm'}
  class:pad-md={section.styles?.paddingY === 'md'}
  class:pad-lg={section.styles?.paddingY === 'lg'}
  class:pad-xl={section.styles?.paddingY === 'xl'}
  class:bg-surface={section.styles?.background === 'surface'}
  class:bg-muted={section.styles?.background === 'muted'}
  class:bg-brand={section.styles?.background === 'brand'}
  class:bg-accent={section.styles?.background === 'accent'}
  class:bg-dark={section.styles?.background === 'dark'}
  data-section-id={section.id}
  data-section-type={section.type}
  style={styleString || undefined}
>
  {@render children()}
</section>

<style>
  .page-section {
    width: 100%;
    padding-block: var(--space-8);
  }

  /* Container widths */
  .narrow { max-width: 720px; margin-inline: auto; }
  .full { max-width: none; }

  /* Default (wide) */
  .page-section:not(.narrow):not(.full) {
    max-width: 1200px;
    margin-inline: auto;
    padding-inline: var(--space-4);
  }

  /* Padding presets */
  .pad-none { padding-block: 0; }
  .pad-sm { padding-block: var(--space-4); }
  .pad-md { padding-block: var(--space-8); }
  .pad-lg { padding-block: var(--space-12); }
  .pad-xl { padding-block: var(--space-16); }

  /* Background presets */
  .bg-surface { background: var(--color-surface); }
  .bg-muted { background: var(--color-surface-muted); }
  .bg-brand {
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
  }
  .bg-accent {
    background: var(--color-brand-accent);
    color: var(--color-text-on-brand);
  }
  .bg-dark {
    background: var(--color-surface-inverse);
    color: var(--color-text-inverse);
  }
</style>
```

---

## 13. Frontend — Modified Server Loads

### Modified: `apps/web/src/routes/_org/[slug]/(space)/+page.server.ts`

Replaces the current hardcoded featured content fetch with layout-driven data fetching.

```typescript
import type { PageServerLoad } from './$types';
import { CACHE_HEADERS } from '$lib/server/cache-headers';
import { getPublicContent } from '$lib/remote/content.remote';
import { getPublicPageLayout } from '$lib/remote/pages.remote';
import { getDefaultLayout } from '$lib/page-builder/defaults';
import type { PageLayoutConfig, PageSection } from '$lib/page-builder/types';

export const load: PageServerLoad = async ({ setHeaders, parent, depends }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);
  depends('cache:page-layout');

  const { org } = await parent();

  // 1. Fetch published layout (or use default)
  let layout: PageLayoutConfig;
  try {
    const published = await getPublicPageLayout({
      slug: org.slug,
      pageSlug: 'home',
    });
    layout = published?.layout ?? getDefaultLayout('home');
  } catch {
    layout = getDefaultLayout('home');
  }

  // 2. Fetch data for data-driven sections (parallel)
  const sectionData = await fetchSectionData(layout.sections, org.id);

  return { layout, sectionData };
};

/**
 * Fetch server-side data for sections that need it.
 * Each section type declares what data it needs.
 */
async function fetchSectionData(
  sections: PageSection[],
  orgId: string
): Promise<Record<string, unknown>> {
  const fetches: [string, Promise<unknown>][] = [];

  for (const section of sections) {
    if (section.type === 'content_grid' || section.type === 'content_carousel') {
      fetches.push([
        section.id,
        getPublicContent({
          orgId,
          sort: (section.data.source as string) || 'newest',
          limit: (section.data.limit as number) || 6,
        }),
      ]);
    }

    // Creator spotlight, categories etc. can be added here
    // as their API endpoints become available
  }

  const results = await Promise.all(
    fetches.map(async ([id, promise]) => {
      try {
        const data = await promise;
        return [id, data] as const;
      } catch {
        return [id, null] as const;
      }
    })
  );

  return Object.fromEntries(results);
}
```

### Modified: `apps/web/src/routes/_org/[slug]/(space)/+page.svelte`

Replaces hardcoded hero + grid with PageRenderer.

```svelte
<script lang="ts">
  import PageRenderer from '$lib/components/page-builder/PageRenderer.svelte';
  import { hydrateIfNeeded } from '$lib/collections/hydration';
  import { page } from '$app/state';
  import { onMount } from 'svelte';

  let { data } = $props();

  // Hydrate content items from section data into TanStack DB collections
  onMount(() => {
    for (const [, sectionData] of Object.entries(data.sectionData)) {
      if (sectionData && typeof sectionData === 'object' && 'items' in sectionData) {
        hydrateIfNeeded('content', sectionData);
      }
    }
  });
</script>

<svelte:head>
  <title>{data.org?.name ?? 'Organization'}</title>
  <meta
    name="description"
    content={data.org?.description ?? 'Welcome to our content platform'}
  />
</svelte:head>

<PageRenderer
  layout={data.layout}
  sectionData={data.sectionData}
  org={data.org}
/>
```

---

## 14. Frontend — Studio Pages Editor

### Route Structure

```
studio/pages/
├── +layout.svelte         — Role gate (admin/owner)
├── +layout.server.ts      — Auth check
├── +page.svelte           — Page list view
├── +page.server.ts        — Fetch pages
└── [pageSlug]/
    ├── +page.svelte       — Page editor
    └── +page.server.ts    — Fetch single page layout
```

### `studio/pages/+layout.server.ts`

Follows `studio/settings/+layout.server.ts` — admin/owner role gate.

```typescript
import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ parent }) => {
  const { org, userRole } = await parent();

  if (userRole !== 'admin' && userRole !== 'owner') {
    redirect(302, '/studio');
  }

  return { orgId: org.id };
};
```

### `studio/pages/+page.server.ts`

```typescript
import type { PageServerLoad } from './$types';
import { getPageLayouts } from '$lib/remote/pages.remote';

export const load: PageServerLoad = async ({ parent }) => {
  const { org } = await parent();
  const pages = await getPageLayouts(org.id);
  return { pages };
};
```

### `studio/pages/[pageSlug]/+page.server.ts`

```typescript
import type { PageServerLoad } from './$types';
import { getPageLayoutBySlug } from '$lib/remote/pages.remote';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ parent, params }) => {
  const { org } = await parent();

  const pageLayout = await getPageLayoutBySlug(org.id, params.pageSlug);
  if (!pageLayout) error(404, 'Page not found');

  return { pageLayout };
};
```

### Editor Component: `PageEditor.svelte`

Follows the brand editor panel pattern — floating panel, section list, settings, live preview via iframe or same-page rendering.

The editor stores state in a Svelte 5 runes-based store (`page-editor-store.svelte.ts`) following the exact pattern of `brand-editor-store.svelte.ts`:
- `$state()` for pending/saved layout
- `$derived()` for isDirty
- `$effect()` for sessionStorage persistence
- Actions: addSection, removeSection, reorderSection, updateSectionData, updateSectionStyles

The settings panel renders dynamically based on `sectionSchemas` — each section type's `fields` array drives the form inputs.

---

## 15. Frontend — Remote Functions

### New File: `apps/web/src/lib/remote/pages.remote.ts`

Follows `branding.remote.ts` — query, command patterns.

```typescript
import { query, command, getRequestEvent } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { z } from 'zod';
import type {
  PageLayoutResponse,
  PageLayoutSummaryResponse,
  PublishedPageLayoutResponse,
} from '@codex/shared-types';

// ─────────────────────────────────────────────────────────────
// QUERIES (cached reads)
// ─────────────────────────────────────────────────────────────

/** List all page layouts for an org (studio) */
export const getPageLayouts = query(
  z.string().uuid(),
  async (orgId): Promise<PageLayoutSummaryResponse[]> => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const result = await api.pages.list(orgId);
    return result?.items ?? [];
  }
);

/** Get a single page layout by slug (studio editor) */
export const getPageLayoutBySlug = query(
  z.object({ orgId: z.string().uuid(), slug: z.string() }),
  async ({ orgId, slug }): Promise<PageLayoutResponse | null> => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      return await api.pages.getBySlug(orgId, slug);
    } catch {
      return null;
    }
  }
);

/** Get published layout (public, for visitor-facing page) */
export const getPublicPageLayout = query(
  z.object({ slug: z.string(), pageSlug: z.string() }),
  async ({ slug, pageSlug }): Promise<PublishedPageLayoutResponse | null> => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      return await api.pages.getPublished(slug, pageSlug);
    } catch {
      return null;
    }
  }
);

// ─────────────────────────────────────────────────────────────
// COMMANDS (mutations)
// ─────────────────────────────────────────────────────────────

/** Create a new page layout */
export const createPageLayoutCommand = command(
  z.object({
    orgId: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    layout: z.unknown(),
    templateId: z.string().uuid().optional(),
  }),
  async ({ orgId, slug, title, layout, templateId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return await api.pages.create(orgId, { slug, title, layout, templateId });
  }
);

/** Update page layout draft */
export const updatePageLayoutCommand = command(
  z.object({
    orgId: z.string().uuid(),
    pageId: z.string().uuid(),
    title: z.string().optional(),
    layout: z.unknown().optional(),
  }),
  async ({ orgId, pageId, title, layout }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return await api.pages.update(orgId, pageId, { title, layout });
  }
);

/** Publish page layout */
export const publishPageLayoutCommand = command(
  z.object({
    orgId: z.string().uuid(),
    pageId: z.string().uuid(),
    changeSummary: z.string().optional(),
  }),
  async ({ orgId, pageId, changeSummary }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return await api.pages.publish(orgId, pageId, { changeSummary });
  }
);

/** Delete page layout */
export const deletePageLayoutCommand = command(
  z.object({
    orgId: z.string().uuid(),
    pageId: z.string().uuid(),
  }),
  async ({ orgId, pageId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return await api.pages.delete(orgId, pageId);
  }
);
```

### API Client Addition

The `createServerApi` function in `apps/web/src/lib/server/api.ts` needs a new `pages` namespace:

```typescript
// Add to createServerApi return object:
pages: {
  list: (orgId: string) =>
    request<{ items: PageLayoutSummaryResponse[]; pagination: PaginationMetadata }>(
      'organization', `/api/organizations/${orgId}/pages`
    ),
  get: (orgId: string, pageId: string) =>
    request<PageLayoutResponse>(
      'organization', `/api/organizations/${orgId}/pages/${pageId}`
    ),
  getBySlug: (orgId: string, slug: string) =>
    request<PageLayoutResponse>(
      'organization', `/api/organizations/${orgId}/pages/by-slug/${slug}`
    ),
  getPublished: (orgSlug: string, pageSlug: string) =>
    request<PublishedPageLayoutResponse>(
      'organization', `/api/organizations/public/${orgSlug}/pages/${pageSlug}`
    ),
  create: (orgId: string, body: CreatePageLayoutInput) =>
    request<PageLayoutResponse>(
      'organization', `/api/organizations/${orgId}/pages`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  update: (orgId: string, pageId: string, body: UpdatePageLayoutInput) =>
    request<PageLayoutResponse>(
      'organization', `/api/organizations/${orgId}/pages/${pageId}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),
  publish: (orgId: string, pageId: string, body: PublishPageLayoutInput) =>
    request<PageLayoutResponse>(
      'organization', `/api/organizations/${orgId}/pages/${pageId}/publish`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  delete: (orgId: string, pageId: string) =>
    request<void>(
      'organization', `/api/organizations/${orgId}/pages/${pageId}`,
      { method: 'DELETE' }
    ),
},
```

---

## 16. Frontend — Navigation Changes

### Modified: `apps/web/src/lib/config/navigation.ts`

Add "Pages" to the studio admin sidebar links:

```typescript
// Add to SIDEBAR_ADMIN_LINKS array (between Content and Analytics, or wherever appropriate):
{ href: '/studio/pages', label: 'Pages', icon: 'layout' },
```

This ensures only admin/owner roles see the Pages link, matching the role gate on the route.

---

## 17. Testing Strategy

### Service Tests: `packages/page-layout/src/__tests__/page-layout-service.test.ts`

Follows `packages/organization/src/services/__tests__/organization-service.test.ts`:

```typescript
import { setupTestDatabase, teardownTestDatabase, seedTestUsers } from '@codex/test-utils';
import { PageLayoutService } from '../services/page-layout-service';
import { PageLayoutNotFoundError, PageLayoutSlugConflictError } from '../errors';
import { DEFAULT_HOME_LAYOUT } from '@codex/validation';

describe('PageLayoutService', () => {
  let db: Database;
  let testUserId: string;
  let testOrgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    [testUserId] = await seedTestUsers(db, 1);
    // Create test org (needed for foreign key)
    testOrgId = await createTestOrg(db, testUserId);
  });

  afterAll(async () => {
    await teardownTestDatabase(db);
  });

  function createService() {
    return new PageLayoutService({
      db,
      environment: 'test',
      organizationId: testOrgId,
    });
  }

  describe('create', () => {
    it('should create a page layout', async () => {
      const service = createService();
      const result = await service.create(
        { slug: 'home', title: 'Home', layout: DEFAULT_HOME_LAYOUT },
        testUserId
      );
      expect(result.id).toBeDefined();
      expect(result.slug).toBe('home');
      expect(result.status).toBe('draft');
      expect(result.layout.sections).toHaveLength(2);
    });

    it('should reject duplicate slug', async () => {
      const service = createService();
      await expect(
        service.create(
          { slug: 'home', title: 'Home 2', layout: DEFAULT_HOME_LAYOUT },
          testUserId
        )
      ).rejects.toThrow(PageLayoutSlugConflictError);
    });
  });

  describe('publish', () => {
    it('should snapshot layout to publishedLayout', async () => {
      const service = createService();
      const page = await service.create(
        { slug: 'about', title: 'About', layout: DEFAULT_HOME_LAYOUT },
        testUserId
      );

      const published = await service.publish(page.id, {}, testUserId);
      expect(published.status).toBe('published');
      expect(published.publishedLayout).toEqual(page.layout);
      expect(published.version).toBe(2);
    });
  });

  describe('getPublished', () => {
    it('should return null for unpublished pages', async () => {
      const service = createService();
      const result = await service.getPublished('nonexistent');
      expect(result).toBeNull();
    });
  });
});
```

### Worker Tests

Integration tests for the API endpoints following the existing worker test patterns.

### Frontend Tests

- Section components: Snapshot tests for each variant
- PageRenderer: Test that it correctly resolves and renders components from registry
- SectionWrapper: Test CSS class/style output

---

## 18. Migration & Rollout

### Phase 1: Foundation (Non-Breaking)

1. Run DB migration (new tables, no existing table changes)
2. Deploy `@codex/page-layout` package
3. Add service to service registry
4. Deploy worker with new routes
5. **Existing landing page continues to work unchanged** — no published layouts exist yet, so `getDefaultLayout('home')` returns the current structure

### Phase 2: Renderer Swap

1. Deploy section components
2. Swap `+page.svelte` to use PageRenderer
3. **Visually identical** — default layout produces the same hero + grid
4. No admin interaction needed

### Phase 3: Editor

1. Deploy studio pages routes
2. Add sidebar navigation link
3. Admins can now create, edit, publish page layouts
4. First publish replaces the default layout for that org

### Rollback Plan

At any phase, rolling back is safe:
- Phase 1: New tables are unused, can be dropped
- Phase 2: Revert `+page.svelte` to hardcoded version (one file change)
- Phase 3: Remove sidebar link (editor is unreachable, pages continue rendering from published layouts or defaults)
