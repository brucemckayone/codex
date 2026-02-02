import { ConflictError, NotFoundError } from '@codex/service-errors';

export class UserNotFoundError extends NotFoundError {
  constructor(userId: string) {
    super('User not found', { userId });
  }
}

export class OrganizationNotFoundError extends NotFoundError {
  constructor(organizationId: string) {
    super('Organization not found', { organizationId });
  }
}

export class OrganizationSlugConflictError extends ConflictError {
  constructor(slug: string) {
    super('Organization slug already exists', { slug });
  }
}
