import type { LevelId, LevelMeta } from './types';

/**
 * Navigation level definitions for the brand editor breadcrumb drill-down.
 *
 * Level 0: Home (category list + presets)
 * Level 1: Category editors (colors, typography, shape, shadows, logo)
 * Level 2: Fine-tune (per-token overrides)
 */
export const LEVELS: Record<LevelId, LevelMeta> = {
  home: {
    id: 'home',
    depth: 0,
    label: 'Brand Editor',
    parent: null,
  },
  colors: {
    id: 'colors',
    depth: 1,
    label: 'Colors',
    parent: 'home',
    icon: '🎨',
    description: 'Primary, secondary, accent',
  },
  typography: {
    id: 'typography',
    depth: 1,
    label: 'Typography',
    parent: 'home',
    icon: 'Aa',
    description: 'Font families and scale',
  },
  shape: {
    id: 'shape',
    depth: 1,
    label: 'Shape & Spacing',
    parent: 'home',
    icon: '⬡',
    description: 'Radius and density',
  },
  shadows: {
    id: 'shadows',
    depth: 1,
    label: 'Shadows',
    parent: 'home',
    icon: '◐',
    description: 'Depth and tint',
  },
  logo: {
    id: 'logo',
    depth: 1,
    label: 'Logo',
    parent: 'home',
    icon: '◻',
    description: 'Upload and preview',
  },
  'fine-tune-colors': {
    id: 'fine-tune-colors',
    depth: 2,
    label: 'Fine-tune Colors',
    parent: 'colors',
  },
  'fine-tune-typography': {
    id: 'fine-tune-typography',
    depth: 2,
    label: 'Fine-tune Typography',
    parent: 'typography',
  },
};

/** Level 1 categories shown on the home screen (in display order). */
export const HOME_CATEGORIES: LevelId[] = [
  'colors',
  'typography',
  'shape',
  'shadows',
  'logo',
];

/** Get the breadcrumb trail for a given level. */
export function getBreadcrumb(levelId: LevelId): LevelMeta[] {
  const trail: LevelMeta[] = [];
  let current: LevelId | null = levelId;

  while (current) {
    trail.unshift(LEVELS[current]);
    current = LEVELS[current].parent;
  }

  return trail;
}
