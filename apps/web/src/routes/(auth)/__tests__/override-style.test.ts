// @vitest-environment node

/**
 * The sign-in shell's server-rendered style carries no declaration but the
 * brand's own custom properties (Codex-403d3).
 *
 * This shell had its own copy of the org layout's join, `${prop}: ${value}`,
 * with no check, so an org admin's saved override reached every sign-in
 * page's `style` attribute as written. It now builds the style with the org
 * layout's tokenOverrideStyle, whose mappers drop an entry that would leave
 * its own declaration or fetch.
 *
 * Rendered on the server, as a visitor's first paint is: Svelte joins the
 * `style` attribute and every `style:` directive into one string there, so a
 * raw value reaching either would show up as a declaration of its own. The
 * shader pane and the page-load bar are stubbed; nothing else is.
 */
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock(
  '$lib/components/auth/AuthShaderPane.svelte',
  () => import('$lib/components/brand-studio/rail/StubField.test.svelte')
);
vi.mock('$lib/components/ui/Feedback/NavigationProgress', async () => ({
  NavigationProgress: (
    await import('$lib/components/brand-studio/rail/StubField.test.svelte')
  ).default,
}));

const { default: AuthLayout } = await import('../+layout.svelte');

/** A sign-in page's brand, with overrides an admin could have stored. */
const BRANDING = {
  name: 'Studio Alpha',
  logoUrl: null,
  brandColors: {
    primary: '#C24129',
    secondary: null,
    accent: null,
    background: null,
  },
  brandFonts: { body: 'Inter', heading: 'Inter' },
  brandRadius: 0.5,
  brandDensity: 1,
  brandFineTune: {
    tokenOverrides: JSON.stringify({
      'heading-color': 'red; position: fixed; inset: 0',
      'x: 1; position': 'red',
      surface: 'image-set("https://pub-a.r2.dev/p.png" 1x)',
      'glass-tint': "'unclosed",
      'shader-preset': 'haze',
    }),
    darkTokenOverrides: JSON.stringify({
      'heading-color': 'blue; scale: 3',
      'shader-logo-url': 'https://pub-a.r2.dev/l.svg',
    }),
    darkModeOverrides: null,
  },
};

/** The shell's style attribute, as the visitor's browser receives it. */
function shellStyle(): string {
  const { body } = render(AuthLayout, {
    props: {
      data: { branding: BRANDING, defaultPreset: 'none' },
      children: createRawSnippet(() => ({ render: () => '<p>form</p>' })),
    } as never,
  });
  const tag = /<div[^>]*class="auth-layout[^"]*"[^>]*>/.exec(body)?.[0] ?? '';
  const style = /style="([^"]*)"/.exec(tag)?.[1] ?? '';
  return style
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

describe('the (auth) layout brand style (Codex-403d3)', () => {
  it("renders the brand's safe override, so the check below reads a real style", () => {
    expect(shellStyle()).toMatch(/--brand-shader-preset:\s*haze/);
  });

  it('carries no declaration that is not a custom property', () => {
    const properties = shellStyle()
      .split(';')
      .map((declaration) => declaration.split(':')[0]?.trim() ?? '')
      .filter((property) => property.length > 0);
    expect(properties.length).toBeGreaterThan(0);
    expect(properties.filter((property) => !property.startsWith('--'))).toEqual(
      []
    );
  });

  it('fetches nothing and keeps no crafted value', () => {
    const style = shellStyle();
    for (const crafted of [
      'image-set',
      'url(',
      'pub-a.r2.dev',
      'unclosed',
      'position',
      'scale',
    ]) {
      expect(style).not.toContain(crafted);
    }
  });
});
