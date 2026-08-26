<!--
  SearchPillHarness — a CONTROLLED parent for SearchPill.

  The bug this exists to catch only appears when the parent behaves like a real
  one: `value` is a prop that changes ONLY when the parent decides to commit.
  Mounting SearchPill with a static `value` cannot reproduce it, because the
  reset effect needs a live prop to reset the local mirror back to.

  `committed` mirrors what the parent has actually accepted, so a test can assert
  "typing did not commit" and "Enter did commit" separately.
-->
<script lang="ts">
  import SearchPill from './SearchPill.svelte';

  interface Props {
    /** Initial committed value (e.g. an SSR `?q=` param). */
    initial?: string;
    /** Pass through to enable live mode; omit for submit-only mode. */
    live?: boolean;
    debounce?: number;
    onSubmitSpy?: (value: string) => void;
    onChangeSpy?: (value: string) => void;
  }

  const {
    initial = '',
    live = false,
    debounce = 0,
    onSubmitSpy,
    onChangeSpy,
  }: Props = $props();

  // Seeded once — the harness owns `committed` from here on.
  // svelte-ignore state_referenced_locally
  let committed = $state(initial);

  export function getCommitted() {
    return committed;
  }
  /** Simulate an external write (parent Clear all, back/forward navigation). */
  export function setCommitted(next: string) {
    committed = next;
  }

  function handleSubmit(value: string) {
    committed = value;
    onSubmitSpy?.(value);
  }
  function handleChange(value: string) {
    committed = value;
    onChangeSpy?.(value);
  }
</script>

<SearchPill
  value={committed}
  placeholder="Search"
  onSubmit={handleSubmit}
  onChange={live ? handleChange : undefined}
  {debounce}
/>
