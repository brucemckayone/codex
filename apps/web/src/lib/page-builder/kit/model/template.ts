/**
 * The starter page for a new journey page, per Style.
 *
 * Sections carry starter PROPS only — no `variant`, no `design` — so every
 * layout and colour resolves from the Style (`resolve.ts`). A starter page
 * therefore re-composes completely if the creator switches Style before they
 * have touched anything, and each section's copy is a real sentence built from
 * the course, never a placeholder.
 */
import { DEFINITIONS } from './catalog';
import type { PageStyleId, SectionTypeId } from './ids';
import { STYLES } from './styles';
import type { KitPage, KitSection, TemplateContext } from './types';

export interface StarterOptions {
  style?: PageStyleId;
  /** Section id factory — injectable so tests get stable ids. */
  makeId?: () => string;
  /** Override the section list (the dev route renders every type). */
  types?: readonly SectionTypeId[];
}

function defaultId(): string {
  return crypto.randomUUID();
}

export function starterSection(
  type: SectionTypeId,
  context: TemplateContext,
  makeId: () => string = defaultId
): KitSection {
  return {
    id: makeId(),
    type,
    enabled: true,
    props: { ...DEFINITIONS[type].starter(context) },
  };
}

export function starterPage(
  context: TemplateContext,
  options: StarterOptions = {}
): KitPage {
  const style = options.style ?? 'bold';
  const types = options.types ?? STYLES[style].starter;
  const makeId = options.makeId ?? defaultId;
  return {
    design: { style },
    sections: types.map((type) => starterSection(type, context, makeId)),
  };
}
