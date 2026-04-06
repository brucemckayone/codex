# Shared Components — Feature Ideation

**Location**: `apps/web/src/lib/components/`
**Current state**: 22+ Melt UI components, layout primitives, icons. Good foundation but gaps.
**Priority**: MEDIUM — reusable building blocks that improve everything.

---

## Current Component Inventory

### UI Primitives (Existing)
- Accordion, Avatar, Badge, Button, Card, Checkbox, Dialog, DropdownMenu
- Input, Label, Popover, Select, Skeleton, SkipLink, Switch
- Table, Tabs, TextArea, Toast, Tooltip
- Layout: Stack, Cluster, PageContainer

### Domain Components (Existing)
- VideoPlayer, StatCard, SEO, StructuredData, ErrorBoundary
- ContentCard (stories only?), CreatorCard (stories only?)
- OrgHeader, StudioHeader, Header

### Missing / Needed Components

---

## New Component Ideas

### 1. ContentCard (Proper Implementation)
**Purpose**: Reusable card for displaying content items across explore, library, landing pages

**Variants**:
- **Explore Card**: Thumbnail, title, creator, price, type icon, duration
- **Library Card**: Thumbnail + progress bar, title, creator, "X% complete", time remaining
- **Featured Card**: Larger, with description, CTA button
- **Compact Card**: Small horizontal layout for lists/sidebars
- **Skeleton Card**: Loading placeholder matching card dimensions

**Props**:
- content (data object)
- variant: 'explore' | 'library' | 'featured' | 'compact'
- showProgress: boolean
- showPrice: boolean
- showCreator: boolean
- onClick handler

### 2. CreatorCard
**Purpose**: Reusable card for displaying creator profiles

**Variants**:
- **Standard**: Avatar, name, title, bio snippet, content count
- **Compact**: Small avatar + name + role
- **Spotlight**: Large, with full bio, top content, social links

**Props**:
- creator (data object)
- variant: 'standard' | 'compact' | 'spotlight'
- showSocialLinks: boolean
- showContentCount: boolean

### 3. SearchBar
**Purpose**: Global search component used in headers and page-level search

**Features**:
- Debounced input
- Real-time suggestions dropdown
- Search categories (content, creators, tags)
- Recent searches from localStorage
- Keyboard navigation (arrow keys, enter to select)
- Loading state while fetching

**Props**:
- scope: 'global' | 'org' | 'creator' | 'library'
- placeholder text
- onSearch callback
- showSuggestions: boolean

### 4. FilterBar
**Purpose**: Reusable filter/sort controls for list pages

**Features**:
- Horizontal scrollable filter chips
- Dropdown menus for multi-option filters
- Active filter display with remove buttons
- "Clear All" button
- URL-driven state
- Responsive: Full bar (desktop) → bottom sheet (mobile)

**Props**:
- filters config array
- activeFilters state
- onFilterChange callback
- sortOptions array

### 5. Carousel / HorizontalScroll
**Purpose**: Scrollable horizontal content row for landing pages, featured sections

**Features**:
- Scroll buttons (left/right arrows)
- Touch/swipe support
- Momentum scrolling
- Snap points (card-aligned)
- "View All" button at end
- Responsive card sizing

**Props**:
- items array
- renderItem slot
- title / heading
- viewAllHref
- cardWidth

### 6. StatsCard (Enhanced)
**Purpose**: Improved version of current StatCard for dashboards

**Features**:
- Value + label
- Trend indicator: Arrow up/down with color (green/red)
- Trend text: "+23% from last month"
- Sparkline mini-chart (optional)
- Icon
- Click handler (navigate to detail)
- Loading skeleton state

**Props**:
- label, value, trend (positive/negative/neutral), trendText
- icon component
- sparklineData (optional)
- href (optional)

### 7. EmptyState (Enhanced)
**Purpose**: Reusable empty state for pages with no data

**Current**: Exists but basic.

**Improvements**:
- Illustration/icon support
- Primary + secondary action buttons
- Contextual messaging based on page type
- Animation: Subtle fade-in

**Props**:
- title, description
- icon or illustration
- primaryAction: { label, href }
- secondaryAction: { label, href }

