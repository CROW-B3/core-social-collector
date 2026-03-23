import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle before importing app
vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(() => mockDrizzleDb),
}));

vi.mock('../db/client', () => ({
  createDatabaseClient: vi.fn(() => mockDrizzleDb),
  generateId: vi.fn((prefix: string) => `${prefix}_test123`),
}));

vi.mock('../services/collector', () => ({
  runCollection: vi.fn(),
  runCollectionForOrg: vi.fn(),
}));

const mockDrizzleDb = {
  select: vi.fn(() => mockDrizzleDb),
  from: vi.fn(() => mockDrizzleDb),
  where: vi.fn(() => mockDrizzleDb),
  limit: vi.fn(() => mockDrizzleDb),
  insert: vi.fn(() => mockDrizzleDb),
  values: vi.fn(() => mockDrizzleDb),
  update: vi.fn(() => mockDrizzleDb),
  set: vi.fn(() => mockDrizzleDb),
  delete: vi.fn(() => mockDrizzleDb),
  then: vi.fn((resolve: Function) => resolve([])),
  [Symbol.asyncIterator]: async function* () {},
};

// Make select().from().where() return a promise of an array
function setupSelectReturns(results: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    then: (resolve: Function) => resolve(results),
    [Symbol.toPrimitive]: () => results,
  };
  // Make it thenable
  Object.defineProperty(chain, 'then', {
    value: (resolve: Function) => Promise.resolve(results).then(resolve),
  });
  mockDrizzleDb.select.mockReturnValue(chain);
  return chain;
}

function setupInsertReturns() {
  const chain = {
    values: vi.fn(() => Promise.resolve()),
  };
  mockDrizzleDb.insert.mockReturnValue(chain);
  return chain;
}

function setupUpdateReturns() {
  const chain = {
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  };
  mockDrizzleDb.update.mockReturnValue(chain);
  return chain;
}

function setupDeleteReturns() {
  const chain = {
    where: vi.fn(() => Promise.resolve()),
  };
  mockDrizzleDb.delete.mockReturnValue(chain);
  return chain;
}

const mockD1 = {
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({
      all: vi.fn(() => ({ results: [] })),
      first: vi.fn(() => null),
      run: vi.fn(() => ({ success: true })),
    })),
  })),
  batch: vi.fn(() => []),
};

const mockEnv = {
  DB: mockD1,
  ENVIRONMENT: 'local',
  SOCIAL_PROCESSING_QUEUE: {
    send: vi.fn(),
    sendBatch: vi.fn(),
  },
  AI: {
    run: vi.fn(),
  },
  AI_GATEWAY_ID: 'test-gateway',
  TAVILY_API_KEY: 'test-tavily-key',
  SYSTEM_SECRET: 'test-secret',
  INTERNAL_GATEWAY_KEY: 'test-key',
};

// Import app after mocks are set up
import app from '../index';

describe('core-social-collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET / (health check)', () => {
    it('should return 200 with service info', async () => {
      const res = await app.request('/', {}, mockEnv);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.service).toBe('crow-social-collector');
      expect(body.status).toBe('ok');
      expect(body.environment).toBe('local');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('POST /api/v1/collect/:orgId', () => {
    it('should trigger collection for org and return 200', async () => {
      const { runCollectionForOrg } = await import('../services/collector');
      (runCollectionForOrg as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await app.request('/api/v1/collect/org-123', { method: 'POST' }, mockEnv);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toContain('org-123');
    });

    it('should return 500 when collection fails', async () => {
      const { runCollectionForOrg } = await import('../services/collector');
      (runCollectionForOrg as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Collection failed')
      );

      const res = await app.request('/api/v1/collect/org-456', { method: 'POST' }, mockEnv);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Collection failed');
    });
  });

  describe('GET /api/v1/configs/:orgId', () => {
    it('should return list of configs for organization', async () => {
      const now = new Date();
      setupSelectReturns([
        {
          id: 'ssc_1',
          orgId: 'org-1',
          platform: 'twitter',
          platformAccountId: null,
          accountHandle: '@test',
          enabled: 1,
          lastCursor: null,
          lastFetchedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const res = await app.request('/api/v1/configs/org-1', {}, mockEnv);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configs).toBeDefined();
      expect(Array.isArray(body.configs)).toBe(true);
      expect(body.configs.length).toBe(1);
      expect(body.configs[0].platform).toBe('twitter');
    });
  });

  describe('POST /api/v1/configs', () => {
    it('should create a new source config', async () => {
      setupInsertReturns();

      const res = await app.request(
        '/api/v1/configs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: 'org-1',
            platform: 'twitter',
            accountHandle: '@testuser',
          }),
        },
        mockEnv
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.config).toBeDefined();
      expect(body.config.orgId).toBe('org-1');
      expect(body.config.platform).toBe('twitter');
    });

    it('should return 400 for invalid platform', async () => {
      const res = await app.request(
        '/api/v1/configs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: 'org-1',
            platform: 'invalid-platform',
          }),
        },
        mockEnv
      );
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/v1/configs/:id', () => {
    it('should return 404 when config not found', async () => {
      setupSelectReturns([]);

      const res = await app.request(
        '/api/v1/configs/nonexistent',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: 0 }),
        },
        mockEnv
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Config not found');
    });
  });

  describe('DELETE /api/v1/configs/:id', () => {
    it('should return 404 when config not found', async () => {
      setupSelectReturns([]);

      const res = await app.request(
        '/api/v1/configs/nonexistent',
        { method: 'DELETE' },
        mockEnv
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Config not found');
    });
  });

  describe('GET /api/v1/search-configs/:orgId', () => {
    it('should return list of search configs', async () => {
      const now = new Date();
      setupSelectReturns([
        {
          id: 'ssc_search_1',
          orgId: 'org-1',
          keywords: JSON.stringify(['coffee', 'latte']),
          brands: null,
          region: 'all',
          enabled: 1,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const res = await app.request('/api/v1/search-configs/org-1', {}, mockEnv);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configs).toBeDefined();
      expect(Array.isArray(body.configs)).toBe(true);
    });
  });

  describe('POST /api/v1/search-configs', () => {
    it('should create a new search config', async () => {
      setupInsertReturns();

      const res = await app.request(
        '/api/v1/search-configs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: 'org-1',
            keywords: ['coffee', 'espresso'],
            region: 'NA-EN',
          }),
        },
        mockEnv
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.config).toBeDefined();
      expect(body.config.orgId).toBe('org-1');
    });

    it('should return 400 for empty keywords', async () => {
      const res = await app.request(
        '/api/v1/search-configs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: 'org-1',
            keywords: [],
          }),
        },
        mockEnv
      );
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/v1/search-configs/:id', () => {
    it('should return 404 when search config not found', async () => {
      setupSelectReturns([]);

      const res = await app.request(
        '/api/v1/search-configs/nonexistent',
        { method: 'DELETE' },
        mockEnv
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Config not found');
    });
  });
});
