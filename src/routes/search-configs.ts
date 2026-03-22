import type { Environment } from '../types';
import { createRoute, OpenAPIHono, z  } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, generateId } from '../db/client';
import { socialSearchConfigs } from '../db/schema';

const app = new OpenAPIHono<{ Bindings: Environment }>();

// --- Schemas ---

const SearchConfigSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  keywords: z.array(z.string()),
  brands: z.array(z.string()).nullable(),
  region: z.string().nullable(),
  enabled: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('SearchConfig');

const CreateSearchConfigSchema = z.object({
  orgId: z.string(),
  keywords: z.array(z.string()).min(1),
  brands: z.array(z.string()).optional(),
  region: z.enum(['NA-EN', 'EU-Multi', 'AP-Multi', 'all']).optional(),
}).openapi('CreateSearchConfig');

const UpdateSearchConfigSchema = z.object({
  keywords: z.array(z.string()).min(1).optional(),
  brands: z.array(z.string()).optional(),
  region: z.enum(['NA-EN', 'EU-Multi', 'AP-Multi', 'all']).optional(),
  enabled: z.number().min(0).max(1).optional(),
}).openapi('UpdateSearchConfig');

// --- Routes ---

const listSearchConfigsRoute = createRoute({
  method: 'get',
  path: '/api/v1/search-configs/{orgId}',
  request: {
    params: z.object({ orgId: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ configs: z.array(SearchConfigSchema) }) } },
      description: 'List of search configs',
    },
  },
});

const createSearchConfigRoute = createRoute({
  method: 'post',
  path: '/api/v1/search-configs',
  request: {
    body: {
      content: { 'application/json': { schema: CreateSearchConfigSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: z.object({ config: SearchConfigSchema }) } },
      description: 'Created search config',
    },
  },
});

const updateSearchConfigRoute = createRoute({
  method: 'put',
  path: '/api/v1/search-configs/{id}',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: UpdateSearchConfigSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ config: SearchConfigSchema }) } },
      description: 'Updated search config',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Config not found',
    },
  },
});

const deleteSearchConfigRoute = createRoute({
  method: 'delete',
  path: '/api/v1/search-configs/{id}',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      description: 'Deleted search config',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Config not found',
    },
  },
});

// --- Handlers ---

app.openapi(listSearchConfigsRoute, async (c) => {
  const { orgId } = c.req.valid('param');
  const db = createDatabaseClient(c.env.DB);

  const configs = await db
    .select()
    .from(socialSearchConfigs)
    .where(eq(socialSearchConfigs.orgId, orgId));

  return c.json({
    configs: configs.map(serializeSearchConfig),
  }, 200);
});

app.openapi(createSearchConfigRoute, async (c) => {
  const body = c.req.valid('json');
  const db = createDatabaseClient(c.env.DB);
  const now = new Date();

  const newConfig = {
    id: generateId('ssc_search'),
    orgId: body.orgId,
    keywords: JSON.stringify(body.keywords),
    brands: body.brands ? JSON.stringify(body.brands) : null,
    region: body.region ?? 'all',
    enabled: 1,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(socialSearchConfigs).values(newConfig);

  return c.json({
    config: serializeSearchConfig(newConfig),
  }, 201);
});

app.openapi(updateSearchConfigRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const db = createDatabaseClient(c.env.DB);

  const existing = await db
    .select()
    .from(socialSearchConfigs)
    .where(eq(socialSearchConfigs.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: 'Config not found' }, 404);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.keywords !== undefined) updates.keywords = JSON.stringify(body.keywords);
  if (body.brands !== undefined) updates.brands = JSON.stringify(body.brands);
  if (body.region !== undefined) updates.region = body.region;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  await db
    .update(socialSearchConfigs)
    .set(updates)
    .where(eq(socialSearchConfigs.id, id));

  const updated = await db
    .select()
    .from(socialSearchConfigs)
    .where(eq(socialSearchConfigs.id, id))
    .limit(1);

  return c.json({ config: serializeSearchConfig(updated[0]) }, 200);
});

app.openapi(deleteSearchConfigRoute, async (c) => {
  const { id } = c.req.valid('param');
  const db = createDatabaseClient(c.env.DB);

  const existing = await db
    .select()
    .from(socialSearchConfigs)
    .where(eq(socialSearchConfigs.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: 'Config not found' }, 404);
  }

  await db
    .delete(socialSearchConfigs)
    .where(eq(socialSearchConfigs.id, id));

  return c.json({ success: true }, 200);
});

function serializeSearchConfig(config: typeof socialSearchConfigs.$inferSelect) {
  return {
    id: config.id,
    orgId: config.orgId,
    keywords: JSON.parse(config.keywords || '[]'),
    brands: config.brands ? JSON.parse(config.brands) : null,
    region: config.region,
    enabled: config.enabled,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  };
}

export default app;
