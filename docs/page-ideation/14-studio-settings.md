# Org Studio Settings — Feature Ideation

**Routes**:
- General: `{slug}.*/studio/settings`
- Branding: `{slug}.*/studio/settings/branding`
**Current state**: General settings form + brand editor (v2 in progress with floating panel).
**Priority**: MEDIUM — configuration pages, used occasionally but important.

---

## General Settings Page

### Organization Identity
- **Org Name**: Editable text input
- **Org Slug**: Subdomain, editable with availability check + confirmation
- **Description**: Textarea for org mission/about
- **Contact Email**: Public contact address
- **Website URL**: External website link

### Social Links
- Twitter, Instagram, YouTube, Facebook, LinkedIn, TikTok
- URL inputs with icon previews
- "Add more" button for additional platforms

### Content Defaults
- Default content visibility: Published / Draft
- Default pricing currency (GBP, USD, EUR, etc.)
- Content categories management:
  - Add/remove/reorder categories
  - Category icon selector
  - Used across content creation and explore filtering

### Feature Toggles (Future)
- Enable/disable features for this org:
  - Show "Creators" page
  - Allow customer reviews
  - Enable content downloads
  - Show pricing publicly
  - Enable waitlists for offerings

### Danger Zone
- "Delete Organization" — with multi-step confirmation
- "Transfer Ownership" — change who owns the org
- Visually distinct (red border, warning styling)

---

## Branding Page

### Current State
- Brand editor v2 with floating panel (live editing on public pages)
- Colors, typography, density, shadows
- See `docs/brand-editor-design-spec.md` for full spec

### Additional Branding Ideas

#### Logo Management
- Upload primary logo (used in header)
- Upload favicon (browser tab icon)
- Upload og:image (social sharing default image)
- Dark mode / light mode logo variants
- Logo size/position controls

#### Hero Configuration
- Choose hero style for landing page (Cinematic / Featured Content / Split / Stats)
- Upload hero background image
- Set hero tagline text
- CTA button text customization
- Hero video URL (for cinematic mode)

#### Custom Pages (Future)
- Customize "About" page content
- Add custom pages (e.g., "FAQ", "Terms of Service")
- Rich text editor for page content
- Custom page URL slugs

#### Email Branding (Future)
- Customize email header/footer
- Email color scheme matching org brand
- Preview email templates with current branding

#### Advanced Theming
- Dark mode toggle for public pages
- Typography scale adjustment
- Custom CSS injection (advanced, power users only)
- Brand presets: "Professional", "Playful", "Minimal", "Bold"

---

## Settings Navigation

### Tab Layout
- Currently: General | Branding
- Future tabs: General | Branding | Domains | Integrations | Advanced

### Domain Settings (Future)
- Custom domain setup: "yourdomain.com"
- DNS configuration instructions
- SSL certificate status
- Subdomain management

### Integrations (Future)
- Connect external services:
  - Google Analytics
  - Facebook Pixel
  - Mailchimp/ConvertKit
  - Zapier webhooks
  - Custom webhook URLs

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Org settings CRUD | org API | Yes |
| Branding settings | identity/platform settings API | Yes |
| Category management | content API | Partial |
| Logo upload | R2 upload | Yes |
| Feature toggles | platform settings API | Partial |
| Custom domains | Not built | Future |
| Integrations | Not built | Future |

---

## Priority Ideas (Top 5)

1. **Category management** interface (add/remove/reorder content categories)
2. **Hero configuration** for customizing the org landing page hero section
3. **Logo management** with primary, favicon, and social share image uploads
4. **Social links** management with all major platforms
5. **Settings tab navigation** that scales to future settings pages
