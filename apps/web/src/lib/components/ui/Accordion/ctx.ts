import type { createAccordion } from '@melt-ui/svelte';
import { getContext, setContext } from 'svelte';

const CTX_KEY = 'accordion-ctx';
const ITEM_CTX_KEY = 'accordion-item-ctx';

export function setCtx(builder: ReturnType<typeof createAccordion>) {
  setContext(CTX_KEY, builder);
}

export function getCtx() {
  return getContext<ReturnType<typeof createAccordion>>(CTX_KEY);
}

export function setItemCtx(value: string) {
  setContext(ITEM_CTX_KEY, { value });
}

export function getItemCtx() {
  return getContext<{ value: string }>(ITEM_CTX_KEY);
}
