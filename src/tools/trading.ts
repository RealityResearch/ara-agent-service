// Trading Tools for Claude
// These tools are exposed to Claude via Anthropic's tool_use feature

import { SolanaWallet, TradeResult, SwapQuote } from './wallet.js';
import { getTokenData, formatPrice, formatUSD } from './market.js';
import { AgentStateManager } from '../state.js';

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '5X61PKDGt6Fjg6hRxyFiaN61CDToHEeE2gJhDgL9pump';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

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
    description: 'Check the current SOL and token balance in the trading wallet',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_price',
    description: 'Get the current price and market data for $ARA token',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_swap_quote',
    description: 'Get a quote for swapping SOL to $ARA or vice versa without executing',
    input_schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['buy', 'sell'],
          description: 'buy = SOL to $ARA, sell = $ARA to SOL',
        },
        amount: {
          type: 'number',
          description: 'Amount in SOL (for buy) or number of tokens (for sell)',
        },
      },
      required: ['direction', 'amount'],
    },
  },
  {
    name: 'execute_trade',
    description: 'Execute a swap trade. Use with caution - this spends real money! Always check balance and quote first.',
    input_schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['buy', 'sell'],
          description: 'buy = SOL to $ARA, sell = $ARA to SOL',
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
      required: ['direction', 'amount', 'reasoning'],
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
];

// Tool executor class
export class TradingToolExecutor {
  private wallet: SolanaWallet;
  private stateManager: AgentStateManager | null;

  constructor(wallet: SolanaWallet, stateManager?: AgentStateManager) {
    this.wallet = wallet;
    this.stateManager = stateManager || null;
  }

  async execute(toolName: string, input: Record<string, unknown>): Promise<string> {
    switch (toolName) {
      case 'check_balance':
        return this.checkBalance();
      case 'get_price':
        return this.getPrice();
      case 'get_swap_quote':
        return this.getSwapQuote(input.direction as string, input.amount as number);
      case 'execute_trade':
        return this.executeTrade(
          input.direction as string,
          input.amount as number,
          input.reasoning as string
        );
      case 'check_can_trade':
        return this.checkCanTrade(input.amount as number);
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  }

  private async checkBalance(): Promise<string> {
    const solBalance = await this.wallet.getSolBalance();
    const araBalance = await this.wallet.getTokenBalance(CONTRACT_ADDRESS);
    const tokenData = await getTokenData();

    const araValue = araBalance * tokenData.price;

    return JSON.stringify({
      sol: {
        balance: solBalance.toFixed(4),
        usdValue: formatUSD(solBalance * 140), // Approximate SOL price
      },
      ara: {
        balance: araBalance.toLocaleString(),
        usdValue: formatUSD(araValue),
      },
      totalUsdValue: formatUSD(solBalance * 140 + araValue),
      walletAddress: this.wallet.getPublicKey(),
    });
  }

  private async getPrice(): Promise<string> {
    const tokenData = await getTokenData();

    return JSON.stringify({
      price: formatPrice(tokenData.price),
      change24h: `${tokenData.priceChange24h > 0 ? '+' : ''}${tokenData.priceChange24h.toFixed(2)}%`,
      volume24h: formatUSD(tokenData.volume24h),
      marketCap: formatUSD(tokenData.marketCap),
      holders: tokenData.holders,
    });
  }

  private async getSwapQuote(direction: string, amount: number): Promise<string> {
    const inputMint = direction === 'buy' ? SOL_MINT : CONTRACT_ADDRESS;
    const outputMint = direction === 'buy' ? CONTRACT_ADDRESS : SOL_MINT;

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

  private async executeTrade(
    direction: string,
    amount: number,
    reasoning: string
  ): Promise<string> {
    console.log(`🔄 Trade request: ${direction} ${amount} SOL | Reason: ${reasoning}`);

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
      result = await this.wallet.buyToken(CONTRACT_ADDRESS, amount);
    } else {
      // For selling, amount is in tokens - simplified for now
      result = await this.wallet.sellToken(CONTRACT_ADDRESS, amount);
    }

    // Record trade in state manager
    if (this.stateManager && result.success) {
      const tokenData = await getTokenData();

      this.stateManager.recordTrade({
        timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
        date: new Date().toISOString().split('T')[0],
        token: '$ARA',
        tokenSymbol: 'ARA',
        direction: direction.toUpperCase() as 'BUY' | 'SELL',
        entryPrice: tokenData.price,
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

    if (result.success) {
      return JSON.stringify({
        success: true,
        txHash: result.txHash,
        inputAmount: result.inputAmount,
        outputAmount: result.outputAmount,
        priceImpact: result.priceImpact ? `${result.priceImpact.toFixed(2)}%` : null,
        message: `Trade executed! TX: ${result.txHash}`,
        explorerUrl: `https://solscan.io/tx/${result.txHash}`,
      });
    } else {
      return JSON.stringify({
        success: false,
        error: result.error,
        message: `Trade failed: ${result.error}`,
      });
    }
  }
}
