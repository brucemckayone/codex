/**
 * Avatar utilities
 *
 * Helper functions for working with user avatars and profile initials.
 */

/**
 * Get initials from a user's name or username
 *
 * Extracts up to 2 characters for use as avatar fallback text:
 * - For names: First letter of first two words (e.g., "Jane Doe" → "JD")
 * - For username: First two characters (e.g., "janedoe" → "JA")
 * - Falls back to "?" if neither is available
 *
 * @param name - The user's display name
 * @param username - The user's username (fallback if no name)
 * @returns Up to 2 uppercase characters for avatar display
 *
 * @example
 * ```ts
 * getInitials("Jane Doe", "janedoe") // "JD"
 * getInitials(null, "janedoe")       // "JA"
 * getInitials(null, null)            // "?"
 * ```
 */
export function getInitials(
  name?: string | null,
  username?: string | null
): string {
  return (
    name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) ||
    username?.slice(0, 2).toUpperCase() ||
    '?'
  );
}
