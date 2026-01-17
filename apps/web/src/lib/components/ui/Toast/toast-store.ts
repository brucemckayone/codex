import { createToaster } from '@melt-ui/svelte';

export type ToastVariant = 'neutral' | 'success' | 'warning' | 'error';

export interface ToastData {
  title?: string;
  description?: string;
  variant: ToastVariant;
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
  add: (data: ToastData, options?: { closeDelay?: number }) =>
    addToast({ data, closeDelay: options?.closeDelay ?? TOAST_CLOSE_DELAY }),

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
