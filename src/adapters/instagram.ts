import type { PlatformAdapter, PlatformPost } from '../types';

/**
 * Instagram Graph API Adapter
 * Can use either real Instagram API or social-ingest-service mock
 * Docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/
 */
export class InstagramAdapter implements PlatformAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || 'https://graph.instagram.com/v21.0';
  }

  async fetchPosts(config: {
    accountId: string;
    cursor?: string;
    limit: number;
  }): Promise<{ posts: PlatformPost[]; nextCursor?: string }> {   
    try {
      // Instagram Graph API endpoint: GET /{ig-user-id}/media
      const url = new URL(`${this.baseUrl}/${config.accountId}/media`);
      url.searchParams.set('fields', 'id,caption,timestamp,media_type,like_count,comments_count,permalink,username,media_url');
      url.searchParams.set('access_token', this.apiKey);
      url.searchParams.set('limit', config.limit.toString());
      if (config.cursor) {
        url.searchParams.set('after', config.cursor);
      }

      const response = await fetch(url.toString());

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        console.warn(`⚠️ Rate limited by Instagram. Retry after: ${retryAfter}s`);
        throw new Error(`Rate limited. Retry after ${retryAfter}s`);
      }

      if (!response.ok) {
        throw new Error(`Instagram API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as InstagramMediaResponse;

      // Transform Instagram posts to canonical format
      const posts: PlatformPost[] = (data.data || []).map(media => ({
        platformPostId: media.id,
        authorId: config.accountId,
        authorUsername: media.username || 'unknown',
        content: media.caption || '',
        publishedAt: media.timestamp,
        engagement: {
          likes: media.like_count || 0,
          shares: 0, // Instagram API doesn't expose shares
          comments: media.comments_count || 0,
          views: 0,
        },
        metadata: {
          language: undefined, // Instagram API doesn't expose language
          location: undefined,
          mediaType: media.media_type === 'VIDEO' ? 'video' : 'photo',
        },
      }));

      return {
        posts,
        nextCursor: data.paging?.next ? data.paging.cursors?.after : undefined,
      };
    } catch (error) {
      console.error('❌ Instagram adapter error:', error);
      throw error;
    }
  }
}

// Instagram API Response Types
interface InstagramMediaResponse {
  data: InstagramMedia[];
  paging?: {
    cursors?: {
      before: string;
      after: string;
    };
    next?: string;
  };
}

interface InstagramMedia {
  id: string;
  caption?: string;
  timestamp: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  like_count?: number;
  comments_count?: number;
  permalink: string;
  username?: string;
  media_url: string;
}
