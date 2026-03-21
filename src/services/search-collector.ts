import type { CollectedItem, Environment, TavilySearchResponse } from '../types';
import { and, eq, inArray } from 'drizzle-orm';
import { createDatabaseClient } from '../db/client';
import { seenLinks } from '../db/schema';

/**
 * Generate search queries using Workers AI based on keywords and brands.
 */
export async function generateSearchQueries(
  env: Environment,
  orgId: string,
  keywords: string[],
  brands: string[]
): Promise<string[]> {
  try {
    const prompt = `You are a search query generator for social media monitoring.
Given the following keywords and brand names, generate 5 diverse web search queries
to find recent social media mentions, reviews, news articles, and public discussions.

Keywords: ${keywords.join(', ')}
Brands: ${brands.join(', ')}

Return ONLY a JSON array of search query strings. No explanation.
Example: ["query 1", "query 2", "query 3", "query 4", "query 5"]`;

     
    const response = await (env.AI as any).run(
      '@cf/meta/llama-3.1-8b-instruct',
      {
        messages: [{ role: 'user', content: prompt }],
      },
      {
        gateway: {
          id: env.AI_GATEWAY_ID,
        },
      }
    );

    const text = 'response' in response ? (response.response as string) : '';
    if (!text) {
      console.warn(`[search-collector] Empty AI response for org ${orgId}`);
      return keywords.map(k => `${k} social media mentions`);
    }

    // Extract JSON array from the response
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter((q: unknown) => typeof q === 'string').slice(0, 10);
      }
    }

    // Fallback: generate basic queries from keywords
    console.warn(`[search-collector] Could not parse AI response, using fallback queries for org ${orgId}`);
    return keywords.map(k => `${k} social media mentions`);
  } catch (error) {
    console.error(`[search-collector] AI query generation failed for org ${orgId}:`, error);
    // Fallback queries
    return keywords.slice(0, 5).map(k => `${k} recent mentions`);
  }
}

/**
 * Execute a search query using the Tavily API.
 */
export async function executeSearch(
  env: Environment,
  query: string
): Promise<TavilySearchResponse> {
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        include_answer: false,
        max_results: 10,
      }),
    });

    if (!response.ok) {
      console.error(`[search-collector] Tavily search failed: ${response.status} ${response.statusText}`);
      return { results: [], query };
    }

    const data = (await response.json()) as TavilySearchResponse;
    return data;
  } catch (error) {
    console.error(`[search-collector] Tavily search error for query "${query}":`, error);
    return { results: [], query };
  }
}

/**
 * Deduplicate links against the seen_links table.
 * Returns only new (unseen) URLs.
 */
export async function deduplicateLinks(
  db: D1Database,
  orgId: string,
  urls: string[]
): Promise<string[]> {
  if (urls.length === 0) return [];

  const client = createDatabaseClient(db);
  const now = new Date();

  // Check which URLs are already seen
  const existingLinks = await client
    .select({ url: seenLinks.url })
    .from(seenLinks)
    .where(
      and(
        eq(seenLinks.orgId, orgId),
        inArray(seenLinks.url, urls)
      )
    );

  const seenUrls = new Set(existingLinks.map(l => l.url));
  const newUrls = urls.filter(url => !seenUrls.has(url));

  // Mark new URLs as seen
  if (newUrls.length > 0) {
    for (const url of newUrls) {
      await client.insert(seenLinks).values({
        url,
        orgId,
        firstSeen: now,
        lastChecked: now,
        source: 'search',
      }).onConflictDoNothing();
    }
  }

  // Update lastChecked for existing URLs
  for (const url of urls.filter(u => seenUrls.has(u))) {
    await client
      .update(seenLinks)
      .set({ lastChecked: now })
      .where(eq(seenLinks.url, url));
  }

  return newUrls;
}

/**
 * Extract text content from a URL.
 */
export async function extractContent(url: string): Promise<{ title: string; content: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CROW-Social-Collector/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[search-collector] Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Basic content extraction from HTML
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : '';

    // Remove script, style, and other non-content tags
    let content = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    // Truncate to a reasonable length
    if (content.length > 5000) {
      content = `${content.substring(0, 5000)  }...`;
    }

    return { title, content };
  } catch (error) {
    console.error(`[search-collector] Content extraction failed for ${url}:`, error);
    return null;
  }
}

/**
 * Run the full AI search collection flow for an organization.
 */
export async function runSearchCollection(
  env: Environment,
  orgId: string,
  keywords: string[],
  brands: string[]
): Promise<CollectedItem[]> {
  const collectedItems: CollectedItem[] = [];

  // Generate search queries using AI
  const queries = await generateSearchQueries(env, orgId, keywords, brands);
  console.warn(`[search-collector] Generated ${queries.length} queries for org ${orgId}`);

  // Execute each search query
  const allUrls: string[] = [];
  const urlToResult = new Map<string, { title: string; content: string; publishedDate?: string }>();

  for (const query of queries) {
    const searchResponse = await executeSearch(env, query);

    for (const result of searchResponse.results) {
      if (!urlToResult.has(result.url)) {
        allUrls.push(result.url);
        urlToResult.set(result.url, {
          title: result.title,
          content: result.content,
          publishedDate: result.published_date,
        });
      }
    }
  }

  console.warn(`[search-collector] Found ${allUrls.length} total URLs for org ${orgId}`);

  // Deduplicate against seen links
  const newUrls = await deduplicateLinks(env.DB, orgId, allUrls);
  console.warn(`[search-collector] ${newUrls.length} new URLs after dedup for org ${orgId}`);

  // Use Tavily's extracted content when available, otherwise extract ourselves
  for (const url of newUrls) {
    const tavilyResult = urlToResult.get(url);
    if (tavilyResult && tavilyResult.content && tavilyResult.content.length > 50) {
      collectedItems.push({
        url,
        title: tavilyResult.title,
        content: tavilyResult.content,
        platform: detectPlatform(url),
        publishedAt: tavilyResult.publishedDate,
        source: 'search',
      });
    } else {
      // Fallback to our own extraction
      const extracted = await extractContent(url);
      if (extracted && extracted.content.length > 50) {
        collectedItems.push({
          url,
          title: extracted.title,
          content: extracted.content,
          platform: detectPlatform(url),
          publishedAt: tavilyResult?.publishedDate,
          source: 'search',
        });
      }
    }
  }

  console.warn(`[search-collector] Collected ${collectedItems.length} items for org ${orgId}`);
  return collectedItems;
}

/**
 * Detect the social media platform from a URL.
 */
function detectPlatform(url: string): string {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) return 'twitter';
  if (lowerUrl.includes('reddit.com')) return 'reddit';
  if (lowerUrl.includes('instagram.com')) return 'instagram';
  if (lowerUrl.includes('tiktok.com')) return 'tiktok';
  if (lowerUrl.includes('linkedin.com')) return 'linkedin';
  if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.com')) return 'facebook';
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  return 'news';
}
