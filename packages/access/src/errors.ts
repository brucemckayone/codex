import { ServiceError } from '@codex/service-errors';

export class AccessDeniedError extends ServiceError {
  constructor(message = 'Access denied.') {
    super('ACCESS_DENIED', message, 403);
  }
}
