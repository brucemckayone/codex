# Code Simplification Findings

> Systematic audit of recently-changed frontend files for opportunities to reduce code volume
> while maintaining identical behavior and performance.

## What to Flag
1. **Oversized components**: Components >250 lines with clearly extractable sections
2. **Verbose patterns**: Code that could be written more concisely (ternaries, early returns, optional chaining)
3. **Unnecessary intermediate state**: `$state()` vars that could be `$derived()` or inline
4. **Dead code**: Unreachable branches, unused imports, commented-out blocks, unused variables
5. **Over-engineering**: Abstractions used only once, unnecessary wrapper functions
6. **CSS that could use utilities**: Inline styles duplicating utility classes from utilities.css
7. **Svelte 5 anti-patterns**: Legacy patterns (`$:`, `$app/stores`), missing rune usage
8. **Unnecessary type assertions**: `as any`, `as unknown as X`, overly loose types
9. **Redundant null checks**: Checks for conditions that can't happen given the data flow

## Severity Scale
- **P0 Critical**: Dead code or anti-pattern that causes bugs or confusion
- **P1 Major**: Significant simplification possible (>30% reduction in a block)
- **P2 Minor**: Moderate simplification (cleaner but similar LOC)
- **P3 Nit**: Style preference, minor cleanup

---

## Files Reviewed

| # | File | Status | Issues |
|---|------|--------|--------|
| 1 | brand-editor/brand-editor-store.svelte.ts | Reviewed | 3 issues |
| 2 | brand-editor/css-injection.ts | Reviewed | 2 issues |
| 3 | brand-editor/index.ts | Reviewed | 1 issue |
| 4 | brand-editor/levels.ts | Reviewed | Clean |
| 5 | brand-editor/oklch-math.ts | Reviewed | Clean |
| 6 | brand-editor/palette-generator.ts | Reviewed | Clean |
| 7 | brand-editor/presets.ts | Reviewed | Clean |
| 8 | brand-editor/types.ts | Reviewed | Clean |
| 9 | components/brand-editor/BrandEditorFooter.svelte | Reviewed | 1 issue |
| 10 | components/brand-editor/BrandEditorHeader.svelte | Reviewed | 2 issues |
| 11 | components/brand-editor/BrandEditorPanel.svelte | Reviewed | 3 issues |
| 12 | components/brand-editor/color-picker/ColorInput.svelte | Reviewed | 1 issue |
| 13 | components/brand-editor/color-picker/HueSlider.svelte | Reviewed | Clean |
| 14 | components/brand-editor/color-picker/OklchColorArea.svelte | Reviewed | 1 issue |
| 15 | components/brand-editor/color-picker/OklchColorPicker.svelte | Reviewed | 2 issues |
| 16 | components/brand-editor/color-picker/SwatchRow.svelte | Reviewed | Clean |
| 17 | components/brand-editor/levels/BrandEditorColors.svelte | Reviewed | Clean |
| 18 | components/brand-editor/levels/BrandEditorFineTuneColors.svelte | Reviewed | Clean |
| 19 | components/brand-editor/levels/BrandEditorFineTuneTypography.svelte | Reviewed | 1 issue |
| 20 | components/brand-editor/levels/BrandEditorHome.svelte | Reviewed | 2 issues |
| 21 | components/brand-editor/levels/BrandEditorLogo.svelte | Reviewed | Clean |
| 22 | components/brand-editor/levels/BrandEditorPresets.svelte | Reviewed | Clean |
| 23 | components/brand-editor/levels/BrandEditorShadows.svelte | Reviewed | 1 issue |
| 24 | components/brand-editor/levels/BrandEditorShape.svelte | Reviewed | 1 issue |
| 25 | components/brand-editor/levels/BrandEditorTypography.svelte | Reviewed | Clean |
| 26 | components/studio/ActivityFeed.svelte | Reviewed | 2 issues |
| 27 | components/studio/content-form/PublishSidebar.svelte | Reviewed | 3 issues |
| 28 | components/studio/content-form/ThumbnailUpload.svelte | Reviewed | 2 issues |
| 29 | components/studio/ContentForm.svelte | Reviewed | 4 issues |
| 30 | components/studio/ContentTable.svelte | Reviewed | 1 issue |
| 31 | components/studio/CustomerDetailDrawer.svelte | Reviewed | 3 issues |
| 32 | components/studio/CustomerTable.svelte | Reviewed | Clean |
| 33 | components/studio/EditMediaDialog.svelte | Reviewed | 2 issues |
| 34 | components/studio/GrantAccessDialog.svelte | Reviewed | Clean |
| 35 | components/studio/InviteMemberDialog.svelte | Reviewed | 2 issues |
| 36 | components/studio/LogoUpload.svelte | Reviewed | 2 issues |
| 37 | components/studio/MediaCard.svelte | Reviewed | 2 issues |
| 38 | components/studio/MediaGrid.svelte | Reviewed | Clean |
| 39 | components/studio/MediaPicker.svelte | Reviewed | 3 issues |
| 40 | components/studio/MediaUpload.svelte | Reviewed | 2 issues |
| 41 | components/studio/MemberTable.svelte | Reviewed | 3 issues |
| 42 | components/studio/TopContentTable.svelte | Reviewed | 2 issues |
| 43 | components/studio/publish-toggle.ts | Reviewed | Clean |

**Summary**: 43 files reviewed. 27 files with findings, 16 clean. 52 total issues found.

---

## Findings

### brand-editor-store.svelte.ts -- 3 issues

**File**: `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts`
**Lines**: 334 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 56-59 | P2 | Verbose | `isDirty` uses `JSON.stringify` comparison on every read | Cache stringified saved value in a `$derived` to avoid double-stringify, or use a deep-equal utility |
| 193-204 | P2 | Verbose | `applyPreset` manually copies 8 fields from preset.values | Use `Object.assign(state.pending, values)` or spread: `state.pending = { ...state.pending, ...preset.values }` to reduce 8 lines to 1 |
| 276-316 | P3 | Over-engineering | 15 reactive getters on the export object that just forward state/derived values | Consider exporting `state` as readonly with a type-narrowed interface, or use a Proxy pattern to avoid 40 lines of boilerplate getters |

---

### css-injection.ts -- 2 issues

