import { nanoid } from 'nanoid';
import { writable } from 'svelte/store';

export type ToastVariant = 'neutral' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant: ToastVariant;
  duration?: number;
}

export type ToastOptions = Omit<Toast, 'id' | 'variant'> & {
  variant?: ToastVariant;
};

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);

  function add(options: ToastOptions) {
    const id = nanoid();
    const toast: Toast = {
      id,
      variant: options.variant ?? 'neutral',
      duration: 3000,
      ...options,
    };

    update((toasts) => [...toasts, toast]);

    if (toast.duration !== 0) {
      setTimeout(() => {
        dismiss(id);
      }, toast.duration);
    }

    return id;
  }

  function dismiss(id: string) {
    update((toasts) => toasts.filter((t) => t.id !== id));
  }

  return {
    subscribe,
    add,
    dismiss,
    // Convenience methods
    success: (options: Omit<ToastOptions, 'variant'>) =>
      add({ ...options, variant: 'success' }),
    error: (options: Omit<ToastOptions, 'variant'>) =>
      add({ ...options, variant: 'error' }),
    warning: (options: Omit<ToastOptions, 'variant'>) =>
      add({ ...options, variant: 'warning' }),
    info: (options: Omit<ToastOptions, 'variant'>) =>
      add({ ...options, variant: 'neutral' }),
  };
}

export const toast = createToastStore();
