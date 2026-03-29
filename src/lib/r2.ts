import type { R2Envelope } from '../types';

/**
 * Generate R2 key for storing raw social media data
 * Format: social/{platform}/{YYYY-MM}/{uuid}.json
 */
export function generateR2Key(platform: string, orgId: string): string {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const uuid = crypto.randomUUID();
  return `social/${orgId}/${platform}/${yearMonth}/${uuid}.json`;
}

/**
 * Write R2 envelope to bucket
 */
export async function writeToR2(
  bucket: R2Bucket,
  key: string,
  envelope: R2Envelope
): Promise<void> {
  const jsonData = JSON.stringify(envelope);
  await bucket.put(key, jsonData, {
    httpMetadata: {
      contentType: 'application/json',
    },
    customMetadata: {
      orgId: envelope.meta.orgId,
      platform: envelope.meta.platform,
      capturedAt: envelope.meta.capturedAt,
    },
  });
  console.warn(`✅ Wrote to R2: ${key}`);
}

/**
 * Read R2 envelope from bucket
 */
export async function readFromR2(
  bucket: R2Bucket,
  key: string
): Promise<R2Envelope | null> {
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }
  const text = await object.text();
  return JSON.parse(text) as R2Envelope;
}

/**
 * Delete R2 object from bucket
 */
export async function deleteFromR2(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
  console.warn(`🗑️ Deleted from R2: ${key}`);
}

/**
 * Batch delete R2 objects
 */
export async function batchDeleteFromR2(bucket: R2Bucket, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await bucket.delete(keys);
  console.warn(`🗑️ Deleted ${keys.length} objects from R2`);
}
