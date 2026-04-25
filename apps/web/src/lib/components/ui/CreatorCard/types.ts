/**
 * Shared types for CreatorCard family components.
 *
 * `CreatorDrawerData` lives here (rather than inline in
 * CreatorProfileDrawer.svelte) so it can be re-exported from the
 * package barrel — TypeScript's `export type from '*.svelte'` does not
 * reliably surface interfaces declared inside `<script>` blocks across
 * svelte-tsc versions.
 */

export interface SocialLinks {
  website?: string;
  twitter?: string;
  youtube?: string;
  instagram?: string;
}

export interface ContentItem {
  title: string;
  slug: string;
  thumbnailUrl: string | null;
  contentType: string;
}

export interface OrgMembership {
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface CreatorDrawerData {
  name: string;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  socialLinks: SocialLinks | null;
  role: string;
  joinedAt: string;
  contentCount: number;
  recentContent: ContentItem[];
  organizations: OrgMembership[];
}
