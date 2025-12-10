/**
 * Base Service Class
 *
 * Provides common functionality for all domain services:
 * - Database access with proper scoping
 * - Transaction management with error handling
 * - Service lifecycle (environment awareness)
 *
 * All domain services should extend this class to ensure:
 * - Consistent constructor patterns
 * - Unified transaction handling
 * - Proper error context wrapping
 * - Type-safe database operations
 */

import type { dbHttp, dbWs } from '@codex/database';
import { isServiceError, wrapError } from './base-errors';

/**
 * Database client type for services
 *
 * Supports both HTTP (production workers) and WebSocket (tests/transactions)
 * database clients from @codex/database.
 */
type ServiceDatabase = typeof dbHttp | typeof dbWs;

/**
 * Configuration required by all services
 * Ensures consistent initialization across the codebase
 */
export interface ServiceConfig {
  /** Database connection instance */
  db: ServiceDatabase;
  /** Runtime environment (development, staging, production, test) */
  environment: string;
}

/**
 * Base Service Abstract Class
 *
 * Provides a standard foundation for all domain services.
 * Services inherit database access, transaction handling, and error management.
 *
 * @example
 * ```typescript
 * export class ContentService extends BaseService {
 *   constructor(config: ServiceConfig) {
 *     super(config);
 *   }
 *
 *   async createContent(input: ContentInput) {
 *     return this.db.transaction(async (tx) => {
 *       // Use tx for database operations within transaction
 *       const item = await tx.insert(table).values(data).returning();
 *       return item;
 *     });
 *   }
 * }
 * ```
 */
export abstract class BaseService {
  /** Protected database connection - accessible to subclasses */
  protected readonly db: ServiceDatabase;

  /** Protected environment string - accessible to subclasses */
  protected readonly environment: string;

  /**
   * Initialize a service with configuration
   *
   * @param config Service configuration containing db and environment
   */
  constructor(config: ServiceConfig) {
    this.db = config.db;
    this.environment = config.environment;
  }

  /**
   * Handle unknown errors by wrapping them with service context
   *
   * - If error is already a ServiceError, re-throws it unchanged
   * - Otherwise, wraps it with service name and environment for debugging
   *
   * @param error Unknown error to handle
   * @param context Optional additional context (domain-specific info)
   * @throws ServiceError Always throws (never returns)
   *
   * @example
   * ```typescript
   * try {
   *   await query();
   * } catch (error) {
   *   this.handleError(error, { userId: '123', action: 'create' });
   * }
   * ```
   */
  protected handleError(error: unknown, context?: string): never {
    if (isServiceError(error)) {
      throw error;
    }
    throw wrapError(error, {
      service: this.constructor.name,
      environment: this.environment,
      ...(context && { context }),
    });
  }
}
