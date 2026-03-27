import { z } from '@hono/zod-openapi';

// ========================================
// Cloudflare Bindings
// ========================================

export type SupportedPlatform = 'instagram' | 'twitter' | 'reddit';

export interface Environment {
  // Cloudflare D1
  DB: D1Database;

  // Cloudflare R2 — raw platform responses stored here
  RAW_DATA_BUCKET: R2Bucket;

  // Cloudflare Queue — sends messages to social-processor
  PROCESSOR_QUEUE: Queue;

  // API base URLs (point to social-ingest-service for local/dev)
  INSTAGRAM_API_BASE_URL: string;
  TWITTER_API_BASE_URL: string;
  REDDIT_API_BASE_URL: string;

  // API keys (empty for mock ingest service, real keys for prod)
  INSTAGRAM_API_KEY: string;
  TWITTER_API_KEY: string;
  REDDIT_API_KEY: string;

  // Direct HTTP forwarding to processor (local dev — queues don't work cross-worker)
  PROCESSOR_SERVICE_URL: string;

  ENVIRONMENT: string;
}

// ========================================
// Platform Post — canonical format all adapters output
// ========================================

export interface PlatformPost {
  platformPostId: string;
  authorId: string;
  authorUsername: string;
  content: string;
  publishedAt: string;
  engagement: {
    likes: number;
    shares: number;
    comments: number;
    views: number;
  };
  metadata: {
    language?: string;
    location?: string;
    mediaType?: string;
  };
}

// ========================================
// Platform Adapter — interface each platform implements
// ========================================

export interface PlatformAdapter {
  fetchPosts(config: {
    accountId: string;
    cursor?: string;
    limit: number;
  }): Promise<{ posts: PlatformPost[]; nextCursor?: string }>;
}

// ========================================
// R2 Envelope — what gets stored in R2
// ========================================

export interface R2Envelope {
  meta: {
    orgId: string;
    platform: SupportedPlatform;
    capturedAt: string;
    batchId: string;
  };
  posts: PlatformPost[];
}

// ========================================
// Queue Message — sent to processor queue
// ========================================

export interface ProcessorQueueMessage {
  orgId: string;
  platform: SupportedPlatform;
  r2Key: string;
  batchId: string;
  postCount: number;
  capturedAt: string;
}

// ========================================
// Zod Schemas for OpenAPI
// ========================================

export const HealthSchema = z
  .object({
    status: z.string(),
    service: z.string(),
    environment: z.string(),
    platforms: z.array(z.string()),
  })
  .openapi('HealthResponse');

export const CollectResultSchema = z
  .object({
    platform: z.string(),
    postsCollected: z.number(),
    r2Key: z.string(),
    batchId: z.string(),
    queueSent: z.boolean(),
    processorNotified: z.boolean(),
  })
  .openapi('CollectResult');

export const CollectAllResultSchema = z
  .object({
    results: z.array(CollectResultSchema),
    totalPosts: z.number(),
  })
  .openapi('CollectAllResult');

export const R2ListSchema = z
  .object({
    objects: z.array(
      z.object({
        key: z.string(),
        size: z.number(),
        uploaded: z.string(),
      })
    ),
    truncated: z.boolean(),
  })
  .openapi('R2ListResult');

export const ErrorSchema = z
  .object({
    error: z.string(),
  })
  .openapi('ErrorResponse');
