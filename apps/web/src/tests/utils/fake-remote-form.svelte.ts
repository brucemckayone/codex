/**
 * A faithful test double for SvelteKit's client-side remote `form()` object.
 *
 * The real thing cannot be used in a jsdom unit test: `.remote.ts` modules load
 * their SERVER source (see the global `$app/server` mock in `src/tests/mocks.ts`),
 * so `form(schema, handler)` evaluates to the bare handler with no `fields`,
 * `enhance` or submit attachment. This double reimplements the parts of the
 * client runtime a form component actually touches, transcribed from
 * `@sveltejs/kit@2.55.0`
 * `src/runtime/client/remote-functions/form.svelte.js`:
 *
 * - `instance[createAttachmentKey()]` — the DEFAULT attachment installed for the
 *   bare `{...form}` spread, which calls `form.reset()` after a submission that
 *   returned no issues (lines 444-452).
 * - the `reset` listener that re-derives the reactive field state from the
 *   post-reset DOM (lines 424-432).
 * - the `input` listener that keeps field state in step with typing (line 422).
 * - `enhance(callback)`, returning a COMPLETE replacement spread —
 *   `{ method, action, [attachment] }` — that runs `callback` instead of the
 *   default one, and therefore never resets (lines 569-578).
 * - `fields.<name>.as(type) / .value() / .set() / .issues()` and the root
 *   `fields.set({...})`, from `create_field_proxy` in
 *   `src/runtime/form-utils.js` (the text `value` is a live getter over field
 *   state, line 804-808).
 *
 * Only `method`, `action` and the attachment are ENUMERABLE, exactly as in the
 * real instance, so `{...fakeForm}` spreads the same three things a real one
 * does. Test-only handles (`submissions`, `resetCount`, `__reset`) are
 * non-enumerable and never reach the DOM.
 */

import { tick } from 'svelte';
import { createAttachmentKey } from 'svelte/attachments';

/** One submitted payload, as read from the DOM at submit time. */
export type SubmittedData = Record<string, string>;

export interface FakeRemoteFormResponse {
  /** Field-keyed validation issues. A non-empty object makes kit skip its reset. */
  issues?: Record<string, { message: string }[]>;
  /** The value exposed as `form.result`. */
  result?: unknown;
}

export interface FakeRemoteFormOptions {
  /** Field state the form starts with, as a `fields.set(...)` seed would leave it. */
  initial?: SubmittedData;
  /** Decides what the server "returns" for a submission. Default: success. */
  respond?: (data: SubmittedData) => FakeRemoteFormResponse;
}

/** One field accessor, as `create_field_proxy` hands them out. */
export interface FakeField {
  value: () => string | undefined;
  set: (value: string) => void;
  issues: () => { message: string }[] | undefined;
  as: (type: string) => {
    name: string;
    type: string;
    readonly value: string;
  };
}

export type FakeFields = Record<string, FakeField> & {
  /** Root `fields.set({...})` — replaces the whole field state. */
  set(values: SubmittedData): void;
};

/** What kit hands an `enhance` callback. */
export interface FakeEnhanceArgs {
  form: HTMLFormElement;
  data: SubmittedData;
  submit: () => Promise<void>;
}

/** A spread object: `method`, `action` and one symbol-keyed attachment. */
export type FakeFormAttrs = Record<string | symbol, unknown>;

export interface FakeRemoteForm {
  method: 'POST';
  action: string;
  fields: FakeFields;
  result: unknown;
  pending: number;
  validate: () => Promise<void>;
  preflight: (schema: unknown) => FakeRemoteForm;
  enhance: (
    callback: (args: FakeEnhanceArgs) => void | Promise<void>
  ) => FakeFormAttrs;
  /** Every payload submitted so far, oldest first. */
  readonly submissions: SubmittedData[];
  /** How many times the DEFAULT attachment called `HTMLFormElement.reset()`. */
  readonly resetCount: number;
  /** Clear state between tests (the real object is a module singleton too). */
  __reset: (options?: FakeRemoteFormOptions) => void;
}

/**
 * Mirror of kit's `flatten_issues` (form-utils.js:563): every issue is ALSO
 * pushed under the catch-all `$` key, which is what the default attachment
 * tests (`if (!issues.$)`) to decide whether to reset.
 */
