import type { CollectedItem, Environment } from '../types';
import { eq } from 'drizzle-orm';
import { createDatabaseClient } from '../db/client';
import { seenLinks, socialSourceConfigs } from '../db/schema';

interface SourceConfig {
  id: string;
  orgId: string;
  platform: string;
  platformAccountId: string | null;
  accountHandle: string | null;
  lastCursor: string | null;
}

/**
 * Scrape the latest content from a social media account URL.
 * Currently uses a basic fetch-and-extract approach.
 * Browser Rendering can be added later for dynamic content.
 */
export async function scrapeAccount(
  env: Environment,
  config: SourceConfig
): Promise<CollectedItem[]> {
  const items: CollectedItem[] = [];

  if (!config.platformAccountId) {
    console.warn(`[direct-collector] No account URL for config ${config.id}, skipping`);
    return items;
  }

  try {
    const url = config.platformAccountId;
    console.warn(`[direct-collector] Scraping ${config.platform} account: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CROW-Social-Collector/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[direct-collector] Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      return items;
    }

    const html = await response.text();
    const extracted = extractFromHtml(html, config.platform, url);

    if (extracted.length > 0) {
      // Deduplicate against seen_links
      const db = createDatabaseClient(env.DB);
      const now = new Date();

      for (const item of extracted) {
        const existing = await db
          .select({ url: seenLinks.url })
          .from(seenLinks)
          .where(eq(seenLinks.url, item.url))
          .limit(1);

        if (existing.length === 0) {
          await db.insert(seenLinks).values({
            url: item.url,
            orgId: config.orgId,
            firstSeen: now,
            lastChecked: now,
            source: 'direct',
          }).onConflictDoNothing();

          items.push(item);
        }
      }
    }

    // Update last fetched timestamp
    const dbClient = createDatabaseClient(env.DB);
    await dbClient
      .update(socialSourceConfigs)
      .set({ lastFetchedAt: new Date() })
      .where(eq(socialSourceConfigs.id, config.id));

    console.warn(`[direct-collector] Collected ${items.length} new items from ${config.platform} for org ${config.orgId}`);
  } catch (error) {
    console.error(`[direct-collector] Error scraping ${config.platform} for config ${config.id}:`, error);
  }

  return items;
}

/**
 * Extract content from HTML based on platform.
 * This is a basic extraction approach; Browser Rendering can enhance this later.
 */
function extractFromHtml(html: string, platform: string, sourceUrl: string): CollectedItem[] {
  const items: CollectedItem[] = [];

  // Remove script and style tags
  const cleanHtml = html
    .replace(/<script[^<]*<\/script>/gi, '')
    .replace(/<style[^<]*<\/style>/gi, '');

  // Extract meta information
  const titleMatch = cleanHtml.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : '';

  const descMatch = cleanHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^<]*?)["']/i)
    || cleanHtml.match(/<meta[^>]*content=["']([^<]*?)["'][^>]*name=["']description["']/i);
  const description = descMatch ? descMatch[1].trim() : '';

  // Extract Open Graph data
  const ogTitleMatch = cleanHtml.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^<]*?)["']/i);
  const ogTitle = ogTitleMatch ? ogTitleMatch[1].trim() : '';

  const ogDescMatch = cleanHtml.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^<]*?)["']/i);
  const ogDesc = ogDescMatch ? ogDescMatch[1].trim() : '';

  // Try to extract article/post content from common patterns
  const articleMatch = cleanHtml.match(/<article[^>]*>([^<]*)<\/article>/gi);
  const mainMatch = cleanHtml.match(/<main[^>]*>([^<]*)<\/main>/gi);

  const contentBlocks = articleMatch || mainMatch || [];

  if (contentBlocks.length > 0) {
    for (let i = 0; i < Math.min(contentBlocks.length, 20); i++) {
      const block = contentBlocks[i];
      const textContent = block
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (textContent.length > 30) {
        items.push({
          url: `${sourceUrl}#post-${i}`,
          title: ogTitle || title,
          content: textContent.substring(0, 3000),
          platform,
          source: 'direct',
        });
      }
    }
  }

  // If no structured content was found, use meta description / OG data as a single item
  if (items.length === 0) {
    const fallbackContent = ogDesc || description;
    if (fallbackContent && fallbackContent.length > 20) {
      items.push({
        url: sourceUrl,
        title: ogTitle || title,
        content: fallbackContent,
        platform,
        source: 'direct',
      });
    } else {
      // Last resort: extract body text
      const bodyMatch = cleanHtml.match(/<body[^>]*>([^<]*)<\/body>/i);
      if (bodyMatch) {
        const bodyText = bodyMatch[1]
          .replace(/<nav[^<]*<\/nav>/gi, '')
          .replace(/<header[^<]*<\/header>/gi, '')
          .replace(/<footer[^<]*<\/footer>/gi, '')
          .replace(/<aside[^<]*<\/aside>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (bodyText.length > 50) {
          items.push({
            url: sourceUrl,
            title: ogTitle || title,
            content: bodyText.substring(0, 5000),
            platform,
            source: 'direct',
          });
        }
      }
    }
  }

  return items;
}

/**
 * Run direct collection for all source configs of an organization.
 */
export async function runDirectCollection(
  env: Environment,
  orgId: string,
  configs: SourceConfig[]
): Promise<CollectedItem[]> {
  const allItems: CollectedItem[] = [];

  for (const config of configs) {
    try {
      const items = await scrapeAccount(env, config);
      allItems.push(...items);
    } catch (error) {
      console.error(`[direct-collector] Failed for config ${config.id} (${config.platform}):`, error);
      // Continue with other configs
    }
  }

  console.warn(`[direct-collector] Total ${allItems.length} items collected for org ${orgId}`);
  return allItems;
}
