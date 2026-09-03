# WP-03: SidebarRailUserSection Component

## Purpose

Bottom section of the sidebar rail handling authentication state. Shows a login icon when unauthenticated, avatar + dropdown when authenticated. Reuses logic from `UserMenu.svelte`.

## Dependencies

- **WP-01** — `LogInIcon` component

## Reference Files

- `apps/web/src/lib/components/layout/Header/UserMenu.svelte` — `getInitials()`, `studioHref`, `canAccessStudio`, logout pattern
- `apps/web/src/lib/components/ui/Avatar/` — Avatar, AvatarImage, AvatarFallback
- `apps/web/src/lib/components/ui/DropdownMenu/` — DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator

## Files to Create

### `apps/web/src/lib/components/layout/SidebarRail/SidebarRailUserSection.svelte`

### Props Interface

```typescript
interface Props {
  user: LayoutUser | null;
  expanded?: boolean;
}
```

### Imports (reuse from existing codebase)

```typescript
import type { LayoutUser } from '$lib/types';
import { page } from '$app/state';
import { submitFormPost } from '$lib/utils/navigation';
import { AUTH_ROLES } from '@codex/constants';
import { buildCreatorsUrl, buildPlatformUrl, extractSubdomain } from '$lib/utils/subdomain';
import { LogInIcon, ChevronDownIcon } from '$lib/components/ui/Icon';
import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
import DropdownMenu from '$lib/components/ui/DropdownMenu/DropdownMenu.svelte';
import DropdownMenuTrigger from '$lib/components/ui/DropdownMenu/DropdownMenuTrigger.svelte';
import DropdownMenuContent from '$lib/components/ui/DropdownMenu/DropdownMenuContent.svelte';
import DropdownMenuItem from '$lib/components/ui/DropdownMenu/DropdownMenuItem.svelte';
import DropdownMenuSeparator from '$lib/components/ui/DropdownMenu/DropdownMenuSeparator.svelte';
import { Tooltip, TooltipTrigger, TooltipContent } from '$lib/components/ui/Tooltip';
import * as m from '$paraglide/messages';
```

### Logic (copied from UserMenu.svelte, adapted)

```typescript
const STUDIO_ROLES = new Set([AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN, AUTH_ROLES.PLATFORM_OWNER]);
const canAccessStudio = $derived(!!user?.role && STUDIO_ROLES.has(user.role));

const currentSubdomain = $derived(extractSubdomain(page.url.hostname));
const studioHref = $derived(
  currentSubdomain && currentSubdomain !== 'creators' && currentSubdomain !== 'www'
    ? '/studio'
    : buildCreatorsUrl(page.url, '/studio')
);

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
```

### Rendering — Unauthenticated (`user === null`)

**Collapsed:**
```svelte
<Tooltip openDelay={0} positioning={{ placement: 'right' }}>
  <TooltipTrigger>
    <a href="/login" class="user-section user-section--unauth" aria-label={m.sidebar_sign_in()}>
      <LogInIcon size={20} />
    </a>
  </TooltipTrigger>
  <TooltipContent>{m.sidebar_sign_in()}</TooltipContent>
</Tooltip>
```

**Expanded:**
```svelte
<div class="user-section user-section--unauth">
  <a href="/login" class="sign-in-link">
    <LogInIcon size={20} />
    <span class="user-section__label">{m.sidebar_sign_in()}</span>
  </a>
  <a href="/register" class="register-link">{m.sidebar_register()}</a>
</div>
```

### Rendering — Authenticated (`user !== null`)

**Collapsed:**
```svelte
<DropdownMenu>
  <DropdownMenuTrigger class="user-section">
    <Avatar class="user-section__avatar">
      {#if user.image}
        <AvatarImage src={user.image} alt={user.name} />
      {/if}
      <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
    </Avatar>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <!-- Same dropdown items as expanded -->
  </DropdownMenuContent>
</DropdownMenu>
```

