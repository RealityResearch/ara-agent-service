// Solana Wallet Utilities
// Handles wallet loading, balance checking, and trade execution

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

// RPC endpoint - use Helius or other reliable RPC
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const JUPITER_API = 'https://quote-api.jup.ag/v6';

// Token addresses
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface WalletConfig {
  maxTradeSize: number;      // Max SOL per trade
  maxPositions: number;      // Max concurrent positions
  stopLossPercent: number;   // Auto-sell threshold
  dailyLossLimit: number;    // Max daily loss in SOL
  cooldownMs: number;        // Min time between trades
}

export const DEFAULT_CONFIG: WalletConfig = {
  maxTradeSize: 0.5,         // 0.5 SOL max per trade
  maxPositions: 3,
  stopLossPercent: 15,
  dailyLossLimit: 2,         // 2 SOL max daily loss
  cooldownMs: 300000,        // 5 min cooldown
};

export interface TokenBalance {
  mint: string;
  symbol: string;
  balance: number;
  usdValue: number;
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: number;
  outAmount: number;
  priceImpactPct: number;
  slippageBps: number;
}

export interface TradeResult {
  success: boolean;
  txHash?: string;
  error?: string;
  inputAmount: number;
  outputAmount?: number;
  priceImpact?: number;
}

export class SolanaWallet {
  private connection: Connection;
  private keypair: Keypair | null = null;
  private config: WalletConfig;
  private lastTradeTime: number = 0;
  private dailyPnl: number = 0;
  private dailyPnlResetTime: number = Date.now();

  constructor(config: Partial<WalletConfig> = {}) {
    this.connection = new Connection(RPC_ENDPOINT, 'confirmed');
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadWallet();
  }

  private loadWallet(): void {
    const privateKey = process.env.SOLANA_PRIVATE_KEY;
    if (!privateKey) {
      console.log('⚠️  No SOLANA_PRIVATE_KEY set - wallet operations disabled');
      return;
    }

    try {
      // Support both base58 and JSON array formats
      if (privateKey.startsWith('[')) {
        const secretKey = Uint8Array.from(JSON.parse(privateKey));
        this.keypair = Keypair.fromSecretKey(secretKey);
      } else {
        const secretKey = bs58.decode(privateKey);
        this.keypair = Keypair.fromSecretKey(secretKey);
      }
      console.log(`✅ Wallet loaded: ${this.keypair.publicKey.toBase58()}`);
    } catch (error) {
      console.error('❌ Failed to load wallet:', error);
    }
  }

  isReady(): boolean {
    return this.keypair !== null;
  }

  getPublicKey(): string | null {
    return this.keypair?.publicKey.toBase58() || null;
  }

  async getSolBalance(): Promise<number> {
    if (!this.keypair) return 0;

    try {
      const balance = await this.connection.getBalance(this.keypair.publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error getting SOL balance:', error);
      return 0;
    }
  }

  async getTokenBalance(mintAddress: string): Promise<number> {
    if (!this.keypair) return 0;

    try {
      const mint = new PublicKey(mintAddress);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { mint }
      );

      if (tokenAccounts.value.length === 0) return 0;

      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
      return parseFloat(balance.uiAmountString || '0');
    } catch (error) {
      console.error('Error getting token balance:', error);
      return 0;
    }
  }

  // Check if trade is allowed by safety rules
  canTrade(amountSol: number): { allowed: boolean; reason?: string } {
    // Check wallet loaded
    if (!this.keypair) {
      return { allowed: false, reason: 'Wallet not loaded' };
    }

    // Check max trade size
    if (amountSol > this.config.maxTradeSize) {
      return { allowed: false, reason: `Amount ${amountSol} exceeds max ${this.config.maxTradeSize} SOL` };
    }

    // Check cooldown
    const timeSinceLastTrade = Date.now() - this.lastTradeTime;
    if (timeSinceLastTrade < this.config.cooldownMs) {
      const waitSecs = Math.ceil((this.config.cooldownMs - timeSinceLastTrade) / 1000);
      return { allowed: false, reason: `Cooldown active, wait ${waitSecs}s` };
    }

    // Check daily loss limit (reset at midnight UTC)
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (now - this.dailyPnlResetTime > dayMs) {
      this.dailyPnl = 0;
      this.dailyPnlResetTime = now;
    }

    if (this.dailyPnl < -this.config.dailyLossLimit) {
      return { allowed: false, reason: `Daily loss limit reached (${this.dailyPnl.toFixed(2)} SOL)` };
    }

    return { allowed: true };
  }

