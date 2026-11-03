/**
 * The org's logo as the page kit draws it (Codex-61zsk.73): the one the org
 * layout's rail shows (`_org/[slug]/+layout.svelte`, `brandLogoUrl`). While
 * the brand editor is open its pending logo is authoritative, a REMOVED one
 * included, so a removal previews as no logo rather than the saved one
 * coming back; otherwise the org's saved logo.
 *
 * NOT `brandOverrideLogo` (`./brand-overrides.ts`): that reads a page's own
 * `brandOverrides.logoUrl`, a key the overrides carry only because they
 * mirror the brand editor's state (`brand-overrides.type-check.ts`). No
 * editor writes it, so it is no preview path.
 *
 * PURE, as `org-grounds.ts`: the caller reads `$app/state` and the brand
 * editor and passes the pieces in, so `PageRenderer` takes plain data.
 */
import type { BrandEditorState } from '$lib/brand-editor';
import type { OrganizationData } from '$lib/types';
import type { OrgLogoSource } from '../kit/page-context';

export function orgLogo(
  org: Pick<OrganizationData, 'logoUrl' | 'name'> | null | undefined,
  pending: Pick<BrandEditorState, 'logoUrl'> | null
): OrgLogoSource | null {
  if (!org) return null;
  const url = (pending ? pending.logoUrl : org.logoUrl)?.trim();
  return url ? { url, name: org.name } : null;
}
