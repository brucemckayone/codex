/**
 * Editor configuration types shared between the editor component
 * and the server-side HTML renderer.
 */

/** Editor feature presets */
export type EditorPreset = 'full' | 'minimal';

/** Options passed to extension factories */
export interface EditorExtensionOptions {
  placeholder?: string;
  maxLength?: number;
}
