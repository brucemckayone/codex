/**
 * The studio's immersive shader picker: its None card says what a piece with
 * no shader actually plays — the brand's shader, or Flow where the brand has
 * none — and a blank saved value reads as None.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));
vi.mock('$lib/components/ui/ShaderHero/load-renderer', () => ({
  loadRenderer: vi.fn(async () => null),
}));

import ShaderPicker from './ShaderPicker.svelte';

let app: ReturnType<typeof mount> | null = null;

/** Mount inside an org layout whose brand sets `brandPreset`, if any. */
function picker(value: string | null, brandPreset?: string) {
  const layout = document.createElement('div');
  layout.className = 'org-layout';
  if (brandPreset) {
    layout.style.setProperty('--brand-shader-preset', brandPreset);
  }
  document.body.appendChild(layout);
  app = mount(ShaderPicker, {
    target: layout,
    props: { value, onchange: () => {} },
  });
  flushSync();
}

/** The None card. */
const noneCard = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.preset-card')].find(
    (card) => card.querySelector('.preset-name')?.textContent?.trim() === 'None'
  );

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ({
      viewport: () => {},
      getExtension: () => null,
      isContextLost: () => false,
    })) as unknown as HTMLCanvasElement['getContext']
  );
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ShaderPicker', () => {
  it("says None plays the brand's shader where the brand has one", () => {
    picker(null, 'ink');
    expect(noneCard()?.textContent).toContain("Plays your brand's shader");
  });

  it('says None plays Flow where the brand has no shader', () => {
    picker(null);
    expect(noneCard()?.textContent).toContain('Plays Flow');
    expect(noneCard()?.textContent).not.toContain('brand');
  });

  it('marks None for a blank saved value, as for no value', () => {
    picker('');
    expect(noneCard()?.getAttribute('aria-checked')).toBe('true');
  });

  it("marks the survivor's card for a saved cut preset", () => {
    picker('nebula');
    const checked = document.querySelector('.preset-card[aria-checked="true"]');
    expect(checked?.querySelector('.preset-name')?.textContent).toBe('Aurora');
  });
});
