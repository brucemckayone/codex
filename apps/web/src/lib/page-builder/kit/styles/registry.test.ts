// @vitest-environment node
/**
 * The private-property registry (03 §4.3): a Style may lean on a `--_*` name
 * only while its owner still has it.
 *
 * A Style that re-points one of the kit's private recipes (as Path once did
 * with `--_acc-light`, before `--lp-accent-source`) silently falls back to the
 * kit's own value the day that private is renamed — the wrong colour, with no
 * test failing, because a custom property nothing reads is not an error. So
 * every private a `style-*.css` DECLARES must be the kit's (declared by one of
 * its four sheets) or the Style's own (`--_<id>-…`), and every private it
 * READS must be declared by the kit, by the Style itself, or by the block it
 * names. Borrowing a block's private, or keeping an un-namespaced helper, is
 * allowed only as an entry below, with its owner and its reason — so a NEW
 * borrowing, or a rename on either side, fails here.
 *
 * Read with svelte's own CSS parser, comments stripped first.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseCss } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { PAGE_STYLE_IDS, type PageStyleId } from '../model/ids';

const STYLES = dirname(fileURLToPath(import.meta.url));
const KIT = dirname(STYLES);
/** The kit's own sheets: what a Style may re-point without an entry. */
const KIT_SHEETS = ['kit.css', 'schemes.css', 'surfaces.css', 'motion.css'];

/** A private a Style borrows from a block, or keeps as a local helper. */
interface Borrowed {
  /** The kit file that declares it, or `local`: declared by no kit file. */
  owner: string;
  reason: string;
}

const LOCAL = 'local';

/**
 * Every existing borrowing, each checked against its owner. The Style files
 * are not this file's to change; a new entry needs a reason as good as these.
 */
const BORROWED: Record<PageStyleId, Record<string, Borrowed>> = {
  bold: {
    '--_marker': {
      owner: 'blocks/curriculum/StageTimeline.svelte',
      reason: 'larger timeline markers, for Bold’s larger type',
    },
    '--_figure': {
      owner: 'blocks/stats/StatsBlock.svelte',
      reason: 'the row’s figures at display size',
    },
    '--_cols': {
      owner: 'blocks/stats/StatsBlock.svelte',
      reason: 'two to a row for two or four figures',
    },
  },
  clean: {
    '--_ratio': {
      owner: 'blocks/hero/HeroBlock.svelte',
      reason: 'a square picture in the split hero',
    },
    '--_columns': {
      owner: 'blocks/gallery/GalleryGrid.svelte',
      reason: 'at most three pictures to a row',
    },
  },
  cinematic: {},
  path: {
    '--_route': {
      owner: 'blocks/curriculum/StageMap.svelte',
      reason: 'the map’s line at the page route’s weight',
    },
    '--_dot': {
      owner: 'blocks/curriculum/StageMap.svelte',
      reason: 'stops small enough to ride the page’s rail',
    },
    '--_gap': {
      owner: 'blocks/curriculum/StageMap.svelte',
      reason: 'READ: the bend back to the rail spans the map’s own gap',
    },
    '--_marker': {
      owner: 'blocks/curriculum/StageTimeline.svelte',
      reason: 'timeline markers sized to sit on the rail',
    },
    '--_r': {
      owner: LOCAL,
      reason: 'a story station’s radius, on its own pseudo-element',
    },
  },
  poster: {
    '--_off': {
      owner: LOCAL,
      reason: 'how far the colour block sits out from a photo',
    },
  },
  quiet: {},
  soft: {
    '--_mist': {
      owner: LOCAL,
      reason: 'how far the shapes’ fade reaches into a band',
    },
  },
  studio: {
    '--_print-edge': {
      owner: LOCAL,
      reason: 'a print’s border width',
    },
    '--_print-paper': {
      owner: LOCAL,
      reason: 'a print’s border colour, the lifted ground',
    },
    '--_gap': {
      owner: 'blocks/gallery/GalleryMosaic.svelte',
      reason: 'a tighter mosaic',
    },
    '--_chars': {
      owner: 'blocks/stats/StatsBlock.svelte',
      reason: 'READ: the longest figure’s length, to fit it in its circle',
    },
  },
};

// ── reading the kit ─────────────────────────────────────────────────────────
type CssNode = {
  type: string;
  property?: string;
  block?: { children: CssNode[] } | null;
  children?: CssNode[];
};

const uncomment = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

