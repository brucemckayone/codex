import type { Component } from 'svelte';
import {
  CompassIcon,
  HomeIcon,
  LibraryIcon,
  SearchIcon,
  TagIcon,
  UsersIcon,
} from '$lib/components/ui/Icon';
import type { RailIcon } from './navigation';

/** Maps RailIcon string keys to Svelte icon components (shared by SidebarRailItem + MobileBottomNav) */
export const RAIL_ICON_MAP: Record<RailIcon, Component> = {
  home: HomeIcon,
  compass: CompassIcon,
  tag: TagIcon,
  library: LibraryIcon,
  search: SearchIcon,
  users: UsersIcon,
};