  async getSwapQuote(
    inputMint: string,
    outputMint: string,
    amountLamports: number,
    slippageBps: number = 100 // 1% default
  ): Promise<SwapQuote | null> {
    try {
      const response = await fetch(
        `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`
      );

      if (!response.ok) {
        console.error('Jupiter quote error:', await response.text());
        return null;
      }

      const data = await response.json();

      return {
        inputMint,
        outputMint,
        inAmount: parseInt(data.inAmount) / LAMPORTS_PER_SOL,
        outAmount: parseInt(data.outAmount) / (outputMint === USDC_MINT ? 1e6 : LAMPORTS_PER_SOL),
        priceImpactPct: parseFloat(data.priceImpactPct),
        slippageBps,
      };
    } catch (error) {
      console.error('Error getting swap quote:', error);
      return null;
    }
  }

  async executeSwap(
    inputMint: string,
    outputMint: string,
    amountSol: number,
    slippageBps: number = 100
  ): Promise<TradeResult> {
    // Safety check
    const canTradeResult = this.canTrade(amountSol);
    if (!canTradeResult.allowed) {
      return {
        success: false,
        error: canTradeResult.reason,
        inputAmount: amountSol,
      };
    }

    if (!this.keypair) {
      return {
        success: false,
        error: 'Wallet not loaded',
        inputAmount: amountSol,
      };
    }

    try {
      const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

      // Get quote
      const quoteResponse = await fetch(
        `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`
      );

      if (!quoteResponse.ok) {
        return {
          success: false,
          error: 'Failed to get quote',
          inputAmount: amountSol,
        };
      }

      const quoteData = await quoteResponse.json();

      // Get swap transaction
      const swapResponse = await fetch(`${JUPITER_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: this.keypair.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        }),
      });

      if (!swapResponse.ok) {
        return {
          success: false,
          error: 'Failed to get swap transaction',
          inputAmount: amountSol,
        };
      }

      const swapData = await swapResponse.json();

      // Deserialize and sign transaction
      const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      // Sign
      transaction.sign([this.keypair]);

      // Send
      const txHash = await this.connection.sendTransaction(transaction, {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Confirm
      const confirmation = await this.connection.confirmTransaction(txHash, 'confirmed');

      if (confirmation.value.err) {
        return {
          success: false,
          error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
          inputAmount: amountSol,
          txHash,
        };
      }

      // Update state
      this.lastTradeTime = Date.now();
      const outputAmount = parseInt(quoteData.outAmount) / (outputMint === USDC_MINT ? 1e6 : LAMPORTS_PER_SOL);

      console.log(`✅ Swap executed: ${amountSol} SOL → ${outputAmount} | TX: ${txHash}`);

      return {
        success: true,
        txHash,
        inputAmount: amountSol,
        outputAmount,
        priceImpact: parseFloat(quoteData.priceImpactPct),
      };

    } catch (error) {
      console.error('Swap error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        inputAmount: amountSol,
      };
    }
  }

  // Convenience methods
  async buyToken(tokenMint: string, solAmount: number): Promise<TradeResult> {
    return this.executeSwap(SOL_MINT, tokenMint, solAmount);
  }

  async sellToken(tokenMint: string, tokenAmount: number): Promise<TradeResult> {
    // For selling tokens, we need the amount in token's native units
    // This is a simplified version - production would need proper decimal handling
    return this.executeSwap(tokenMint, SOL_MINT, tokenAmount);
  }

  updateDailyPnl(pnlSol: number): void {
    this.dailyPnl += pnlSol;
  }

  getStats(): {
    publicKey: string | null;
    dailyPnl: number;
    lastTradeTime: number;
    config: WalletConfig;
  } {
    return {
      publicKey: this.getPublicKey(),
      dailyPnl: this.dailyPnl,
      lastTradeTime: this.lastTradeTime,
      config: this.config,
    };
  }
}
