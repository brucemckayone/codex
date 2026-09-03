# WP-07: MobileBottomSheet Component

## Purpose

A bottom sheet drawer that slides up from the bottom of the screen when the "More" button is tapped in the mobile bottom nav. Contains overflow nav items, auth section, and account links.

## Dependencies

- **WP-06** — `MobileBottomNav` (triggers the sheet)

## Reference Files

- `apps/web/src/lib/components/layout/Header/MobileNav.svelte` — Escape key close, route-change close, overlay pattern
- `apps/web/src/lib/components/layout/Header/UserMenu.svelte` — studioHref, canAccessStudio, getInitials, logout
- `apps/web/src/routes/_org/[slug]/studio/+layout.svelte` — Route-change close via `$effect`

## Files to Create

### `apps/web/src/lib/components/layout/MobileNav/MobileBottomSheet.svelte`

### Props Interface

```typescript
import type { LayoutUser, LayoutOrganization } from '$lib/types';

interface Props {
  open: boolean;               // $bindable
  variant: 'platform' | 'org';
  user: LayoutUser | null;
  org?: LayoutOrganization;
}
```

### Close Logic

```typescript
import { page } from '$app/state';

// Close on route change (reuse studio layout pattern)
$effect(() => {
  page.url.pathname;  // Track dependency
  if (open) open = false;
});

// Close on Escape
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open) {
    open = false;
  }
}

// Drag-to-dismiss (progressive enhancement)
let startY = 0;
let currentY = 0;
let dragging = false;

function handleTouchStart(e: TouchEvent) {
  startY = e.touches[0].clientY;
  dragging = true;
}

function handleTouchMove(e: TouchEvent) {
  if (!dragging) return;
  currentY = e.touches[0].clientY;
  const delta = currentY - startY;
  if (delta > 0) {
    // Only allow dragging down, not up
    sheetEl.style.transform = `translateY(${delta}px)`;
  }
}

function handleTouchEnd() {
  dragging = false;
  const delta = currentY - startY;
  if (delta > 100) {
    open = false;
  }
  sheetEl.style.transform = '';
}
```

### Auth Logic (reused from UserMenu.svelte)

```typescript
import { AUTH_ROLES } from '@codex/constants';
import { buildCreatorsUrl, buildPlatformUrl, extractSubdomain } from '$lib/utils/subdomain';
import { submitFormPost } from '$lib/utils/navigation';

const STUDIO_ROLES = new Set([AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN, AUTH_ROLES.PLATFORM_OWNER]);
const canAccessStudio = $derived(!!user?.role && STUDIO_ROLES.has(user.role));

const currentSubdomain = $derived(extractSubdomain(page.url.hostname));
const studioHref = $derived(
  currentSubdomain && currentSubdomain !== 'creators' && currentSubdomain !== 'www'
    ? '/studio'
    : buildCreatorsUrl(page.url, '/studio')
);

function getInitials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
```

### Template

```svelte
<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="sheet-backdrop"
    role="presentation"
    onclick={() => { open = false; }}
    transition:fade={{ duration: 200 }}
  ></div>

  <!-- Sheet -->
  <div
    bind:this={sheetEl}
    class="sheet"
    role="dialog"
    aria-label="More options"
    transition:fly={{ y: 400, duration: 300 }}
    ontouchstart={handleTouchStart}
    ontouchmove={handleTouchMove}
    ontouchend={handleTouchEnd}
  >
    <!-- Drag handle -->
    <div class="sheet__handle-area">
      <div class="sheet__handle"></div>
    </div>

    <!-- Nav links (overflow items not in bottom bar) -->
    <div class="sheet__section">
      {#if variant === 'org'}
        <a href="/creators" class="sheet__link" onclick={() => { open = false; }}>
          <UsersIcon size={20} />
          <span>{m.sidebar_creators()}</span>
        </a>
      {/if}
      <a href="/pricing" class="sheet__link" onclick={() => { open = false; }}>
        <TagIcon size={20} />
        <span>{m.sidebar_pricing()}</span>
      </a>
      {#if canAccessStudio}
        <a href={studioHref} class="sheet__link" onclick={() => { open = false; }}>
          <LayoutDashboardIcon size={20} />
          <span>{m.nav_studio()}</span>
        </a>
      {/if}
    </div>

    <div class="sheet__divider"></div>

    <!-- Auth section -->
    <div class="sheet__section">
      {#if user}
        <div class="sheet__user">
          <Avatar class="sheet__avatar">
            {#if user.image}
              <AvatarImage src={user.image} alt={user.name} />
            {/if}
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
          <div class="sheet__user-info">
            <span class="sheet__user-name">{user.name}</span>
            <span class="sheet__user-email">{user.email}</span>
          </div>
        </div>
        <a href={buildPlatformUrl(page.url, '/account')} class="sheet__link">
          <UserIcon size={20} />
          <span>{m.nav_account()}</span>
        </a>
        <button class="sheet__link sheet__link--danger" onclick={() => submitFormPost('/logout')}>
          <LogInIcon size={20} />
          <span>{m.nav_log_out()}</span>
        </button>
      {:else}
        <a href="/login" class="sheet__link">
          <LogInIcon size={20} />
          <span>{m.common_sign_in()}</span>
        </a>
        <a href="/register" class="sheet__link sheet__link--primary">
          <UserPlusIcon size={20} />
          <span>{m.nav_register()}</span>
        </a>
      {/if}
    </div>
  </div>
{/if}
```

### CSS

```css
.sheet-backdrop {
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  z-index: var(--z-modal-backdrop);
}

.sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 70vh;
  background: var(--color-surface);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: var(--shadow-xl);
  z-index: var(--z-modal);
  padding: 0 var(--space-4) var(--space-4);
  padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
  overflow-y: auto;
  touch-action: pan-y;
}

/* Drag handle */
.sheet__handle-area {
  display: flex;
  justify-content: center;
  padding: var(--space-3) 0;
  cursor: grab;
}

.sheet__handle {
  width: var(--space-10);
  height: var(--space-1);
  background: var(--color-border);
  border-radius: var(--radius-full);
}

/* Sections */
.sheet__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.sheet__divider {
  height: var(--border-width);
  background: var(--color-border);
  margin: var(--space-3) 0;
}

/* Links */
.sheet__link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: var(--transition-colors);
}

.sheet__link:hover,
.sheet__link:active {
  background: var(--color-surface-secondary);
}

.sheet__link--danger {
  color: var(--color-error);
}

.sheet__link--primary {
  color: var(--color-interactive);
}

/* User info */
.sheet__user {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
}

:global(.sheet__avatar) {
  width: var(--space-10);
  height: var(--space-10);
}

.sheet__user-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.sheet__user-name {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-text);
}

.sheet__user-email {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
```

## Acceptance Criteria

- [ ] Slides up from bottom with `fly` transition (300ms)
- [ ] Backdrop overlay with click-to-close
- [ ] Drag handle at top, drag down >100px dismisses
- [ ] Escape key closes
- [ ] Route change closes (via `$effect` watching `page.url.pathname`)
- [ ] Shows overflow nav items: Creators (org only), Pricing, Studio (if creator/admin)
- [ ] Auth section: user info + Account + Sign Out (authenticated) or Sign In + Register (unauthenticated)
- [ ] Sign Out uses `submitFormPost('/logout')`
- [ ] Studio link routes correctly (subdomain-aware)
- [ ] Safe area padding for iPhone notch
- [ ] Focus trapped inside when open
- [ ] All CSS uses design tokens
