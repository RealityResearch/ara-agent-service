// Trading Tools for Claude
// These tools are exposed to Claude via Anthropic's tool_use feature

import { SolanaWallet, TradeResult, SwapQuote } from './wallet.js';
import { getTokenData, formatPrice, formatUSD, getSolPrice } from './market.js';
import { AgentStateManager } from '../state.js';
import { PositionManager, getTokenByAddress, isKnownTradable, formatTokenListForAgent } from './tokens.js';

// Contract address is optional - agent discovers tokens dynamically
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// DexScreener API for price lookups
const DEXSCREENER_API = 'https://api.dexscreener.com';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

// Tool definitions for Claude
export const TRADING_TOOLS: ToolDefinition[] = [
  {
    name: 'check_balance',
    description: 'Check your SOL balance and all token positions in the wallet',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_price',
    description: 'Get price and market data for any Solana token by contract address',
    input_schema: {
      type: 'object',
      properties: {
        token_address: {
          type: 'string',
          description: 'The token contract address (mint) to get price for',
        },
      },
      required: ['token_address'],
    },
  },
  {
    name: 'get_swap_quote',
    description: 'Get a quote for buying/selling any token. Always call this before execute_trade.',
    input_schema: {
      type: 'object',
      properties: {
        token_address: {
          type: 'string',
          description: 'The token contract address (mint) to trade',
        },
        direction: {
          type: 'string',
          enum: ['buy', 'sell'],
          description: 'buy = SOL to token, sell = token to SOL',
        },
        amount: {
          type: 'number',
          description: 'Amount in SOL (for buy) or number of tokens (for sell)',
        },
      },
      required: ['token_address', 'direction', 'amount'],
    },
  },
  {
    name: 'execute_trade',
    description: 'Execute a swap trade. REAL MONEY! Always get quote first. Max 15% of portfolio.',
    input_schema: {
      type: 'object',
      properties: {
        token_address: {
          type: 'string',
          description: 'The token contract address (mint) to trade',
        },
        direction: {
          type: 'string',
          enum: ['buy', 'sell'],
          description: 'buy = SOL to token, sell = token to SOL',
        },
        amount: {
          type: 'number',
          description: 'Amount in SOL (for buy) or number of tokens (for sell)',
        },
        reasoning: {
          type: 'string',
          description: 'Your reasoning for this trade (will be logged)',
        },
      },
      required: ['token_address', 'direction', 'amount', 'reasoning'],
    },
  },
  {
    name: 'check_can_trade',
    description: 'Check if trading is currently allowed (cooldown, daily limits, etc)',
    input_schema: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Amount in SOL to check',
        },
      },
      required: ['amount'],
    },
  },
  {
    name: 'check_token_tradable',
    description: 'Check if a token can be traded on Jupiter. ALWAYS call this before execute_trade! Pump.fun tokens may not be tradable until they graduate.',
    input_schema: {
      type: 'object',
      properties: {
        token_address: {
          type: 'string',
          description: 'The token contract address to check',
        },
      },
      required: ['token_address'],
    },
  },
  {
    name: 'get_positions',
    description: 'Get all open positions with current P&L, stop loss, and take profit levels',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'check_stop_loss_take_profit',
    description: 'Check if any positions have hit stop loss or take profit. Call this regularly to manage risk!',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'set_stop_loss',
    description: 'Update stop loss percentage for a position',
    input_schema: {
      type: 'object',
      properties: {
        token_address: {
          type: 'string',
          description: 'Token address of the position',
        },
        stop_loss_percent: {
          type: 'number',
          description: 'Stop loss percentage below entry price (e.g., 15 for 15% below)',
        },
      },
      required: ['token_address', 'stop_loss_percent'],
    },
  },
  {
    name: 'set_take_profit',
    description: 'Update take profit percentage for a position',
    input_schema: {
      type: 'object',
      properties: {
        token_address: {
          type: 'string',
          description: 'Token address of the position',
        },
        take_profit_percent: {
          type: 'number',
          description: 'Take profit percentage above entry price (e.g., 50 for 50% above)',
        },
      },
      required: ['token_address', 'take_profit_percent'],
    },
  },
];

// Tool executor class
export class TradingToolExecutor {
  private wallet: SolanaWallet;
  private stateManager: AgentStateManager | null;
  private positionManager: PositionManager;

  constructor(wallet: SolanaWallet, stateManager?: AgentStateManager, positionManager?: PositionManager) {
    this.wallet = wallet;
    this.stateManager = stateManager || null;
    this.positionManager = positionManager || new PositionManager(15, 50); // 15% SL, 50% TP
  }

