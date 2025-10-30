import { Hono } from 'hono';

type Bindings = {
  ENVIRONMENT?: string;
  DATABASE_URL?: string;
  SESSION_SECRET?: string;
  BETTER_AUTH_SECRET?: string;
  WEB_APP_URL?: string;
  API_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'auth-worker' });
});

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    worker: 'auth-worker',
    environment: c.env.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString(),
    config: {
      hasDatabase: !!c.env.DATABASE_URL,
      hasSessionSecret: !!c.env.SESSION_SECRET,
      hasBetterAuthSecret: !!c.env.BETTER_AUTH_SECRET,
      webAppUrl: c.env.WEB_APP_URL || 'not set',
      apiUrl: c.env.API_URL || 'not set',
    },
  });
});

export default app;
