# Org Content Detail Page — Feature Ideation

**Route**: `{slug}.revelations.studio/content/{contentSlug}` → `_org/[slug]/(space)/content/[contentSlug]/+page.svelte`
**Current state**: Shows content info + video player. Has purchase CTA and preview clip support. Basic layout.
**Priority**: CRITICAL — this is the conversion page. Users decide to buy (or not) here.

---

## Vision

This is the **product page** — the single most important page for revenue. It must do three things brilliantly:
1. **Sell the content** to non-owners (preview, description, social proof, clear pricing)
2. **Deliver the content** to owners (player, progress, resources)
3. **Upsell related content** to everyone

Think Amazon product page meets Netflix content detail meets Masterclass lesson page.

---

## Two States

### State 1: Preview (Not Purchased)
The user doesn't own this content. The page must convince them to buy.

### State 2: Full Access (Purchased/Free)
The user owns this content. The page must deliver the best viewing experience.

---

## Preview State Layout

### Hero Section
- **Preview video player**: Auto-plays the 30-second preview clip (muted, with play button overlay)
- Or: Static thumbnail with "Watch Preview" button overlay
- Below player: "This is a preview. Purchase to watch the full video."
- Prominent purchase CTA: "Buy for £29" (large, brand-colored button)
- "Get Free Access" for free content (green, inviting)
- Payment trust signals: Stripe badge, secure checkout icon, money-back text

### Content Info
- **Title** (large, prominent)
- **Creator**: Avatar + name + link to their profile
- **Description**: Full content description (expandable "Read more" for long text)
- **Metadata strip**: Duration, Content type, Category, Date published, Difficulty level
- **Tags**: Clickable tag pills linking to explore filtered by tag

### Pricing Section
- Price displayed prominently: "£29.00"
- If on sale (future): Strikethrough original price + sale price + "Save 40%"
- "Included in subscription" badge (future, when subscriptions ship)
- "Buy Now" primary CTA
- "Add to Wishlist" secondary CTA (future)

### What You'll Get
- Bulleted list of what's included:
  - "45-minute HD video"
  - "Downloadable PDF workbook"
  - "Lifetime access"
  - "Watch on any device"
  - "Progress tracking"

### Social Proof
- Purchase count: "1,200+ students have purchased this"
- Reviews/ratings (future): Star rating + review excerpts
- Creator credibility: "By Sarah, who has taught 5,000+ students"

### Related Content
- "More from {Creator Name}": 3-4 cards
- "Similar content": Same category, different creators
- "Customers also purchased": (future, based on purchase patterns)
- "Complete the collection": If this is part of a series/bundle

### Bundle Upsell
- If this content is included in a bundle: "This is included in 'Complete Yoga Library' — Save 60%"
- Shows bundle card with price comparison
- Can upsell to bundle instead of individual purchase

---

## Full Access State Layout

### Video Player Section
- **Full video player** (Media Chrome + HLS)
- Controls: Play/pause, seek, volume, quality selector, fullscreen, playback speed
- Progress bar with chapter markers (future)
- "Pick up where you left off" — auto-resumes from saved position
- Keyboard shortcuts: Space (play/pause), Arrow keys (seek ±10s), F (fullscreen)
- Picture-in-Picture support
- Autoplay next (if part of series)

### Below Player
- **Content description** (same as preview, but less prominent)
- **Resources section**: Downloadable files (PDFs, workbooks, audio)
  - Each resource: Icon, filename, file size, "Download" button
  - Progress: "1 of 3 resources downloaded"
- **Notes section** (future): Personal notes while watching
  - Timestamped: Click a note to jump to that point in the video
  - Export notes as PDF

### Progress & Completion
- "X% complete" progress indicator
- "Mark as Complete" button
- Completion celebration: Confetti or "Well done!" animation (subtle)
- "Rate this content" prompt on completion (future)
- Certificate download on completion (future)

### Related Content (Same as Preview, but Different Emphasis)
- "Continue your learning": Next item in series or suggested follow-up
- "From your library": Other owned content
- De-emphasize purchase CTAs since they're already a customer

---

## Series/Collection Experience (Future)

If the content is part of a series:
- **Series sidebar**: Show all items in the series as a playlist
  - Current item highlighted
  - Completed items with checkmark
  - Next up indicator
  - Click to navigate between items
- "Episode X of Y" indicator
- Auto-play next episode toggle
- Series progress: "3 of 8 complete"

---

## Content Type Variations

### Video Content
- Full video player with HLS streaming
- Quality selector, speed control, captions (future)
- Preview clip for non-owners

### Audio Content
- Audio player with waveform visualization
- Mini-player that persists while scrolling
- Background playback (future PWA)
- Transcript alongside player (future)

### Written Content
- Clean reading layout (article/blog style)
- Estimated read time
- Table of contents for long pieces
- Print-friendly version
- Highlight and share quotes (future)

---

## Mobile Considerations

- Video player goes full-width, aspect ratio maintained
- Description collapses to expandable summary
- Purchase CTA becomes sticky bottom bar
- Resources listed as compact download links
- Swipeable related content carousel
- Floating mini-player when scrolling past video (PiP)

---

## Accessibility

- Video captions/subtitles support
- Keyboard-navigable player controls
- Screen reader descriptions for all interactive elements
- High contrast mode for player controls
- Reduced motion option (no autoplay)

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Content metadata | content API | Yes |
| Preview clip URL | media/content API | Yes |
| Full video URL | access API (signed) | Yes |
| Purchase status | access/purchase API | Yes |
| Watch progress | progress collection | Yes |
| Resources | content API (attachments) | Partial |
| Related content | content API (same category) | Needs work |
| Purchase count | analytics API | Needs endpoint |
| Reviews/ratings | Not built | Future |
| Series membership | Not built | Future |

---

## Priority Ideas (Top 5)

1. **Two-state layout** with clear preview vs full-access experience
2. **Purchase CTA section** with price, trust signals, "what you get" list
3. **Auto-resume playback** from saved progress position
4. **Resources section** for downloadable attachments
5. **Related content recommendations** for upselling and continued engagement
