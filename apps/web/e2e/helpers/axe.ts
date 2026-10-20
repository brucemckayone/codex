/**
 * The page kit's axe pass (Codex-61zsk.11): every WCAG 2.2 A and AA rule on
 * the page, and colour contrast everywhere but a Moving background's band.
 *
 * There the words sit on a veil axe cannot see: the org's shader is a canvas,
 * and on Cinematic the veil is a panel drawn by a pseudo-element. axe reads
 * past both to the page's own ground and reports pale words on a pale page —
 * measured on studio-alpha's bone-deep (light, 1440, at first paint) while the
 * words read clearly on screen, with scripts on or off. Those words are held
 * to their floors over the shader's worst frames from the band's live tokens
 * by `page-kit/org-shader.spec.ts` and `page-kit/live-veil.spec.ts`.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export const WCAG_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;

export interface KitAxe {
  /** Each violation as `rule: target`. */
  readonly violations: string[];
  /** The contrast pass's own results, for what it could not judge. */
  readonly contrast: AxeResults;
}

export async function kitAxe(page: Page, scope = '.lp'): Promise<KitAxe> {
  const rules = await new AxeBuilder({ page })
    .include(scope)
    .withTags(WCAG_TAGS)
    .disableRules(['color-contrast'])
    .analyze();
  const contrast = await new AxeBuilder({ page })
    .include(scope)
    .exclude(`${scope} [data-lp-scheme='atmosphere']`)
    .withRules(['color-contrast'])
    .analyze();
  return {
    violations: [...rules.violations, ...contrast.violations].flatMap((rule) =>
      rule.nodes.map((node) => `${rule.id}: ${node.target.join(' ')}`)
    ),
    contrast,
  };
}
