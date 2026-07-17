// Disable SSR: form()/command() remote functions require browser context
// (mirrors studio/settings/branding/+page.ts — the studio subtree is a CSR SPA).
export const ssr = false;