function flattenIssues(
  issues: Record<string, { message: string }[]> | undefined
): Record<string, { message: string }[]> {
  if (!issues) return {};
  const all = Object.values(issues).flat();
  return all.length > 0 ? { ...issues, $: all } : {};
}

function readFormData(form: HTMLFormElement): SubmittedData {
  const data: SubmittedData = {};
  for (const [key, value] of new FormData(form).entries()) {
    data[key] = typeof value === 'string' ? value : value.name;
  }
  return data;
}

export function createFakeRemoteForm(
  options: FakeRemoteFormOptions = {}
): FakeRemoteForm {
  let config = options;
  let input = $state<SubmittedData>({ ...(options.initial ?? {}) });
  let issues = $state.raw<Record<string, { message: string }[]>>({});
  let result = $state.raw<unknown>(undefined);
  let pending = $state(0);
  let submissions: SubmittedData[] = [];
  let resetCount = 0;

  async function submit(form: HTMLFormElement): Promise<void> {
    const data = readFormData(form);
    submissions.push(data);
    pending++;
    // One microtask stands in for the network turn, so `pending` is observable.
    await Promise.resolve();
    const response = config.respond?.(data) ?? { result: { success: true } };
    issues = flattenIssues(response.issues);
    result = 'result' in response ? response.result : { success: true };
    pending--;
  }

  function onsubmit(callback: (args: FakeEnhanceArgs) => void | Promise<void>) {
    return async (event: Event) => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      await callback({
        form,
        data: readFormData(form),
        submit: () => submit(form),
      });
    };
  }

  function createAttachment(handler: (event: Event) => void) {
    return (form: HTMLFormElement) => {
      form.addEventListener('submit', handler);

      const handleInput = (event: Event) => {
        const element = event.target as HTMLInputElement;
        if (!element.name) return;
        input[element.name] = element.value;
      };
      form.addEventListener('input', handleInput);

      // kit waits a tick because `reset` fires BEFORE the controls are cleared.
      const handleReset = async () => {
        await tick();
        input = readFormData(form);
      };
      form.addEventListener('reset', handleReset);

      return () => {
        form.removeEventListener('submit', handler);
        form.removeEventListener('input', handleInput);
        form.removeEventListener('reset', handleReset);
      };
    };
  }

  const fields = new Proxy({} as FakeFields, {
    get(_target, prop: string) {
      if (prop === 'set') {
        return (values: SubmittedData) => {
          input = { ...values };
        };
      }
      return {
        value: () => input[prop],
        set: (value: string) => {
          input[prop] = value;
        },
        issues: () => issues[prop],
        as: (type: string) => ({
          name: prop,
          type,
          get value() {
            return input[prop] != null ? String(input[prop]) : '';
          },
        }),
      };
    },
  });

  const action = '?/remote=fake';
  const instance: Record<string | symbol, unknown> = {
    method: 'POST',
    action,
  };

  // The DEFAULT attachment — the one the bare `{...form}` spread installs.
  instance[createAttachmentKey()] = createAttachment(
    onsubmit(({ submit: doSubmit, form }) =>
      doSubmit().then(() => {
        if (!issues.$) {
          resetCount++;
          form.reset();
        }
      })
    )
  );

  Object.defineProperties(instance, {
    fields: { get: () => fields },
    result: { get: () => result },
    pending: { get: () => pending },
    validate: { value: async () => {} },
    preflight: { value: () => instance },
    enhance: {
      value: (callback: (args: FakeEnhanceArgs) => void | Promise<void>) => ({
        method: 'POST' as const,
        action,
        [createAttachmentKey()]: createAttachment(onsubmit(callback)),
      }),
    },
    submissions: { get: () => submissions },
    resetCount: { get: () => resetCount },
    __reset: {
      value: (next: FakeRemoteFormOptions = {}) => {
        config = { ...config, ...next };
        input = { ...(next.initial ?? config.initial ?? {}) };
        issues = {};
        result = undefined;
        pending = 0;
        submissions = [];
        resetCount = 0;
      },
    },
  });

  return instance as unknown as FakeRemoteForm;
}