function privatesOf(nodes: CssNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.type === 'Declaration' && node.property?.startsWith('--_'))
      into.add(node.property);
    privatesOf(node.block?.children ?? node.children ?? [], into);
  }
  return into;
}

/** The `--_*` properties a stylesheet declares (a style query only reads). */
const declaredBySheet = (css: string) =>
  privatesOf(parseCss(uncomment(css)).children as unknown as CssNode[]);

/** …a component declares: in its <style>, and inline (`style:--_x`, `style="--_x: …"`). */
function declaredByComponent(source: string): Set<string> {
  // The parser drops the <style>'s comments itself; stripping first could cut
  // a `/*` out of a string in the script.
  const css = parse(source, { modern: true }).css;
  const found = privatesOf((css?.children ?? []) as unknown as CssNode[]);
  const code = uncomment(source);
  for (const m of code.matchAll(/style:(--_[\w-]+)/g)) found.add(m[1]);
  for (const attr of code.matchAll(/style=(["'])(.*?)\1/g))
    for (const m of attr[2].matchAll(/(--_[\w-]+)\s*:/g)) found.add(m[1]);
  return found;
}

/** The `--_*` properties a stylesheet reads. */
const readBySheet = (css: string) =>
  new Set(
    [...uncomment(css).matchAll(/var\(\s*(--_[\w-]+)/g)].map((m) => m[1])
  );

interface Registry {
  /** Declared by the four kit sheets. */
  kit: Set<string>;
  /** Declared by each other kit file (blocks, primitives, the renderer), by path. */
  files: Map<string, Set<string>>;
  /** Each Style's own sheets, merged. */
  styles: Map<string, { declared: Set<string>; read: Set<string> }>;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(css|svelte)$/.test(entry.name) ? [path] : [];
  });
}

/** Every kit file's source, by its path from the kit root. */
function kitSources(): Map<string, string> {
  return new Map(
    walk(KIT).map((path) => [relative(KIT, path), readFileSync(path, 'utf8')])
  );
}

function registryOf(sources: Map<string, string>): Registry {
  const registry: Registry = {
    kit: new Set(),
    files: new Map(),
    styles: new Map(),
  };
  for (const [path, source] of sources) {
    const sheet = path.match(/^styles\/(.+\.css)$/)?.[1];
    const style = sheet?.match(/^style-([a-z]+)(?:-[a-z]+)?\.css$/)?.[1];
    if (sheet && KIT_SHEETS.includes(sheet)) {
      for (const name of declaredBySheet(source)) registry.kit.add(name);
    } else if (style) {
      const own = registry.styles.get(style) ?? {
        declared: new Set(),
        read: new Set(),
      };
      for (const name of declaredBySheet(source)) own.declared.add(name);
      for (const name of readBySheet(source)) own.read.add(name);
      registry.styles.set(style, own);
    } else {
      registry.files.set(
        path,
        path.endsWith('.svelte')
          ? declaredByComponent(source)
          : declaredBySheet(source)
      );
    }
  }
  return registry;
}

/** Everything wrong with how the Styles use the kit's privates. */
function violations(
  registry: Registry,
  borrowed: Record<string, Record<string, Borrowed>>
): string[] {
  const out: string[] = [];
  const declaredElsewhere = (name: string) =>
    registry.kit.has(name) ||
    [...registry.files.values()].some((set) => set.has(name));
  // A borrowing holds while its owner has the name (a local one: while no one does).
  const holds = (entry: Borrowed, name: string) =>
    entry.owner === LOCAL
      ? !declaredElsewhere(name)
      : (registry.files.get(entry.owner)?.has(name) ?? false);

  for (const [id, { declared, read }] of registry.styles) {
    const entries = borrowed[id] ?? {};
    for (const name of declared) {
      if (name.startsWith(`--_${id}-`) || registry.kit.has(name)) continue;
      const entry = entries[name];
      if (!entry)
        out.push(
          `${id} declares ${name}: not the kit's, not --_${id}-…, and not listed`
        );
      else if (!holds(entry, name))
        out.push(
          entry.owner === LOCAL
            ? `${id}'s local ${name} is now declared by the kit too`
            : `${id} sets ${name}, which ${entry.owner} no longer declares`
        );
    }
    for (const name of read) {
      if (declared.has(name) || registry.kit.has(name)) continue;
      const entry = entries[name];
      if (!entry || entry.owner === LOCAL)
        out.push(`${id} reads ${name}, which nothing it may read declares`);
      else if (!holds(entry, name))
        out.push(
          `${id} reads ${name}, which ${entry.owner} no longer declares`
        );
    }
    for (const name of Object.keys(entries))
      if (!declared.has(name) && !read.has(name))
        out.push(
          `${id}: the entry for ${name} is stale — the Style no longer uses it`
        );
  }
  return out;
}

// ── the gate ────────────────────────────────────────────────────────────────
describe('the private-property registry (calibration, on scratch copies)', () => {
  const real = kitSources();
  const scratch = (edits: Record<string, (source: string) => string>) => {
    const copy = new Map(real);
    for (const [path, edit] of Object.entries(edits)) {
      const source = copy.get(path);
      if (source === undefined) throw new Error(`no ${path}`);
      copy.set(path, edit(source));
    }
    return registryOf(copy);
  };
  // Path as it was before `--lp-accent-source`: it re-pointed a kit recipe.
  const repointing = {
    'styles/style-path.css': (css: string) =>
      `${css}\n.lp[data-lp-style='path'] { --_acc-light: var(--lp-brand-2); }`,
  };

  it('passes a Style that re-points a kit private, and fails it once the kit renames that private', () => {
    expect(violations(scratch(repointing), BORROWED)).toEqual([]);
    const renamed = scratch({
      ...repointing,
      'styles/schemes.css': (css) =>
        css.replaceAll('--_acc-light', '--_accent-light'),
    });
    expect(violations(renamed, BORROWED)).toEqual([
      "path declares --_acc-light: not the kit's, not --_path-…, and not listed",
    ]);
  });

  it('fails a borrowing when the block renames the private, and a read of a renamed kit private', () => {
    const block = scratch({
      'blocks/curriculum/StageMap.svelte': (svelte) =>
        svelte.replaceAll('--_dot', '--_stop'),
    });
    expect(violations(block, BORROWED)).toEqual([
      'path sets --_dot, which blocks/curriculum/StageMap.svelte no longer declares',
    ]);
    const read = scratch({
      'styles/schemes.css': (css) =>
        css.replaceAll('--_scrim', '--_media-scrim'),
    });
    expect(violations(read, BORROWED)).toEqual([
      'path reads --_scrim, which nothing it may read declares',
    ]);
  });

  it('fails a new un-namespaced private, and a stale entry; passes a namespaced one', () => {
    const fresh = scratch({
      'styles/style-poster.css': (css) =>
        `${css}\n.lp[data-lp-style='poster'] { --_tilt: 2deg; --_poster-tilt: 2deg; }`,
    });
    expect(violations(fresh, BORROWED)).toEqual([
      "poster declares --_tilt: not the kit's, not --_poster-…, and not listed",
    ]);
    const stale = {
      ...BORROWED,
      soft: { ...BORROWED.soft, '--_gone': { owner: LOCAL, reason: 'x' } },
    };
    expect(violations(registryOf(real), stale)).toEqual([
      'soft: the entry for --_gone is stale — the Style no longer uses it',
    ]);
  });

  it('reads a style query and a comment as neither a declaration nor a use', () => {
    expect([
      ...declaredBySheet(
        '@container style(--_q: on) { .a { color: red; } } /* .b { --_c: 1; } */ .d { --_e: 1; }'
      ),
    ]).toEqual(['--_e']);
    expect(
      [
        ...declaredByComponent(
          '<b style:--_f={1} style="--_g: 2"></b><style>.h { --_i: 3; }</style>'
        ),
      ].sort()
    ).toEqual(['--_f', '--_g', '--_i']);
  });
});

describe('the private-property registry', () => {
  const registry = registryOf(kitSources());

  it('reads every Style and the kit, and finds real privates', () => {
    expect([...registry.styles.keys()].sort()).toEqual(
      [...PAGE_STYLE_IDS].sort()
    );
    expect(registry.kit.size).toBeGreaterThan(100);
    expect(registry.files.size).toBeGreaterThan(40);
    // Not vacuous: the Styles do borrow, and do read the kit's own.
    expect(registry.styles.get('path')?.declared.has('--_dot')).toBe(true);
    // (Quiet's floating bar read `--_accent-g` until its bar took base's own
    // colours, phase 3a.)
    expect(registry.styles.get('path')?.read.has('--_scrim')).toBe(true);
  });

  it('holds every Style to the kit’s names, its own, or a listed borrowing that still holds', () => {
    expect(violations(registry, BORROWED)).toEqual([]);
  });
});