**Expanded:**
```svelte
<DropdownMenu>
  <DropdownMenuTrigger class="user-section user-section--expanded">
    <Avatar class="user-section__avatar">
      {#if user.image}
        <AvatarImage src={user.image} alt={user.name} />
      {/if}
      <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
    </Avatar>
    <div class="user-section__info">
      <span class="user-section__name">{user.name}</span>
      <span class="user-section__email">{user.email}</span>
    </div>
    <ChevronDownIcon size={14} class="user-section__chevron" />
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <div class="dropdown-user-info">
      <span class="dropdown-user-name">{user.name}</span>
      <span class="dropdown-user-email">{user.email}</span>
    </div>
    <DropdownMenuSeparator />
    <a href={buildPlatformUrl(page.url, '/account')}>
      <DropdownMenuItem>{m.nav_account()}</DropdownMenuItem>
    </a>
    <a href={buildPlatformUrl(page.url, '/library')}>
      <DropdownMenuItem>{m.nav_library()}</DropdownMenuItem>
    </a>
    {#if canAccessStudio}
      <a href={studioHref}>
        <DropdownMenuItem>{m.nav_studio()}</DropdownMenuItem>
      </a>
    {/if}
    <DropdownMenuSeparator />
    <button type="button" class="logout-button" onclick={() => submitFormPost('/logout')}>
      <DropdownMenuItem>{m.nav_log_out()}</DropdownMenuItem>
    </button>
  </DropdownMenuContent>
</DropdownMenu>
```

### CSS

```css
.user-section {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  margin: 0 var(--space-2);
  border-radius: var(--radius-md);
  transition: var(--transition-colors);
  color: var(--color-text-secondary);
  min-height: var(--space-10);
}

.user-section:hover {
  background-color: var(--color-surface-secondary);
}

/* Avatar sizing — smaller than default to fit rail */
:global(.user-section__avatar) {
  width: var(--space-8);
  height: var(--space-8);
  flex-shrink: 0;
}

.user-section__info {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  overflow: hidden;
  min-width: 0;
}

.user-section__name {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-section__email {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Label animation matches SidebarRailItem */
.user-section__label {
  opacity: 0;
  transform: translateX(calc(-1 * var(--space-1)));
  transition:
    opacity var(--duration-normal) var(--ease-default),
    transform var(--duration-normal) var(--ease-out);
}

:global([data-expanded='true']) .user-section__label,
:global([data-expanded='true']) .user-section__info,
:global([data-expanded='true']) .user-section__chevron {
  opacity: 1;
  transform: translateX(0);
}

/* Unauth sign-in styling */
.sign-in-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-secondary);
  text-decoration: none;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}

.sign-in-link:hover {
  color: var(--color-text);
}

.register-link {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  text-decoration: none;
  padding-left: calc(20px + var(--space-3)); /* Align with label (icon width + gap) */
}

.register-link:hover {
  color: var(--color-interactive);
}

/* Dropdown styles (reused from UserMenu.svelte) */
.dropdown-user-info {
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.dropdown-user-name {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-text);
}

.dropdown-user-email {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.logout-button {
  width: 100%;
  padding: 0;
  text-align: left;
  background: none;
  border: none;
}
```

## Acceptance Criteria

- [ ] Unauthenticated: shows login icon (collapsed) or "Sign In" + "Register" (expanded)
- [ ] Authenticated: shows avatar (collapsed) or avatar + name + email (expanded)
- [ ] Dropdown opens with Account, Library, Studio (if creator/admin), Sign Out
- [ ] Studio link routes correctly: `/studio` on org subdomains, creators URL on platform
- [ ] Sign Out calls `submitFormPost('/logout')` (existing pattern)
- [ ] Avatar fallback shows initials from `getInitials()` (max 2 chars, uppercase)
- [ ] Tooltip appears on collapsed avatar hover (right placement)
- [ ] All CSS uses design tokens
