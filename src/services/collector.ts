import type { CollectedItem, Environment } from '../types';
import { eq } from 'drizzle-orm';
import { createDatabaseClient } from '../db/client';
import { socialSearchConfigs, socialSourceConfigs } from '../db/schema';
import { runDirectCollection } from './direct-collector';
import { dispatchToQueue } from './queue-dispatcher';
import { runSearchCollection } from './search-collector';

/**
 * Main collection orchestrator called by the cron handler.
 * Queries all enabled configs, groups by org, and runs collection.
 */
export async function runCollection(env: Environment): Promise<void> {
  console.warn('[collector] Starting scheduled collection run');
  const db = createDatabaseClient(env.DB);

  // Fetch all enabled source configs
  let sourceConfigs: Array<typeof socialSourceConfigs.$inferSelect>;
  let searchConfigs: Array<typeof socialSearchConfigs.$inferSelect>;

  try {
    sourceConfigs = await db
      .select()
      .from(socialSourceConfigs)
      .where(eq(socialSourceConfigs.enabled, 1));
  } catch (error) {
    console.error('[collector] Failed to query social_source_configs (table may not exist - run migrations):', error);
    sourceConfigs = [];
  }

  try {
    searchConfigs = await db
      .select()
      .from(socialSearchConfigs)
      .where(eq(socialSearchConfigs.enabled, 1));
  } catch (error) {
    console.error('[collector] Failed to query social_search_configs (table may not exist - run migrations):', error);
    searchConfigs = [];
  }

  // Group by org_id
  const orgIds = new Set<string>();
  for (const config of sourceConfigs) {
    orgIds.add(config.orgId);
  }
  for (const config of searchConfigs) {
    orgIds.add(config.orgId);
  }

  if (orgIds.size === 0) {
    console.warn('[collector] No enabled configs found, nothing to collect');
    return;
  }

  console.warn(`[collector] Found ${orgIds.size} organizations to process`);

  // Process each org independently so one failure doesn't break others
  for (const orgId of orgIds) {
    try {
      await runCollectionForOrg(env, orgId, sourceConfigs, searchConfigs);
    } catch (error) {
      console.error(`[collector] Error processing org ${orgId}:`, error);
    }
  }

  console.warn('[collector] Scheduled collection run complete');
}

/**
 * Run collection for a single organization.
 */
export async function runCollectionForOrg(
  env: Environment,
  orgId: string,
  allSourceConfigs?: Array<typeof socialSourceConfigs.$inferSelect>,
  allSearchConfigs?: Array<typeof socialSearchConfigs.$inferSelect>
): Promise<void> {
  console.warn(`[collector] Processing org ${orgId}`);
  const db = createDatabaseClient(env.DB);

  // Get configs for this org (use provided or query fresh)
  const orgSourceConfigs = allSourceConfigs
    ? allSourceConfigs.filter(c => c.orgId === orgId)
    : await db.select().from(socialSourceConfigs).where(eq(socialSourceConfigs.orgId, orgId));

  const orgSearchConfigs = allSearchConfigs
    ? allSearchConfigs.filter(c => c.orgId === orgId)
    : await db.select().from(socialSearchConfigs).where(eq(socialSearchConfigs.orgId, orgId));

  const allCollectedItems: CollectedItem[] = [];

  // Path 1: AI-generated search collection
  if (orgSearchConfigs.length > 0) {
    for (const searchConfig of orgSearchConfigs) {
      if (searchConfig.enabled !== 1) continue;

      try {
        const keywords: string[] = JSON.parse(searchConfig.keywords || '[]');
        const brands: string[] = searchConfig.brands ? JSON.parse(searchConfig.brands) : [];

        if (keywords.length === 0 && brands.length === 0) {
          console.warn(`[collector] Search config ${searchConfig.id} has no keywords or brands, skipping`);
          continue;
        }

        const searchItems = await runSearchCollection(env, orgId, keywords, brands);
        allCollectedItems.push(...searchItems);
      } catch (error) {
        console.error(`[collector] Search collection failed for config ${searchConfig.id}:`, error);
      }
    }
  }

  // Path 2: Direct scraping collection
  if (orgSourceConfigs.length > 0) {
    const enabledSourceConfigs = orgSourceConfigs.filter(c => c.enabled === 1);
    if (enabledSourceConfigs.length > 0) {
      try {
        const directItems = await runDirectCollection(env, orgId, enabledSourceConfigs);
        allCollectedItems.push(...directItems);
      } catch (error) {
        console.error(`[collector] Direct collection failed for org ${orgId}:`, error);
      }
    }
  }

  // Dispatch collected items to the interaction queue
  if (allCollectedItems.length > 0) {
    await dispatchToQueue(env, orgId, allCollectedItems);
    console.warn(`[collector] Dispatched ${allCollectedItems.length} items for org ${orgId}`);
  } else {
    console.warn(`[collector] No new items collected for org ${orgId}`);
  }
}
