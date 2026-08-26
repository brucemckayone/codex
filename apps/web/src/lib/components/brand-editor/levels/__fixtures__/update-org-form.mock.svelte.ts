/**
 * Reactive test double for `$lib/remote/org.remote` (Codex-cijzb · WP-1.6
 * hero-text tests). Only `updateOrganizationForm` — the surface
 * BrandEditorHeroText imports — is stubbed.
 *
 * `.pending`/`.result` are $state-backed (getters over module state) so a test
 * can drive the submit lifecycle and the component's reactive effects re-run,
 * exactly as the real remote form would. `.fields.X.set()` records its calls so
 * a test can assert the current org values were seeded into the form.
 *
 * A `.svelte.ts` module (runes compiled) that is NOT a `*.test.*` file, so
 * vitest's include globs never collect it as a suite — same trick as
 * StubField.test.svelte.
 */

export type OrgFormResult =
  | { success: true; data: unknown }
  | { success: false; error: string }
  | undefined;

const formState = $state<{ pending: number; result: OrgFormResult }>({
  pending: 0,
  result: undefined,
});

/** Values passed to each field's `.set()` — for seed assertions. */
export const fieldSets: { name: string[]; description: string[] } = {
  name: [],
  description: [],
};

function stubField(record: string[]) {
  return {
    as: (_type: string) => ({ name: 'stub' }),
    set: (value: string) => {
      record.push(value);
    },
    value: () => '',
    issues: () => [] as { message: string }[],
  };
}

export const updateOrganizationForm = {
  method: 'POST',
  action: '?/updateOrganizationForm',
  onsubmit: () => {},
  get pending() {
    return formState.pending;
  },
  get result() {
    return formState.result;
  },
  fields: {
    name: stubField(fieldSets.name),
    description: stubField(fieldSets.description),
  },
};

/** Drive the submit lifecycle from a test. */
export function setResult(result: OrgFormResult): void {
  formState.result = result;
}

export function setPending(pending: number): void {
  formState.pending = pending;
}

/** Reset between tests (module singleton persists across mounts). */
export function reset(): void {
  formState.pending = 0;
  formState.result = undefined;
  fieldSets.name.length = 0;
  fieldSets.description.length = 0;
}
