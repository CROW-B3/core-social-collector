import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const socialSourceConfigs = sqliteTable('social_source_configs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  platform: text('platform').notNull(),
  platformAccountId: text('platform_account_id'),
  accountHandle: text('account_handle'),
  enabled: integer('enabled').default(1),
  lastCursor: text('last_cursor'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const socialSearchConfigs = sqliteTable('social_search_configs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  keywords: text('keywords').notNull(),
  brands: text('brands'),
  region: text('region').default('all'),
  enabled: integer('enabled').default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const seenLinks = sqliteTable('seen_links', {
  url: text('url').primaryKey(),
  orgId: text('org_id').notNull(),
  firstSeen: integer('first_seen', { mode: 'timestamp' }).notNull(),
  lastChecked: integer('last_checked', { mode: 'timestamp' }),
  contentHash: text('content_hash'),
  source: text('source'),
});
