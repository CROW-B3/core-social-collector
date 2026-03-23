import type { Environment } from './types';
import { OpenAPIHono } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import collectApp from './routes/collect';
import configsApp from './routes/configs';
import searchConfigsApp from './routes/search-configs';
import { runCollection } from './services/collector';

const app = new OpenAPIHono<{ Bindings: Environment }>();

app.use(logger());

// Health check
app.get('/', (c) => {
  return c.json({
    service: 'crow-social-collector',
    status: 'ok',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  });
});

// Mount route groups
app.route('/', configsApp);
app.route('/', searchConfigsApp);
app.route('/', collectApp);

// OpenAPI docs
app.doc('/docs', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'CROW Social Collector API',
    description: 'Social media collection service for CROW platform',
  },
});

// Export with scheduled handler for cron triggers
export default {
  ...app,
  scheduled: async (
    event: ScheduledEvent,
    env: Environment,
    ctx: ExecutionContext
  ) => {
    console.warn(`[cron] Scheduled event triggered at ${new Date().toISOString()}, cron: ${event.cron}`);
    ctx.waitUntil(
      runCollection(env).catch((error) => {
        console.error('[cron] Collection run failed:', error);
      })
    );
  },
};
