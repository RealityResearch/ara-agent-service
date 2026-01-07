// Market data tools - fetches from pump.fun + DexScreener APIs
// Set CONTRACT_ADDRESS and CREATOR_WALLET in .env

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '';
const CREATOR_WALLET = process.env.CREATOR_WALLET || '';

// DexScreener API - free, no key required, 300 req/min
const DEXSCREENER_API = 'https://api.dexscreener.com';

// Token addresses for price lookups
const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';

// Cache for SOL price (refresh every 30s)
let cachedSolPrice: { price: number; timestamp: number } | null = null;
const SOL_PRICE_CACHE_TTL = 30000; // 30 seconds

export interface TokenData {
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  holders: number;
  name: string;
  symbol: string;
}

export interface WalletData {
  sol: number;
  ara: number;
  usdValue: number;
}

// Simulated price state for demo mode
let demoPrice = 0.00000847;
let demoTrend = 1;

/**
 * Fetch SOL price from DexScreener API (free, no key)
 * Uses caching to avoid rate limits
 */
async function fetchSolPrice(): Promise<number> {
  // Check cache first
  if (cachedSolPrice && Date.now() - cachedSolPrice.timestamp < SOL_PRICE_CACHE_TTL) {
    return cachedSolPrice.price;
  }

  try {
    // DexScreener tokens endpoint - get SOL price
    const response = await fetch(`${DEXSCREENER_API}/tokens/v1/solana/${SOL_ADDRESS}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ClaudeInvestments/1.0'
      }
    });

    if (!response.ok) {
      console.error(`DexScreener API error: ${response.status}`);
      return cachedSolPrice?.price || 180; // Fallback
    }

    const data = await response.json();

    // DexScreener returns array of pairs, find one with USD price
    if (Array.isArray(data) && data.length > 0) {
      // Look for a USDC or USDT pair for accurate USD price
      const usdPair = data.find((p: { quoteToken?: { symbol?: string } }) =>
        p.quoteToken?.symbol === 'USDC' || p.quoteToken?.symbol === 'USDT'
      ) || data[0];

      const price = parseFloat(usdPair.priceUsd || '0');
      if (price > 0) {
        cachedSolPrice = { price, timestamp: Date.now() };
        console.log(`SOL price from DexScreener: $${price.toFixed(2)}`);
        return price;
      }
    }

    return cachedSolPrice?.price || 180;
  } catch (error) {
    console.error('Error fetching SOL price:', error);
    return cachedSolPrice?.price || 180;
  }
}

async function fetchPumpFunData(): Promise<TokenData | null> {
  if (!CONTRACT_ADDRESS) {
    return null; // Fall back to demo mode
  }

  try {
    // Pump.fun API endpoint for token data
    const response = await fetch(`https://frontend-api.pump.fun/coins/${CONTRACT_ADDRESS}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ClaudeInvestments/1.0'
      }
    });

    if (!response.ok) {
      console.error(`Pump.fun API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Calculate price from bonding curve
    const virtualSolReserves = data.virtual_sol_reserves || 0;
    const virtualTokenReserves = data.virtual_token_reserves || 1;
    const price = virtualSolReserves / virtualTokenReserves;

    // Get real SOL price from DexScreener
    const solPriceUsd = await fetchSolPrice();

    return {
      price: price * solPriceUsd,
      priceChange24h: data.price_change_24h || 0,
      volume24h: (data.volume_24h || 0) * solPriceUsd,
      marketCap: (data.market_cap || price * 1_000_000_000) * solPriceUsd,
      holders: data.holder_count || 0,
      name: data.name || '$ARA',
      symbol: data.symbol || 'ARA'
    };
  } catch (error) {
    console.error('Error fetching pump.fun data:', error);
    return null;
  }
}

async function fetchWalletData(): Promise<WalletData | null> {
  if (!CREATOR_WALLET) {
    return null;
  }

  try {
    // Use Helius or public Solana RPC to get wallet balance
    // For now, we'll use a simple approach
    const response = await fetch(`https://api.mainnet-beta.solana.com`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [CREATOR_WALLET]
      })
    });

    const data = await response.json();
    const solBalance = (data.result?.value || 0) / 1e9;

    // Get real SOL price for USD value
    const solPriceUsd = await fetchSolPrice();

    // For token balance, would need to query token accounts
    // Simplified for now
    return {
      sol: solBalance,
      ara: 50_000_000, // Would need SPL token query
      usdValue: solBalance * solPriceUsd
    };
  } catch (error) {
    console.error('Error fetching wallet data:', error);
    return null;
  }
}

function getDemoData(): TokenData {
  // Simulate price movement
  const volatility = (Math.random() - 0.5) * 0.1;
  if (Math.random() > 0.95) demoTrend = -demoTrend;

  demoPrice = demoPrice * (1 + volatility * 0.05 + demoTrend * 0.01);
  demoPrice = Math.max(demoPrice, 0.00000100);

  const priceChange = (Math.random() - 0.3) * 20;

  return {
    price: demoPrice,
    priceChange24h: priceChange,
    volume24h: 50000 + Math.random() * 200000,
    marketCap: demoPrice * 1_000_000_000,
    holders: Math.floor(1200 + Math.random() * 100),
    name: '$ARA',
    symbol: 'ARA'
  };
}

function getDemoWallet(): WalletData {
  return {
    sol: 2.4 + Math.random() * 0.1,
    ara: 50_000_000 + Math.random() * 1_000_000,
    usdValue: (2.4 * 180) + (50_000_000 * demoPrice)
  };
}

export async function getTokenData(): Promise<TokenData> {
  const liveData = await fetchPumpFunData();
  if (liveData) {
    console.log('Using live pump.fun data');
    return liveData;
  }
  return getDemoData();
}

export async function getWalletBalance(): Promise<WalletData> {
  const liveData = await fetchWalletData();
  if (liveData) {
    console.log('Using live wallet data');
    return liveData;
  }
  return getDemoWallet();
}

export function formatPrice(price: number): string {
  if (price < 0.00001) return price.toExponential(2);
  if (price < 0.001) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(2);
}

export function formatUSD(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}
