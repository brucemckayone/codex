/**
 * Shared view-mode persistence helper.
 *
 * Reads/writes a `'grid' | 'list'` preference to localStorage.
 * SSR-safe: always returns `defaultMode` on the server.
 *
 * Usage (call at component top-level so `$state` is captured):
 *
 *   const { viewMode, handleViewChange } = useViewMode();
 *   <ViewToggle value={viewMode} onchange={handleViewChange} />
 */

import { browser } from '$app/environment';

export type ViewMode = 'grid' | 'list';

export function useViewMode(
  storageKey = 'codex-view-mode',
  defaultMode: ViewMode = 'grid'
) {
  let viewMode = $state<ViewMode>(
    browser
      ? ((localStorage.getItem(storageKey) as ViewMode | null) ?? defaultMode)
      : defaultMode
  );

  function handleViewChange(mode: ViewMode) {
    viewMode = mode;
    if (browser) localStorage.setItem(storageKey, mode);
  }

  return {
    get viewMode() {
      return viewMode;
    },
    handleViewChange,
  };
}
