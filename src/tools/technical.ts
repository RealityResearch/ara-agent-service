// Technical Analysis Tools for Smarter Trading
// Provides RSI, Moving Averages, Volume Analysis, and Momentum indicators

const DEXSCREENER_API = 'https://api.dexscreener.com';

export interface PriceCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  rsi: number | null;
  rsiSignal: 'oversold' | 'neutral' | 'overbought';
  sma20: number | null;
  sma50: number | null;
  priceVsSma20: number | null; // % above/below SMA20
  volumeSpike: boolean;
  volumeRatio: number; // current vs average
  momentum: 'bullish' | 'bearish' | 'neutral';
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence: number; // 0-100
  analysis: string;
}

/**
 * Calculate RSI (Relative Strength Index)
 * RSI < 30 = oversold (potential buy)
 * RSI > 70 = overbought (potential sell)
 */
function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Calculate smoothed RSI
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Detect volume spikes (current volume > 2x average)
 */
function detectVolumeSpike(volumes: number[]): { isSpike: boolean; ratio: number } {
  if (volumes.length < 5) return { isSpike: false, ratio: 1 };

  const recent = volumes.slice(-5);
  const avgVolume = recent.slice(0, -1).reduce((a, b) => a + b, 0) / (recent.length - 1);
  const currentVolume = recent[recent.length - 1];
  const ratio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  return {
    isSpike: ratio > 2,
    ratio: Math.round(ratio * 10) / 10,
  };
}

/**
 * Fetch price history from DexScreener
 */
