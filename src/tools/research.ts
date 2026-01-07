// Research Tools - Web search and scraping via Firecrawl
// Gives the agent the ability to research crypto news, sentiment, and market info

import { FirecrawlAppV1 as FirecrawlApp } from '@mendable/firecrawl-js';
import { ToolDefinition } from './trading.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

// Tool definitions for Claude
export const RESEARCH_TOOLS: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Search the web for crypto news, sentiment, market analysis. Use for researching tokens, finding alpha, checking news.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "Solana memecoin pump today", "$ARA token news")',
        },
        limit: {
          type: 'number',
          description: 'Number of results to return (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'scrape_page',
    description: 'Scrape a specific webpage for content. Use for reading articles, checking project sites, analyzing competitors.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to scrape (e.g., "https://dexscreener.com/solana/...")',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'search_crypto_twitter',
    description: 'Search for crypto-related content on Twitter/X. Good for sentiment analysis and finding alpha.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for crypto Twitter (e.g., "Solana memecoin alpha", "pump.fun trending")',
        },
      },
      required: ['query'],
    },
  },
];

export class ResearchToolExecutor {
  private firecrawl: FirecrawlApp | null = null;
  private isEnabled: boolean = false;

  constructor() {
    if (FIRECRAWL_API_KEY) {
      this.firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY });
      this.isEnabled = true;
      console.log('🔥 Firecrawl research tools ENABLED');
    } else {
      console.log('⚠️  Firecrawl not configured - research tools disabled');
      console.log('   Add FIRECRAWL_API_KEY to .env to enable web research');
    }
  }

  isReady(): boolean {
    return this.isEnabled;
  }

  async execute(toolName: string, input: Record<string, unknown>): Promise<string> {
    if (!this.isEnabled || !this.firecrawl) {
      return JSON.stringify({
        error: 'Research tools not enabled',
        hint: 'Add FIRECRAWL_API_KEY to .env',
      });
    }

    switch (toolName) {
      case 'web_search':
        return this.webSearch(input.query as string, input.limit as number | undefined);
      case 'scrape_page':
        return this.scrapePage(input.url as string);
      case 'search_crypto_twitter':
        return this.searchCryptoTwitter(input.query as string);
      default:
        return JSON.stringify({ error: `Unknown research tool: ${toolName}` });
    }
  }

  private async webSearch(query: string, limit: number = 5): Promise<string> {
    try {
      console.log(`🔍 Searching: "${query}"`);

      const results = await this.firecrawl!.search(query, {
        limit: Math.min(limit, 10),
      });

      // Handle error response
      if ('error' in results || !results.success) {
        return JSON.stringify({ error: 'Search failed', details: results });
      }

      // Format results for Claude
      const formatted = results.data.map((r: any, i: number) => ({
        rank: i + 1,
        title: r.metadata?.title || r.title || 'No title',
        url: r.metadata?.sourceURL || r.url || 'No URL',
        snippet: r.metadata?.description || r.markdown?.slice(0, 300) || 'No description',
      }));

      return JSON.stringify({
        query,
        resultCount: formatted.length,
        results: formatted,
      });
    } catch (error) {
      console.error('Search error:', error);
      return JSON.stringify({
        error: 'Search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async scrapePage(url: string): Promise<string> {
    try {
      console.log(`📄 Scraping: ${url}`);

      const result = await this.firecrawl!.scrapeUrl(url, {
        formats: ['markdown'],
      });

      // Handle error response
      if ('error' in result || !result.success) {
        return JSON.stringify({ error: 'Scrape failed', url, details: result });
      }

      // Truncate content if too long
      const content = result.markdown || '';
      const truncated = content.length > 5000
        ? content.slice(0, 5000) + '\n\n[... content truncated ...]'
        : content;

      return JSON.stringify({
        url,
        title: result.metadata?.title || 'Unknown',
        description: result.metadata?.description || '',
        contentLength: content.length,
        content: truncated,
      });
    } catch (error) {
      console.error('Scrape error:', error);
      return JSON.stringify({
        error: 'Scrape failed',
        url,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async searchCryptoTwitter(query: string): Promise<string> {
    try {
      // Use Firecrawl search with Twitter-specific query
      const twitterQuery = `site:twitter.com OR site:x.com ${query} crypto`;

      console.log(`🐦 Searching Twitter: "${query}"`);

      const results = await this.firecrawl!.search(twitterQuery, {
        limit: 8,
      });

      // Handle error response
      if ('error' in results || !results.success) {
        return JSON.stringify({
          error: 'Twitter search failed',
          hint: 'Try a different query or use web_search instead',
        });
      }

      const formatted = results.data
        .filter((r: any) => {
          const url = r.metadata?.sourceURL || r.url || '';
          return url.includes('twitter.com') || url.includes('x.com');
        })
        .map((r: any, i: number) => ({
          rank: i + 1,
          url: r.metadata?.sourceURL || r.url,
          snippet: r.metadata?.description || r.markdown?.slice(0, 200) || 'No preview',
        }));

      return JSON.stringify({
        query,
        platform: 'Twitter/X',
        resultCount: formatted.length,
        results: formatted,
        note: formatted.length === 0
          ? 'No Twitter results found. Try web_search for broader results.'
          : undefined,
      });
    } catch (error) {
      console.error('Twitter search error:', error);
      return JSON.stringify({
        error: 'Twitter search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

// Helper to check if research tools should be included
export function getResearchTools(): ToolDefinition[] {
  if (FIRECRAWL_API_KEY) {
    return RESEARCH_TOOLS;
  }
  return [];
}
