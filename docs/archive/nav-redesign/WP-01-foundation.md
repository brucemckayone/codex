# WP-01: Foundation — Icons, Nav Config, i18n

## Purpose

Create all foundational assets needed by subsequent work packets: new icon components, navigation configuration types/data, and i18n message keys.

## Dependencies

None — this is the first work packet.

## Files to Create

### 1. Icon Components

All in `apps/web/src/lib/components/ui/Icon/`. Follow the established pattern from `IconBase.svelte` + `SearchIcon.svelte`.

**Pattern (every icon follows this exactly):**
```svelte
<script lang="ts">
  import type { IconProps } from './types';
  import IconBase from './IconBase.svelte';
  const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
  <!-- SVG path elements here -->
</IconBase>
```

#### HomeIcon.svelte
```svelte
<IconBase {size} {...restProps}>
  <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
  <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
</IconBase>
```

#### CompassIcon.svelte
```svelte
<IconBase {size} {...restProps}>
  <circle cx="12" cy="12" r="10" />
  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
</IconBase>
```

#### TagIcon.svelte
```svelte
<IconBase {size} {...restProps}>
  <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
  <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
</IconBase>
```

#### LibraryIcon.svelte
```svelte
<IconBase {size} {...restProps}>
  <path d="m16 6 4 14" />
  <path d="M12 6v14" />
  <path d="M8 8v12" />
  <path d="M4 4v16" />
</IconBase>
```

#### MoreHorizontalIcon.svelte
```svelte
<IconBase {size} {...restProps}>
  <circle cx="12" cy="12" r="1" />
  <circle cx="19" cy="12" r="1" />
  <circle cx="5" cy="12" r="1" />
</IconBase>
```

#### LogInIcon.svelte
```svelte
<IconBase {size} {...restProps}>
  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
  <polyline points="10 17 15 12 10 7" />
  <line x1="15" y1="12" x2="3" y2="12" />
</IconBase>
```

#### CommandIcon.svelte
```svelte
<IconBase {size} {...restProps}>
  <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
</IconBase>
```

All SVG paths are from Lucide (the icon set already used in this project — see existing `SearchIcon`, `UserIcon`, etc.).

### 2. Update Icon Barrel Export

**File:** `apps/web/src/lib/components/ui/Icon/index.ts`

Add these exports in alphabetical order within the existing file:
```typescript
export { default as CommandIcon } from './CommandIcon.svelte';
export { default as CompassIcon } from './CompassIcon.svelte';
export { default as HomeIcon } from './HomeIcon.svelte';
export { default as LibraryIcon } from './LibraryIcon.svelte';
export { default as LogInIcon } from './LogInIcon.svelte';
export { default as MoreHorizontalIcon } from './MoreHorizontalIcon.svelte';
export { default as TagIcon } from './TagIcon.svelte';
```

### 3. Navigation Config

**File:** `apps/web/src/lib/config/navigation.ts` (modify existing)

Add after the existing `SidebarIcon` type (line ~13):

```typescript
// ── Rail Navigation (sidebar rail for platform/org) ──────────────────

export type RailIcon = 'home' | 'compass' | 'tag' | 'library' | 'search' | 'users';

export interface RailNavLink extends NavLink {
  icon: RailIcon;
}

/** Platform sidebar rail navigation */
export const PLATFORM_RAIL_NAV: RailNavLink[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/discover', label: 'Discover', icon: 'compass' },
  { href: '/pricing', label: 'Pricing', icon: 'tag' },
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
```

### 4. i18n Keys

**File:** `apps/web/src/paraglide/messages/en.js` (add new message functions)

```javascript
// Sidebar rail
export const sidebar_home = () => 'Home';
export const sidebar_discover = () => 'Discover';
export const sidebar_explore = () => 'Explore';
export const sidebar_creators = () => 'Creators';
export const sidebar_pricing = () => 'Pricing';
export const sidebar_library = () => 'Library';
export const sidebar_search = () => 'Search';
export const sidebar_sign_in = () => 'Sign In';
export const sidebar_register = () => 'Register';

// Mobile nav
export const mobile_more = () => 'More';
export const mobile_search = () => 'Search';

// Command palette
export const command_palette_placeholder = () => 'Search content, creators...';
export const command_palette_no_results = () => 'No results found';
export const command_palette_recent = () => 'Recent';
export const command_palette_content = () => 'Content';
export const command_palette_creators = () => 'Creators';
```

## Acceptance Criteria

- [ ] All 7 icon components render correctly at sizes 16, 20, and 24
- [ ] Icons use `currentColor` and inherit parent color
- [ ] `Icon/index.ts` exports all new icons without breaking existing imports
- [ ] `navigation.ts` exports `RailIcon`, `RailNavLink`, `PLATFORM_RAIL_NAV`, `getOrgRailNav`, `PLATFORM_MOBILE_NAV`, `getOrgMobileNav`
- [ ] TypeScript compiles without errors (`pnpm typecheck`)
- [ ] All i18n keys are callable functions returning strings