  getPositionManager(): PositionManager {
    return this.positionManager;
  }

  async execute(toolName: string, input: Record<string, unknown>): Promise<string> {
    switch (toolName) {
      case 'check_balance':
        return this.checkBalance();
      case 'get_price':
        return this.getPrice(input.token_address as string);
      case 'get_swap_quote':
        return this.getSwapQuote(
          input.token_address as string,
          input.direction as string,
          input.amount as number
        );
      case 'execute_trade':
        return this.executeTrade(
          input.token_address as string,
          input.direction as string,
          input.amount as number,
          input.reasoning as string
        );
      case 'check_can_trade':
        return this.checkCanTrade(input.amount as number);
      case 'check_token_tradable':
        return this.checkTokenTradable(input.token_address as string);
      case 'get_positions':
        return this.getPositions();
      case 'check_stop_loss_take_profit':
        return this.checkStopLossTakeProfit();
      case 'set_stop_loss':
        return this.setStopLoss(input.token_address as string, input.stop_loss_percent as number);
      case 'set_take_profit':
        return this.setTakeProfit(input.token_address as string, input.take_profit_percent as number);
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  }

  private async checkBalance(): Promise<string> {
    const solBalance = await this.wallet.getSolBalance();

    // Get all token accounts the wallet holds
    const tokenPositions = await this.wallet.getAllTokenBalances();

    return JSON.stringify({
      sol: {
        balance: solBalance.toFixed(4),
        usdValue: formatUSD(solBalance * 140), // Approximate SOL price
      },
      positions: tokenPositions,
      totalPositions: tokenPositions.length,
      walletAddress: this.wallet.getPublicKey(),
      note: 'Use get_price with token_address to check specific token values',
    });
  }

  private async getPrice(tokenAddress: string): Promise<string> {
    if (!tokenAddress) {
      return JSON.stringify({ error: 'token_address is required' });
    }

    try {
      // Fetch from DexScreener
      const response = await fetch(
        `https://api.dexscreener.com/tokens/v1/solana/${tokenAddress}`,
        { headers: { 'Accept': 'application/json' } }
      );

      if (!response.ok) {
        return JSON.stringify({ error: 'Failed to fetch token data' });
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        return JSON.stringify({ error: 'Token not found on DexScreener' });
      }

      const pair = data[0];
      return JSON.stringify({
        token: pair.baseToken?.symbol || 'Unknown',
        address: tokenAddress,
        price: pair.priceUsd || '0',
        change24h: `${pair.priceChange?.h24 > 0 ? '+' : ''}${(pair.priceChange?.h24 || 0).toFixed(2)}%`,
        volume24h: formatUSD(pair.volume?.h24 || 0),
        liquidity: formatUSD(pair.liquidity?.usd || 0),
        marketCap: formatUSD(pair.marketCap || 0),
      });
    } catch (error) {
      return JSON.stringify({ error: `Failed to get price: ${error}` });
    }
  }

  private async getSwapQuote(tokenAddress: string, direction: string, amount: number): Promise<string> {
    if (!tokenAddress) {
      return JSON.stringify({ error: 'token_address is required' });
    }

    const inputMint = direction === 'buy' ? SOL_MINT : tokenAddress;
    const outputMint = direction === 'buy' ? tokenAddress : SOL_MINT;

    // Convert to lamports (assuming SOL input for now)
    const amountLamports = Math.floor(amount * 1e9);

    const quote = await this.wallet.getSwapQuote(inputMint, outputMint, amountLamports);

    if (!quote) {
      return JSON.stringify({ error: 'Failed to get quote' });
    }

    return JSON.stringify({
      direction,
      inputAmount: amount,
      outputAmount: quote.outAmount,
      priceImpact: `${quote.priceImpactPct.toFixed(2)}%`,
      slippage: `${quote.slippageBps / 100}%`,
      warning: quote.priceImpactPct > 1 ? '⚠️ High price impact!' : null,
    });
  }

  private async checkCanTrade(amount: number): Promise<string> {
    const result = this.wallet.canTrade(amount);
    const stats = this.wallet.getStats();

    return JSON.stringify({
      allowed: result.allowed,
      reason: result.reason,
      dailyPnl: `${stats.dailyPnl.toFixed(4)} SOL`,
      lastTradeTime: stats.lastTradeTime > 0
        ? new Date(stats.lastTradeTime).toISOString()
        : 'Never',
      limits: {
        maxTradeSize: `${stats.config.maxTradeSize} SOL`,
        cooldown: `${stats.config.cooldownMs / 1000}s`,
        dailyLossLimit: `${stats.config.dailyLossLimit} SOL`,
      },
    });
  }

  private async checkTokenTradable(tokenAddress: string): Promise<string> {
    if (!tokenAddress) {
      return JSON.stringify({ error: 'token_address is required' });
    }

    const result = await this.wallet.isTokenTradable(tokenAddress);

    // Also check if it's a pump.fun token
    const isPumpFun = tokenAddress.toLowerCase().endsWith('pump');

    return JSON.stringify({
      tokenAddress,
      tradable: result.tradable,
      reason: result.reason || (result.tradable ? 'Token is tradable on Jupiter' : 'Unknown issue'),
      isPumpFunToken: isPumpFun,
      warning: isPumpFun
        ? '⚠️ Pump.fun token - may have Token-2022 routing issues. Prefer graduated tokens.'
        : null,
      recommendation: result.tradable
        ? 'You can proceed with trading this token.'
        : 'DO NOT attempt to trade this token. Find an alternative.',
    });
  }

  private async executeTrade(
    tokenAddress: string,
    direction: string,
    amount: number,
    reasoning: string
  ): Promise<string> {
    if (!tokenAddress) {
      return JSON.stringify({ error: 'token_address is required' });
    }

    console.log(`🔄 Trade request: ${direction} ${amount} SOL for ${tokenAddress.slice(0, 8)}... | Reason: ${reasoning}`);

    // Check if token is tradable on Jupiter FIRST
    const tradabilityCheck = await this.wallet.isTokenTradable(tokenAddress);
    if (!tradabilityCheck.tradable) {
      console.log(`⚠️ Token not tradable: ${tradabilityCheck.reason}`);
      return JSON.stringify({
        success: false,
        error: `TOKEN_NOT_TRADABLE: ${tradabilityCheck.reason}. Find a different token - this one won't work on Jupiter.`,
        tip: 'Use discover_tokens to find alternatives, then check_token_tradable before trying again.',
      });
    }

    // Extra safety check
    const canTrade = this.wallet.canTrade(amount);
    if (!canTrade.allowed) {
      return JSON.stringify({
        success: false,
        error: canTrade.reason,
      });
    }

    let result: TradeResult;

    if (direction === 'buy') {
      result = await this.wallet.buyToken(tokenAddress, amount);
    } else {
      // For selling, amount is in tokens
      result = await this.wallet.sellToken(tokenAddress, amount);
    }

    // Get token info for recording
    let tokenSymbol = tokenAddress.slice(0, 6);
    let tokenPrice = 0;
    try {
      const response = await fetch(
        `https://api.dexscreener.com/tokens/v1/solana/${tokenAddress}`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          tokenSymbol = data[0].baseToken?.symbol || tokenSymbol;
          tokenPrice = parseFloat(data[0].priceUsd || '0');
        }
      }
    } catch {}

    // Record trade in state manager
    if (this.stateManager && result.success) {
      this.stateManager.recordTrade({
        timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
        date: new Date().toISOString().split('T')[0],
        token: tokenAddress,
        tokenSymbol,
        direction: direction.toUpperCase() as 'BUY' | 'SELL',
        entryPrice: tokenPrice,
        exitPrice: null,
        amountSol: amount,
        pnlSol: 0,
        pnlPercent: 0,
        holdTime: '—',
        status: 'open',
        result: 'open',
        txHash: result.txHash || 'unknown',
        reasoning,
      });
    }

    // Track position for stop loss / take profit
    if (result.success && direction === 'buy') {
      this.positionManager.openPosition(
        tokenAddress,
        tokenSymbol,
        result.outputAmount || 0,
        tokenPrice,
        amount // SOL cost basis
      );
    } else if (result.success && direction === 'sell') {
      // Close the position
      this.positionManager.closePosition(tokenAddress, tokenPrice, result.outputAmount || 0);
    }

    if (result.success) {
      const position = this.positionManager.getPosition(tokenAddress);
      return JSON.stringify({
        success: true,
        txHash: result.txHash,
        inputAmount: result.inputAmount,
        outputAmount: result.outputAmount,
        priceImpact: result.priceImpact ? `${result.priceImpact.toFixed(2)}%` : null,
        message: `Trade executed! TX: ${result.txHash}`,
        explorerUrl: `https://solscan.io/tx/${result.txHash}`,
        position: position ? {
          stopLoss: position.stopLoss?.toFixed(8),
          takeProfit: position.takeProfit?.toFixed(8),
        } : null,
      });
    } else {
      return JSON.stringify({
        success: false,
        error: result.error,
        message: `Trade failed: ${result.error}`,
      });
    }
  }

