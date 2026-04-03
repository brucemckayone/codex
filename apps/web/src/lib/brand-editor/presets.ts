import type { BrandPreset } from './types';

/**
 * Built-in brand presets.
 *
 * Each preset provides a complete set of brand values that produce
 * a visually distinct result when applied. The CSS engine (org-brand.css)
 * derives the full palette from these inputs via OKLCH relative colors.
 */
export const BRAND_PRESETS: readonly BrandPreset[] = [
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean and understated — sharp corners, neutral palette',
    values: {
      primaryColor: '#1A1A1A',
      secondaryColor: '#737373',
      accentColor: null,
      backgroundColor: null,
      fontBody: null,
      fontHeading: null,
      radius: 0,
      density: 1,
    },
  },
  {
    id: 'vibrant',
    name: 'Vibrant',
    description: 'Bold and energetic — rounded, saturated colors',
    values: {
      primaryColor: '#7C3AED',
      secondaryColor: null,
      accentColor: '#F59E0B',
      backgroundColor: null,
      fontBody: 'Poppins',
      fontHeading: 'Poppins',
      radius: 0.75,
      density: 1,
    },
  },
  {
    id: 'corporate',
    name: 'Corporate',
    description: 'Professional and trustworthy — tight spacing, serif heading',
    values: {
      primaryColor: '#1E40AF',
      secondaryColor: null,
      accentColor: '#059669',
      backgroundColor: null,
      fontBody: 'Source Sans 3',
      fontHeading: 'Source Sans 3',
      radius: 0.375,
      density: 0.95,
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Moody and modern — dark surface, light accents',
    values: {
      primaryColor: '#818CF8',
      secondaryColor: null,
      accentColor: '#FBBF24',
      backgroundColor: '#0F172A',
      fontBody: 'DM Sans',
      fontHeading: 'DM Sans',
      radius: 0.5,
      density: 1,
    },
  },
] as const;
