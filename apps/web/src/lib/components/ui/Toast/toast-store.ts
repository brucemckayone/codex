import { createToaster } from '@melt-ui/svelte';

export type ToastVariant = 'neutral' | 'success' | 'warning' | 'error';

export interface ToastData {
  title?: string;
  description?: string;
  variant: ToastVariant;
  /** One link under the text (a toast's "Show them"); following it closes the toast. */
  action?: { label: string; href: string; newTab?: boolean };
}

// Create the toaster
const {
  elements: { content, title, description, close },
  helpers: { addToast, removeToast },
  states: { toasts },
} = createToaster<ToastData>();

export const toaster = {
  toasts,
  elements: { content, title, description, close },
  remove: removeToast,
};

// Default 5s delay balances readability with non-intrusive UX
const TOAST_CLOSE_DELAY = 5000;

// Helper for easier usage
export const toast = {
  /**
   * A toast with an `action` stays until it is closed (Melt: `closeDelay` 0).
   * Melt pauses the timer on pointer hover only, never on focus, and the
   * toaster is last in the tab order, so a timed one could vanish under a
   * keyboard user's focus on its way to the link.
   */
  add: (data: ToastData, options?: { closeDelay?: number }) =>
    addToast({
      data,
      closeDelay: options?.closeDelay ?? (data.action ? 0 : TOAST_CLOSE_DELAY),
    }),

  success: (title: string, description?: string) =>
    addToast({
      data: { title, description, variant: 'success' },
      closeDelay: TOAST_CLOSE_DELAY,
    }),

  error: (title: string, description?: string) =>
    addToast({
      data: { title, description, variant: 'error' },
      closeDelay: TOAST_CLOSE_DELAY,
    }),

  warning: (title: string, description?: string) =>
    addToast({
      data: { title, description, variant: 'warning' },
      closeDelay: TOAST_CLOSE_DELAY,
    }),

  info: (title: string, description?: string) =>
    addToast({
      data: { title, description, variant: 'neutral' },
      closeDelay: TOAST_CLOSE_DELAY,
    }),
};
