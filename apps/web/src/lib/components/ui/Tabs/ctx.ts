import type { createTabs } from '@melt-ui/svelte';
import { getContext, setContext } from 'svelte';

const CTX_KEY = 'tabs-ctx';
const ID_KEY = 'tabs-id';

export function setCtx(builder: ReturnType<typeof createTabs>) {
  setContext(CTX_KEY, builder);
}

export function getCtx() {
  return getContext<ReturnType<typeof createTabs>>(CTX_KEY);
}

/**
 * The tab set's own id. Melt (0.86) gives a tab no id and labels its panel
 * by the bare value (`aria-labelledby="page"`, an element that does not
 * exist), so a tab and its panel are named here instead, unique per set.
 */
export function setTabsId(id: string) {
  setContext(ID_KEY, id);
}

/** Read at a trigger's or panel's initialisation, as every context is. */
export function getTabsId() {
  return getContext<string>(ID_KEY);
}

/** The ids of one value's tab and panel, which point at each other. */
export function tabIds(id: string, value: string) {
  return { tab: `${id}-tab-${value}`, panel: `${id}-panel-${value}` };
}
