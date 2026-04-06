# Org Landing Page — Feature Ideation

**Route**: `{slug}.revelations.studio/` → `_org/[slug]/(space)/+page.svelte`
**Current state**: Sparse. Only shows featured content in a basic grid. No hero, no personality, no storytelling.
**Priority**: CRITICAL — this is the first thing anyone sees when visiting an org subdomain.

---

## Vision

The org landing page is the **front door** of a collective. It should answer three questions in seconds:
1. **What is this place?** (identity + mission)
2. **What can I find here?** (content preview + navigation)
3. **Who makes this happen?** (creators + community)

Think of it as a **magazine cover** — bold, branded, immediately communicating the org's personality through the brand tokens (colors, typography, density, shadow style).

---

## Hero Section Ideas

### Option A: Cinematic Hero
- Full-width branded background (org's primary color or hero image from branding settings)
- Org logo (large, centered or left-aligned)
- Org tagline/mission statement (1-2 sentences)
- Prominent CTA: "Explore Content" / "Start Learning" / customizable
- Secondary CTA: "Meet Our Creators" or "View Pricing"
- Optional: Background video loop (30s preview of featured content)

### Option B: Featured Content Hero
- Large featured content item takes center stage (like Netflix hero)
- Content thumbnail/preview as background with gradient overlay
- Content title, creator name, price badge
- "Watch Preview" + "Buy Now" CTAs
- Org branding overlay (logo in corner, brand colors in gradient)

### Option C: Split Hero
- Left: Org identity (logo, name, mission, CTA)
- Right: Auto-rotating featured content card or creator spotlight
- Responsive: stacks vertically on mobile

### Option D: Stats-Driven Hero
- Org name + tagline
- Key stats strip: "47 Courses • 12 Creators • 2,400 Students"
- Immediately builds credibility and scale
- CTA below stats

### Option E: Seasonal/Dynamic Hero
- Admin can set a "hero mode" in branding settings
- Rotate between: Featured content, New release announcement, Event promotion, Custom message
- Time-based: Different hero for morning/evening (wellness orgs love this)

---

## Content Sections (Below Hero)

### 1. Featured Content Row
- **Current**: Basic grid of featured items
- **Improved**: Horizontal scrollable carousel with large cards
- Card design: Thumbnail (16:9), title, creator avatar + name, price badge, "Free" / "£29" / "Purchased"
- "View All" link to /explore
- Category pill badges on each card
- Progress indicator if user has started watching

### 2. Continue Watching (Authenticated Users)
- Only shows if user has in-progress content from this org
- Horizontal row with progress bars on thumbnails
- "Resume" button on each card
- "See Library" link
- This is high-value real estate for retention

### 3. New Releases / Recently Added
- Chronologically sorted, newest first
- Subtitle: "Added this week" or "New in April"
- Limited to 4-6 items, "See All New" link
- Animated "NEW" badge on cards added in last 7 days

### 4. Categories / Topics Strip
- Horizontal row of category pills/tags
- Click to filter or navigate to /explore?category=X
- Icons per category (optional, from icon library)
- Visually represents the breadth of content

### 5. Creator Spotlight
- 1-3 featured creators with:
  - Avatar (large)
  - Name + role/title
  - Short bio (1 sentence)
  - "X courses" count
  - Link to their profile within the org
- "Meet All Creators" CTA → /creators
- Rotates/features different creators periodically

### 6. Popular / Trending Content
- "Most watched this month" or "Trending now"
- Algorithm: Most purchases + most views in last 30 days
- Shows social proof (purchase count or "500+ students")
- Separate from "Featured" which is curated by admin

### 7. Testimonials / Social Proof
- Customer quotes with attribution
- Star ratings (future feature)
- "Join 2,400+ learners" banner
- Trust badges (secure checkout, money-back guarantee)

### 8. Content Bundles / Collections
- Curated collections: "Beginner's Path", "Advanced Series", "Complete Library"
- Card showing: Bundle name, item count, total value vs bundle price
- "Save 40%" type messaging
- Links to bundle detail page

### 9. Org About Section
- Condensed mission/about paragraph
- "Learn More" → /about (if org has an about page)
- Could include: Founded date, total content hours, team size
- Social media links

### 10. Email Signup / Newsletter
- "Stay updated with new releases"
- Simple email input + subscribe button
- Future: integrates with notifications service

### 11. Upcoming Events (Future-Ready)
- Placeholder section for offerings system
- "Coming Soon" or hidden until offerings feature ships
- When available: Next 3 upcoming events with date, time, spots remaining

---

## Layout Variations

### For Small Orgs (< 10 content items)
- Emphasize hero + about section
- Show ALL content (no need for "see more")
- Prominent creator bios
- Focus on mission/story over volume

### For Large Orgs (50+ content items)
- Category navigation becomes critical
- Featured/trending algorithms matter
- Consider "paths" or "learning journeys"
- More horizontal carousels, less vertical scroll

### For Single-Creator Orgs
- Merge creator spotlight INTO the hero
- The org IS the creator — make it personal
- Show the creator's face, their story
- More intimate, less corporate

---

## Interactive Elements

- **Search bar**: Quick search across this org's content (top of page or in hero)
- **Category filter chips**: Horizontal scrollable, filter content sections in-place
- **Content card hover**: Expand card slightly, show preview thumbnail animation, display brief description
- **Scroll-triggered animations**: Sections fade in as user scrolls (subtle, brand-speed-appropriate)
- **"Back to top" button**: Appears after scrolling past hero
- **Notification bell**: If logged in, show "New: 3 items added since your last visit"

---

## Mobile Considerations

- Hero shrinks to 60vh, stacked layout
- Horizontal carousels become swipeable with momentum scrolling
- Category pills become scrollable row
- Creator spotlight shows 1 at a time (swipeable)
- Bottom sticky CTA bar: "Explore Content" or "Continue Watching"
- Touch-friendly card sizes (min 280px wide)

---

## Personalization Ideas

### Unauthenticated Visitors
- Emphasis on discovery: "Here's what we offer"
- CTA: Register / Sign Up
- Show pricing transparency
- Feature free content to lower barrier

### Authenticated, No Purchases
- "Start your journey" messaging
- Recommend based on browse history (future)
- Highlight free content
- Show "popular with new members"

### Authenticated, Has Purchases
- Lead with "Continue Watching"
- Show "Because you watched X, try Y" (future)
- "New since your last visit" section
- De-emphasize CTA to buy, emphasize engagement

---

## Data Requirements

| Section | Data Source | Exists? |
|---------|------------|---------|
| Hero / org info | org branding settings | Yes |
| Featured content | content API (featured flag) | Yes |
| Continue watching | library/progress collections | Yes |
| New releases | content API (sort by createdAt) | Yes |
| Categories | content API (distinct categories) | Partial |
| Creator spotlight | org membership API | Yes |
| Popular/trending | analytics API or content API | Needs work |
| Testimonials | Not yet built | No |
| Bundles | Not yet built | No |
| Upcoming events | offerings system | Future |

---

## Design Inspiration

- **Masterclass.com**: Cinematic hero, creator-centric, premium feel
- **Skillshare**: Category browsing, personalized recommendations
- **Patreon**: Creator-first, community feel, tiers
- **Substack**: Clean, calm, content-focused
- **Notion's landing page**: Clear value prop, feature previews, social proof
- **Apple TV+**: Featured content hero with trailer autoplay

---

## Priority Ideas (Top 5)

1. **Proper hero section** with org logo, tagline, and branded background
2. **Continue Watching row** for authenticated users with progress
3. **Creator spotlight** section showing who makes the content
4. **Category navigation strip** for quick content discovery
5. **New releases section** with "NEW" badges and chronological sort
