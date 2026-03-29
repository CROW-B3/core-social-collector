import type {
  Environment,
  PlatformAdapter,
  ProcessorQueueMessage,
  R2Envelope,
  SupportedPlatform,
} from './types';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { InstagramAdapter } from './adapters/instagram';
import { RedditAdapter } from './adapters/reddit';
import { TwitterAdapter } from './adapters/twitter';
import { sendToProcessorQueue } from './lib/queue';
import { generateR2Key, readFromR2, writeToR2 } from './lib/r2';
import {
  CollectAllRoute,
  CollectPlatformRoute,
  HealthRoute,
  InspectR2Route,
  R2ContentRoute,
} from './routes';

const app = new OpenAPIHono<{ Bindings: Environment }>();

app.use(cors());
app.use(logger());

// ========================================
// Health Check
// ========================================

app.openapi(HealthRoute, c => {
  return c.json({
    status: 'ok',
    service: 'crow-social-collector',
    environment: c.env.ENVIRONMENT || 'unknown',
    platforms: ['instagram', 'twitter', 'reddit'],
  });
});

// ========================================
// Collect from ALL platforms
// ========================================

app.openapi(CollectAllRoute, async c => {
  const { limit: limitStr, orgId } = c.req.valid('query');
  const limit = Number.parseInt(limitStr, 10) || 10;

  const platforms: SupportedPlatform[] = ['instagram', 'twitter', 'reddit'];
  const results = await Promise.allSettled(
    platforms.map(platform =>
      collectFromPlatform(c.env, platform, orgId, limit)
    )
  );

  const collected = results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    console.error(`Failed to collect from ${platforms[i]}:`, result.reason);
    return {
      platform: platforms[i],
      postsCollected: 0,
      r2Key: '',
      batchId: '',
      queueSent: false,
      processorNotified: false,
      error: String(result.reason),
    };
  });

  return c.json({
    results: collected,
    totalPosts: collected.reduce((sum, r) => sum + r.postsCollected, 0),
  }, 200 as const);
});

// ========================================
// Collect from a SINGLE platform
// ========================================

app.openapi(CollectPlatformRoute, async c => {
  const { platform } = c.req.valid('param');
  const { limit: limitStr, orgId, accountId } = c.req.valid('query');
  const limit = Number.parseInt(limitStr, 10) || 10;

  try {
    const result = await collectFromPlatform(
      c.env,
      platform as SupportedPlatform,
      orgId,
      limit,
      accountId
    );
    return c.json(result, 200 as const);
  } catch (error) {
    console.error(`Collection error for ${platform}:`, error);
    return c.json({ error: String(error) }, 500 as const);
  }
});

// ========================================
// Inspect R2 bucket
// ========================================

app.openapi(InspectR2Route, async c => {
  const { limit: limitStr, prefix } = c.req.valid('query');
  const limit = Number.parseInt(limitStr, 10) || 50;

  const listed = await c.env.RAW_DATA_BUCKET.list({
    limit,
    prefix: prefix || undefined,
  });

  return c.json({
    objects: listed.objects.map(obj => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded.toISOString(),
    })),
    truncated: listed.truncated,
  }, 200 as const);
});

// ========================================
// Read R2 content
// ========================================

app.openapi(R2ContentRoute, async c => {
  const { key } = c.req.valid('query');

  const envelope = await readFromR2(c.env.RAW_DATA_BUCKET, key);
  if (!envelope) {
    return c.json({ error: `Object not found: ${key}` }, 404 as const);
  }

  return c.json(envelope as any, 200 as const);
});

// ========================================
// OpenAPI docs
// ========================================

app.doc('/docs', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'CROW Social Collector API',
  },
});

// ========================================
// Core Collection Logic
// ========================================

function createAdapter(
  env: Environment,
  platform: SupportedPlatform
): PlatformAdapter {
  switch (platform) {
    case 'instagram':
      return new InstagramAdapter(
        env.INSTAGRAM_API_KEY || 'mock-key',
        env.INSTAGRAM_API_BASE_URL
      );
    case 'twitter':
      return new TwitterAdapter(
        env.TWITTER_API_KEY || 'mock-key',
        env.TWITTER_API_BASE_URL
      );
    case 'reddit':
      return new RedditAdapter(
        env.REDDIT_API_KEY || 'mock-key',
        env.REDDIT_API_BASE_URL
      );
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function getDefaultAccountId(platform: SupportedPlatform): string {
  switch (platform) {
    case 'instagram':
      return '12345';
    case 'twitter':
      return '67890';
    case 'reddit':
      return 'technology';
  }
}

async function collectFromPlatform(
  env: Environment,
  platform: SupportedPlatform,
  orgId: string,
  limit: number,
  accountId?: string
): Promise<{
  platform: string;
  postsCollected: number;
  r2Key: string;
  batchId: string;
  queueSent: boolean;
  processorNotified: boolean;
}> {
  console.warn(
    `Collecting from ${platform} for org=${orgId} limit=${limit}`
  );

  // 1. Create adapter and fetch posts
  const adapter = createAdapter(env, platform);
  const { posts } = await adapter.fetchPosts({
    accountId: accountId || getDefaultAccountId(platform),
    limit,
  });

  if (posts.length === 0) {
    return {
      platform,
      postsCollected: 0,
      r2Key: '',
      batchId: '',
      queueSent: false,
      processorNotified: false,
    };
  }

  // 2. Create R2 envelope
  const batchId = crypto.randomUUID();
  const capturedAt = new Date().toISOString();
  const r2Key = generateR2Key(platform, orgId);

  const envelope: R2Envelope = {
    meta: {
      orgId,
      platform,
      capturedAt,
      batchId,
    },
    posts,
  };

  // 3. Write to R2
  await writeToR2(env.RAW_DATA_BUCKET, r2Key, envelope);

  // 4. Send queue message (may fail locally — that's OK)
  let queueSent = false;
  try {
    const queueMessage: ProcessorQueueMessage = {
      orgId,
      platform,
      r2Key,
      batchId,
      postCount: posts.length,
      capturedAt,
    };
    await sendToProcessorQueue(env.PROCESSOR_QUEUE, queueMessage);
    queueSent = true;
    console.warn(`Queue message sent for batch ${batchId}`);
  } catch (error) {
    console.warn(`Queue send failed (expected in local dev): ${error}`);
  }

  // 5. Direct HTTP forward to processor (local dev fallback)
  let processorNotified = false;
  if (env.PROCESSOR_SERVICE_URL) {
    try {
      const response = await fetch(
        `${env.PROCESSOR_SERVICE_URL}/api/v1/social/process`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            platform,
            batchId,
            posts,
          }),
        }
      );
      processorNotified = response.ok;
      if (!response.ok) {
        const text = await response.text();
        console.warn(`Processor HTTP forward failed: ${response.status} ${text}`);
      } else {
        console.warn(`Processor notified via HTTP for batch ${batchId}`);
      }
    } catch (error) {
      console.warn(`Processor HTTP forward error: ${error}`);
    }
  }

  console.warn(
    `Collected ${posts.length} posts from ${platform} — R2: ${r2Key}, queue: ${queueSent}, http: ${processorNotified}`
  );

  return {
    platform,
    postsCollected: posts.length,
    r2Key,
    batchId,
    queueSent,
    processorNotified,
  };
}

export default app;
