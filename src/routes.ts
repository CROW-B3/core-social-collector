import { createRoute, z } from '@hono/zod-openapi';
import {
  CollectAllResultSchema,
  CollectResultSchema,
  ErrorSchema,
  HealthSchema,
  R2ListSchema,
} from './types';

export const HealthRoute = createRoute({
  method: 'get',
  path: '/health',
  responses: {
    200: {
      content: { 'application/json': { schema: HealthSchema } },
      description: 'Service health',
    },
  },
});

export const CollectAllRoute = createRoute({
  method: 'get',
  path: '/collect/all',
  request: {
    query: z.object({
      limit: z.string().optional().default('10'),
      orgId: z.string().optional().default('00000000-0000-4000-8000-000000000001'),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CollectAllResultSchema } },
      description: 'Collection results from all platforms',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Collection error',
    },
  },
});

export const CollectPlatformRoute = createRoute({
  method: 'get',
  path: '/collect/{platform}',
  request: {
    params: z.object({
      platform: z.enum(['instagram', 'twitter', 'reddit']),
    }),
    query: z.object({
      limit: z.string().optional().default('10'),
      orgId: z.string().optional().default('00000000-0000-4000-8000-000000000001'),
      accountId: z.string().optional().default('12345'),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CollectResultSchema } },
      description: 'Collection result for a single platform',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Collection error',
    },
  },
});

export const InspectR2Route = createRoute({
  method: 'get',
  path: '/inspect-r2',
  request: {
    query: z.object({
      limit: z.string().optional().default('50'),
      prefix: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: R2ListSchema } },
      description: 'R2 bucket contents',
    },
  },
});

export const R2ContentRoute = createRoute({
  method: 'get',
  path: '/r2-content',
  request: {
    query: z.object({
      key: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'R2 object content',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Object not found',
    },
  },
});
