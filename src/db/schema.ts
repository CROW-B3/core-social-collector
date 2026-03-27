import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Social Source Configurations
 * Tracks which social media accounts to monitor per organization
 */
export const socialSourceConfigs = sqliteTable('social_source_configs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  platform: text('platform').notNull(), // 'instagram' | 'tiktok' | 'reddit' | 'twitter' | 'facebook'

  // Platform-specific account identifier
  platformAccountId: text('platform_account_id').notNull(),
  accountHandle: text('account_handle'),

  // Config
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  lastCursor: text('last_cursor'), // Pagination cursor for next fetch
  lastFetchedAt: integer('last_fetched_at'),

  // Timestamps
  createdAt: integer('created_at').notNull().default(Date.now()),
  updatedAt: integer('updated_at').notNull().default(Date.now()),
});

export type SocialSourceConfig = typeof socialSourceConfigs.$inferSelect;
export type NewSocialSourceConfig = typeof socialSourceConfigs.$inferInsert;
