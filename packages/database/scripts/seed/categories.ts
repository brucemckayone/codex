import type { dbWs as DbClient } from '../../src';
import { eq, schema } from '../../src';
import { CATEGORIES, CONTENT, ORGS, USERS } from './constants';

/**
 * Build the R2 cover-image key for a category. The landing "Browse by topic"
 * resolver reads `${R2_PUBLIC_URL_BASE}/${coverImageKey}/{sm,md,lg}.webp`, so
 * this is the shared prefix; seed/r2.ts uploads the sized variants under it.
 */
function categoryCoverKey(categoryId: string): string {
  return `categories/${categoryId}/cover`;
}

/**
 * Content → category tag map for Of Blood & Bones.
 *
 * Keys are `CONTENT` object keys; values are `CATEGORIES` object keys (1–2
 * each). Every bones content item — existing offerings and the expanded
 * catalogue — is tagged so the landing "Browse by topic" module and per-topic
 * pages have populated results, and each of the six topics carries several
 * items across the browse types.
 */
const CONTENT_CATEGORY_MAP: Record<
  string,
  ReadonlyArray<keyof typeof CATEGORIES>
> = {
  // ── Existing offerings ──
  skinTalismans: ['ancestralMedicine', 'ceremony'],
  toothTalismans: ['ancestralMedicine'],
  soulPath: ['healing', 'somatics'],
  limpia: ['ceremony', 'healing'],
  ceremonialCacao: ['ceremony', 'ancestralMedicine'],
  sacredCalendar: ['ancestralMedicine'],
  closingTheBones: ['healing', 'somatics'],
  held: ['somatics', 'healing'],
  neuroSomatic: ['somatics', 'breathwork'],
  soundTherapy: ['soundVibration', 'healing'],
  ecoSomatic: ['somatics'],
  // ── Expanded catalogue — video ──
  morningSomaticFlow: ['somatics', 'healing'],
  fireCeremonyDusk: ['ceremony', 'ancestralMedicine'],
  breathAncestors: ['breathwork', 'ancestralMedicine'],
  wombAwakening: ['somatics', 'healing'],
  copalSmokeRite: ['ceremony'],
  groundingRoots: ['somatics', 'breathwork'],
  // ── Expanded catalogue — audio ──
  ancestralLullaby: ['soundVibration', 'healing'],
  drumJourney: ['soundVibration', 'ceremony'],
  oceanBreath: ['breathwork', 'healing'],
  whispersLineage: ['ancestralMedicine', 'soundVibration'],
  tuningForkReset: ['soundVibration', 'healing'],
  coyolxauhquiChant: ['ceremony', 'ancestralMedicine'],
  // ── Expanded catalogue — written ──
  medicineOfGrief: ['healing', 'ancestralMedicine'],
  readingBodyStories: ['somatics', 'healing'],
  copalSacredSmoke: ['ceremony', 'ancestralMedicine'],
  nervousSystemLiteracy: ['somatics', 'breathwork'],
  fourSacredDirections: ['ceremony', 'ancestralMedicine'],
  vibrationAsMedicine: ['soundVibration', 'healing'],
};

/**
 * Seed the Of Blood & Bones topic taxonomy: six curated categories plus the
 * content ⇄ category membership edges. Deterministic ids (via seedUuid) make
 * this idempotent — a re-seed truncates via CASCADE and re-inserts identical
 * rows. Runs inside the seed transaction, AFTER seedContent (join rows FK the
 * content ids).
 */
export async function seedCategories(db: typeof DbClient) {
  const cats = Object.values(CATEGORIES);

  await db.insert(schema.categories).values(
    cats.map((cat) => ({
      id: cat.id,
      organizationId: ORGS.bones.id,
      creatorId: USERS.luzura.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      icon: cat.icon,
      coverImageKey: categoryCoverKey(cat.id),
      sortOrder: cat.sortOrder,
    }))
  );

  const joinRows = Object.entries(CONTENT_CATEGORY_MAP).flatMap(
    ([contentKey, catKeys]) => {
      const contentItem = CONTENT[contentKey as keyof typeof CONTENT];
      return catKeys.map((catKey) => ({
        contentId: contentItem.id,
        categoryId: CATEGORIES[catKey].id,
      }));
    }
  );

  await db.insert(schema.contentCategories).values(joinRows);

  // Point each item's legacy `content.category` text column at its PRIMARY
  // (first-listed) taxonomy category name, so landing card eyebrows read the
  // real topic ("Ceremony", "Sound & Vibration", …) instead of a single
  // hardcoded "healing". The relational taxonomy is authoritative; this just
  // keeps the denormalized legacy column coherent until it's dropped.
  for (const [contentKey, catKeys] of Object.entries(CONTENT_CATEGORY_MAP)) {
    const primaryName = CATEGORIES[catKeys[0]].name;
    await db
      .update(schema.content)
      .set({ category: primaryName })
      .where(
        eq(schema.content.id, CONTENT[contentKey as keyof typeof CONTENT].id)
      );
  }

  console.log(
    `  Seeded ${cats.length} categories, ${joinRows.length} content-category links`
  );
}
