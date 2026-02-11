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

export interface SidebarLink extends NavLink {
  icon: string;
}

/** Platform-level navigation (top header on codex.com) */
export const PLATFORM_NAV: NavLink[] = [
  { href: '/discover', label: 'Discover' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/library', label: 'Library' },
];

/** Organization-level navigation (org subdomain header) */
export function getOrgNav(slug: string): NavLink[] {
  return [
    { href: `/${slug}`, label: 'Explore' },
    { href: `/${slug}/creators`, label: 'Creators' },
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
  { href: '/studio/billing', label: 'Billing', icon: 'billing' },
];

/** Account settings sub-navigation */
export const ACCOUNT_NAV: NavLink[] = [
  { href: '/account', label: 'Profile' },
  { href: '/account/payment', label: 'Payments' },
  { href: '/account/notifications', label: 'Notifications' },
];
