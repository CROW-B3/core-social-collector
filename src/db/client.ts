import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function createDatabaseClient(d1: D1Database) {
  return drizzle(d1, { schema });
}

export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}${random}`;
}
