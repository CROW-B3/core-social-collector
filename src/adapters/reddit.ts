import type { PlatformAdapter, PlatformPost } from '../types';

/**
 * Reddit API Adapter
 * Docs: https://www.reddit.com/dev/api
 * NOTE: Reddit eliminated free tier in 2023. Requires paid API access.
 */
export class RedditAdapter implements PlatformAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || 'https://oauth.reddit.com';
  }

  async fetchPosts(config: {
    accountId: string; // Subreddit name (e.g., "r/brand")
    cursor?: string;
    limit: number;
  }): Promise<{ posts: PlatformPost[]; nextCursor?: string }> {
    try {
      // Reddit API endpoint: GET /r/{subreddit}/new
      const url = new URL(`${this.baseUrl}/r/${config.accountId}/new`);
      url.searchParams.set('limit', Math.min(config.limit, 100).toString());
      if (config.cursor) {
        url.searchParams.set('after', config.cursor);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'CROW-Social-Collector/1.0',
        },
      });

      if (response.status === 429) {
        throw new Error(`Rate limited by Reddit`);
      }

      if (!response.ok) {
        throw new Error(`Reddit API error: ${response.status}`);
      }

      const data = await response.json() as RedditResponse;

      const posts: PlatformPost[] = (data.data?.children || []).map(child => ({
        platformPostId: child.data.id,
        authorId: child.data.author_fullname || 'unknown',
        authorUsername: child.data.author,
        content: `${child.data.title}\n\n${child.data.selftext || ''}`,
        publishedAt: new Date(child.data.created_utc * 1000).toISOString(),
        engagement: {
          likes: child.data.ups || 0,
          shares: 0,
          comments: child.data.num_comments || 0,
          views: 0,
        },
        metadata: {
          language: undefined,
          location: undefined,
          mediaType: child.data.post_hint === 'image' ? 'photo' :
                     child.data.is_video ? 'video' : 'text',
        },
      }));

      return {
        posts,
        nextCursor: data.data?.after,
      };
    } catch (error) {
      console.error('❌ Reddit adapter error:', error);
      throw error;
    }
  }
}

interface RedditResponse {
  data?: {
    children: RedditPost[];
    after?: string;
  };
}

interface RedditPost {
  data: {
    id: string;
    title: string;
    selftext?: string;
    author: string;
    author_fullname: string;
    created_utc: number;
    ups: number;
    num_comments: number;
    post_hint?: string;
    is_video: boolean;
  };
}
