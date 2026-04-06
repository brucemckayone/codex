# Org Creators Page — Feature Ideation

**Route**: `{slug}.revelations.studio/creators` → `_org/[slug]/(space)/creators/+page.svelte`
**Current state**: Basic list of creators with minimal info. Very sparse.
**Priority**: HIGH — this is the human face of the org, critical for trust and community feel.

---

## Vision

The Creators page is the **team page** of the collective. Organizations are built on people — this page should make visitors feel the expertise, diversity, and personality of the creators. It should answer: "Who are these people and why should I learn from them?"

---

## Layout Options

### Option A: Magazine-Style Grid
- Large hero card for the lead creator/org owner
- Smaller cards in a responsive grid for other creators
- Each card: Large avatar, name, title/role, short bio, content count
- Asymmetric grid (some cards larger than others based on content volume)

### Option B: Directory Style
- Alphabetical or role-sorted list
- Two-column layout: Left sidebar with search/filter, right main area
- More formal, professional — good for large orgs (10+ creators)

### Option C: Featured + Grid
- Top section: 1-3 featured/spotlighted creators with expanded bios
- Below: Grid of all other creators
- Featured creators rotate or are admin-selected

### Option D: Card Deck with Detail Expansion
- Grid of uniform cards
- Clicking a card expands it inline (accordion-style) to show full bio + content
- No navigation away from the page — everything in-place

---

## Creator Card Design

### Essential Info
- **Avatar** (prominent, circular or rounded square, 120px+)
- **Name** (display name, not username)
- **Title / Role** (e.g., "Lead Yoga Instructor", "Meditation Guide")
- **Short Bio** (2-3 lines, truncated with "Read more")
- **Content Count**: "12 courses" or "47 lessons"
- **Joined Date**: "Member since 2024" (builds credibility)

### Enhancement Ideas
- **Specialty Tags**: "Yoga", "Breathwork", "Nutrition" — pill badges
- **Social Links**: Tiny icons for website, Twitter, Instagram, YouTube
- **"View Content" CTA**: Button linking to `/explore?creator={id}`
- **Featured Badge**: Star or crown icon for lead creator / org owner
- **Activity Indicator**: "Active — last published 3 days ago" or green dot
- **Student Count**: "2,400 students" (social proof)
- **Rating** (future): Star rating from content reviews

### Card Interactions
- Hover: Subtle elevation, background tint change
- Click: Navigate to creator's content within org (filtered explore) OR expand inline
- Avatar click: Opens creator profile in new tab (creators.*/username)

---

## Search & Filter

### Search
- "Find a creator" search input
- Searches: name, bio text, specialty tags
- Real-time filtering as you type

### Filters
- **Specialty/Category**: Filter by what they teach
- **Sort**: Most content, Most popular, Newest member, A-Z
- **Role**: All, Owners, Admins, Creators (if role visibility is appropriate)

---

## Sections

### 1. Page Header
- "Our Creators" title (or org-customizable: "Our Teachers", "Our Coaches", "The Team")
- Subtitle: "Meet the people behind {org name}"
- Stats bar: "15 creators • 230+ courses • 12,000 students"

### 2. Featured Creator Spotlight
- Full-width section for 1-2 highlighted creators
- Large avatar + full bio (paragraph, not truncated)
- Their best-selling content (2-3 cards)
- Quote/testimonial from the creator about the org
- "View All Content by {name}" CTA

### 3. All Creators Grid
- Standard creator cards
- Responsive: 3 columns desktop, 2 tablet, 1 mobile
- Sorted by: content count (default), then alphabetical

### 4. "Become a Creator" CTA (Conditional)
- Show only if org is accepting new creators
- Bottom of page: "Want to teach with us?"
- Brief description of what it means to create for this org
- "Apply" or "Contact Us" CTA
- Could link to external form or future creator application flow

### 5. Creator Map (Future, for in-person orgs)
- For orgs with geographically distributed creators
- Map view showing creator locations
- Useful for retreat/workshop orgs

---

## Creator Profile Inline Preview

When clicking a creator card, instead of (or in addition to) navigating away:

### Expanded Card / Drawer
- Slides out from right or expands inline
- Full bio
- Their content (last 5 items with thumbnails)
- Social links
- "View Full Profile" link to creators.*/username
- Close button to return to grid

---

## For Single-Creator Orgs

When there's only one creator (the org owner):
- Don't show a grid — show a full biography page instead
- Larger hero: Their photo, full story, credentials
- Below: Their content catalogue
- Personal touch: "Hi, I'm Sarah. Here's my story..."
- This page becomes their "About" page

---

## Responsive Behavior

### Desktop
- 3-column grid with featured section at top
- Sidebar search/filter on left (optional)

### Tablet
- 2-column grid
- Search above grid (no sidebar)

### Mobile
- Single column, cards stacked
- Swipeable featured creators carousel
- Search at top, collapsible

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Creator list | org membership API | Yes |
| Creator profiles | identity API | Yes |
| Content count per creator | content API (aggregated) | Needs endpoint |
| Student count per creator | analytics/purchase API | Needs endpoint |
| Specialty tags | creator profile or content categories | Partial |
| Featured creators | Admin setting | Not yet |
| Social links | identity API (profile) | Yes |

---

## Priority Ideas (Top 5)

1. **Rich creator cards** with avatar, role/title, bio, content count, specialty tags
2. **Featured creator spotlight** at top of page with expanded bio + content preview
3. **Search + sort controls** for quick creator discovery
4. **Stats header** showing collective credibility ("15 creators, 230+ courses")
5. **Inline creator preview** (expandable card or drawer) to avoid navigating away