  // === Position Management Methods ===

  private async getPositions(): Promise<string> {
    const positions = this.positionManager.getAllPositions();

    if (positions.length === 0) {
      return JSON.stringify({
        positions: [],
        message: 'No open positions',
        tip: 'Use execute_trade to open a position',
      });
    }

    // Update current prices for all positions
    const updatedPositions = await Promise.all(
      positions.map(async (pos) => {
        try {
          const response = await fetch(
            `${DEXSCREENER_API}/tokens/v1/solana/${pos.tokenAddress}`,
            { headers: { 'Accept': 'application/json' } }
          );
          if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
              const currentPrice = parseFloat(data[0].priceUsd || '0');
              this.positionManager.updatePrice(pos.tokenAddress, currentPrice);
              return {
                ...pos,
                currentPrice,
                unrealizedPnlPercent: ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100,
              };
            }
          }
        } catch {}
        return pos;
      })
    );

    return JSON.stringify({
      positions: updatedPositions.map(p => ({
        token: p.tokenSymbol,
        address: p.tokenAddress,
        entryPrice: `$${p.entryPrice.toFixed(8)}`,
        currentPrice: p.currentPrice ? `$${p.currentPrice.toFixed(8)}` : 'unknown',
        costBasis: `${p.costBasis.toFixed(4)} SOL`,
        pnlPercent: p.unrealizedPnlPercent ? `${p.unrealizedPnlPercent >= 0 ? '+' : ''}${p.unrealizedPnlPercent.toFixed(2)}%` : '--',
        stopLoss: p.stopLoss ? `$${p.stopLoss.toFixed(8)}` : 'not set',
        takeProfit: p.takeProfit ? `$${p.takeProfit.toFixed(8)}` : 'not set',
        holdTime: this.formatHoldTime(Date.now() - p.entryTime),
      })),
      totalPositions: positions.length,
    });
  }

  private async checkStopLossTakeProfit(): Promise<string> {
    const positions = this.positionManager.getAllPositions();
    const triggers: { token: string; reason: string; action: string }[] = [];

    for (const pos of positions) {
      try {
        const response = await fetch(
          `${DEXSCREENER_API}/tokens/v1/solana/${pos.tokenAddress}`,
          { headers: { 'Accept': 'application/json' } }
        );

        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            const currentPrice = parseFloat(data[0].priceUsd || '0');
            const result = this.positionManager.updatePrice(pos.tokenAddress, currentPrice);

            if (result.shouldSell) {
              triggers.push({
                token: pos.tokenSymbol,
                reason: result.reason === 'stop_loss' ? '🛑 STOP LOSS HIT' : '🎯 TAKE PROFIT HIT',
                action: `SELL ${pos.amount.toLocaleString()} ${pos.tokenSymbol} NOW!`,
              });
            }
          }
        }
      } catch {}

      // Rate limit
      await new Promise(r => setTimeout(r, 100));
    }

    if (triggers.length > 0) {
      return JSON.stringify({
        alert: true,
        triggers,
        message: '⚠️ ACTION REQUIRED: Positions have hit stop loss or take profit!',
        instruction: 'Execute sell trades immediately to lock in gains or cut losses.',
      });
    }

    return JSON.stringify({
      alert: false,
      message: 'All positions within safe range',
      positionsChecked: positions.length,
    });
  }

  private setStopLoss(tokenAddress: string, stopLossPercent: number): string {
    const position = this.positionManager.getPosition(tokenAddress);
    if (!position) {
      return JSON.stringify({ error: 'No position found for this token' });
    }

    const newStopLoss = position.entryPrice * (1 - stopLossPercent / 100);
    position.stopLoss = newStopLoss;

    return JSON.stringify({
      success: true,
      token: position.tokenSymbol,
      entryPrice: `$${position.entryPrice.toFixed(8)}`,
      newStopLoss: `$${newStopLoss.toFixed(8)}`,
      percentBelowEntry: `${stopLossPercent}%`,
    });
  }

  private setTakeProfit(tokenAddress: string, takeProfitPercent: number): string {
    const position = this.positionManager.getPosition(tokenAddress);
    if (!position) {
      return JSON.stringify({ error: 'No position found for this token' });
    }

    const newTakeProfit = position.entryPrice * (1 + takeProfitPercent / 100);
    position.takeProfit = newTakeProfit;

    return JSON.stringify({
      success: true,
      token: position.tokenSymbol,
      entryPrice: `$${position.entryPrice.toFixed(8)}`,
      newTakeProfit: `$${newTakeProfit.toFixed(8)}`,
      percentAboveEntry: `${takeProfitPercent}%`,
    });
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
}