**File**: `apps/web/src/lib/brand-editor/css-injection.ts`
**Lines**: 202 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 117-130 + 174-183 | P1 | Duplication | Style removal loop (iterate inline styles, collect --color-/--brand- props, remove) is duplicated in both `injectBrandVars` and `clearBrandVars` | Extract `removeOverrideVars(el: HTMLElement, excludeProps?: Set<string>)` helper -- saves ~15 lines |
| 143-157 | P3 | Verbose | Dark mode var map is a hand-maintained Record that mirrors ThemeColors keys | Could derive from the `ThemeColors` type or a shared constant to avoid drift |

---

### index.ts -- 1 issue

**File**: `apps/web/src/lib/brand-editor/index.ts`
**Lines**: 38 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 1-38 | P3 | Over-engineering | Barrel re-exports every single symbol from 6 modules including types that are only used internally | Only re-export what consumers actually import. Check for unused exports with `grep` -- likely `CssVarMapping`, `LevelDepth`, `PaletteResult` are internal-only |

---

### BrandEditorFooter.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/BrandEditorFooter.svelte`
**Lines**: 66 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 54-59 | P3 | CSS | `.editor-footer__dot` uses hardcoded `width: 6px; height: 6px` | Use `var(--space-1-5)` (6px) for consistency with design token system |

---

### BrandEditorHeader.svelte -- 2 issues

**File**: `apps/web/src/lib/components/brand-editor/BrandEditorHeader.svelte`
**Lines**: 158 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 69-76 | P3 | CSS | `.editor-header__back` uses hardcoded `width: 24px; height: 24px` | Use `var(--space-6)` (24px) |
| 106-117 | P3 | CSS | `.editor-header__btn` uses hardcoded `width: 28px; height: 28px` | Use `var(--space-7)` (28px) |

---

### BrandEditorPanel.svelte -- 3 issues

**File**: `apps/web/src/lib/components/brand-editor/BrandEditorPanel.svelte`
**Lines**: 197 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 63-72 | P2 | Dead code | Minimized bar has a Save button with empty `onclick={() => {}}` -- does nothing | Wire it to the actual save handler via a prop, or remove the button |
| 64-68 | P3 | Verbose | `brandEditor.isDirty` checked twice in adjacent blocks (line 64 and 68) | Combine into one `{#if}` block wrapping both the dot and Save button |
| 101-102 | P3 | CSS | `border: 1px solid var(--material-glass-border)` uses hardcoded `1px` | Use `var(--border-width)` |

---

### ColorInput.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/color-picker/ColorInput.svelte`
**Lines**: 131 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 14-16 | P2 | Unnecessary state | `inputValue` and `isValid` are `$state` but `inputValue` could be `$derived(value)` with a local override pattern | The sync `$effect` on line 18-21 is needed because of the two-way flow, but `isValid` can be `$derived` from `inputValue` -- remove the `$effect` setter for `isValid` |

---

### OklchColorArea.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/color-picker/OklchColorArea.svelte`
**Lines**: 165 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 69-77 | P2 | Verbose | Creates a temporary canvas to putImageData then drawImage onto the real canvas (DPR workaround) | Use `ctx.putImageData` directly on a non-scaled context, then use CSS `image-rendering` for sharpness, or draw at DPR resolution directly -- eliminates temp canvas allocation |

---

### OklchColorPicker.svelte -- 2 issues

**File**: `apps/web/src/lib/components/brand-editor/color-picker/OklchColorPicker.svelte`
**Lines**: 132 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 63-80 | P2 | Duplication | `handleHexInput` and `handleSwatchSelect` are identical functions (parse hex, set oklch, set value, call onchange) | Merge into one `setFromHex(hex: string)` function, saves 10 lines |
| 88-98 | P3 | Verbose | Both `bind:lightness` / `bind:chroma` and `onchange` are wired -- the bind already syncs values | The `onchange` + `handleAreaChange` is needed to trigger `emitHex()`, but the bind is redundant since `handleAreaChange` already sets `oklch.l` and `oklch.c`. Remove the binds and let onchange be the sole update path, or remove onchange and use `$effect` on oklch to emit |

---

### BrandEditorFineTuneTypography.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorFineTuneTypography.svelte`
**Lines**: 181 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 9-17 | P2 | Unnecessary state | `textScale`, `headingWeight`, `bodyWeight` are `$state` that get overwritten by the `$effect` on line 13-17 every time `brandEditor.pending` changes | These should be `$derived` from `brandEditor.pending?.tokenOverrides` -- the local `$state` + `$effect` sync is the classic anti-pattern of mirroring store state. The handlers can call `updateOverride` directly without local state |

---

### BrandEditorHome.svelte -- 2 issues

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorHome.svelte`
**Lines**: 373 total
**Complexity**: Medium

```
Script: 21 lines | Template: 97 lines | Style: 252 lines
Extractable sections: Palette grid section, Category list (Customize/Advanced share identical markup)
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 69-110 | P1 | Duplication | "Customize" and "Advanced" category sections are identical markup with different data arrays | Extract a `CategoryList` snippet or small component that takes `categories: LevelId[]` and `label: string` -- eliminates 20 duplicated lines |
| 120-372 | P2 | CSS bloat | 252 lines of CSS for a single level component | Several classes share identical styles (`.home__category` and `.home__colors-row` are near-identical flex buttons with border). Extract a shared `.home__nav-row` base class |

---

### BrandEditorShadows.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorShadows.svelte`
**Lines**: 197 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 7-15 | P2 | Unnecessary state | `intensity` and `tintColor` are `$state` mirroring `brandEditor.pending?.tokenOverrides`, overwritten by `$effect` on line 12-15 | Same pattern as FineTuneTypography -- use `$derived` instead of `$state` + sync `$effect` |

---

### BrandEditorShape.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorShape.svelte`
**Lines**: 173 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 4-10 | P2 | Unnecessary state | `radius` and `density` are `$state` mirroring `brandEditor.pending`, overwritten by `$effect` on line 7-10 | Same anti-pattern -- use `$derived`. The input handlers can write directly to the store via `brandEditor.updateField` |

---

### ActivityFeed.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/ActivityFeed.svelte`
**Lines**: 172 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 25-29 | P2 | Dead code | `typeConfig` record maps types to `{ icon, colorClass }` but the `icon` field is never used -- the template uses inline `{#if}` blocks for icons instead | Remove the `icon` field from `typeConfig`, or use it in the template to eliminate the `{#if}` chain |
| 161-170 | P3 | Over-engineering | Dark mode overrides use `:global([data-theme='dark'])` when the design token system should handle this via semantic tokens | Replace with theme-aware tokens (e.g., `--color-success-bg`) if they exist, or leave as-is if token system doesn't cover it yet |

