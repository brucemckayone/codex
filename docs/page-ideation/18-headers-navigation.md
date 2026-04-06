# Header & Navigation — Feature Ideation

**Components**: OrgHeader, StudioHeader, Header (platform), all navigation elements
**Current state**: Basic headers with logo, nav links, user menu. Functional but minimal.
**Priority**: HIGH — navigation is the skeleton of the entire experience.

---

## Vision

Navigation should be **invisible when it works, powerful when you need it**. Headers should adapt to context (org brand, studio role, creator profile) and provide fast access to key actions. A global search bar is overdue.

---

## Org Public Header (OrgHeader)

### Current
- Org logo/name, basic nav links (Home, Explore, Creators, Library), user menu

### Improvement Ideas

#### Global Search Bar
- **Prominent search input** in the center of the header (like Spotify)
- Search scope: All content on this org
- Real-time suggestions as you type:
  - Content matches (with thumbnails)
  - Creator matches (with avatars)
  - Category matches (with icons)
- Recent searches (localStorage)
- Keyboard shortcut: Cmd/Ctrl + K to focus search (power user feature)
- Mobile: Search icon that expands to full search overlay

#### Enhanced Navigation
- Active state: Clear visual indicator of current page
- Badge counts: "Library (3)" showing items in library
- Notification bell (future): "2 new items since last visit"
- "New" badge on nav items with recent additions

#### User Menu (Authenticated)
- Avatar dropdown with:
  - Display name + email
  - "My Library" quick link
  - "Account Settings" → platform/account
  - "Switch to Studio" → /studio (if creator/admin)
  - Studio switcher: Personal Studio | {Org 1} | {Org 2}
  - "Sign Out"
- Keyboard navigable dropdown

#### Unauthenticated State
- "Sign In" / "Sign Up" buttons (right side)
- Prominent register CTA: "Start Free"
- Keep nav minimal: Home, Explore, Pricing

#### Mobile Header
- Hamburger menu → Full-screen slide-in nav
- Search icon → Full-screen search overlay
- Compact logo
- User avatar (or sign-in button)
- Mobile nav includes all links + studio switcher + sign out

#### Breadcrumbs
- For deep pages: Home > Explore > Category > Content Title
- Especially useful on content detail pages
- Optional: Only show on desktop, hide on mobile

---

## Studio Header (StudioHeader)

### Current
- Studio logo/name, nav sidebar, studio switcher

### Improvement Ideas

#### Studio Sidebar Navigation
- **Icon + label** for each nav item
- **Collapsible**: Icon-only mode to save space
- Active indicator: Left border highlight or background tint
- Badge counts:
  - Content: "5" (draft count)
  - Customers: "New" (new customers since last visit)
  - Team: "1" (pending invite)

#### Navigation Items (Improved Order)
1. Dashboard (home icon)
2. Content (film icon) — with draft badge
3. Media (upload icon)
4. Analytics (chart icon)
5. Customers (users icon) — admin only
6. Team (people icon) — admin only
7. Settings (gear icon) — admin only
8. Billing (card icon) — owner only
9. ---separator---
10. "View Public Site" (external link icon) — opens org in new tab
11. "Edit Brand Live" (paint icon) — opens brand editor

#### Studio Switcher (Enhanced)
- Dropdown in sidebar header
- Shows: Personal Studio + all orgs where user is creator+
- Each option: Org avatar/logo + name + role badge
- Current context highlighted
- "Create New Organization" option at bottom (future)
- Quick switch without full page reload (just navigation)

#### Studio Header Bar (Top)
- Breadcrumb: Studio > Content > Edit "Yoga Basics"
- Quick actions: "Create Content" button (always visible)
- Notification bell (future)
- "Preview" button: Opens public view of whatever you're editing
- "Help" button: Opens contextual help

#### Command Palette (Power Feature)
- Cmd/Ctrl + K opens command palette
- Search across: Content, media, customers, pages, settings
- Quick actions: "Create content", "Upload media", "View analytics"
- Recent items: Last 5 content items edited
- Keyboard-first navigation for power users

---

## Platform Header (Header)

### Current
- Codex logo, nav links (Discover, Library, Account, Pricing), user menu

### Improvement Ideas
- Search bar (platform-wide: search across all orgs and creators)
- "Become a Creator" CTA for customers
- Notification center (future)
- Language switcher (i18n support exists via Paraglide)

---

## Mobile Navigation (All Contexts)

### Bottom Tab Bar (Alternative to Hamburger)
- For org public: Home | Explore | Library | Profile
- For studio: Dashboard | Content | Media | More
- Active tab highlighted
- Badge counts on tabs
- Smooth: No jarring page transitions

### Slide-Out Drawer
- Full-screen overlay
- All navigation items
- User profile summary at top
- Studio switcher
- Sign out at bottom

---

## Accessibility

- Keyboard navigation: Tab through all nav items
- Skip links: "Skip to main content" (already exists)
- ARIA labels on all interactive elements
- Focus indicators: Clear, visible focus rings
- Reduced motion: No nav animations if prefers-reduced-motion
- Screen reader: Announce current page, navigation landmarks

---

## Responsive Breakpoints

| Breakpoint | Header Behavior |
|------------|----------------|
| Desktop (1024+) | Full nav bar, search visible, all links shown |
| Tablet (768-1023) | Condensed nav, search icon, hamburger menu |
| Mobile (<768) | Compact header, hamburger + search icons, bottom tab bar option |

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| User session | auth/hooks | Yes |
| Org memberships | org API | Yes |
| User role | org membership API | Yes |
| Draft count | content API | Yes |
| New customer count | admin API | Partial |
| Search | content API | Yes |
| Notifications | Not built | Future |

---

## Priority Ideas (Top 5)

1. **Global search bar** in all headers with real-time suggestions
2. **Enhanced studio sidebar** with badge counts and collapsible mode
3. **Improved studio switcher** with org logos and role badges
4. **Mobile bottom tab bar** for quick navigation on touch devices
5. **Command palette** (Cmd+K) for power user navigation
