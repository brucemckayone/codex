/**
 * Centralized navigation link definitions.
 *
 * All nav links used by Header, Sidebar, and MobileNav components
 * are defined here as the single source of truth.
 */

export interface NavLink {
  href: string;
  label: string;
}

export type SidebarIcon =
  | 'dashboard'
  | 'content'
  | 'media'
  | 'analytics'
  | 'team'
  | 'customers'
  | 'settings'
  | 'billing'
  | 'monetisation';

export interface SidebarLink extends NavLink {
  icon: SidebarIcon;
}

/** Platform-level navigation (top header on codex.com) */
export const PLATFORM_NAV: NavLink[] = [
  { href: '/discover', label: 'Discover' },
  { href: '/library', label: 'Library' },
];

/** Organization-level navigation (org subdomain header) */
export function getOrgNav(_slug: string): NavLink[] {
  // On org subdomains, the slug is in the hostname — paths are relative to root
  return [
    { href: '/explore', label: 'Explore' },
    { href: '/creators', label: 'Creators' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/library', label: 'Library' },
  ];
}

/** Studio header navigation (mobile menu links) */
export const STUDIO_NAV: NavLink[] = [
  { href: '/studio', label: 'Dashboard' },
  { href: '/studio/content', label: 'Content' },
  { href: '/studio/media', label: 'Media' },
];

/** Studio sidebar — base links visible to all roles */
export const SIDEBAR_BASE_LINKS: SidebarLink[] = [
  { href: '/studio', label: 'Dashboard', icon: 'dashboard' },
  { href: '/studio/content', label: 'Content', icon: 'content' },
  { href: '/studio/media', label: 'Media', icon: 'media' },
  { href: '/studio/analytics', label: 'Analytics', icon: 'analytics' },
];

/** Studio sidebar — admin-only links */
export const SIDEBAR_ADMIN_LINKS: SidebarLink[] = [
  { href: '/studio/team', label: 'Team', icon: 'team' },
  { href: '/studio/customers', label: 'Customers', icon: 'customers' },
  { href: '/studio/settings', label: 'Settings', icon: 'settings' },
];

/** Studio sidebar — owner-only links */
export const SIDEBAR_OWNER_LINKS: SidebarLink[] = [
  { href: '/studio/monetisation', label: 'Monetisation', icon: 'monetisation' },
  { href: '/studio/billing', label: 'Billing', icon: 'billing' },
];

/** Studio sidebar — personal studio links (settings without admin gate) */
export const SIDEBAR_PERSONAL_LINKS: SidebarLink[] = [
  { href: '/studio/settings', label: 'Settings', icon: 'settings' },
];

/** Studio settings sub-navigation (General, Branding, Email Templates) */
export const SETTINGS_NAV: NavLink[] = [
  { href: '/studio/settings', label: 'General' },
  { href: '/studio/settings/branding', label: 'Branding' },
  { href: '/studio/settings/email-templates', label: 'Email Templates' },
];

/** Account settings sub-navigation */
export const ACCOUNT_NAV: NavLink[] = [
  { href: '/account', label: 'Profile' },
  { href: '/account/subscriptions', label: 'Subscriptions' },
  { href: '/account/payment', label: 'Payments' },
  { href: '/account/notifications', label: 'Notifications' },
];

// ── Rail Navigation (sidebar rail for platform/org) ──────────────────

export type RailIcon =
  | 'home'
  | 'compass'
  | 'tag'
  | 'library'
  | 'search'
  | 'users';

export interface RailNavLink extends NavLink {
  icon: RailIcon;
}

/** Platform sidebar rail navigation */
export const PLATFORM_RAIL_NAV: RailNavLink[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/discover', label: 'Discover', icon: 'compass' },
  { href: '/library', label: 'Library', icon: 'library' },
];

/** Org sidebar rail navigation (subdomain — paths are root-relative) */
export function getOrgRailNav(): RailNavLink[] {
  return [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/explore', label: 'Explore', icon: 'compass' },
    { href: '/creators', label: 'Creators', icon: 'users' },
    { href: '/pricing', label: 'Pricing', icon: 'tag' },
    { href: '/library', label: 'Library', icon: 'library' },
  ];
}

/** Platform mobile bottom nav (subset — search + more handled separately) */
export const PLATFORM_MOBILE_NAV: RailNavLink[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/discover', label: 'Discover', icon: 'compass' },
  { href: '/library', label: 'Library', icon: 'library' },
];

/** Org mobile bottom nav (subset — search + more handled separately) */
export function getOrgMobileNav(): RailNavLink[] {
  return [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/explore', label: 'Explore', icon: 'compass' },
    { href: '/library', label: 'Library', icon: 'library' },
  ];
}
