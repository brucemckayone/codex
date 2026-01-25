import type { createPopover } from '@melt-ui/svelte';
import { getContext, setContext } from 'svelte';

const CTX_KEY = 'popover-ctx';

export function setCtx(builder: ReturnType<typeof createPopover>) {
  setContext(CTX_KEY, builder);
}

export function getCtx() {
  return getContext<ReturnType<typeof createPopover>>(CTX_KEY);
}
