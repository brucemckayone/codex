import { chromium } from 'playwright';

(async () => {
  console.log('Launching browser');
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Note: Since this needs auth, maybe it's easier to run the existing playwright test with DEBUG=pw:api
  await browser.close();
})();