### 8. DataTable (Enhanced)
**Purpose**: Full-featured table for studio pages

**Features**:
- Sortable columns (click header)
- Selectable rows (checkboxes)
- Bulk action bar
- Column visibility toggle
- Sticky header on scroll
- Responsive: Scroll horizontal on mobile, or collapse to card layout
- Row hover actions
- Pagination integration
- Loading skeleton rows

### 9. Chart Components
**Purpose**: Reusable charts for analytics and dashboard

**Types Needed**:
- LineChart (revenue over time, customer growth)
- BarChart (content comparison, revenue by category)
- DonutChart (category distribution, segment breakdown)
- Sparkline (inline mini-charts for tables and stat cards)

**Library**: Consider Chart.js, or lightweight custom SVG charts

**Props**:
- data array
- type: 'line' | 'bar' | 'donut' | 'sparkline'
- color (brand-aware)
- interactive (hover tooltips)
- responsive sizing

### 10. ProgressBar
**Purpose**: Reusable progress indicator for library, player, onboarding

**Variants**:
- Thin bar (on thumbnails)
- Standard bar (library cards)
- Circular/radial (completion percentage)
- Stepped (onboarding checklist)

**Props**:
- value (0-100)
- variant
- color (brand-aware)
- showLabel: boolean
- label text override

### 11. PriceBadge
**Purpose**: Consistent price display across all content cards

**Variants**:
- "Free" (green)
- "£29" (neutral)
- "Purchased" (blue checkmark)
- "£49 → £29" (strikethrough sale price)
- "From £10" (variable pricing)

**Props**:
- price (number, 0 = free)
- isPurchased: boolean
- salePrice (optional)
- currency

### 12. UserAvatar (Enhanced)
**Purpose**: Consistent avatar display with status indicators

**Features**:
- Image with fallback initials
- Size variants: xs, sm, md, lg, xl
- Status dot: Online (green), Away, Offline (invisible)
- Role badge overlay: Admin crown, Creator star
- Group/stack avatars for team displays

### 13. CommandPalette
**Purpose**: Keyboard-driven navigation (Cmd+K)

**Features**:
- Full-screen overlay
- Search across pages, content, actions
- Recently visited items
- Grouped results: Pages, Content, Actions, Settings
- Keyboard navigation
- Action execution (navigate, create, toggle)

### 14. Breadcrumb
**Purpose**: Location indicator for deep navigation

**Features**:
- Auto-generated from route
- Truncation for long paths
- Home icon as first item
- Mobile: Show only current + parent

### 15. NotificationBadge
**Purpose**: Count indicator on navigation items

**Features**:
- Small dot (boolean) or number badge
- Animated appearance (pulse on change)
- Color variants: default (brand), warning, error

---

## Component Architecture Ideas

### Compound Components Pattern
For complex components like DataTable, Card, Dialog — use compound pattern:
```svelte
<Card.Root>
  <Card.Header>
    <Card.Title>Title</Card.Title>
  </Card.Header>
  <Card.Content>...</Card.Content>
  <Card.Footer>...</Card.Footer>
</Card.Root>
```
(Already used for Card, Table, Dialog, Tabs, Accordion)

### Variant System
Consistent variant pattern across all components:
- variant: 'primary' | 'secondary' | 'ghost' | 'destructive'
- size: 'sm' | 'md' | 'lg'
- Data attributes for styling: `data-variant={variant}`

### Token Consumption
All new components MUST use design tokens exclusively. No hardcoded values.
Brand-aware: Use `--color-brand-*` tokens that respect org branding.

---

## Priority New Components (Top 10)

1. **ContentCard** — reusable across 5+ pages
2. **SearchBar** — needed in every header
3. **FilterBar** — needed in explore, library, studio content, customers
4. **Carousel** — needed for landing page, featured sections
5. **StatsCard (enhanced)** — needed for dashboard, analytics
6. **DataTable (enhanced)** — needed for studio content, customers, team, media
7. **Chart components** — needed for dashboard, analytics
8. **CreatorCard** — needed for creators page, landing page
9. **PriceBadge** — needed on all content cards
10. **ProgressBar** — needed in library, player, onboarding
