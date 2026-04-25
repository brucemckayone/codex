/**
 * Denoise proof-test helpers and audit utilities.
 *
 * Imported by `__denoise_proofs__/iter-NNN/*.test.ts` files (proof helpers) and by
 * the SKILL.md cycle workflow (audit utilities). Each helper backs one row of the
 * Testability Creativity Catalogue in `.claude/skills/denoise/SKILL.md` §6 OR a
 * step in the cycle workflow.
 *
 * @example
 *   // In a proof test:
 *   import { jscpdBudget, findConsumers } from '~/scripts/denoise';
 *
 *   // In the cycle workflow:
 *   import { consumerGraph, hasConsumerChurn, extractApi } from '~/scripts/denoise';
 */

export type {
  ConsumerEntry,
  ConsumerGraphOptions,
  ConsumerGraphResult,
} from './consumer-graph.js';
// Cycle workflow helpers (used by §5.0 cell selection + §5 step 7 CLAUDE.md regen)
export { consumerGraph, hasConsumerChurn } from './consumer-graph.js';
export type {
  ExportEntry,
  ExtractApiOptions,
  ExtractApiResult,
} from './extract-api.js';
export { extractApi } from './extract-api.js';
export type { ConsumerHit, FindConsumersOptions } from './find-consumers.js';
export { findConsumers } from './find-consumers.js';
export type {
  JscpdBudgetOptions,
  JscpdBudgetResult,
  JscpdDuplicate,
} from './jscpd-budget.js';
// Proof-test helpers (used by simplification phase tests)
export { jscpdBudget } from './jscpd-budget.js';
