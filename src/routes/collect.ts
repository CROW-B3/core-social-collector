import type { Environment } from '../types';
import { createRoute, OpenAPIHono, z  } from '@hono/zod-openapi';
import { runCollectionForOrg } from '../services/collector';

const app = new OpenAPIHono<{ Bindings: Environment }>();

const manualCollectRoute = createRoute({
  method: 'post',
  path: '/api/v1/collect/{orgId}',
  request: {
    params: z.object({ orgId: z.string() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        },
      },
      description: 'Collection triggered',
    },
    500: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.string(),
          }),
        },
      },
      description: 'Collection failed',
    },
  },
});

app.openapi(manualCollectRoute, async (c) => {
  const { orgId } = c.req.valid('param');

  try {
    console.warn(`[collect] Manual collection triggered for org ${orgId}`);
    await runCollectionForOrg(c.env, orgId);
    return c.json({
      success: true,
      message: `Collection completed for org ${orgId}`,
    }, 200);
  } catch (error) {
    console.error(`[collect] Manual collection failed for org ${orgId}:`, error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;
