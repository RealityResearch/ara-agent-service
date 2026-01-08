// Token Registry - Known tradable tokens and position tracking
// These are established Solana tokens that work reliably with Jupiter

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Get directory for data persistence
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', '..', 'data');
const POSITIONS_FILE = join(DATA_DIR, 'positions.json');

export interface KnownToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  category: 'blue_chip' | 'memecoin' | 'defi' | 'ai' | 'gaming';
  volatility: 'low' | 'medium' | 'high' | 'extreme';
  tradable: true; // All tokens here are verified tradable on Jupiter
}

// Hardcoded tokens verified to work on Jupiter (no Token-2022 issues)
export const KNOWN_TOKENS: Record<string, KnownToken> = {
  // === Blue Chips ===
  SOL: {
    address: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    name: 'Wrapped SOL',
    decimals: 9,
    category: 'blue_chip',
    volatility: 'medium',
    tradable: true,
  },
  USDC: {
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    category: 'blue_chip',
    volatility: 'low',
    tradable: true,
  },
  USDT: {
    address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    category: 'blue_chip',
    volatility: 'low',
    tradable: true,
  },

  // === DeFi Tokens ===
  JUP: {
    address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: 'JUP',
    name: 'Jupiter',
    decimals: 6,
    category: 'defi',
    volatility: 'medium',
    tradable: true,
  },
  RAY: {
    address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    symbol: 'RAY',
    name: 'Raydium',
    decimals: 6,
    category: 'defi',
    volatility: 'medium',
    tradable: true,
  },
  ORCA: {
    address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
    symbol: 'ORCA',
    name: 'Orca',
    decimals: 6,
    category: 'defi',
    volatility: 'medium',
    tradable: true,
  },
  PYTH: {
    address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    symbol: 'PYTH',
    name: 'Pyth Network',
    decimals: 6,
    category: 'defi',
    volatility: 'medium',
    tradable: true,
  },
  JTO: {
    address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
    symbol: 'JTO',
    name: 'Jito',
    decimals: 9,
    category: 'defi',
    volatility: 'medium',
    tradable: true,
  },

  // === Top Memecoins (Established, High Liquidity) ===
  BONK: {
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk',
    decimals: 5,
    category: 'memecoin',
    volatility: 'high',
    tradable: true,
  },
  WIF: {
    address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    symbol: 'WIF',
    name: 'dogwifhat',
    decimals: 6,
    category: 'memecoin',
    volatility: 'extreme',
    tradable: true,
  },
  POPCAT: {
    address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    symbol: 'POPCAT',
    name: 'Popcat',
    decimals: 9,
    category: 'memecoin',
    volatility: 'extreme',
    tradable: true,
  },
  MEW: {
    address: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',
    symbol: 'MEW',
    name: 'cat in a dogs world',
    decimals: 5,
    category: 'memecoin',
    volatility: 'extreme',
    tradable: true,
  },
  PNUT: {
    address: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump',
    symbol: 'PNUT',
    name: 'Peanut the Squirrel',
    decimals: 6,
    category: 'memecoin',
    volatility: 'extreme',
    tradable: true,
  },
  FARTCOIN: {
    address: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
    symbol: 'FARTCOIN',
    name: 'Fartcoin',
    decimals: 6,
    category: 'memecoin',
    volatility: 'extreme',
    tradable: true,
  },
  GOAT: {
    address: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump',
    symbol: 'GOAT',
    name: 'Goatseus Maximus',
    decimals: 6,
    category: 'memecoin',
    volatility: 'extreme',
    tradable: true,
  },
  CHILLGUY: {
    address: 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump',
    symbol: 'CHILLGUY',
    name: 'Just a chill guy',
    decimals: 6,
    category: 'memecoin',
    volatility: 'extreme',
    tradable: true,
  },
  MOODENG: {
    address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY',
    symbol: 'MOODENG',
    name: 'Moo Deng',
    decimals: 6,
    category: 'memecoin',
    volatility: 'extreme',
    tradable: true,
  },

  // === AI Tokens ===
  AI16Z: {
    address: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC',
    symbol: 'AI16Z',
    name: 'ai16z',
    decimals: 9,
    category: 'ai',
    volatility: 'extreme',
    tradable: true,
  },
  GRIFFAIN: {
    address: 'KENJSUYLASHUMfHyy5o4Hp2FdNqZg1AsUPhfH2kYvEP',
    symbol: 'GRIFFAIN',
    name: 'Griffain',
    decimals: 9,
    category: 'ai',
    volatility: 'extreme',
    tradable: true,
  },
  ZEREBRO: {
    address: 'ZEREBRO3x5ARzEkYqFfWjfLRVT58qKZkb9MDuMkpump',
    symbol: 'ZEREBRO',
    name: 'Zerebro',
    decimals: 6,
    category: 'ai',
    volatility: 'extreme',
    tradable: true,
  },
};

