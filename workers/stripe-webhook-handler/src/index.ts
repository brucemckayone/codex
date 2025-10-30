import { Hono } from 'hono';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';

type Bindings = {
  ENVIRONMENT?: string;
  DATABASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET_PAYMENT?: string;
  STRIPE_WEBHOOK_SECRET_SUBSCRIPTION?: string;
  STRIPE_WEBHOOK_SECRET_CONNECT?: string;
  STRIPE_WEBHOOK_SECRET_CUSTOMER?: string;
  STRIPE_WEBHOOK_SECRET_BOOKING?: string;
  STRIPE_WEBHOOK_SECRET_DISPUTE?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Request timing middleware
app.use('*', async (c, next) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Error handling
app.onError((err, c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  obs.trackError(err, { url: c.req.url, method: c.req.method });
  return c.text('Internal Server Error', 500);
});

app.get('/', (c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  obs.info('Health check endpoint hit');
  return c.json({ status: 'ok', service: 'stripe-webhook-handler' });
});

// TODO: Add actual Stripe webhook handling logic
app.post('/webhook', async (c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  obs.info('Stripe webhook received');
  // Webhook logic will go here
  return c.json({ received: true });
});

export default app;
