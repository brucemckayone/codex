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
  { href: '/pricing', label: 'Pricing' },
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

/** Studio settings sub-navigation (General, Branding) */
export const SETTINGS_NAV: NavLink[] = [
  { href: '/studio/settings', label: 'General' },
  { href: '/studio/settings/branding', label: 'Branding' },
];

/** Account settings sub-navigation */
export const ACCOUNT_NAV: NavLink[] = [
  { href: '/account', label: 'Profile' },
  { href: '/account/subscriptions', label: 'Subscriptions' },
  { href: '/account/payment', label: 'Payments' },
  { href: '/account/notifications', label: 'Notifications' },
];
