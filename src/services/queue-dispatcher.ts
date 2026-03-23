import type { CollectedItem, Environment, InteractionMessage } from '../types';

/**
 * Format collected items and dispatch them to the Interaction Queue.
 * Groups items into batches to avoid exceeding queue message size limits.
 */
export async function dispatchToQueue(
  env: Environment,
  orgId: string,
  collectedItems: CollectedItem[]
): Promise<number> {
  if (collectedItems.length === 0) {
    console.warn(`[queue-dispatcher] No items to dispatch for org ${orgId}`);
    return 0;
  }

  let dispatched = 0;
  const sessionId = `social_${orgId}_${Date.now()}`;

  // Group items into batches of ~5 to keep message size reasonable
  const batchSize = 5;
  for (let i = 0; i < collectedItems.length; i += batchSize) {
    const batch = collectedItems.slice(i, i + batchSize);

    const data = JSON.stringify({
      items: batch.map(item => ({
        url: item.url,
        title: item.title,
        content: item.content,
        platform: item.platform,
        author: item.author,
        publishedAt: item.publishedAt,
        source: item.source,
      })),
      batchIndex: Math.floor(i / batchSize),
      totalItems: collectedItems.length,
    });

    const summary = batch
      .map(item => `[${item.platform}] ${item.title || item.url}`)
      .join('; ');

    const message: InteractionMessage = {
      organizationId: orgId,
      sourceType: 'social',
      sessionId,
      data,
      summary: summary.substring(0, 500),
      timestamp: Date.now(),
    };

    try {
      await env.SOCIAL_PROCESSING_QUEUE.send(message);
      dispatched += batch.length;
    } catch (error) {
      console.error(
        `[queue-dispatcher] Failed to send batch ${Math.floor(i / batchSize)} for org ${orgId}:`,
        error
      );
    }
  }

  console.warn(
    `[queue-dispatcher] Dispatched ${dispatched}/${collectedItems.length} items for org ${orgId} (session: ${sessionId})`
  );
  return dispatched;
}