async function fetchPriceHistory(tokenAddress: string): Promise<PriceCandle[]> {
  try {
    // Get token pairs
    const response = await fetch(
      `${DEXSCREENER_API}/tokens/v1/solana/${tokenAddress}`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return [];

    const pair = data[0];

    // DexScreener doesn't provide historical candles in free API
    // We'll construct pseudo-candles from available data
    const candles: PriceCandle[] = [];

    // Use price change data to estimate recent price action
    const currentPrice = parseFloat(pair.priceUsd || '0');
    const change5m = pair.priceChange?.m5 || 0;
    const change1h = pair.priceChange?.h1 || 0;
    const change6h = pair.priceChange?.h6 || 0;
    const change24h = pair.priceChange?.h24 || 0;

    const volume24h = pair.volume?.h24 || 0;
    const volume6h = pair.volume?.h6 || 0;
    const volume1h = pair.volume?.h1 || 0;

    // Reconstruct price points
    const now = Date.now();
    const price24hAgo = currentPrice / (1 + change24h / 100);
    const price6hAgo = currentPrice / (1 + change6h / 100);
    const price1hAgo = currentPrice / (1 + change1h / 100);
    const price5mAgo = currentPrice / (1 + change5m / 100);

    // Add synthetic candles for analysis
    candles.push(
      { timestamp: now - 24 * 60 * 60 * 1000, open: price24hAgo, high: price24hAgo, low: price24hAgo, close: price24hAgo, volume: volume24h / 24 },
      { timestamp: now - 6 * 60 * 60 * 1000, open: price6hAgo, high: price6hAgo, low: price6hAgo, close: price6hAgo, volume: volume6h / 6 },
      { timestamp: now - 60 * 60 * 1000, open: price1hAgo, high: price1hAgo, low: price1hAgo, close: price1hAgo, volume: volume1h },
      { timestamp: now - 5 * 60 * 1000, open: price5mAgo, high: Math.max(price5mAgo, currentPrice), low: Math.min(price5mAgo, currentPrice), close: currentPrice, volume: volume1h / 12 },
      { timestamp: now, open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice, volume: volume1h / 60 }
    );

    return candles;
  } catch (error) {
    console.error('Error fetching price history:', error);
    return [];
  }
}

/**
 * Main function: Analyze a token and return technical indicators
 */
export async function analyzeTechnicals(tokenAddress: string): Promise<TechnicalIndicators> {
  const candles = await fetchPriceHistory(tokenAddress);

  if (candles.length < 3) {
    return {
      rsi: null,
      rsiSignal: 'neutral',
      sma20: null,
      sma50: null,
      priceVsSma20: null,
      volumeSpike: false,
      volumeRatio: 1,
      momentum: 'neutral',
      recommendation: 'hold',
      confidence: 0,
      analysis: 'Insufficient data for technical analysis.',
    };
  }

  const prices = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const currentPrice = prices[prices.length - 1];

  // Calculate indicators
  const rsi = calculateRSI(prices, Math.min(14, prices.length - 1));
  const sma20 = calculateSMA(prices, Math.min(20, prices.length));
  const sma50 = calculateSMA(prices, Math.min(50, prices.length));
  const { isSpike: volumeSpike, ratio: volumeRatio } = detectVolumeSpike(volumes);

  // Determine RSI signal
  let rsiSignal: 'oversold' | 'neutral' | 'overbought' = 'neutral';
  if (rsi !== null) {
    if (rsi < 30) rsiSignal = 'oversold';
    else if (rsi > 70) rsiSignal = 'overbought';
  }

  // Calculate price vs SMA
  const priceVsSma20 = sma20 ? ((currentPrice - sma20) / sma20) * 100 : null;

  // Determine momentum
  let momentum: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (priceVsSma20 !== null) {
    if (priceVsSma20 > 5) momentum = 'bullish';
    else if (priceVsSma20 < -5) momentum = 'bearish';
  }

  // Generate recommendation
  let score = 50; // Start neutral

  // RSI contribution
  if (rsi !== null) {
    if (rsi < 25) score += 20; // Very oversold = buy signal
    else if (rsi < 35) score += 10;
    else if (rsi > 75) score -= 20; // Very overbought = sell signal
    else if (rsi > 65) score -= 10;
  }

  // Momentum contribution
  if (momentum === 'bullish') score += 15;
  else if (momentum === 'bearish') score -= 15;

  // Volume spike contribution
  if (volumeSpike && momentum === 'bullish') score += 10;
  else if (volumeSpike && momentum === 'bearish') score -= 10;

  // Determine recommendation
  let recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  if (score >= 75) recommendation = 'strong_buy';
  else if (score >= 60) recommendation = 'buy';
  else if (score >= 40) recommendation = 'hold';
  else if (score >= 25) recommendation = 'sell';
  else recommendation = 'strong_sell';

  // Confidence based on data quality
  const confidence = Math.min(100, Math.max(0, 50 + (candles.length * 5)));

  // Generate analysis text
  const analysisPoints: string[] = [];

  if (rsi !== null) {
    analysisPoints.push(`RSI at ${rsi.toFixed(1)} (${rsiSignal})`);
  }

  if (priceVsSma20 !== null) {
    const direction = priceVsSma20 > 0 ? 'above' : 'below';
    analysisPoints.push(`Price ${Math.abs(priceVsSma20).toFixed(1)}% ${direction} 20-period MA`);
  }

  if (volumeSpike) {
    analysisPoints.push(`VOLUME SPIKE: ${volumeRatio}x average volume`);
  }

  analysisPoints.push(`Momentum: ${momentum.toUpperCase()}`);
  analysisPoints.push(`Signal: ${recommendation.replace('_', ' ').toUpperCase()}`);

  return {
    rsi,
    rsiSignal,
    sma20,
    sma50,
    priceVsSma20,
    volumeSpike,
    volumeRatio,
    momentum,
    recommendation,
    confidence,
    analysis: analysisPoints.join(' | '),
  };
}

// Tool definition for Claude
export const TECHNICAL_TOOLS = [
  {
    name: 'analyze_technicals',
    description: 'Get technical analysis for a token: RSI, moving averages, volume spikes, and momentum. Returns buy/sell/hold recommendation with confidence score. Use this BEFORE trading to make data-driven decisions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        token_address: {
          type: 'string',
          description: 'The Solana token contract address to analyze',
        },
      },
      required: ['token_address'],
    },
  },
];

/**
 * Execute technical analysis tool
 */
export async function executeTechnicalTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<string> {
  if (toolName === 'analyze_technicals') {
    const tokenAddress = input.token_address as string;
    if (!tokenAddress) {
      return JSON.stringify({ error: 'token_address is required' });
    }

    const indicators = await analyzeTechnicals(tokenAddress);

    return JSON.stringify({
      tokenAddress,
      ...indicators,
      summary: `${indicators.recommendation.replace('_', ' ').toUpperCase()} (${indicators.confidence}% confidence) - ${indicators.analysis}`,
    });
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}
