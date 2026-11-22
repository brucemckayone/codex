/**
 * The seeded Of Blood & Bones stores the hero the Showreel's browser suite
 * reads from the server's HTML (Codex-1yd58): the Showreel, Wide, with the
 * featured peek on. A landing with no `hero-opt-purpose` draws the classic
 * hero instead, so every cell reading the served reel failed on a fresh seed
 * while it passed on a local row that stores the hero.
 *
 * What the landing resolves from these keys and these facts is the web app's
 * `hero-config.test.ts` ("the seeded OBB's stored hero"): consume with a reel
 * is the Showreel, and the peek stays on while a featured piece exists. Here,
 * the seed's half: the keys, the brand the other suites pin, the logo the top
 * bar draws, and the featured rows the peek and the reel are made of.
 *
 * The database is a fake that records each insert's rows: no DB, no network.
 */
import { describe, expect, it } from 'vitest';
import type { dbWs as DbClient } from '../../../src';
import { schema } from '../../../src';
import { ORGS } from '../constants';
import { seedContent } from '../content';
import { seedOrganizations } from '../organizations';

type Row = Record<string, unknown>;

/** A database whose inserts record their rows by table, and do nothing else. */
function recordingDb(): { db: typeof DbClient; rows: Map<unknown, Row[]> } {
  const rows = new Map<unknown, Row[]>();
  const db = {
    insert: (table: unknown) => ({
      values: async (values: Row | Row[]) => {
        const list = rows.get(table) ?? [];
        list.push(...(Array.isArray(values) ? values : [values]));
        rows.set(table, list);
      },
    }),
  };
  return { db: db as unknown as typeof DbClient, rows };
}

async function bonesBranding(): Promise<Row> {
  const { db, rows } = recordingDb();
  await seedOrganizations(db);
  const row = rows
    .get(schema.brandingSettings)
    ?.find((r) => r.organizationId === ORGS.bones.id);
  if (!row) throw new Error('no branding row for of-blood-and-bones');
  return row;
}

describe("the seeded of-blood-and-bones' stored hero", () => {
  it('stores the Showreel, Wide, as the Showreel suite reads it', async () => {
    const row = await bonesBranding();
    const overrides = JSON.parse(String(row.tokenOverrides)) as Row;
    const hero = Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key.startsWith('hero-opt-'))
    );
    expect(hero).toEqual({
      'hero-opt-purpose': 'consume',
      'hero-opt-comp': 'showreel',
      'hero-opt-reel-layout': 'wide',
      'hero-opt-reel-pointer': 'none',
      'hero-opt-second': 'auto',
    });
  });

  it('keeps the brand the other suites pin: shadow scale 0.5, no shader, no intro film, no dark background', async () => {
    const row = await bonesBranding();
    const overrides = JSON.parse(String(row.tokenOverrides)) as Row;
    // e2e/org/org-shadows.spec.ts
    expect(overrides['shadow-scale']).toBe('0.5');
    // e2e/page-kit/org-shader.spec.ts ("with none, its pages keep their Style's schemes")
    expect(overrides['shader-preset']).toBeUndefined();
    // the Showreel suite stands a catalogue film in for it (helpers/showreel.ts)
    expect(row.introVideoMediaItemId ?? null).toBeNull();
    // e2e/page-kit/brand-fidelity.spec.ts ("an org background with no dark one")
    expect(row.darkModeOverrides ?? null).toBeNull();
  });

  it('keeps a logo for the top bar: the Showreel suite fails one late and lays the name beside it', async () => {
    const row = await bonesBranding();
    expect(row.logoUrl).toEqual(expect.stringMatching(/^https?:\/\/\S+$/));
  });

  it('has at least two featured, published pieces with a picture: the reel and the peek', async () => {
    const { db, rows } = recordingDb();
    await seedContent(db);
    const featured = (rows.get(schema.content) ?? []).filter(
      (r) =>
        r.organizationId === ORGS.bones.id &&
        r.featured === true &&
        r.status === 'published' &&
        typeof r.thumbnailUrl === 'string'
    );
    expect(featured.length).toBeGreaterThanOrEqual(2);
  });
});
