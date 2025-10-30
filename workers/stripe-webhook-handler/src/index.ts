import { Hono } from 'hono';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';

const app = new Hono();

// Initialize observability (environment will come from env vars in production)
const obs = new ObservabilityClient(
  'stripe-webhook-handler',
  process.env.ENVIRONMENT || 'development'
);

// Request timing middleware
app.use('*', async (c, next) => {
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Error handling
app.onError((err, c) => {
  obs.trackError(err, { url: c.req.url, method: c.req.method });
  return c.text('Internal Server Error', 500);
});

app.get('/', (c) => {
  obs.info('Health check endpoint hit');
  return c.json({ status: 'ok', service: 'stripe-webhook-handler' });
});

// TODO: Add actual Stripe webhook handling logic
app.post('/webhook', async (c) => {
  obs.info('Stripe webhook received');
  // Webhook logic will go here
  return c.json({ received: true });
});

export default app;
