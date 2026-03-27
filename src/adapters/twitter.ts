import type { PlatformAdapter, PlatformPost } from '../types';

/**
 * Twitter/X API Adapter
 * Docs: https://developer.x.com/en/docs/twitter-api
 * NOTE: Free tier: 1 request per 15 minutes (extremely limited)
 *       Basic tier ($100/month): 10K tweets/month required for production
 */
export class TwitterAdapter implements PlatformAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || 'https://api.twitter.com/2';
  }

  async fetchPosts(config: {
    accountId: string; // Twitter user ID
    cursor?: string;
    limit: number;
  }): Promise<{ posts: PlatformPost[]; nextCursor?: string }> {
    try {
      // Twitter API endpoint: GET /2/users/:id/tweets
      const url = new URL(`${this.baseUrl}/users/${config.accountId}/tweets`);
      url.searchParams.set('max_results', Math.min(config.limit, 100).toString());
      url.searchParams.set('tweet.fields', 'created_at,public_metrics,lang');
      if (config.cursor) {
        url.searchParams.set('pagination_token', config.cursor);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (response.status === 429) {
        const resetTime = response.headers.get('x-rate-limit-reset');
        throw new Error(`Rate limited. Reset at: ${resetTime}`);
      }

      if (!response.ok) {
        throw new Error(`Twitter API error: ${response.status}`);
      }

      const data = await response.json() as TwitterResponse;

      const posts: PlatformPost[] = (data.data || []).map(tweet => ({
        platformPostId: tweet.id,
        authorId: config.accountId,
        authorUsername: 'twitter_user', // Would need separate API call to get username
        content: tweet.text,
        publishedAt: tweet.created_at,
        engagement: {
          likes: tweet.public_metrics?.like_count || 0,
          shares: tweet.public_metrics?.retweet_count || 0,
          comments: tweet.public_metrics?.reply_count || 0,
          views: tweet.public_metrics?.impression_count || 0,
        },
        metadata: {
          language: tweet.lang,
          location: undefined,
          mediaType: 'text',
        },
      }));

      return {
        posts,
        nextCursor: data.meta?.next_token,
      };
    } catch (error) {
      console.error('❌ Twitter adapter error:', error);
      throw error;
    }
  }
}

interface TwitterResponse {
  data?: TwitterTweet[];
  meta?: {
    next_token?: string;
  };
}

interface TwitterTweet {
  id: string;
  text: string;
  created_at: string;
  lang?: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    impression_count: number;
  };
}
