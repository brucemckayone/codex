# Frontend Component Catalog

**Status**: Draft
**Framework**: Svelte
**Styling**: Tailwind CSS + Shadcn-Svelte (likely)
**Last Updated**: 2026-01-09

This document lists the reusable UI components required for the Codex Platform, grouped by domain and usage.

---

## 1. Shared / Atomic Components
*Foundational elements used across all layouts.*

*   **Buttons**:
    *   `Button` (Primary, Secondary, Outline, Ghost, Destructive variants)
    *   `IconButton` (For actions like "Close", "Menu")
*   **Inputs & Forms**:
    *   `TextField` (Label, Input, Error Message)
    *   `TextArea`
    *   `Select` / `Combobox`
    *   `Switch` (Toggle)
    *   `Checkbox`
    *   `RadioGroup`
    *   `FileUpload` (Drag & drop zone)
*   **Feedback**:
    *   `Toast` (Notifications via Sonner or similar)
    *   `Spinner` (Loading state)
    *   `ProgressBar` (For uploads/playback)
    *   `Alert` (Inline warning/info boxes)
    *   `Skeleton` (Loading placeholders)
*   **Display**:
    *   `Badge` (Status indicators: "Draft", "Published")
    *   `Avatar` (User images with fallback initials)
    *   `Card` (Container with Header, Content, Footer)
    *   `Table` (Sortable, paginated data grid)
    *   `DropdownMenu`
*   **Overlay**:
    *   `Dialog` / `Modal`
    *   `Sheet` / `Drawer` (Side panels)
    *   `Tooltip`

---

## 2. Layout Components
*Structural wrappers for specific route groups.*

*   **Public**:
    *   `PublicHeader`: Logo, Nav Links, Auth Buttons, Cart Icon.
    *   `PublicFooter`: Copyright, Links.
*   **App / Authenticated**:
    *   `AppSidebar`: Vertical navigation for User/Creator/Admin.
    *   `UserMenu`: Dropdown for profile/logout.
    *   `OrgSwitcher`: Dropdown to toggle context (if multi-tenant).
    *   `PageHeader`: Title + Breadcrumbs + Primary Action.

---

## 3. Authentication (Auth)
*Forms for identity management.*

*   `LoginForm`: Email/Password inputs.
*   `RegisterForm`: Name/Email/Password.
*   `ForgotPasswordForm`: Email input.
*   `ResetPasswordForm`: New password inputs.
*   `AuthCard`: Centered wrapper with branding.

---

## 4. Storefront (Public)
*Components for the shopping experience.*

*   `HeroSection`: Big banner for featured content.
*   `ContentGrid`: Responsive grid layout for products.
*   `ProductCard`:
    *   Thumbnail, Title, Author, Price.
    *   "Buy" or "View" action.
*   `SearchFilters`: Sidebar or bar for filtering content.
*   `ProductHero`: Detail page header (Title, Description, Buy Button).
*   `MediaPreview`: 30s video player for teasers.
*   `PurchaseAction`: Handles "Buy" vs "Go to Library" logic.

---

## 5. User Portal (Consumer)
*Components for consuming content.*

*   `LibraryGrid`: Filterable grid of owned content.
*   `ResumeWatchingRow`: Horizontal scroll of active items.
*   `LibraryCard`: Product card variant with progress bar.
*   **Video Player**:
    *   `HLSPlayer`: Core video element wrapper.
    *   `PlayerControls`: Custom UI (Play, Seek, Volume, Quality).
    *   `ChapterList`: Sidebar for video navigation.
    *   `NextUpOverlay`: End-screen suggestion.

---

## 6. Creator Studio
*Components for content management.*

*   **Media**:
    *   `UploadZone`: Large drop area handling multi-file uploads.
    *   `MediaList`: Data table of files with status badges.
    *   `MediaDetailSidebar`: Edit form for media metadata.
*   **Content Editor**:
    *   `ContentForm`: Multi-step or long form for creating products.
    *   `MediaPicker`: Modal to select from Media Library.
    *   `ThumbnailUploader`: Specific image upload crop/preview.
    *   `PriceInput`: Currency input handling.
    *   `VisibilitySelector`: Radio group for access rules.

---

## 7. Admin Dashboard
*Components for platform owners.*

*   **Analytics**:
    *   `StatsCard`: Value + Trend indicator.
    *   `RevenueChart`: Visual graph of income.
    *   `TopContentList`: Ranked table.
*   **Management**:
    *   `CustomerTable`: Users with search/filter.
    *   `CustomerProfile`: Detail view with purchase history.
    *   `GrantAccessModal`: Admin action form.
*   **Settings**:
    *   `BrandingForm`: Logo upload + Color pickers.
    *   `FeatureToggles`: List of switches.
