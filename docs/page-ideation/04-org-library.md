# Org Library Page — Feature Ideation

**Route**: `{slug}.revelations.studio/library` → `_org/[slug]/(space)/library/+page.svelte`
**Current state**: Basic content grid showing purchased content. Has filtering and sort from platform library.
**Priority**: MEDIUM — engagement and retention surface.

**Note**: Per the routing spec, the library is platform-level (`revelations.studio/library`), not org-scoped. The org `/library` route may redirect to platform library or show org-filtered view of user's library.

---

## Vision

The library is the user's **personal bookshelf** within this org. It's where they return to continue learning. The experience should feel like opening a well-organized personal collection, not browsing a store.

---

## Key Distinction from Explore

| Explore | Library |
|---------|---------|
| Everything available | Only what I own |
| Discovery mode | Consumption mode |
| Price-focused | Progress-focused |
| Browsing | Returning |

The library UX should be warmer, more personal, more focused on *continuing* rather than *discovering*.

---

## Core Sections

### 1. Continue Watching (Top Priority)
- **Prominent placement** — this is the #1 reason people visit their library
- Horizontal carousel of in-progress items
- Each card shows: Thumbnail with progress bar overlay, title, creator, "X% complete"
- "Resume" button that takes you directly to the content player at the right timestamp
- Sort by: Most recent activity
- Max 6-8 items, auto-hides if empty

### 2. Completed Content
- Separate section: "Completed" with checkmark badges
- Option to re-watch
- Rating prompt (future): "How was this? Rate 1-5 stars"
- "Certificate" or completion badge (future gamification)

### 3. Full Library Grid
- All purchased content from this org
- Filter by: Content type, Category, Completion status (Not started, In progress, Completed)
- Sort by: Recently purchased, Recently watched, A-Z, Progress %
- View toggle: Grid / List

### 4. Search Within Library
- "Search your library" — search only purchased items
- Useful for users with 20+ items
- Searches title, description, creator name

---

## Card Design for Library Context

Library cards are different from Explore cards because the user already owns them:

### Library Card
- Thumbnail with progress bar (bottom edge)
- Title
- Creator name
- Duration remaining: "23 min left" or "Completed"
- Completion percentage badge
- Content type icon
- Last accessed date: "Watched 3 days ago"
- NO price — they already own it
- Green checkmark overlay for completed items

---

## Empty States

### New User (No Purchases)
- Friendly message: "Your library is empty — let's change that!"
- CTA: "Explore Content" → /explore
- Show 3-4 recommended items to get started

### All Content Completed
- Celebratory: "You've completed everything! Amazing work."
- CTA: "Explore new content" → /explore
- Show recently added content they haven't purchased

### No Results (Filtered)
- "No content matches your filter"
- "Try adjusting your filters" + Clear button

---

## Gamification Ideas (Future)

- **Streak tracking**: "You've watched content 5 days in a row!"
- **Completion certificates**: Downloadable PDF for completed courses
- **Progress milestones**: "You've watched 10 hours of content"
- **Badges**: "Early Adopter", "Completionist", "Night Owl" (based on watch patterns)
- **Leaderboard**: Optional, if org enables it — "Top learners this month"

---

## Offline/PWA Considerations (Future)

- Download content for offline viewing
- Downloaded items show in a special "Downloaded" section
- Progress syncs when back online
- Storage management: "Using 2.3 GB of 5 GB"

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Purchased content | library/access API | Yes |
| Watch progress | progress collection | Yes |
| Content metadata | content API | Yes |
| Completion status | derived from progress | Yes |
| Recommendations | analytics/content API | Not yet |
| Certificates | Not built | Future |

---

## Priority Ideas (Top 5)

1. **Continue Watching** as the dominant top section with resume buttons
2. **Completion badges** and "Completed" section separate from in-progress
3. **Library-specific card design** showing progress/time remaining instead of price
4. **Search within library** for users with large collections
5. **Empty state with recommendations** to drive first purchase
