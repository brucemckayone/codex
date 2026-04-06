# Creator Profile Page — Feature Ideation

**Route**: `creators.revelations.studio/{username}` → `_creators/[username]/+page.svelte`
**Current state**: Basic profile with name, bio, and content list. Very minimal.
**Priority**: HIGH — this is the creator's personal brand page, their digital identity.

---

## Vision

The creator profile is a **personal brand page** — part portfolio, part storefront, part social profile. It should communicate who this person is, what they create, and why you should learn from them. Think Linktree meets Substack author page meets personal website.

---

## Layout Ideas

### Option A: Hero + Sections
- Large hero banner (customizable background image/color)
- Avatar (large, overlapping hero)
- Name, title/tagline, social links
- Tabbed sections below: Content | About | Organizations

### Option B: Two-Column
- Left sidebar: Avatar, name, bio, social links, stats (sticky on desktop)
- Right main: Content grid, about section, org affiliations

### Option C: Magazine Cover
- Full-viewport hero with creator's image as background
- Name + tagline overlaid
- Scroll down to content sections
- Dramatic, personal, impactful

---

## Profile Header

### Essential Elements
- **Avatar** (large, 160px+)
- **Display Name** (prominent)
- **Title/Tagline**: "Yoga Instructor & Mindfulness Coach"
- **Bio**: 2-3 paragraph personal description
- **Location** (optional): "London, UK"
- **Social Links**: Website, Twitter, Instagram, YouTube, TikTok — icon row
- **Join Date**: "Teaching on Codex since 2025"

### Stats Strip
- "47 courses • 2,400 students • 4.8 average rating"
- Quick credibility indicators
- Clickable: "47 courses" scrolls to content section

### Action Buttons
- "Follow" (future) — follow for updates
- "Contact" (future) — direct message
- "Share Profile" — copy link / share to social

---

## Content Sections

### 1. Featured Content
- Creator's hand-picked top items (2-3 large cards)
- These are their "best work" — what they want you to see first
- Large thumbnails, full descriptions, prominent CTAs

### 2. All Content
- Grid of all published content by this creator
- Includes content from personal profile AND from orgs they create for
- Each card shows: Org badge (if from an org), title, thumbnail, price, type icon
- Filter by: Type, Category, Price range, Org
- Sort by: Newest, Popular, Price

### 3. Organization Affiliations
- "Creates for" section showing orgs they belong to
- Org logo + name + their role
- Link to org subdomain
- "View my content on {Org Name}" CTA
- Shows the breadth of their work across collectives

### 4. About / Bio (Expanded)
- Full-length bio/story
- Credentials, certifications, experience
- Teaching philosophy or mission statement
- Photos (future): Gallery of teaching/work photos

### 5. Testimonials (Future)
- Student quotes about this specific creator
- Rating summary
- "What students say about {name}"

---

## Creator Call-to-Action Ideas

### For Non-Customers
- "Start with my free content" — highlighted free items
- "Browse all courses" — link to content section
- "Join {Org Name}" — if creator belongs to an org

### For Existing Customers
- "Continue watching" — their in-progress content by this creator
- "New from {Name}" — content added since last visit
- "Rate your experience" (future)

---

## Mobile Layout

- Stacked: Avatar + name, bio (truncated), stats, content grid
- Swipeable content carousel
- Social links as floating action button or in expandable footer
- "Share" button in header

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Creator profile | identity API | Yes |
| Creator's content | content API (by creator) | Yes |
| Org affiliations | org membership API | Yes |
| Social links | identity API | Yes |
| Content stats | analytics API | Partial |
| Student count | analytics/purchase API | Needs endpoint |
| Featured content | Creator setting | Not yet |
| Testimonials | Not built | Future |

---

## Priority Ideas (Top 5)

1. **Rich profile header** with avatar, tagline, stats strip, social links
2. **Featured content section** (creator-curated top picks)
3. **Organization affiliations** showing where else they create
4. **Content grid with org badges** distinguishing personal vs org content
5. **Share profile** functionality for social promotion
