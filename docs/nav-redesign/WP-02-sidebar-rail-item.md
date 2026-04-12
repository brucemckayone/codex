# WP-02: SidebarRailItem Component

## Purpose

A single navigation item for the sidebar rail. Renders as an icon-only button (with tooltip) when collapsed, and icon + animated label when expanded. Handles active state, hover, and accessibility.

## Dependencies

- **WP-01** — Icon components and `RailIcon` type

## Files to Create

### `apps/web/src/lib/components/layout/SidebarRail/SidebarRailItem.svelte`

### Props Interface

```typescript
interface Props {
  href: string;
  label: string;
  icon: RailIcon;
  active?: boolean;
  expanded?: boolean;
  index?: number;  // For staggered animation delay (0-based)
}
```

### Icon Map

Map `RailIcon` string keys to icon components. Follow the pattern from `StudioSidebar.svelte` (line ~30):

```typescript
import {
  HomeIcon, CompassIcon, TagIcon, LibraryIcon,
  SearchIcon, UsersIcon
} from '$lib/components/ui/Icon';
import type { Component } from 'svelte';
import type { RailIcon } from '$lib/config/navigation';

const RAIL_ICON_MAP: Record<RailIcon, Component> = {
  home: HomeIcon,
  compass: CompassIcon,
  tag: TagIcon,
  library: LibraryIcon,
  search: SearchIcon,
  users: UsersIcon,
};
```

### Rendering Logic

**Collapsed (`expanded=false`):**
```svelte
<Tooltip openDelay={0} positioning={{ placement: 'right' }}>
  <TooltipTrigger>
    <a href={href} class="rail-item" class:rail-item--active={active}
       aria-label={label} aria-current={active ? 'page' : undefined}>
      <svelte:component this={RAIL_ICON_MAP[icon]} size={20} />
    </a>
  </TooltipTrigger>
  <TooltipContent>{label}</TooltipContent>
</Tooltip>
```

**Expanded (`expanded=true`):**
```svelte
<a href={href} class="rail-item" class:rail-item--active={active}
   aria-current={active ? 'page' : undefined}
   style:--item-index={index ?? 0}>
  <svelte:component this={RAIL_ICON_MAP[icon]} size={20} />
  <span class="rail-item__label">{label}</span>
</a>
```

Note: When expanded, the tooltip is NOT rendered (the label is visible). Use `{#if expanded} ... {:else} ... {/if}` to switch between the two.

### CSS

```css
.rail-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  margin: 0 var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  transition: var(--transition-colors);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  min-height: var(--space-10);  /* 40px touch target */
}

.rail-item:hover {
  background-color: var(--color-surface-secondary);
  color: var(--color-text);
}

.rail-item--active {
  background-color: var(--color-surface-secondary);
  color: var(--color-interactive);
  position: relative;
}

/* Active indicator — left accent bar */
.rail-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: var(--space-2);
  bottom: var(--space-2);
  width: var(--border-width-thick);
  background-color: var(--color-interactive);
  border-radius: var(--radius-full);
}

/* Label animation — staggered fade-in on expand */
.rail-item__label {
  opacity: 0;
  transform: translateX(calc(-1 * var(--space-1)));
  transition:
    opacity var(--duration-normal) var(--ease-default),
    transform var(--duration-normal) var(--ease-out);
  transition-delay: calc(30ms * var(--item-index, 0));
}

/* When parent sidebar has data-expanded='true', labels become visible */
:global([data-expanded='true']) .rail-item__label {
  opacity: 1;
  transform: translateX(0);
}
```

### Accessibility

- `aria-current="page"` on active items (matches existing `OrgHeader.svelte` line 31)
- `aria-label={label}` always present (screen readers don't see tooltips)
- Minimum touch target: `var(--space-10)` (40px) height
- Focus ring: inherits from global `:focus-visible` styles
- Tooltip side: `placement: 'right'` (appears to the right of the rail)

### Reduced Motion

All transitions use token durations which auto-collapse to `0.01ms` via `motion.css` `@media (prefers-reduced-motion: reduce)`.

## Acceptance Criteria

- [ ] Renders icon-only with right-side tooltip when `expanded=false`
- [ ] Renders icon + label when `expanded=true`
- [ ] Label animates in with staggered delay based on `index` prop
- [ ] Active state shows left accent bar + `--color-interactive` text
- [ ] Hover state shows `--color-surface-secondary` background
- [ ] `aria-current="page"` set correctly on active item
- [ ] Minimum 40px touch target height
- [ ] All CSS uses design tokens — zero hardcoded values
