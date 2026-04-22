interface FilterOption {
  value: string;
  label: string;
}

interface PillFilter {
  type: 'pills';
  key: string;
  label: string;
  options: FilterOption[];
  variant?: 'connected' | 'separated';
}

interface SelectFilter {
  type: 'select';
  key: string;
  label: string;
  options: FilterOption[];
  placeholder?: string;
  minWidth?: string;
}

interface SearchFilter {
  type: 'search';
  key: string;
  placeholder: string;
  mode?: 'debounce' | 'submit';
  debounceMs?: number;
}

type FilterConfig = PillFilter | SelectFilter | SearchFilter;

export { default as FilterBar } from './FilterBar.svelte';
