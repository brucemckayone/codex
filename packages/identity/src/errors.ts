import {
  BusinessLogicError,
  ConflictError,
  NotFoundError,
} from '@codex/service-errors';

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

export class UsernameTakenError extends ConflictError {
  constructor(username: string) {
    super('Username already taken', { username });
  }
}

/**
 * Thrown when a user tries to delete their account while still owning one or
 * more organizations. Org teardown/transfer is a separate, larger flow
 * (tracked as Codex-904q0) — until then we block and guide the owner to hand
 * off or delete their org(s) first, rather than orphaning members, content,
 * and subscribers. Maps to HTTP 422 (business rule, not a validation error).
 */
export class AccountOwnsOrganizationError extends BusinessLogicError {
  constructor(organizationNames: string[]) {
    const single = organizationNames.length === 1;
    super(
      `You still own ${single ? 'an organization' : `${organizationNames.length} organizations`} (${organizationNames.join(', ')}). Transfer ownership or delete ${single ? 'it' : 'them'} before deleting your account.`,
      { organizationNames }
    );
  }
}
