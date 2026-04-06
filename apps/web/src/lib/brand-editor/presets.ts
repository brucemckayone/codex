import type { BrandPreset } from './types';

/**
 * Built-in brand presets.
 *
 * Each preset provides a complete set of brand values that produce
 * a visually distinct result when applied. The CSS engine (org-brand.css)
 * derives the full palette from these inputs via OKLCH relative colors.
 */
export type PresetCategory = 'Professional' | 'Creative' | 'Bold' | 'Minimal';

export interface CategorizedPreset extends BrandPreset {
  category: PresetCategory;
}

export const BRAND_PRESETS: readonly CategorizedPreset[] = [
  // ─── Professional ───────────────────────────────────────────────────
  {
    id: 'corporate',
    name: 'Corporate',
    category: 'Professional',
    description: 'Professional and trustworthy — tight spacing',
    values: {
      primaryColor: '#1E40AF',
      secondaryColor: '#4B5563',
      accentColor: '#059669',
      backgroundColor: null,
      fontBody: 'Source Sans 3',
      fontHeading: 'Source Sans 3',
      radius: 0.375,
      density: 0.95,
      darkOverrides: null,
    },
  },
  {
    id: 'executive',
    name: 'Executive',
    category: 'Professional',
    description: 'Refined and authoritative — dark navy, gold accent',
    values: {
      primaryColor: '#1E293B',
      secondaryColor: '#64748B',
      accentColor: '#D97706',
      backgroundColor: null,
      fontBody: 'DM Sans',
      fontHeading: 'DM Sans',
      radius: 0.25,
      density: 0.9,
      darkOverrides: null,
    },
  },
  {
    id: 'consulting',
    name: 'Consulting',
    category: 'Professional',
    description: 'Clean, approachable, expert — teal primary',
    values: {
      primaryColor: '#0D9488',
      secondaryColor: '#6B7280',
      accentColor: '#F97316',
      backgroundColor: null,
      fontBody: 'Inter',
      fontHeading: 'Inter',
      radius: 0.5,
      density: 1,
      darkOverrides: null,
    },
  },

  // ─── Creative ───────────────────────────────────────────────────────
  {
    id: 'vibrant',
    name: 'Vibrant',
    category: 'Creative',
    description: 'Bold and energetic — rounded, saturated colors',
    values: {
      primaryColor: '#7C3AED',
      secondaryColor: '#EC4899',
      accentColor: '#F59E0B',
      backgroundColor: null,
      fontBody: 'Poppins',
      fontHeading: 'Poppins',
      radius: 0.75,
      density: 1,
      darkOverrides: null,
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    category: 'Creative',
    description: 'Warm gradient feel — coral, amber, earthy',
    values: {
      primaryColor: '#E11D48',
      secondaryColor: '#F97316',
      accentColor: '#FBBF24',
      backgroundColor: null,
      fontBody: 'Nunito',
      fontHeading: 'Nunito',
      radius: 1,
      density: 1.05,
      darkOverrides: null,
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    category: 'Creative',
    description: 'Cool and calming — deep blues to aqua',
    values: {
      primaryColor: '#0284C7',
      secondaryColor: '#0891B2',
      accentColor: '#34D399',
      backgroundColor: null,
      fontBody: 'Outfit',
      fontHeading: 'Outfit',
      radius: 0.75,
      density: 1,
      darkOverrides: null,
    },
  },

  // ─── Bold ───────────────────────────────────────────────────────────
  {
    id: 'dark',
    name: 'Dark',
    category: 'Bold',
    description: 'Moody and modern — dark surface, light accents',
    values: {
      primaryColor: '#818CF8',
      secondaryColor: '#A78BFA',
      accentColor: '#FBBF24',
      backgroundColor: '#0F172A',
      fontBody: 'DM Sans',
      fontHeading: 'DM Sans',
      radius: 0.5,
      density: 1,
      darkOverrides: null,
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    category: 'Bold',
    description: 'High contrast, electric — black background, neon green',
    values: {
      primaryColor: '#22D3EE',
      secondaryColor: '#A3E635',
      accentColor: '#F472B6',
      backgroundColor: '#09090B',
      fontBody: 'Space Grotesk',
      fontHeading: 'Space Grotesk',
      radius: 0.25,
      density: 0.95,
      darkOverrides: null,
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    category: 'Bold',
    description: 'Fiery intensity — deep red, warm surface',
    values: {
      primaryColor: '#DC2626',
      secondaryColor: '#EA580C',
      accentColor: '#FCD34D',
      backgroundColor: '#1C1917',
      fontBody: 'Rubik',
      fontHeading: 'Rubik',
      radius: 0.375,
      density: 1,
      darkOverrides: null,
    },
  },

  // ─── Minimal ────────────────────────────────────────────────────────
  {
    id: 'minimal',
    name: 'Minimal',
    category: 'Minimal',
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
      darkOverrides: null,
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    category: 'Minimal',
    description: 'Warm, editorial — off-white, soft radius',
    values: {
      primaryColor: '#78716C',
      secondaryColor: '#A8A29E',
      accentColor: '#B45309',
      backgroundColor: '#FAFAF9',
      fontBody: 'Lora',
      fontHeading: 'Lora',
      radius: 0.5,
      density: 1.1,
      darkOverrides: null,
    },
  },
  {
    id: 'mono',
    name: 'Mono',
    category: 'Minimal',
    description: 'Pure black and white — maximum contrast, no colour',
    values: {
      primaryColor: '#000000',
      secondaryColor: '#525252',
      accentColor: null,
      backgroundColor: '#FFFFFF',
      fontBody: null,
      fontHeading: null,
      radius: 0,
      density: 0.95,
      darkOverrides: null,
    },
  },
] as const;
