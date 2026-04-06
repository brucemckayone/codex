# Org Explore Page — Feature Ideation

**Route**: `{slug}.revelations.studio/explore` → `_org/[slug]/(space)/explore/+page.svelte`
**Current state**: Basic content grid with no filtering, sorting, or discovery tools.
**Priority**: HIGH — this is the primary content discovery surface for customers.

---

## Vision

The Explore page is the **content catalogue** — the Netflix browse experience for an org. Customers should be able to find what they want through multiple paths: search, browse by category, filter by type/price/creator, or just scroll through curated collections.

---

## Search & Filter Bar

### Global Search
- Prominent search bar at top of page (not just in header)
- Real-time search-as-you-type with debounce
- Search across: title, description, creator name, tags, categories
- Show recent searches (localStorage)
- Show search suggestions/autocomplete
- "X results for 'yoga'" count display

### Filter Panel
- Collapsible sidebar (desktop) / bottom sheet (mobile)
- Filters:
  - **Content Type**: Video, Audio, Written, All
  - **Category**: Dynamic list from org's content categories
  - **Creator**: Multi-select of org creators (with avatars)
  - **Price Range**: Free, Under £10, £10-£50, £50+, or slider
  - **Duration**: Short (<15m), Medium (15-60m), Long (60m+)
  - **Status**: Available, In Library, In Progress
  - **Sort**: Newest, Popular, Price (low-high), Price (high-low), A-Z, Duration
- Active filter chips shown above grid with "Clear All" button
- URL-driven filters (shareable filtered views)
- Filter count badge: "Showing 23 of 47 items"

### View Toggle
- Grid view (default) vs List view
- Grid: 3 columns desktop, 2 tablet, 1 mobile
- List: Full-width rows with more detail (description, duration, tags)
- Save preference in localStorage

---

## Content Card Improvements

### Standard Card (Grid View)
- Thumbnail (16:9) with hover animation
- Price badge (top-right corner): "Free" (green), "£29" (neutral), "Purchased" (blue checkmark)
- Content type icon overlay (bottom-left): Video, Audio, Document
- Title (2 lines max, truncated)
- Creator avatar (tiny) + name
- Category pill badge
- Duration badge (bottom-right of thumbnail): "45 min"
- Star rating (future) or "500+ students"
- Progress bar (if in library and started)

### Card Hover State
- Slight scale-up (1.02)
- Shadow elevation increase
- Show expanded info: full description (3 lines), all tags, "Quick Preview" button
- On video content: Show animated thumbnail GIF or short clip

### Card in List View
- Horizontal layout: Thumbnail (left, smaller) | Info (center) | Price + CTA (right)
- Shows: Title, full description (3 lines), creator, category, duration, tags, price
- More information-dense for power users

---

## Content Sections

### 1. Category Navigation
- Sticky horizontal tab bar below search
- "All" | "Yoga" | "Meditation" | "Nutrition" | "Mindfulness" | ...
- Clicking a category filters the grid instantly (client-side if data is loaded, URL param if server)
- Active category highlighted with brand accent color
- Scroll arrows on overflow

### 2. Featured Collections
- Admin-curated groupings: "Start Here", "Advanced Series", "Most Popular"
- Horizontal carousels within the page
- Each collection has: Name, description (1 line), item count, "View All" link
- Distinct from category filtering — these are editorial picks

### 3. Content Grid
- Main grid of all content (filtered/sorted as per controls)
- Infinite scroll OR pagination (configurable)
- Skeleton loading states while fetching
- Empty state: "No content matches your filters" with "Clear Filters" button
- Lazy-load images for performance

### 4. "Staff Picks" or "Editor's Choice"
- Highlighted row with larger cards
- Selected by org admin in studio
- Ribbon/badge: "Staff Pick" or "Editor's Choice"

### 5. Recently Viewed (Authenticated)
- "Pick up where you left off"
- Shows last 5 content items the user viewed on this org
- Includes progress bars
- Stored in localStorage per org

---

## Advanced Discovery (Future-Ready)

### Learning Paths
- Curated sequences: "Complete Beginner → Intermediate → Advanced"
- Visual progress along the path
- Numbered steps with completion checkmarks
- "Start this path" CTA

### "Similar Content" Suggestions
- On hover or in a sidebar: "If you like this, try..."
- Based on: same category, same creator, similar tags, similar duration

### Content Calendar
- Toggle to calendar view showing release dates
- "Coming this month" preview
- Useful for orgs that release on a schedule

### Difficulty/Level Indicators
- Beginner, Intermediate, Advanced badges
- Filter by level
- Visual icon (1 bar, 2 bars, 3 bars)

---

## Responsive Behavior

### Desktop (1024px+)
- 3-4 column grid
- Sidebar filters (collapsible)
- Sticky search + category bar

### Tablet (768-1023px)
- 2 column grid
- Filters collapse to icon button → bottom sheet
- Search bar full-width

### Mobile (<768px)
- 1 column grid (or 2 compact cards)
- Filter button → full-screen filter overlay
- Search as expandable icon in header
- Swipeable category pills
- Infinite scroll preferred over pagination

---

## Loading & Empty States

### Loading
- Skeleton grid: 6-9 shimmer cards matching grid layout
- Skeleton search bar
- Progressive: show category bar immediately, load content cards

### Empty (No Content)
- Org has no published content
- Friendly illustration + "Content is on its way!"
- CTA for org admin: "Go to Studio to publish content"

### No Results (Filtered)
- "No content matches your filters"
- Show which filters are active
- "Try removing some filters" suggestion
- "Clear All Filters" button

### Error
- "Unable to load content" with retry button
- Don't break the whole page — show error inline

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Content list | content API (paginated) | Yes |
| Search | content API (?q=) | Yes |
| Categories | content API (distinct) | Partial |
| Creators list | org membership API | Yes |
| Featured collections | Admin-curated | Not yet |
| Recently viewed | localStorage | Not yet |
| View counts/popularity | analytics API | Partial |
| Content type/duration | content API | Yes |

---

## Priority Ideas (Top 5)

1. **Filter bar** with category, type, price, creator, sort controls
2. **Improved content cards** with price badges, duration, type icons, hover states
3. **Category navigation** as sticky horizontal tab bar
4. **View toggle** (grid/list) with localStorage persistence
5. **Skeleton loading states** for professional feel during data fetches
