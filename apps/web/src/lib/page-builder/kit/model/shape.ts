/**
 * Page-shape validation for publish — the v2 successor of `validatePageShape`.
 *
 * Advisory, never enforced by the renderer: a misshapen page still RENDERS
 * (a duplicate hero is demoted to an `<h2>`, not dropped) because an author who
 * duplicated a section must be able to see and delete it. Blocking publish is
 * the builder's job, and it reads these issues to do it.
 */

import type { SectionTypeId } from './ids';
import { renderableSections } from './resolve';
import type { KitPage } from './types';

export type ShapeIssueCode =
  | 'empty-page'
  | 'no-hero'
  | 'hero-not-first'
  | 'multiple-hero'
  | 'no-cta';

export interface ShapeIssue {
  code: ShapeIssueCode;
  severity: 'error' | 'warning';
  /** The offending section, when there is one. */
  sectionId?: string;
  /** Creator-facing, plain English. */
  message: string;
}

/** The section types that always render the page's primary call to action. */
const CTA_CARRIERS: ReadonlySet<SectionTypeId> = new Set([
  'hero',
  'pricing',
  'cta',
]);

export interface ShapeOptions {
  /** Whether the course can be bought — a CTA is only required when it can. */
  purchasable?: boolean;
}

export function validateKitShape(
  page: KitPage,
  options: ShapeOptions = {}
): ShapeIssue[] {
  const sections = renderableSections(page);
  if (sections.length === 0) {
    return [
      {
        code: 'empty-page',
        severity: 'error',
        message: 'This page has no visible sections yet.',
      },
    ];
  }

  const issues: ShapeIssue[] = [];
  const heroes = sections.filter((section) => section.type === 'hero');

  if (heroes.length === 0) {
    issues.push({
      code: 'no-hero',
      severity: 'error',
      message: 'Add a hero so visitors know what this page is about.',
    });
  } else if (sections[0].type !== 'hero') {
    issues.push({
      code: 'hero-not-first',
      severity: 'error',
      sectionId: heroes[0].id,
      message: 'Move the hero to the top of the page.',
    });
  }

  for (const extra of heroes.slice(1)) {
    issues.push({
      code: 'multiple-hero',
      severity: 'error',
      sectionId: extra.id,
      message: 'A page can have only one hero. Remove or hide this one.',
    });
  }

  if (
    options.purchasable !== false &&
    !sections.some((section) => CTA_CARRIERS.has(section.type))
  ) {
    issues.push({
      code: 'no-cta',
      severity: 'error',
      message: 'Add a hero, pricing or call to action so visitors can join.',
    });
  }

  return issues;
}
