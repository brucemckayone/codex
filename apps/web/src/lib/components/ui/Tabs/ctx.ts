import type { createTabs } from '@melt-ui/svelte';
import { getContext, setContext } from 'svelte';

const CTX_KEY = 'tabs-ctx';

export function setCtx(builder: ReturnType<typeof createTabs>) {
  setContext(CTX_KEY, builder);
}

export function getCtx() {
  return getContext<ReturnType<typeof createTabs>>(CTX_KEY);
}
