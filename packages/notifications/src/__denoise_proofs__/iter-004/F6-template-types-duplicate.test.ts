/**
 * Denoise iter-004 F6 — proof test for
 * `types:type-duplicate-cross-package` — `TemplateScope`, `TemplateStatus`,
 * `EmailCategory` declared in two packages with z.infer / drizzle-enum
 * inferred shapes.
 *
 * Finding:
 *   - packages/database/src/schema/notifications.ts:220-221
 *       export type TemplateScope = (typeof templateScopeEnum.enumValues)[number];
 *       export type TemplateStatus = (typeof templateStatusEnum.enumValues)[number];
 *
 *   - packages/validation/src/schemas/notifications.ts:9,12,390
 *       export type TemplateScope = z.infer<typeof templateScopeEnum>;
 *       export type TemplateStatus = z.infer<typeof templateStatusEnum>;
 *       export type EmailCategory = z.infer<typeof emailCategoryEnum>;
 *
 *   - packages/notifications/src/types.ts:135
 *       export type EmailCategory = 'transactional' | 'marketing' | 'digest';
 *
 * `EmailCategory` is declared THREE times in the codebase if you count
 * shared-types' indirect path (none currently — but adding one would land
 * a fourth). Two of these are public exports the consumer is meant to
 * import. The validation-package's z.infer and the notifications-package's
 * literal-union should produce equivalent types today, but the literal
 * union is fragile: if the Zod enum gains a value (`'urgent'`?), the
 * literal union does not see it.
 *
 * Same pattern for `TemplateScope` / `TemplateStatus` between
 * `@codex/database` (drizzle enum inference) and `@codex/validation`
 * (Zod enum inference). The Zod enum is the runtime-enforced shape; the
 * Drizzle enum is the schema definition. They MUST stay in sync, but
 * nothing in the build forces them to.
 *
 * Suggested fix: pick ONE source of truth (Zod schema in
 * `@codex/validation` is the natural choice — the API boundary
 * validates against it) and re-export from
 * `@codex/database` and `@codex/notifications`. The literal-union in
 * `notifications/types.ts` deletes; the database schema imports from
 * validation OR the validation schema imports from database.
 *
 * Rule (ref 02 §7 rows 4 + 5 / ref 07 §7 row 5): same name declared in
 * 2+ packages → consolidate to a single canonical declaration.
 *
 * Proof shape: type-equality assertion via `expectTypeOf` (Catalogue
 * row 3 — Type-equality test). Today the assertions pass (the values
 * match) but the test continues to anchor the equivalence after a
 * refactor that consolidates them.
 *
 * Severity: minor (no current runtime divergence; documentation /
 * source-of-truth concern).
 *
 * Remove the `.skip()` modifier in the same PR as the consolidation.
 */

import type {
  TemplateScope as DatabaseTemplateScope,
  TemplateStatus as DatabaseTemplateStatus,
} from '@codex/database/schema';
import type {
  EmailCategory as ValidationEmailCategory,
  TemplateScope as ValidationTemplateScope,
  TemplateStatus as ValidationTemplateStatus,
} from '@codex/validation';
import { describe, expectTypeOf, it } from 'vitest';
import type { EmailCategory as NotificationsEmailCategory } from '../types';

describe('denoise proof: F6 types:type-duplicate-cross-package — Template* / EmailCategory', () => {
  it.skip('TemplateScope MUST be the same type whether imported from @codex/database or @codex/validation', () => {
    // Today: equivalent shapes derived from two enum sources. Bug surfaces
    // if the two enums drift. After consolidation: both names point at
    // the same declaration site.
    expectTypeOf<DatabaseTemplateScope>().toEqualTypeOf<ValidationTemplateScope>();
  });

  it.skip('TemplateStatus MUST be the same type whether imported from @codex/database or @codex/validation', () => {
    expectTypeOf<DatabaseTemplateStatus>().toEqualTypeOf<ValidationTemplateStatus>();
  });

  it.skip('EmailCategory MUST be the same type whether imported from @codex/notifications or @codex/validation', () => {
    expectTypeOf<NotificationsEmailCategory>().toEqualTypeOf<ValidationEmailCategory>();
  });
});
