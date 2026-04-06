# Org Studio Content Management — Feature Ideation

**Routes**:
- Content list: `{slug}.*/studio/content`
- New content: `{slug}.*/studio/content/new`
- Edit content: `{slug}.*/studio/content/{id}/edit`
**Current state**: Basic content list with table view. Create/edit forms exist. Functional but sparse.
**Priority**: HIGH — this is the core workflow for content creators.

---

## Content List Page

### Current State
- Table with title, status, type, date columns
- Basic status badges
- Create button

### Improvement Ideas

#### View Options
- **Table View** (current, improved): Add more columns, bulk actions, inline editing
- **Grid/Card View**: Visual cards with thumbnails, ideal for visual content
- **Kanban View**: Columns by status (Draft → Pending → Published → Archived)
- Toggle between views, save preference

#### Enhanced Table
- Columns: Thumbnail, Title, Status, Type, Creator, Category, Price, Views, Purchases, Revenue, Date
- Sortable by any column (click header)
- Column visibility toggle (show/hide columns)
- Row hover: Quick action icons (edit, preview, publish, duplicate, archive)
- Multi-select with checkboxes for bulk actions

#### Filters & Search
- Search: Title, description, tags
- Filter by: Status (draft/published/archived), Type (video/audio/written), Category, Creator, Price range, Date range
- Active filter chips with clear
- Save filter presets: "My Drafts", "Published Videos", "Best Sellers"

#### Bulk Actions
- Select multiple items → action bar appears at top:
  - "Publish Selected" (for drafts)
  - "Archive Selected"
  - "Delete Selected" (with confirmation)
  - "Change Category"
  - "Export Selected"
- Select all / deselect all

#### Quick Inline Actions
- Toggle publish status directly from the table (switch toggle)
- Quick edit price without opening edit form
- Duplicate content (copy as new draft)
- Quick preview: Eye icon opens content in new tab

#### Status Badges
- **Draft**: Muted gray, "Draft" text
- **Published**: Green dot, "Published" text, with date
- **Archived**: Orange, "Archived"
- **Processing**: Blue spinner, "Processing media..."
- **Failed**: Red warning, "Media processing failed" with retry link

#### Content Stats Mini
- Small sparkline chart next to each item showing views trend (last 7 days)
- Revenue column with currency formatting
- "Top seller" badge for highest-revenue items

---

## Create Content Page

### Current Flow
1. Choose content type → Fill form → Save as draft → Publish

### Improved Flow Ideas

#### Step-by-Step Wizard
1. **Type Selection**: Choose Video, Audio, or Written with visual cards
2. **Media Selection**: Pick from media library or upload new
3. **Details**: Title, description, category, tags
4. **Pricing**: Free, fixed price, or "coming soon" (future: included in subscription)
5. **Preview & Publish**: Review everything, publish or save as draft

#### Media Selection
- Browse media library inline (filterable grid)
- Upload new media directly from this flow
- Show media processing status
- Preview selected media (video thumbnail, audio waveform)
- "Recently uploaded" section for quick access

#### Rich Description Editor
- Markdown editor with preview
- Formatting toolbar: Bold, italic, headers, lists, links, images
- Character count / word count
- Preview toggle: "How customers will see this"

#### Auto-Save
- Auto-save draft every 30 seconds
- "Saved at 2:34 PM" indicator
- Prevent data loss on accidental navigation
- "Unsaved changes" warning if leaving page

#### Metadata Enhancement
- **Slug**: Auto-generated from title, editable
- **SEO Preview**: Show how it will appear in Google search results
- **Thumbnail**: Auto-generated from video, or upload custom
- **Difficulty Level**: Beginner / Intermediate / Advanced selector
- **Estimated Duration**: Auto-calculated from media, or manual override
- **Prerequisites**: "Recommended before this: [link to other content]"
- **Tags**: Autocomplete from existing tags + create new

#### Pricing Section
- Price input with currency symbol (£)
- "Free" toggle (sets price to 0)
- Compare: "Average price for similar content: £25"
- Future: "Include in subscription tiers" checkboxes
- Future: "Promotional price" with date range

#### Resource Attachments
- Upload PDFs, workbooks, templates
- Reorder attachments via drag-and-drop
- Per-resource: Title, description, file
- Preview uploaded files
- "Customers can download these after purchase"

---

## Edit Content Page

### Same as Create, Plus:
- **Version history** (future): See previous edits, revert
- **Publishing controls**: Publish / Unpublish / Schedule publish date
- **Performance panel**: Views, purchases, revenue for this item (sidebar)
- **Preview**: "View as customer" button → opens public page in new tab
- **Duplicate**: "Create copy as new draft" button
- **Delete**: With confirmation dialog, soft-delete behavior

---

## Content Scheduling (Future)

- Set publish date/time in the future
- Calendar view of scheduled publishes
- "Scheduled for April 10 at 9:00 AM" badge
- Auto-publish at scheduled time
- "Promote" option: Schedule social media/email announcement

---

## Responsive Behavior

### Desktop
- Full table with all columns
- Sidebar filters
- Inline quick actions on hover

### Tablet
- Reduced columns (thumbnail, title, status, actions)
- Dropdown filters
- Card view preferred

### Mobile
- Card view only (no table)
- Stack filter chips horizontally
- Full-screen create/edit form
- Bottom action bar for bulk actions

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Content list (paginated) | content API | Yes |
| Content CRUD | content API | Yes |
| Media library | media API | Yes |
| Categories/tags | content API | Partial |
| Content analytics | analytics API | Partial |
| Bulk operations | content API (batch) | Needs endpoint |
| Version history | Not built | Future |
| Scheduled publish | Not built | Future |

---

## Priority Ideas (Top 5)

1. **View toggle** (table/grid/kanban) with improved table columns and sortability
2. **Bulk actions** for publishing, archiving, deleting multiple items
3. **Step-by-step create wizard** replacing single long form
4. **Auto-save drafts** with "unsaved changes" protection
5. **Content performance mini-stats** (views, revenue) visible in list view
