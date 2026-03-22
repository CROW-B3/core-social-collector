export interface Environment {
  DB: D1Database;
  ENVIRONMENT: 'local' | 'dev' | 'prod';
  INTERACTION_QUEUE: Queue<InteractionMessage>;
  AI: Ai;
  AI_GATEWAY_ID: string;
  TAVILY_API_KEY: string;
  SYSTEM_SECRET?: string;
  INTERNAL_GATEWAY_KEY?: string;
}

export interface InteractionMessage {
  organizationId: string;
  sourceType: 'social';
  sessionId?: string;
  data: string;
  summary?: string;
  timestamp: number;
}

export interface CollectedItem {
  url: string;
  title: string;
  content: string;
  platform: string;
  author?: string;
  publishedAt?: string;
  source: 'search' | 'direct';
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

export interface TavilySearchResponse {
  results: TavilySearchResult[];
  query: string;
}
