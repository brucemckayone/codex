/**
 * Default-deny environment guard for the dev-only webhook catch-all.
 *
 * Only 'development' and 'staging' are allowed through. Every other value
 * (including `undefined`, 'production', 'PROD', 'Production', stray
 * typos) returns false → the route returns 404. Matching specifically on
 * 'production' would expose the catch-all if ENVIRONMENT is missing,
 * misspelled, or uppercased.
 */
export function isDevEnvironment(environment: string | undefined): boolean {
  return environment === 'development' || environment === 'staging';
}