---

### PublishSidebar.svelte -- 3 issues

**File**: `apps/web/src/lib/components/studio/content-form/PublishSidebar.svelte`
**Lines**: 451 total
**Complexity**: High

```
Script: 107 lines | Template: 165 lines | Style: 175 lines
Extractable sections: Readiness checklist, Visibility section, Price section, Danger zone
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 24 | P1 | Type issue | `form: any` -- the form prop is typed as `any` | Type it properly using the form type from the remote function, e.g., `typeof createContentForm` or a union type |
| 144-175 | P2 | Verbose | Publish/unpublish button section has two nearly identical `{#if}` branches that differ only in text | Combine into one block: `{#if isEdit}` with a ternary for the label and a single condition for disabled state |
| 318-319 | P3 | CSS | `letter-spacing: 0.05em` hardcoded | Use `var(--tracking-wide)` (already used on line 299) |

---

### ThumbnailUpload.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/content-form/ThumbnailUpload.svelte`
**Lines**: 206 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 14 | P1 | Type issue | `form: any` -- same untyped form prop | Type it with the actual form type |
| 86-100 + 187-204 | P2 | Duplication | `.form-card`, `.card-title`, `.field-input` CSS classes are duplicated across PublishSidebar, ThumbnailUpload, EditMediaDialog, and InviteMemberDialog | Extract shared form field styles to a common CSS module or utility classes |

---

### ContentForm.svelte -- 4 issues

**File**: `apps/web/src/lib/components/studio/ContentForm.svelte`
**Lines**: 377 total
**Complexity**: High

```
Script: 209 lines | Template: 101 lines | Style: 63 lines
Extractable sections: Unsaved changes guard logic, Form population effect
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 17-18 | P3 | Dead code | `beforeNavigate` is imported twice from `$app/navigation` (line 14 and implicitly via `goto` on same import) -- not a double import, but `onDestroy` from svelte and `tick` are imported on line 13 while `onDestroy` is only used once for a timeout clear | Consider inlining the timeout cleanup in `$effect` return instead of `onDestroy` -- more idiomatic Svelte 5 |
| 76-109 | P2 | Verbose | Form field population effect has two branches (edit/create) that manually list all fields | Create a `getDefaultFields(content, organizationId)` helper that returns the field object, reducing the effect to a single `form.fields.set(getDefaultFields(...))` |
| 230-235 | P2 | Over-engineering | Template-level side effects using `{@const _ = handleCreateSuccess()}` is an unusual pattern | Use `$effect` watching `createContentForm.result?.success` instead -- cleaner and more predictable |
| 111-127 | P3 | Verbose | `beforeNavigate` guard creates `pendingNavigation` object but `cancel` is never called | Remove the unused `cancel` property from the stored object |

---

### ContentTable.svelte -- 1 issue

**File**: `apps/web/src/lib/components/studio/ContentTable.svelte`
**Lines**: 332 total
**Complexity**: Medium

```
Script: 69 lines | Template: 68 lines | Style: 191 lines
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 139-331 | P2 | CSS bloat | 191 lines of CSS, much of which is standard table styling that could be shared with CustomerTable and TopContentTable | Extract shared table styles (`.table-wrap`, thead/th/td patterns, `.action-btn` base) into a common stylesheet or component-level mixin |

---

### CustomerDetailDrawer.svelte -- 3 issues

**File**: `apps/web/src/lib/components/studio/CustomerDetailDrawer.svelte`
**Lines**: 402 total
**Complexity**: High

```
Script: 96 lines | Template: 110 lines | Style: 192 lines
Extractable sections: Profile section, Stats section, Purchase history table
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 209-230 | P1 | CSS | 13 `:global` overrides with `!important` to force drawer positioning on Dialog | This is a code smell indicating Dialog isn't designed for drawer use. Consider creating a dedicated `Drawer` component wrapping Dialog with the right defaults, eliminating all `!important` declarations |
| 86-95 | P3 | Duplication | `initials` derivation (split name, map to first char, join, uppercase, slice) is duplicated in MemberTable (`getInitials` function) | Extract to a shared `getInitials(name)` utility in `$lib/utils/format.ts` |
| 196-204 | P3 | Verbose | Redundant `{#if customer}` check on GrantAccessDialog -- already inside `{:else if customer}` block | Remove the outer `{#if customer}` guard since it's always true in that branch |

---

### EditMediaDialog.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/EditMediaDialog.svelte`
**Lines**: 191 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 142-190 | P2 | Duplication | `.form-field`, `.field-label`, `.field-input` CSS are identical to InviteMemberDialog and PublishSidebar | See cross-component duplication note -- extract shared form field styles |
| 131-137 | P3 | Verbose | Submit button shows loading text via `{#if submitting}...{:else}...{/if}` but the Button already has a `loading` prop that handles this | Remove the inner `{#if}` block and just use the Button's built-in loading state with static text |

---

### InviteMemberDialog.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/InviteMemberDialog.svelte`
**Lines**: 174 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 131-174 | P2 | Duplication | `.invite-form`, `.form-field`, `.field-label`, `.field-input` CSS is a copy-paste of EditMediaDialog styles | Extract shared form dialog styles |
| 119-127 | P3 | Verbose | Same redundant loading text pattern inside Button as EditMediaDialog | Remove inner `{#if submitting}` and rely on Button's `loading` prop |

---

### LogoUpload.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/LogoUpload.svelte`
**Lines**: 323 total
**Complexity**: Medium

```
Script: 112 lines | Template: 90 lines | Style: 118 lines
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 289-307 | P2 | Duplication | `.hidden-form` and `.hidden-form input[type="file"]` have identical visually-hidden CSS (both use `clip: rect(0,0,0,0)` etc.) | The input inherits from its parent `.hidden-form` -- remove the duplicate `.hidden-form input[type="file"]` rule (7 lines) |
| 245-246 | P3 | CSS | `.drop-zone` uses hardcoded `border: 2px dashed` | Use `var(--border-width-thick)` for the width, and define a dashed border-style token or use inline `border-style: dashed` with token width |

---

### MediaCard.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/MediaCard.svelte`
**Lines**: 357 total
**Complexity**: Medium

```
Script: 161 lines | Template: 70 lines | Style: 123 lines
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 95-129 | P2 | Verbose | `statusVariant` and `statusLabel` are two separate `$derived.by` blocks with identical switch structures over `media.status` | Merge into one `$derived.by` that returns `{ variant, label }` -- saves the duplicated switch and 15 lines |
| 134-141 | P2 | Over-engineering | `formatFileSize` is defined locally but the same function exists in `$lib/utils/format.ts` (imported by MediaPicker) | Import from `$lib/utils/format` instead of redefining |

---

### MediaPicker.svelte -- 3 issues

**File**: `apps/web/src/lib/components/studio/MediaPicker.svelte`
**Lines**: 672 total
**Complexity**: High

```
Script: 201 lines | Template: 160 lines | Style: 308 lines
Extractable sections: Trigger display (selected vs placeholder), Option rendering, Keyboard handler
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 1-672 | P1 | Oversized | At 672 lines this is the largest component in the audit. It implements a full custom combobox/listbox from scratch | Consider using Melt UI's `Combobox` or `Select` builder which handles ARIA, keyboard nav, and open/close for you -- would eliminate ~150 lines of manual keyboard/mouse handling |
| 308-347 | P2 | Duplication | The option rendering for filtered items (lines 308-347) duplicates the trigger's selected preview layout (icon + title + meta) | Extract an `{#snippet mediaItemRow(item)}` to share the icon + title + type-badge + duration + filesize layout |
| 571-573 | P3 | CSS | `.option.highlighted` uses hardcoded `outline: 2px solid` | Use `var(--border-width-thick)` and `var(--color-focus)` |

---

### MediaUpload.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/MediaUpload.svelte`
**Lines**: 515 total
**Complexity**: High

```
Script: 260 lines | Template: 78 lines | Style: 174 lines
Extractable sections: XHR upload logic (uploadToR2 + uploadViaWorker are structurally identical)
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 171-220 | P1 | Duplication | `uploadToR2` and `uploadViaWorker` are nearly identical XHR wrappers (same progress tracking, same onload/onerror, differ only in HTTP method, URL, and headers) | Extract a generic `xhrUpload(url, method, file, headers, onProgress)` helper -- saves ~25 lines |
| 41-61 | P3 | Over-engineering | `ACCEPTED_TYPES` lists both MIME types and file extensions in the same array | Split into `ACCEPTED_MIMES` (for validation) and compute the `accept` attribute string separately -- cleaner separation, and `isValidFile` only checks MIME types anyway so the extensions are unused in validation |

---

### MemberTable.svelte -- 3 issues

**File**: `apps/web/src/lib/components/studio/MemberTable.svelte`
**Lines**: 285 total
**Complexity**: Medium

```
Script: 97 lines | Template: 79 lines | Style: 106 lines
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 72-80 | P2 | Duplication | `getInitials` function is duplicated from CustomerDetailDrawer | Extract to `$lib/utils/format.ts` |
| 93 | P2 | Over-engineering | Uses `confirm()` (browser native dialog) for member removal | Inconsistent with the rest of the app which uses `ConfirmDialog` component. Replace with `ConfirmDialog` for UX consistency |
| 249-271 | P3 | Duplication | Loading skeleton with `@keyframes pulse` animation is duplicated in TopContentTable | Extract a shared `SkeletonRows` component or use the existing `Skeleton` component (used in ActivityFeed and CustomerDetailDrawer) |

---

### TopContentTable.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/TopContentTable.svelte`
**Lines**: 149 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 33-40 | P2 | Duplication | `formatRevenue` is a local function that duplicates `formatPrice` from `$lib/utils/format.ts` (used by CustomerTable and CustomerDetailDrawer) | Import `formatPrice` instead of redefining. Note: verify `formatPrice` handles the cents-to-pounds conversion the same way |
| 98-113 | P3 | Duplication | Skeleton loading state with `@keyframes pulse` identical to MemberTable | Same as MemberTable finding -- use shared skeleton component |

---

## Cross-Cutting Findings

These patterns appear across multiple files and represent the highest-value refactoring targets.

### XC-1: Form field CSS duplication (P1, ~5 files)

**Files**: PublishSidebar, ThumbnailUpload, EditMediaDialog, InviteMemberDialog, LogoUpload

The following CSS classes are copy-pasted across 5 files with identical or near-identical styles:
- `.field-input` (padding, font-size, border-radius, border, background, color, transition, focus state)
- `.field-label` (font-size, font-weight, color)
- `.form-field` (flex column, gap)

**Recommendation**: Extract to a shared `form-fields.css` utility or a `FormField.svelte` wrapper component. Estimated savings: ~80 lines across the 5 files.

### XC-2: State mirroring anti-pattern (P2, ~4 files)

**Files**: BrandEditorShape, BrandEditorShadows, BrandEditorFineTuneTypography, BrandEditorTypography

Pattern: `let x = $state(brandEditor.pending?.field ?? default)` followed by `$effect(() => { x = brandEditor.pending?.field ?? default })`. This is the Svelte 5 equivalent of the old "derived from store" anti-pattern.

**Recommendation**: Replace with `$derived(brandEditor.pending?.field ?? default)`. The input event handlers should write directly to the store via `brandEditor.updateField()` instead of setting local state. Estimated savings: ~40 lines across 4 files plus elimination of stale-state bugs.

### XC-3: Button loading text redundancy (P3, ~3 files)

**Files**: EditMediaDialog, InviteMemberDialog, GrantAccessDialog

Pattern: Button has `loading={submitting}` prop AND an inner `{#if submitting}` block showing different text. The Button component already handles loading state visually.

**Recommendation**: Remove inner `{#if}` blocks and use static button text. Button's `loading` prop handles the rest. Estimated savings: ~15 lines.

### XC-4: Duplicate utility functions (P2, ~3 files)

| Function | Defined in | Also defined in |
|----------|-----------|----------------|
| `getInitials(name)` | CustomerDetailDrawer | MemberTable |
| `formatFileSize(bytes)` | MediaCard | (already in `$lib/utils/format.ts`) |
| `formatRevenue(cents)` | TopContentTable | (duplicates `formatPrice` in `$lib/utils/format.ts`) |

**Recommendation**: Consolidate into `$lib/utils/format.ts`. Estimated savings: ~25 lines.

### XC-5: Skeleton loading duplication (P3, ~2 files)

**Files**: MemberTable, TopContentTable

Both define identical `.skeleton-row` + `@keyframes pulse` CSS. The app already has a `Skeleton` component used elsewhere.

**Recommendation**: Use the existing `Skeleton` component for loading states. Estimated savings: ~30 lines of CSS.

### XC-6: Table styling duplication (P2, ~3 files)

**Files**: ContentTable, CustomerTable, MemberTable

Shared patterns: `.table-wrap`/`.table-wrapper` overflow container, header styling, row hover states, cell typography classes (`.date-cell`, `.email-cell`).

**Recommendation**: Create shared table utility styles or extend the existing `Table` component suite with common cell variants. Estimated savings: ~60 lines.

---

## Wave 2 Findings — UI Components + Route Pages

### Files Reviewed (Wave 2)

| # | File | Status | Issues |
|---|------|--------|--------|
| 1 | ui/Alert/Alert.svelte | Reviewed | Clean |
| 2 | ui/BackToTop/BackToTop.svelte | Reviewed | Clean |
| 3 | ui/Badge/Badge.svelte | Reviewed | 1 issue |
| 4 | ui/Breadcrumb/Breadcrumb.svelte | Reviewed | Clean |
| 5 | ui/Button/Button.svelte | Reviewed | 1 issue |
| 6 | ui/CheckoutSuccess/CheckoutSuccess.svelte | Reviewed | 2 issues |
| 7 | ui/ContentCard/ContentCard.svelte | Reviewed | 2 issues |
| 8 | ui/DataTable/DataTable.svelte | Reviewed | Clean |
| 9 | ui/EmptyState/EmptyState.svelte | Reviewed | Clean |
| 10 | ui/FilterBar/FilterBar.svelte | Reviewed | 1 issue |
| 11 | ui/PriceBadge/PriceBadge.svelte | Reviewed | Clean |
| 12 | ui/Select/Select.svelte | Reviewed | 2 issues |
| 13 | ui/ViewToggle/ViewToggle.svelte | Reviewed | Clean |
| 14 | library/ContinueWatching.svelte | Reviewed | Clean |
| 15 | library/ContinueWatchingCard.svelte | Reviewed | Clean |
| 16 | library/LibraryCard.svelte | Reviewed | Clean |
| 17 | library/LibraryFilters.svelte | Reviewed | 2 issues |
| 18 | carousel/Carousel.svelte | Reviewed | Clean |
| 19 | search/SearchBar.svelte | Reviewed | 1 issue |
| 20 | command-palette/CommandPalette.svelte | Reviewed | 2 issues |
| 21 | content/ContentDetailView.svelte | Reviewed | 3 issues |
| 22 | player/PreviewPlayer.svelte | Reviewed | 2 issues |
| 23 | _creators/[username]/+page.svelte | Reviewed | 1 issue |
| 24 | _creators/[username]/content/[contentSlug]/+page.svelte | Reviewed | 1 issue |
| 25 | _creators/checkout/success/+page.svelte | Reviewed | Clean |
| 26 | _creators/studio/content/+page.svelte | Reviewed | Clean |
| 27 | _creators/studio/media/+page.svelte | Reviewed | 1 issue |
| 28 | _creators/studio/settings/+page.svelte | Reviewed | 1 issue |
| 29 | _org/[slug]/(space)/+page.svelte | Reviewed | Clean |
| 30 | _org/[slug]/(space)/content/[contentSlug]/+page.svelte | Reviewed | 1 issue |
| 31 | _org/[slug]/(space)/explore/+page.svelte | Reviewed | Clean |
| 32 | _org/[slug]/(space)/library/+page.svelte | Reviewed | Clean |
| 33 | _org/[slug]/+layout.svelte | Reviewed | 1 issue |
| 34 | _org/[slug]/studio/+page.svelte | Reviewed | 1 issue |
| 35 | _org/[slug]/studio/content/+page.svelte | Reviewed | Clean |
| 36 | _org/[slug]/studio/customers/+page.svelte | Reviewed | Clean |
| 37 | _org/[slug]/studio/media/+page.svelte | Reviewed | 1 issue |
| 38 | _org/[slug]/studio/settings/branding/+page.svelte | Reviewed | 1 issue |
| 39 | (platform)/+page.svelte | Reviewed | Clean |
| 40 | (platform)/library/+page.svelte | Reviewed | 1 issue |
| 41 | (platform)/discover/+page.svelte | Reviewed | 1 issue |
| 42 | (platform)/account/+page.svelte | Reviewed | 1 issue |
| 43 | (platform)/account/payment/+page.svelte | Reviewed | 2 issues |
| 44 | (platform)/become-creator/+page.svelte | Reviewed | Clean |
| 45 | (platform)/pricing/+page.svelte | Reviewed | Clean |
| 46 | _org/[slug]/studio/analytics/+page.svelte | Reviewed | 1 issue |
| 47 | _org/[slug]/studio/billing/+page.svelte | Reviewed | Clean |
| 48 | _org/[slug]/studio/team/+page.svelte | Reviewed | Clean |
| 49 | _org/[slug]/studio/settings/+page.svelte | Reviewed | 1 issue |
| 50 | +error.svelte | Reviewed | 1 issue |
| 51 | _creators/[username]/+error.svelte | N/A | File does not exist |
| 52 | _creators/[username]/content/+error.svelte | N/A | File does not exist |

**Summary**: 50 files reviewed (2 do not exist). 24 files with findings, 26 clean. 34 total issues found.

---

### Badge.svelte -- 1 issue

**File**: `apps/web/src/lib/components/ui/Badge/Badge.svelte`
**Lines**: 70 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 40-41 | P3 | Dead code | Comment `/* background-color is already defined above */` above the success variant is stale -- there is no background-color on the base `.badge` rule | Remove the misleading comment |

---

### Button.svelte -- 1 issue

**File**: `apps/web/src/lib/components/ui/Button/Button.svelte`
**Lines**: 187 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 79-107 | P3 | CSS | Size variants use hardcoded `rem` values for height (`1.75rem`, `2rem`, `2.5rem`, `2.75rem`, `3rem`) | Map these to space tokens where possible (e.g., `var(--space-7)` for 1.75rem, `var(--space-8)` for 2rem, `var(--space-10)` for 2.5rem) for consistency with the token system |

---

### CheckoutSuccess.svelte -- 2 issues

**File**: `apps/web/src/lib/components/ui/CheckoutSuccess/CheckoutSuccess.svelte`
**Lines**: 435 total
**Complexity**: Medium

```
Script: 66 lines | Template: 137 lines | Style: 232 lines
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 165-199 | P1 | Duplication | The `{:else if retriesExhausted}` and `{:else}` branches (lines 165-199) are identical -- same icon, same title, same description, same action buttons | Merge into a single `{:else}` branch covering both retriesExhausted and the open/expired fallback. The `shouldRetry` branch already handles the pending case; everything else is the same fallback UI |
| 276-287 | P3 | Duplication | `@keyframes spin` is defined here and also in Button.svelte and PreviewPlayer.svelte | Extract to a shared keyframes utility or the global tokens CSS. Not urgent since scoped CSS prevents conflicts, but reduces volume |

---

### ContentCard.svelte -- 2 issues

**File**: `apps/web/src/lib/components/ui/ContentCard/ContentCard.svelte`
**Lines**: 502 total
**Complexity**: High

```
Script: 100 lines | Template: 118 lines | Style: 280 lines
Extractable sections: Content type icon snippet (repeated 3 times), sr-only utility class
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 129-136 + 139-146 + 156-163 | P2 | Duplication | The content-type icon `{#if}/{:else if}/{:else}` chain (PlayIcon/MusicIcon/FileTextIcon) appears 3 times in the template -- once for error fallback placeholder, once for no-thumbnail placeholder, once for the type icon overlay | Extract a `{#snippet contentTypeIcon(size)}` and call `{@render contentTypeIcon(32)}` or `{@render contentTypeIcon(16)}` -- saves ~20 lines |
| 250-261 | P3 | Duplication | `.sr-only` utility class is defined locally, but it also exists in ContentCard, Select, and likely a global utility | Extract to global utilities CSS (e.g., `$lib/styles/utilities.css`) if not already there, and use `:global(.sr-only)` or a shared class |

---

### FilterBar.svelte -- 1 issue

**File**: `apps/web/src/lib/components/ui/FilterBar/FilterBar.svelte`
**Lines**: 355 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 64-75 | P2 | Unnecessary state | `searchTimers` is a plain object (not reactive) but `searchValues` is `$state`. The `$effect` on lines 69-75 re-initializes `searchValues` from `values` on every render, overwriting any in-progress user typing | The `$effect` should only initialize on mount or when filter keys change, not on every `values` update. Use `untrack` for the initial sync or gate with a `mounted` flag to prevent clobbering mid-type |

---

### Select.svelte -- 2 issues

**File**: `apps/web/src/lib/components/ui/Select/Select.svelte`
**Lines**: 207 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 68 | P3 | Over-engineering | `generatedId` uses `Math.random().toString(36).substring(2, 9)` for auto-ID generation which is a `$derived` recalculated per-render | Use `crypto.randomUUID().slice(0,8)` in a non-reactive `const`, or use Svelte's built-in `:id` pattern. The current approach regenerates on every reactive update |
| 195-205 | P3 | Duplication | `.sr-only` class is duplicated (also in ContentCard) | Same as ContentCard finding -- use a shared global utility |

---

### LibraryFilters.svelte -- 2 issues

**File**: `apps/web/src/lib/components/library/LibraryFilters.svelte`
**Lines**: 235 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 74-84 | P2 | Over-engineering | `mounted` flag pattern (`let mounted = $state(false)`) to skip the first `$effect` run is the classic workaround for preventing callback on initial render | Use `untrack` for the initial read of filter values, or move the initial state into the `$state` initializers and only call `onFilterChange` from explicit user actions (button clicks, debounce callback) -- eliminates the `$effect` entirely |
| 86-92 | P3 | Over-engineering | `export function clearAll()` uses the Svelte 4 `export` pattern for imperative methods | This works in Svelte 5 but the idiomatic approach is to accept an `onReset` prop or expose via `bind:this` with a typed interface. Currently `bind:this` is used by the parent, so this is functional but worth noting for future refactors |

---

### SearchBar.svelte -- 1 issue

**File**: `apps/web/src/lib/components/search/SearchBar.svelte`
**Lines**: 307 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 66-74 + 76-82 | P2 | Duplication | `handleSubmit` and `selectRecent` both build the same URL with `${searchUrl}?${paramKey}=...` and call `goto()` | Extract a `navigateToSearch(term: string)` helper that handles `saveRecent`, `isOpen = false`, and `goto` -- saves ~8 lines and eliminates the duplicated URL construction |

---

### CommandPalette.svelte -- 2 issues

**File**: `apps/web/src/lib/components/command-palette/CommandPalette.svelte`
**Lines**: 353 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 82 | P3 | Dead code | `const flatItems = $derived(filteredItems)` is a pointless alias -- `flatItems` is just `filteredItems` | Replace all `flatItems` references with `filteredItems` directly and remove the alias |
| 192 | P2 | Verbose | `{@const globalIndex = flatItems.indexOf(item)}` inside the `{#each}` loop calls `indexOf` for every item on every render -- O(n^2) for the full list | Precompute an `indexMap` in the `groupedItems` derivation, or use a flat index counter that increments as you iterate groups |

---

### ContentDetailView.svelte -- 3 issues

**File**: `apps/web/src/lib/components/content/ContentDetailView.svelte`
**Lines**: 714 total
**Complexity**: High

```
Script: 137 lines | Template: 223 lines | Style: 351 lines
Extractable sections: Benefits list (duplicated), Preview overlay (duplicated)
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 264-284 + 299-316 | P1 | Duplication | The "What you'll get" benefits list is copy-pasted identically between the `{#if needsPurchase}` and `{:else if isFree && !hasAccess}` branches -- same heading, same 4 list items | Extract a `{#snippet benefitsList()}` and render it in both branches. Saves ~20 lines |
| 495 | P3 | CSS | `.content-detail__badge` uses hardcoded `letter-spacing: 0.05em` | Use `var(--tracking-wide)` for consistency with the token system |
| 43-49 | P3 | Type issue | `ContentDetail` type extension uses a complex conditional mapped type (`infer M ? M extends object ? M & {...} : M : never`) to add `thumbnailUrl` and `hlsPreviewUrl` | Simplify to a straightforward intersection: `type ContentDetail = ContentWithRelations & { mediaItem?: ContentWithRelations['mediaItem'] & { thumbnailUrl?: string; hlsPreviewUrl?: string } }` |

---

### PreviewPlayer.svelte -- 2 issues

**File**: `apps/web/src/lib/components/player/PreviewPlayer.svelte`
**Lines**: 451 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 313-319 | P3 | CSS | `.preview-player__control-btn` uses hardcoded `width: 2rem; height: 2rem` | Use `var(--space-8)` (2rem) for token consistency |
| 432-433 | P3 | CSS | Responsive breakpoint uses hardcoded `@media (max-width: 640px)` | Use the project's custom media query `@media (--below-sm)` for consistency with the rest of the codebase |

---

### CreatorProfilePage -- 1 issue

**File**: `apps/web/src/routes/_creators/[username]/+page.svelte`
**Lines**: 523 total
**Complexity**: High

```
Script: 37 lines | Template: 179 lines | Style: 304 lines
Extractable sections: Social links block (4 nearly identical `{#if}` blocks)
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 90-142 | P2 | Verbose | Four social link `{#if}` blocks are structurally identical -- only the icon component, URL field, and aria label differ | Create a `socialLinks` array `[{ key, icon, label }]` and use `{#each}` with a single link template. Saves ~30 lines of template markup |

---

### CreatorContentDetailPage -- 1 issue

**File**: `apps/web/src/routes/_creators/[username]/content/[contentSlug]/+page.svelte`
**Lines**: 92 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 35-38 + 42 | P2 | Duplication | `displayPrice` function is defined identically in this file, the org content detail page, and ContentDetailView itself | Remove from both page wrappers -- ContentDetailView already has its own `displayPrice`. The pages only use it inside the purchase button snippet, which could call `formatPrice` directly |

---

### CreatorStudioMediaPage -- 1 issue

**File**: `apps/web/src/routes/_creators/studio/media/+page.svelte`
**Lines**: 305 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 1-305 | P1 | Duplication | This file is 95%+ identical to `_org/[slug]/studio/media/+page.svelte` (same script logic, same template, same styles, only the title suffix differs) | Extract a shared `StudioMediaPage` component that accepts `titleSuffix` as a prop, or use a `+page.svelte` that delegates to a shared component. Saves ~280 lines |

---

### CreatorStudioSettings -- 1 issue

**File**: `apps/web/src/routes/_creators/studio/settings/+page.svelte`
**Lines**: 410 total
**Complexity**: High

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 1-410 | P1 | Duplication | This file is 90%+ identical to `(platform)/account/+page.svelte` -- same avatar section, same profile form, same `$effect` chains for result handling, same CSS | Extract a shared `ProfileSettingsForm` component that both pages use. The only differences are the page title, the `<h1>` text, and the absence of the upgrade banner. Saves ~350 lines |

---

### OrgContentDetailPage -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.svelte`
**Lines**: 87 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 38-40 + 44 | P2 | Duplication | `displayPrice` function duplicated from CreatorContentDetailPage and ContentDetailView | Same as finding for CreatorContentDetailPage -- remove and use `formatPrice` directly in the snippet |

---

### OrgLayout -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/+layout.svelte`
**Lines**: 408 total
**Complexity**: High

```
Script: 262 lines | Template: 82 lines | Style: 60 lines
```

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 145-186 | P2 | Oversized script | The brand editor initialization block (lines 145-186) reconstructs `BrandEditorState` from 5+ data sources with multiple JSON.parse try/catch blocks | Extract to a `buildEditorState(org: OrgData): BrandEditorState` utility function in `$lib/brand-editor/`. The layout's `$effect` would become a single call. Saves ~30 lines from the layout and improves testability |

---

### StudioDashboard -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/studio/+page.svelte`
**Lines**: 293 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 41-48 | P2 | Duplication | `formatRevenue` function is defined locally using `Intl.NumberFormat('en-GB', { currency: 'GBP' })` -- the same function exists in analytics/+page.svelte and billing/+page.svelte | Import `formatPrice` from `$lib/utils/format.ts` (which handles GBP cents-to-pounds) instead of redefining. Or create a `formatCurrencyWhole(cents)` helper if the no-decimals behavior is needed |

---

### OrgStudioMediaPage -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/studio/media/+page.svelte`
**Lines**: 333 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 141-142 | P3 | Dead code | `handlePageChange` function body is `void newPage;` -- it does nothing | Remove the function and the `onPageChange` prop from Pagination since URL-based pagination handles navigation automatically |

---

### BrandingSettings -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/studio/settings/branding/+page.svelte`
**Lines**: 168 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 157-158 | P3 | CSS | `.brand-summary__swatch` uses hardcoded `width: 32px; height: 32px` | Use `var(--space-8)` (32px) for consistency with the token system |

---

### PlatformLibraryPage -- 1 issue

**File**: `apps/web/src/routes/(platform)/library/+page.svelte`
**Lines**: 329 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 82-88 | P2 | Type issue | `totalPages` derivation uses `as { total: number }` and `as { limit: number }` type assertions to access properties on `data.library` | Type the server load return properly so `data.library` includes `total` and `limit` fields, eliminating the need for `as` casts |

---

### DiscoverPage -- 1 issue

**File**: `apps/web/src/routes/(platform)/discover/+page.svelte`
**Lines**: 228 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 60-85 | P2 | Over-engineering | Hand-builds content card markup (`.content-card`, `.card-thumb`, `.card-body`) instead of using the existing `ContentCard` component used by every other page | Replace inline card markup with `<ContentCard>` component. The custom card has no features that ContentCard lacks. Saves ~25 lines of template + ~70 lines of CSS |

---

### AccountPage -- 1 issue

**File**: `apps/web/src/routes/(platform)/account/+page.svelte`
**Lines**: 490 total
**Complexity**: High

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 1-490 | P1 | Duplication | Near-identical to `_creators/studio/settings/+page.svelte` (see finding above). Both files share identical avatar logic, form effects, success message handling, and CSS | See CreatorStudioSettings finding -- extract shared `ProfileSettingsForm` component |

---

### PaymentPage -- 2 issues

**File**: `apps/web/src/routes/(platform)/account/payment/+page.svelte`
**Lines**: 347 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 97-101 | P0 | Currency bug | `formatAmount` uses `currency: 'USD'` and `en-US` locale, but the platform default is GBP | Change to `currency: 'GBP'` and `en-GB` locale, or import `formatPrice` from `$lib/utils/format.ts` which already handles this correctly |
| 103-110 | P3 | Verbose | `formatDate` uses `en-US` locale but platform targets UK audience | Change to `en-GB` for consistent UK date formatting (day-month-year). Consider importing a shared date formatter if one exists |

---

### AnalyticsPage -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/studio/analytics/+page.svelte`
**Lines**: 249 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 238 | P3 | CSS | `.summary-label` uses hardcoded `letter-spacing: 0.05em` | Use `var(--tracking-wide)` for token consistency |

---

### SettingsGeneral -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/studio/settings/+page.svelte`
**Lines**: 349 total
**Complexity**: Medium

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 86-91 | P2 | Unnecessary state | `timezoneValue` is `$state` with an `$effect` syncing from `contact.timezone` -- the same pattern flagged in Wave 1 (state mirroring anti-pattern) | Use `$derived(contact.timezone ?? 'UTC')` for the display value, and update via `updateContactForm.fields` directly in the Select's `onValueChange` handler |

---

### ErrorPage -- 1 issue

**File**: `apps/web/src/routes/+error.svelte`
**Lines**: 162 total
**Complexity**: Low

| Line(s) | Severity | Category | Issue | Suggestion |
|---------|----------|----------|-------|------------|
| 74-89 | P2 | CSS | `.error-card` and child elements use fallback values with hardcoded px/rem/hex (e.g., `var(--radius-lg, 0.75rem)`, `1px solid var(--color-border, #e5e5e5)`, `var(--shadow-lg)`) | Remove the CSS fallback values -- design tokens are always loaded before this component renders. The fallbacks add noise and bypass the token system if tokens ever fail to load |

---

## Wave 2 Cross-Cutting Findings

### XC-7: Page-level `displayPrice` duplication (P2, ~4 files)

**Files**: ContentDetailView, CreatorContentDetailPage, OrgContentDetailPage, StudioDashboard

The function `displayPrice(cents)` returning `formatPrice(cents)` or a "Free" string is defined in 3-4 places with identical logic.

**Recommendation**: Add a `formatPriceOrFree(cents)` helper to `$lib/utils/format.ts`. Each file imports one function instead of defining its own. Estimated savings: ~15 lines.

### XC-8: `formatRevenue` / `formatCurrency` duplication (P2, ~4 files)

**Files**: StudioDashboard, AnalyticsPage, BillingPage, TopContentTable

The pattern `new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(cents / 100)` is defined as a local function in 4+ files.

**Recommendation**: Add a `formatCurrencyWhole(cents)` variant to `$lib/utils/format.ts` (no decimal places). Estimated savings: ~20 lines.

### XC-9: Creator studio pages are near-identical to org studio pages (P1, ~2 page pairs)

**Files**:
- `_creators/studio/media/+page.svelte` vs `_org/[slug]/studio/media/+page.svelte` (95% identical)
- `_creators/studio/settings/+page.svelte` vs `(platform)/account/+page.svelte` (90% identical)

Both pairs share script logic, template structure, and CSS. Only the page title and minor data source differences vary.

**Recommendation**: Extract shared `StudioMediaPage` and `ProfileSettingsForm` components. Each route page becomes a thin wrapper passing title and data props. Estimated savings: ~600 lines across both pairs.

### XC-10: Filter button CSS duplication (P2, ~5 files)

**Files**: LibraryFilters, CreatorStudioMediaPage, OrgStudioMediaPage, OrgExplorePage, OrgLibraryPage

The `.filter-btn` / `.filter-btn--active` pattern (pill-shaped buttons with interactive color on active state) is duplicated verbatim across 5 files with identical padding, font-size, border-radius, colors, and transitions.

**Recommendation**: Extract to a shared `.filter-pill` utility class in `$lib/styles/utilities.css`, or use the existing `FilterBar` component which already provides this exact pattern. Estimated savings: ~100 lines of CSS.

### XC-11: `.btn` / `.btn-primary` redefinition (P2, ~3 files)

**Files**: TeamPage, SettingsGeneral, (partially in StudioDashboard)

These files define local `.btn` and `.btn-primary` CSS classes that duplicate the `Button` component's styles.

**Recommendation**: Replace `<button class="btn btn-primary">` with `<Button variant="primary">` component usage. The Button component already handles all these styles. Estimated savings: ~50 lines of CSS.

### XC-12: Content grid CSS duplication (P2, ~6 files)

**Files**: CreatorProfilePage, OrgLandingPage, OrgExplorePage, OrgLibraryPage, PlatformLibraryPage, DiscoverPage

The `.content-grid` responsive grid pattern (1-column mobile, 2-column sm, 3-column lg) is repeated in 6+ files with identical breakpoints and gap values.

**Recommendation**: Extract to a shared utility class or a `ContentGrid` layout component. Estimated savings: ~50 lines of CSS.

### XC-13: Discover page bypasses ContentCard component (P2, 1 file)

**File**: DiscoverPage

The discover page hand-builds card markup (`.content-card`, `.card-thumb`, `.card-body`) instead of using the `ContentCard` component that every other listing page uses.

**Recommendation**: Replace with `<ContentCard>` component. Saves ~95 lines (25 template + 70 CSS) and ensures visual consistency.

### XC-14: USD currency in payment page (P0, 1 file)

**File**: PaymentPage (`(platform)/account/payment/+page.svelte`)

`formatAmount` uses `currency: 'USD'` and `en-US` locale. The platform default is GBP. This is a bug.

**Recommendation**: Change to `currency: 'GBP'` and `en-GB` locale, or import `formatPrice` from `$lib/utils/format.ts`.

---

## Cumulative Summary (Wave 1 + Wave 2)

| Metric | Wave 1 | Wave 2 | Total |
|--------|--------|--------|-------|
| Files reviewed | 43 | 50 | 93 |
| Files with findings | 27 | 24 | 51 |
| Clean files | 16 | 26 | 42 |
| Total issues | 52 | 34 | 86 |
| P0 Critical | 0 | 1 | 1 |
| P1 Major | 4 | 5 | 9 |
| P2 Moderate | 22 | 17 | 39 |
| P3 Nit | 26 | 11 | 37 |
| Cross-cutting findings | 6 | 8 | 14 |

