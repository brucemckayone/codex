/**
 * A `File` may only travel through `form()` — never `command()` or `query()`.
 *
 * THE BUG THIS EXISTS FOR. `uploadJourneyCover` was written as a `command()`
 * whose schema contained `z.instanceof(File)`. A command's arguments are
 * serialized with devalue, which has no representation for a `File`, so calling
 * it threw `Cannot stringify arbitrary non-POJOs` in the BROWSER — before any
 * request was made. The cover upload could never have worked, on any browser,
 * since the day it was written.
 *
 * WHY NOTHING CAUGHT IT. The rule was already known: three sibling uploads
 * (`uploadThumbnailForm`, `uploadCategoryCoverForm`, `uploadLogoForm`) each
 * carry a comment saying "File objects cannot be serialized by
 * command()/devalue". But a rule recorded only in prose is a rule the next
 * author does not inherit — and the only test touching the path MOCKED the
 * remote function, so the mock happily accepted a `File` that the real
 * implementation could never transmit. A mock that is more capable than the
 * thing it stands in for hides exactly this class of defect.
 *
 * So the rule is asserted over the SOURCE, mechanically, for every remote file.
 * SvelteKit's own docs are explicit on both halves: query/command arguments
 * "are serialized with devalue", while a form field's value may be a "string,
 * number, boolean or `File`".
 *
 * WHY SOURCE-SCANNING RATHER THAN A TYPE. `command()` accepts any Standard
 * Schema, and `z.instanceof(File)` is a perfectly well-typed schema — TypeScript
 * cannot know that devalue will refuse the value at runtime. There is no type
 * that expresses "serializable by devalue", so the guard has to read the code.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every remote module in this directory. */
const REMOTE_FILES = readdirSync(HERE)
  .filter((name) => name.endsWith('.remote.ts'))
  .sort();

type Flavour = 'query' | 'command' | 'form' | 'prerender';

interface Declaration {
  file: string;
  name: string;
  flavour: Flavour;
  /** Source of the first argument only — the schema, not the handler. */
  schema: string;
}

/**
 * Slice out a remote declaration's SCHEMA argument.
 *
 * Walks parens from the opening `(` and stops at the first comma seen at depth
 * 1, which is the boundary between the schema and the handler. Bounding the
 * slice this way matters: a handler body may legitimately mention `File` (a
 * type annotation, a comment), and including it would make the assertion below
 * fire on code that is correct.
 */
function declarations(file: string, src: string): Declaration[] {
  const out: Declaration[] = [];
  const re = /export const (\w+) = (query|command|form|prerender)\(/g;

  for (const match of src.matchAll(re)) {
    const [, name, flavour] = match;
    let i = match.index + match[0].length;
    let depth = 1;
    const start = i;
    let end = -1;

    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      else if (ch === ',' && depth === 1) {
        end = i;
        break;
      }
      i += 1;
    }

    out.push({
      file,
      name,
      flavour: flavour as Flavour,
      // No depth-1 comma means a single argument (no schema, e.g. `query(fn)`).
      schema: end > 0 ? src.slice(start, end) : '',
    });
  }

  return out;
}

/**
 * Follow a schema passed by NAME to the `const` that defines it.
 *
 * Most uploads here declare their schema separately (`uploadLogoSchema`,
 * `avatarUploadSchema`, …) and pass the identifier. An earlier version of this
 * guard only read the inline slice and so saw 1 of the 4 real uploads — the
 * three that matter most were invisible to it, which would have let a
 * `command(uploadLogoSchema, …)` regression through untouched. Resolving the
 * identifier is what makes the assertion cover the code as it is actually
 * written.
 */
function resolveSchema(src: string, expr: string): string {
  const trimmed = expr.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(trimmed)) return trimmed;

  const at = src.search(new RegExp(`\\bconst ${trimmed}\\s*=`));
  if (at < 0) return trimmed;

  // Walk to the end of the initializer: depth back to 0 and then a `;`.
  let i = src.indexOf('=', at) + 1;
  let depth = 0;
  const start = i;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ';' && depth === 0) break;
    i += 1;
  }
  return src.slice(start, i);
}

const ALL: Declaration[] = REMOTE_FILES.flatMap((file) => {
  const src = readFileSync(join(HERE, file), 'utf8');
  return declarations(file, src).map((d) => ({
    ...d,
    schema: resolveSchema(src, d.schema),
  }));
});

/** Declarations whose SCHEMA accepts a `File`. */
const FILE_CARRYING = ALL.filter((d) =>
  /instanceof\(\s*File\s*\)/.test(d.schema)
);

describe('remote functions — a File may only travel by form()', () => {
  it('parses the remote files it claims to check', () => {
    // Guards the guard twice over. An empty file list, or a parser that matched
    // nothing, would make every assertion below pass while checking nothing —
    // which is precisely the failure mode that let the original bug through.
    expect(REMOTE_FILES.length).toBeGreaterThan(5);
    expect(ALL.length).toBeGreaterThan(20);
    expect(new Set(ALL.map((d) => d.flavour))).toContain('command');
    expect(new Set(ALL.map((d) => d.flavour))).toContain('form');
  });

  it('finds the uploads, so the rule below is not asserted over an empty set', () => {
    // If a refactor moves the uploads elsewhere this fails rather than going
    // quietly green.
    expect(FILE_CARRYING.length).toBeGreaterThanOrEqual(4);
  });

  it('never accepts a File in a command() or query() schema', () => {
    // The whole point. `form()` submits real FormData, so a File is fine there;
    // query/command/prerender arguments go through devalue, which throws
    // `Cannot stringify arbitrary non-POJOs` on the CLIENT — no request, no
    // server log, nothing to grep for.
    const wrong = FILE_CARRYING.filter((d) => d.flavour !== 'form').map(
      (d) => `${d.file}: ${d.name} is a ${d.flavour}()`
    );
    expect(
      wrong,
      'a File cannot be serialized by devalue — use form() and submit FormData'
    ).toEqual([]);
  });

  it('has every File-carrying form declare multipart handling in its docs', () => {
    // Soft half of the contract: the `<form>` needs
    // `enctype="multipart/form-data"`, which lives in the component. The nearest
    // machine-checkable proxy is that the remote function says so, so the next
    // author inherits the rule this file exists to enforce.
    const undocumented = FILE_CARRYING.filter((d) => {
      const src = readFileSync(join(HERE, d.file), 'utf8');
      const at = src.indexOf(`export const ${d.name} =`);
      const preamble = src.slice(Math.max(0, at - 1600), at);
      return !/FormData|multipart|devalue/i.test(preamble);
    }).map((d) => `${d.file}: ${d.name}`);
    expect(undocumented).toEqual([]);
  });
});