// Get token by symbol (case insensitive)
export function getTokenBySymbol(symbol: string): KnownToken | null {
  const upper = symbol.toUpperCase();
  return KNOWN_TOKENS[upper] || null;
}

// Get token by address
export function getTokenByAddress(address: string): KnownToken | null {
  for (const token of Object.values(KNOWN_TOKENS)) {
    if (token.address === address) return token;
  }
  return null;
}

// Check if address is a known tradable token
export function isKnownTradable(address: string): boolean {
  return getTokenByAddress(address) !== null;
}

// Get all tokens in a category
export function getTokensByCategory(category: KnownToken['category']): KnownToken[] {
  return Object.values(KNOWN_TOKENS).filter(t => t.category === category);
}

// Get all memecoins for quick trading
export function getTradableMemecoins(): KnownToken[] {
  return Object.values(KNOWN_TOKENS).filter(
    t => t.category === 'memecoin' && t.tradable
  );
}

// === Position Tracking ===

export interface Position {
  tokenAddress: string;
  tokenSymbol: string;
  entryPrice: number;      // USD price at entry
  entryTime: number;       // Timestamp
  amount: number;          // Token amount held
  costBasis: number;       // SOL spent
  currentPrice?: number;   // Last known price
  unrealizedPnl?: number;  // Current P&L in SOL
  unrealizedPnlPercent?: number;
  stopLoss?: number;       // Price to auto-sell (% below entry)
  takeProfit?: number;     // Price to auto-sell (% above entry)
}

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private stopLossPercent: number;
  private takeProfitPercent: number;

  constructor(stopLoss: number = 15, takeProfit: number = 50) {
    this.stopLossPercent = stopLoss;
    this.takeProfitPercent = takeProfit;
    this.loadFromDisk();
  }

  // Load positions from disk
  private loadFromDisk(): void {
    try {
      if (existsSync(POSITIONS_FILE)) {
        const data = readFileSync(POSITIONS_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        if (parsed.positions) {
          for (const [addr, pos] of parsed.positions) {
            this.positions.set(addr, pos);
          }
          console.log(`📂 Loaded ${this.positions.size} positions from disk`);
        }
        if (parsed.stopLossPercent) this.stopLossPercent = parsed.stopLossPercent;
        if (parsed.takeProfitPercent) this.takeProfitPercent = parsed.takeProfitPercent;
      }
    } catch (error) {
      console.error('Failed to load positions from disk:', error);
    }
  }

  // Save positions to disk
  private saveToDisk(): void {
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
      }
      writeFileSync(POSITIONS_FILE, JSON.stringify(this.toJSON(), null, 2));
    } catch (error) {
      console.error('Failed to save positions to disk:', error);
    }
  }

  // Open a new position
  openPosition(
    tokenAddress: string,
    tokenSymbol: string,
    amount: number,
    entryPrice: number,
    costBasis: number
  ): Position {
    const position: Position = {
      tokenAddress,
      tokenSymbol,
      entryPrice,
      entryTime: Date.now(),
      amount,
      costBasis,
      stopLoss: entryPrice * (1 - this.stopLossPercent / 100),
      takeProfit: entryPrice * (1 + this.takeProfitPercent / 100),
    };

    this.positions.set(tokenAddress, position);
    console.log(`📈 Opened position: ${tokenSymbol} @ $${entryPrice.toFixed(8)}`);
    console.log(`   Stop Loss: $${position.stopLoss?.toFixed(8)} (-${this.stopLossPercent}%)`);
    console.log(`   Take Profit: $${position.takeProfit?.toFixed(8)} (+${this.takeProfitPercent}%)`);

    this.saveToDisk();
    return position;
  }

  // Close a position
  closePosition(tokenAddress: string, exitPrice: number, soldAmount: number): {
    pnlSol: number;
    pnlPercent: number;
    holdTime: string;
  } | null {
    const position = this.positions.get(tokenAddress);
    if (!position) return null;

    const exitValue = soldAmount; // SOL received
    const pnlSol = exitValue - position.costBasis;
    const pnlPercent = (pnlSol / position.costBasis) * 100;
    const holdTimeMs = Date.now() - position.entryTime;
    const holdTime = this.formatHoldTime(holdTimeMs);

    console.log(`📉 Closed position: ${position.tokenSymbol}`);
    console.log(`   P&L: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)`);
    console.log(`   Hold time: ${holdTime}`);

    this.positions.delete(tokenAddress);
    this.saveToDisk();

    return { pnlSol, pnlPercent, holdTime };
  }

  // Update price and check for stop loss / take profit triggers
  updatePrice(tokenAddress: string, currentPrice: number): {
    shouldSell: boolean;
    reason?: 'stop_loss' | 'take_profit';
    position?: Position;
  } {
    const position = this.positions.get(tokenAddress);
    if (!position) return { shouldSell: false };

    // Update position with current price
    position.currentPrice = currentPrice;
    position.unrealizedPnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    // Check stop loss
    if (position.stopLoss && currentPrice <= position.stopLoss) {
      console.log(`🛑 STOP LOSS TRIGGERED: ${position.tokenSymbol} @ $${currentPrice.toFixed(8)}`);
      return { shouldSell: true, reason: 'stop_loss', position };
    }

    // Check take profit
    if (position.takeProfit && currentPrice >= position.takeProfit) {
      console.log(`🎯 TAKE PROFIT TRIGGERED: ${position.tokenSymbol} @ $${currentPrice.toFixed(8)}`);
      return { shouldSell: true, reason: 'take_profit', position };
    }

    return { shouldSell: false, position };
  }

  // Get position by address
  getPosition(tokenAddress: string): Position | null {
    return this.positions.get(tokenAddress) || null;
  }

  // Get all open positions
  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  // Get position count
  getPositionCount(): number {
    return this.positions.size;
  }

  // Check if we have a position in a token
  hasPosition(tokenAddress: string): boolean {
    return this.positions.has(tokenAddress);
  }

  private formatHoldTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  // Serialize for persistence
  toJSON(): object {
    return {
      positions: Array.from(this.positions.entries()),
      stopLossPercent: this.stopLossPercent,
      takeProfitPercent: this.takeProfitPercent,
    };
  }

  // Load from persistence
  static fromJSON(data: any): PositionManager {
    const pm = new PositionManager(data.stopLossPercent, data.takeProfitPercent);
    if (data.positions) {
      for (const [addr, pos] of data.positions) {
        pm.positions.set(addr, pos);
      }
    }
    return pm;
  }
}

// Format token list for agent prompt
export function formatTokenListForAgent(): string {
  const memes = getTradableMemecoins();
  const defi = getTokensByCategory('defi');
  const ai = getTokensByCategory('ai');

  return `
## KNOWN TRADABLE TOKENS (Verified Jupiter Routes)

### Top Memecoins (High Vol, High Risk):
${memes.map(t => `- ${t.symbol}: ${t.address}`).join('\n')}

### DeFi Blue Chips:
${defi.map(t => `- ${t.symbol}: ${t.address}`).join('\n')}

### AI/Agent Tokens:
${ai.map(t => `- ${t.symbol}: ${t.address}`).join('\n')}

**TIP:** These tokens have verified Jupiter routes. For NEW tokens, always run check_token_tradable first!
`.trim();
}
