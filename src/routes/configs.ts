import type { Environment } from '../types';
import { createRoute, OpenAPIHono, z  } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, generateId } from '../db/client';
import { socialSourceConfigs } from '../db/schema';

const app = new OpenAPIHono<{ Bindings: Environment }>();

// --- Schemas ---

const SourceConfigSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  platform: z.string(),
  platformAccountId: z.string().nullable(),
  accountHandle: z.string().nullable(),
  enabled: z.number().nullable(),
  lastCursor: z.string().nullable(),
  lastFetchedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('SourceConfig');

const CreateSourceConfigSchema = z.object({
  orgId: z.string(),
  platform: z.enum(['twitter', 'reddit', 'instagram', 'tiktok', 'linkedin', 'facebook', 'youtube', 'news']),
  platformAccountId: z.string().optional(),
  accountHandle: z.string().optional(),
}).openapi('CreateSourceConfig');

const UpdateSourceConfigSchema = z.object({
  platform: z.enum(['twitter', 'reddit', 'instagram', 'tiktok', 'linkedin', 'facebook', 'youtube', 'news']).optional(),
  platformAccountId: z.string().optional(),
  accountHandle: z.string().optional(),
  enabled: z.number().min(0).max(1).optional(),
}).openapi('UpdateSourceConfig');

// --- Routes ---

const listConfigsRoute = createRoute({
  method: 'get',
  path: '/api/v1/configs/{orgId}',
  request: {
    params: z.object({ orgId: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ configs: z.array(SourceConfigSchema) }) } },
      description: 'List of social source configs',
    },
  },
});

const createConfigRoute = createRoute({
  method: 'post',
  path: '/api/v1/configs',
  request: {
    body: {
      content: { 'application/json': { schema: CreateSourceConfigSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: z.object({ config: SourceConfigSchema }) } },
      description: 'Created social source config',
    },
  },
});

const updateConfigRoute = createRoute({
  method: 'put',
  path: '/api/v1/configs/{id}',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: UpdateSourceConfigSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ config: SourceConfigSchema }) } },
      description: 'Updated social source config',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Config not found',
    },
  },
});

const deleteConfigRoute = createRoute({
  method: 'delete',
  path: '/api/v1/configs/{id}',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      description: 'Deleted social source config',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Config not found',
    },
  },
});

// --- Handlers ---

app.openapi(listConfigsRoute, async (c) => {
  const { orgId } = c.req.valid('param');
  const db = createDatabaseClient(c.env.DB);

  const configs = await db
    .select()
    .from(socialSourceConfigs)
    .where(eq(socialSourceConfigs.orgId, orgId));

  return c.json({
    configs: configs.map(serializeConfig),
  }, 200);
});

app.openapi(createConfigRoute, async (c) => {
  const body = c.req.valid('json');
  const db = createDatabaseClient(c.env.DB);
  const now = new Date();

  const newConfig = {
    id: generateId('ssc'),
    orgId: body.orgId,
    platform: body.platform,
    platformAccountId: body.platformAccountId ?? null,
    accountHandle: body.accountHandle ?? null,
    enabled: 1,
    lastCursor: null,
    lastFetchedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(socialSourceConfigs).values(newConfig);

  return c.json({ config: serializeConfig(newConfig) }, 201);
});

app.openapi(updateConfigRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const db = createDatabaseClient(c.env.DB);

  const existing = await db
    .select()
    .from(socialSourceConfigs)
    .where(eq(socialSourceConfigs.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: 'Config not found' }, 404);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.platform !== undefined) updates.platform = body.platform;
  if (body.platformAccountId !== undefined) updates.platformAccountId = body.platformAccountId;
  if (body.accountHandle !== undefined) updates.accountHandle = body.accountHandle;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  await db
    .update(socialSourceConfigs)
    .set(updates)
    .where(eq(socialSourceConfigs.id, id));

  const updated = await db
    .select()
    .from(socialSourceConfigs)
    .where(eq(socialSourceConfigs.id, id))
    .limit(1);

  return c.json({ config: serializeConfig(updated[0]) }, 200);
});

app.openapi(deleteConfigRoute, async (c) => {
  const { id } = c.req.valid('param');
  const db = createDatabaseClient(c.env.DB);

  const existing = await db
    .select()
    .from(socialSourceConfigs)
    .where(eq(socialSourceConfigs.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: 'Config not found' }, 404);
  }

  await db
    .delete(socialSourceConfigs)
    .where(eq(socialSourceConfigs.id, id));

  return c.json({ success: true }, 200);
});

function serializeConfig(config: typeof socialSourceConfigs.$inferSelect) {
  return {
    id: config.id,
    orgId: config.orgId,
    platform: config.platform,
    platformAccountId: config.platformAccountId,
    accountHandle: config.accountHandle,
    enabled: config.enabled,
    lastCursor: config.lastCursor,
    lastFetchedAt: config.lastFetchedAt ? config.lastFetchedAt.toISOString() : null,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  };
}

export default app;
