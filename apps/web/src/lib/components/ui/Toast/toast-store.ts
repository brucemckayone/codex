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

// Helper for easier usage
export const toast = {
  add: (data: ToastData, options?: { closeDelay?: number }) =>
    addToast({ data, closeDelay: options?.closeDelay ?? 5000 }),

  success: (title: string, description?: string) =>
    addToast({
      data: { title, description, variant: 'success' },
      closeDelay: 5000,
    }),

  error: (title: string, description?: string) =>
    addToast({
      data: { title, description, variant: 'error' },
      closeDelay: 5000,
    }),

  warning: (title: string, description?: string) =>
    addToast({
      data: { title, description, variant: 'warning' },
      closeDelay: 5000,
    }),

  info: (title: string, description?: string) =>
    addToast({
      data: { title, description, variant: 'neutral' },
      closeDelay: 5000,
    }),
};
