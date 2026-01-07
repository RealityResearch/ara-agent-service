// Token Discovery Tool - Finds potential plays using DexScreener API
// Rate limits: 60 req/min for boost endpoints, 300 req/min for pairs

const DEXSCREENER_API = 'https://api.dexscreener.com';

export interface DiscoveredToken {
  address: string;
  name: string;
  symbol: string;
  description: string;
  chainId: string;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  txns24h: { buys: number; sells: number };
  pairCreatedAt: number;
  boostAmount?: number;
  url: string;
  socials: { twitter?: string; telegram?: string; website?: string };
  score: number; // Our calculated score
  flags: string[]; // Warning flags
}

export interface DiscoveryFilters {
  minLiquidity?: number;
  minVolume24h?: number;
  maxAge?: number; // hours since pair creation
  minBuys24h?: number;
  chainId?: string;
}

const DEFAULT_FILTERS: DiscoveryFilters = {
  minLiquidity: 10000, // $10k minimum liquidity (tradeable)
  minVolume24h: 20000, // $20k minimum 24h volume (active)
  maxAge: 168, // 7 days old max (catch newer plays)
  minBuys24h: 50, // at least 50 buys
  chainId: 'solana',
};

/**
 * Fetch boosted tokens from DexScreener
 */
async function fetchBoostedTokens(): Promise<any[]> {
  try {
    const response = await fetch(`${DEXSCREENER_API}/token-boosts/latest/v1`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error('Error fetching boosted tokens:', error);
    return [];
  }
}

/**
 * Fetch top boosted tokens
 */
async function fetchTopBoosted(): Promise<any[]> {
  try {
    const response = await fetch(`${DEXSCREENER_API}/token-boosts/top/v1`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error('Error fetching top boosted:', error);
    return [];
  }
}

/**
 * Search for tokens by query
 */
async function searchTokens(query: string): Promise<any[]> {
  try {
    const response = await fetch(
      `${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(query)}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.pairs || [];
  } catch (error) {
    console.error('Error searching tokens:', error);
    return [];
  }
}

/**
 * Get pair data for a token address
 */
async function getTokenPairs(chainId: string, tokenAddress: string): Promise<any[]> {
  try {
    const response = await fetch(
      `${DEXSCREENER_API}/token-pairs/v1/${chainId}/${tokenAddress}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : data.pairs || [];
  } catch (error) {
    console.error('Error fetching token pairs:', error);
    return [];
  }
}

/**
 * Calculate a score for a token based on various metrics
 */
function calculateScore(token: Partial<DiscoveredToken>): number {
  let score = 50; // Base score

  // Volume to liquidity ratio (higher is better, shows active trading)
  const volLiqRatio = (token.volume24h || 0) / Math.max(token.liquidity || 1, 1);
  if (volLiqRatio > 2) score += 15;
  else if (volLiqRatio > 1) score += 10;
  else if (volLiqRatio > 0.5) score += 5;

  // Buy/sell ratio (more buys = bullish)
  const buys = token.txns24h?.buys || 0;
  const sells = token.txns24h?.sells || 0;
  const buyRatio = buys / Math.max(buys + sells, 1);
  if (buyRatio > 0.6) score += 10;
  else if (buyRatio > 0.5) score += 5;
  else if (buyRatio < 0.4) score -= 10;

  // Price action
  const change = token.priceChange24h || 0;
  if (change > 50) score += 10;
  else if (change > 20) score += 5;
  else if (change < -30) score -= 10;

  // Liquidity bonus
  if ((token.liquidity || 0) > 50000) score += 10;
  else if ((token.liquidity || 0) > 20000) score += 5;

  // Volume bonus
  if ((token.volume24h || 0) > 100000) score += 10;
  else if ((token.volume24h || 0) > 50000) score += 5;

  // Boost bonus
  if ((token.boostAmount || 0) > 100) score += 5;

  // Has socials bonus
  if (token.socials?.twitter) score += 5;
  if (token.socials?.telegram) score += 3;
  if (token.socials?.website) score += 2;

  return Math.min(100, Math.max(0, score));
}

/**
 * Generate warning flags for a token
 */
function generateFlags(token: Partial<DiscoveredToken>): string[] {
  const flags: string[] = [];

  // Low liquidity warning
  if ((token.liquidity || 0) < 10000) {
    flags.push('LOW_LIQUIDITY');
  }

  // High sell pressure
  const buys = token.txns24h?.buys || 0;
  const sells = token.txns24h?.sells || 0;
  if (sells > buys * 1.5) {
    flags.push('HIGH_SELL_PRESSURE');
  }

  // Very new (< 6 hours)
  const ageHours = (Date.now() - (token.pairCreatedAt || Date.now())) / (1000 * 60 * 60);
  if (ageHours < 6) {
    flags.push('VERY_NEW');
  }

  // Large price drop
  if ((token.priceChange24h || 0) < -40) {
    flags.push('DUMPING');
  }

  // No socials
  if (!token.socials?.twitter && !token.socials?.telegram) {
    flags.push('NO_SOCIALS');
  }

  return flags;
}

/**
 * Enrich boosted token data with pair information
 */
async function enrichToken(
  boostData: any,
  pairData: any
): Promise<DiscoveredToken | null> {
  if (!pairData) return null;

  const socials: DiscoveredToken['socials'] = {};
  for (const link of boostData.links || []) {
    if (link.type === 'twitter') socials.twitter = link.url;
    else if (link.type === 'telegram') socials.telegram = link.url;
    else if (!link.type && link.url) socials.website = link.url;
  }

  const token: DiscoveredToken = {
    address: boostData.tokenAddress,
    name: pairData.baseToken?.name || 'Unknown',
    symbol: pairData.baseToken?.symbol || '???',
    description: (boostData.description || '').slice(0, 200),
    chainId: boostData.chainId,
    priceUsd: parseFloat(pairData.priceUsd || '0'),
    priceChange24h: pairData.priceChange?.h24 || 0,
    volume24h: pairData.volume?.h24 || 0,
    liquidity: pairData.liquidity?.usd || 0,
    marketCap: pairData.marketCap || 0,
    txns24h: {
      buys: pairData.txns?.h24?.buys || 0,
      sells: pairData.txns?.h24?.sells || 0,
    },
    pairCreatedAt: pairData.pairCreatedAt || Date.now(),
    boostAmount: boostData.totalAmount,
    url: boostData.url || `https://dexscreener.com/${boostData.chainId}/${boostData.tokenAddress}`,
    socials,
    score: 0,
    flags: [],
  };

  token.score = calculateScore(token);
  token.flags = generateFlags(token);

  return token;
}

/**
 * Apply filters to a token
 */
function passesFilters(token: DiscoveredToken, filters: DiscoveryFilters): boolean {
  if (filters.chainId && token.chainId !== filters.chainId) return false;
  if (filters.minLiquidity && token.liquidity < filters.minLiquidity) return false;
  if (filters.minVolume24h && token.volume24h < filters.minVolume24h) return false;
  if (filters.minBuys24h && token.txns24h.buys < filters.minBuys24h) return false;

  if (filters.maxAge) {
    const ageHours = (Date.now() - token.pairCreatedAt) / (1000 * 60 * 60);
    if (ageHours > filters.maxAge) return false;
  }

  return true;
}

/**
 * Main discovery function - finds potential plays
 */
export async function discoverTokens(
  filters: DiscoveryFilters = DEFAULT_FILTERS
): Promise<DiscoveredToken[]> {
  console.log('🔍 Scanning for potential plays...');

  // Fetch boosted tokens (these are promoted, likely have attention)
  const [latestBoosted, topBoosted] = await Promise.all([
    fetchBoostedTokens(),
    fetchTopBoosted(),
  ]);

  // Combine and dedupe by address
  const allBoosted = [...latestBoosted, ...topBoosted];
  const seenAddresses = new Set<string>();
  const uniqueBoosted = allBoosted.filter((t) => {
    if (seenAddresses.has(t.tokenAddress)) return false;
    seenAddresses.add(t.tokenAddress);
    return true;
  });

  // Filter to target chain
  const chainFiltered = uniqueBoosted.filter(
    (t) => !filters.chainId || t.chainId === filters.chainId
  );

  console.log(`Found ${chainFiltered.length} boosted tokens on ${filters.chainId || 'all chains'}`);

  // Enrich with pair data (batch in groups of 5 to respect rate limits)
  const enrichedTokens: DiscoveredToken[] = [];

  for (let i = 0; i < Math.min(chainFiltered.length, 20); i++) {
    const boost = chainFiltered[i];
    const pairs = await getTokenPairs(boost.chainId, boost.tokenAddress);

    if (pairs.length > 0) {
      // Use the pair with highest liquidity
      const bestPair = pairs.sort((a: any, b: any) =>
        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0];

      const enriched = await enrichToken(boost, bestPair);
      if (enriched && passesFilters(enriched, filters)) {
        enrichedTokens.push(enriched);
      }
    }

    // Small delay to avoid rate limits
    if (i % 5 === 4) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Sort by score
  enrichedTokens.sort((a, b) => b.score - a.score);

  console.log(`✅ Found ${enrichedTokens.length} tokens passing filters`);

  return enrichedTokens;
}

/**
 * Search for specific tokens by name/symbol
 */
export async function searchForTokens(
  query: string,
  filters: DiscoveryFilters = DEFAULT_FILTERS
): Promise<DiscoveredToken[]> {
  console.log(`🔍 Searching for: ${query}`);

  const pairs = await searchTokens(query);

  // Filter to target chain
  const chainFiltered = pairs.filter(
    (p: any) => !filters.chainId || p.chainId === filters.chainId
  );

  const tokens: DiscoveredToken[] = chainFiltered.slice(0, 20).map((pair: any) => {
    const token: DiscoveredToken = {
      address: pair.baseToken?.address || '',
      name: pair.baseToken?.name || 'Unknown',
      symbol: pair.baseToken?.symbol || '???',
      description: '',
      chainId: pair.chainId,
      priceUsd: parseFloat(pair.priceUsd || '0'),
      priceChange24h: pair.priceChange?.h24 || 0,
      volume24h: pair.volume?.h24 || 0,
      liquidity: pair.liquidity?.usd || 0,
      marketCap: pair.marketCap || 0,
      txns24h: {
        buys: pair.txns?.h24?.buys || 0,
        sells: pair.txns?.h24?.sells || 0,
      },
      pairCreatedAt: pair.pairCreatedAt || Date.now(),
      url: pair.url || '',
      socials: {},
      score: 0,
      flags: [],
    };

    token.score = calculateScore(token);
    token.flags = generateFlags(token);

    return token;
  }).filter((t: DiscoveredToken) => passesFilters(t, filters));

  tokens.sort((a, b) => b.score - a.score);

  return tokens;
}

/**
 * Format token for display to agent
 */
export function formatTokenForAgent(token: DiscoveredToken): string {
  const ageHours = Math.floor((Date.now() - token.pairCreatedAt) / (1000 * 60 * 60));
  const flagsStr = token.flags.length > 0 ? ` ⚠️ ${token.flags.join(', ')}` : '';

  return `
**${token.name} (${token.symbol})** - Score: ${token.score}/100${flagsStr}
- Price: $${token.priceUsd.toFixed(8)} (${token.priceChange24h >= 0 ? '+' : ''}${token.priceChange24h.toFixed(1)}% 24h)
- Volume: $${token.volume24h.toLocaleString()} | Liquidity: $${token.liquidity.toLocaleString()}
- Txns: ${token.txns24h.buys} buys / ${token.txns24h.sells} sells (24h)
- Age: ${ageHours}h | Boost: ${token.boostAmount || 0}
- ${token.description.slice(0, 100)}${token.description.length > 100 ? '...' : ''}
- Links: ${token.socials.twitter ? 'Twitter ' : ''}${token.socials.telegram ? 'Telegram ' : ''}${token.socials.website ? 'Website' : ''}
- Address: ${token.address}
`.trim();
}

// Claude tool definitions
export const DISCOVERY_TOOLS = [
  {
    name: 'discover_tokens',
    description: 'Scan DexScreener for trending/boosted tokens. Returns scored list of potential plays with volume, liquidity, and risk flags.',
    input_schema: {
      type: 'object' as const,
      properties: {
        min_liquidity: {
          type: 'number',
          description: 'Minimum liquidity in USD (default: 5000)',
        },
        min_volume: {
          type: 'number',
          description: 'Minimum 24h volume in USD (default: 10000)',
        },
        max_age_hours: {
          type: 'number',
          description: 'Maximum age in hours since pair creation (default: 72)',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_tokens',
    description: 'Search for specific tokens by name or symbol on DexScreener.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (token name, symbol, or theme like "pepe" or "ai")',
        },
        min_liquidity: {
          type: 'number',
          description: 'Minimum liquidity in USD (default: 5000)',
        },
      },
      required: ['query'],
    },
  },
];

/**
 * Execute discovery tool
 */
export async function executeDiscoveryTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    if (toolName === 'discover_tokens') {
      const filters: DiscoveryFilters = {
        ...DEFAULT_FILTERS,
        minLiquidity: (input.min_liquidity as number) || DEFAULT_FILTERS.minLiquidity,
        minVolume24h: (input.min_volume as number) || DEFAULT_FILTERS.minVolume24h,
        maxAge: (input.max_age_hours as number) || DEFAULT_FILTERS.maxAge,
      };

      const tokens = await discoverTokens(filters);

      if (tokens.length === 0) {
        return 'No tokens found matching the criteria. Try adjusting filters.';
      }

      const formatted = tokens.slice(0, 10).map(formatTokenForAgent).join('\n\n---\n\n');
      return `Found ${tokens.length} potential plays:\n\n${formatted}`;
    }

    if (toolName === 'search_tokens') {
      const query = input.query as string;
      if (!query) return 'Error: query is required';

      const filters: DiscoveryFilters = {
        ...DEFAULT_FILTERS,
        minLiquidity: (input.min_liquidity as number) || DEFAULT_FILTERS.minLiquidity,
      };

      const tokens = await searchForTokens(query, filters);

      if (tokens.length === 0) {
        return `No tokens found for "${query}". Try a different search term.`;
      }

      const formatted = tokens.slice(0, 10).map(formatTokenForAgent).join('\n\n---\n\n');
      return `Search results for "${query}":\n\n${formatted}`;
    }

    return `Unknown tool: ${toolName}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
