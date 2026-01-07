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

// Network configuration
const USE_DEVNET = process.env.SOLANA_NETWORK === 'devnet';
const RPC_ENDPOINT = USE_DEVNET
  ? 'https://api.devnet.solana.com'
  : (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

// Jupiter API - use public API (has 0.2% fee) or provide your own key
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const JUPITER_API = JUPITER_API_KEY
  ? 'https://api.jup.ag/swap/v1'
  : 'https://lite-api.jup.ag/swap/v1'; // Use lite API (more reliable)

// Mock mode for devnet (Jupiter doesn't work on devnet)
const MOCK_SWAPS = USE_DEVNET;

// Token addresses
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Known problematic token patterns
const PUMP_FUN_SUFFIX = 'pump'; // Pump.fun tokens end with "pump"

export interface WalletConfig {
  maxTradeSize: number;      // Max SOL per trade
  maxPositions: number;      // Max concurrent positions
  stopLossPercent: number;   // Auto-sell threshold
  dailyLossLimit: number;    // Max daily loss in SOL
  cooldownMs: number;        // Min time between trades
}

export const DEFAULT_CONFIG: WalletConfig = {
  maxTradeSize: 0.5,         // 0.5 SOL max per trade (15% rule overrides this)
  maxPositions: 2,           // Max 2 open positions at once
  stopLossPercent: 20,       // 20% stop loss
  dailyLossLimit: 1,         // 1 SOL max daily loss (conservative with small portfolio)
  cooldownMs: 60000,         // 1 min cooldown between trades
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
    console.log(`🌐 Solana network: ${USE_DEVNET ? 'DEVNET' : 'MAINNET'}`);
    console.log(`   RPC: ${RPC_ENDPOINT}`);
    if (MOCK_SWAPS) {
      console.log('   ⚠️  Mock swaps enabled (Jupiter not available on devnet)');
    }
    this.loadWallet();
  }

  // Airdrop SOL (devnet only)
  async airdrop(amount: number = 1): Promise<boolean> {
    if (!USE_DEVNET) {
      console.error('❌ Airdrop only works on devnet!');
      return false;
    }
    if (!this.keypair) {
      console.error('❌ Wallet not loaded');
      return false;
    }

    try {
      console.log(`💸 Requesting ${amount} SOL airdrop...`);
      const signature = await this.connection.requestAirdrop(
        this.keypair.publicKey,
        amount * LAMPORTS_PER_SOL
      );
      await this.connection.confirmTransaction(signature, 'confirmed');
      const balance = await this.getSolBalance();
      console.log(`✅ Airdrop complete! Balance: ${balance.toFixed(4)} SOL`);
      return true;
    } catch (error) {
      console.error('❌ Airdrop failed:', error);
      return false;
    }
  }

  getNetwork(): string {
    return USE_DEVNET ? 'devnet' : 'mainnet';
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

  // Get all token positions the wallet holds
  async getAllTokenBalances(): Promise<Array<{ mint: string; symbol: string; balance: number }>> {
    if (!this.keypair) return [];

    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      const positions: Array<{ mint: string; symbol: string; balance: number }> = [];

      for (const account of tokenAccounts.value) {
        const info = account.account.data.parsed.info;
        const balance = parseFloat(info.tokenAmount?.uiAmountString || '0');

        // Only include tokens with non-zero balance
        if (balance > 0) {
          positions.push({
            mint: info.mint,
            symbol: info.mint.slice(0, 6) + '...', // Truncated address as symbol fallback
            balance,
          });
        }
      }

      return positions;
    } catch (error) {
      console.error('Error getting all token balances:', error);
      return [];
    }
  }

  // Check if a token is likely tradable on Jupiter
  async isTokenTradable(tokenMint: string): Promise<{ tradable: boolean; reason?: string }> {
    // Pump.fun tokens that haven't graduated won't work on Jupiter
    if (tokenMint.toLowerCase().endsWith(PUMP_FUN_SUFFIX)) {
      // Try to get a quote - if it fails, the token isn't tradable
      try {
        const testAmount = 10000000; // 0.01 SOL in lamports
        const quoteUrl = `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${tokenMint}&amount=${testAmount}&slippageBps=1000`;
        const response = await fetch(quoteUrl, {
          headers: { 'Accept': 'application/json' },
        });

        if (!response.ok) {
          return {
            tradable: false,
            reason: 'PUMP_FUN_NOT_GRADUATED: This pump.fun token may not have graduated to Jupiter yet.',
          };
        }

        const data = await response.json();
        if (data.error || !data.routePlan || data.routePlan.length === 0) {
          return {
            tradable: false,
            reason: 'NO_ROUTE: Jupiter cannot find a route for this token. It may not be liquid enough.',
          };
        }

        return { tradable: true };
      } catch (error) {
        return {
          tradable: false,
          reason: `QUOTE_FAILED: Could not verify token tradability: ${error}`,
        };
      }
    }

    // For non-pump.fun tokens, try a quick quote check
    try {
      const testAmount = 10000000; // 0.01 SOL in lamports
      const response = await fetch(
        `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${tokenMint}&amount=${testAmount}&slippageBps=500`,
        { headers: { 'Accept': 'application/json' } }
      );

      if (!response.ok) {
        return { tradable: false, reason: 'NO_JUPITER_ROUTE: Token not available on Jupiter.' };
      }

      return { tradable: true };
    } catch {
      return { tradable: true }; // Assume tradable if we can't check
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
    slippageBps: number = 500 // 5% default for memecoins
  ): Promise<SwapQuote | null> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (JUPITER_API_KEY) {
        headers['x-api-key'] = JUPITER_API_KEY;
      }

      const response = await fetch(
        `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`,
        { headers }
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
        priceImpactPct: parseFloat(data.priceImpactPct || '0'),
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
    slippageBps: number = 500 // 5% for memecoins
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

    // Mock swap for devnet testing
    if (MOCK_SWAPS) {
      return this.executeMockSwap(inputMint, outputMint, amountSol);
    }

    try {
      const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (JUPITER_API_KEY) {
        headers['x-api-key'] = JUPITER_API_KEY;
      }

      // Get quote
      const quoteResponse = await fetch(
        `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`,
        { headers }
      );

      if (!quoteResponse.ok) {
        const errorText = await quoteResponse.text();
        console.error('Quote error:', errorText);
        return {
          success: false,
          error: `Failed to get quote: ${errorText}`,
          inputAmount: amountSol,
        };
      }

      const quoteData = await quoteResponse.json();

      // Get swap transaction with memecoin-optimized settings
      const swapResponse = await fetch(`${JUPITER_API}/swap`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: this.keypair.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          // Memecoin trading optimizations
          dynamicComputeUnitLimit: true, // Auto-estimate compute units
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: 2000000, // 0.002 SOL max priority fee
              priorityLevel: 'veryHigh', // Fast execution for memecoins
            },
          },
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

    } catch (error: unknown) {
      console.error('Swap error:', error);

      // Parse specific error codes for better debugging
      let errorMsg = error instanceof Error ? error.message : 'Unknown error';

      // Check for common Jupiter/Solana error codes
      if (errorMsg.includes('0x177e') || errorMsg.includes('6014')) {
        errorMsg = 'TOKEN_PROGRAM_MISMATCH: This token may use Token-2022 program. Try a different token or wait for Jupiter support.';
      } else if (errorMsg.includes('0x1771') || errorMsg.includes('6001')) {
        errorMsg = 'SLIPPAGE_EXCEEDED: Price moved too much. Try increasing slippage or reducing amount.';
      } else if (errorMsg.includes('0x1772') || errorMsg.includes('6002')) {
        errorMsg = 'INSUFFICIENT_FUNDS: Not enough balance to complete swap.';
      } else if (errorMsg.includes('InsufficientFunds')) {
        errorMsg = 'INSUFFICIENT_SOL: Not enough SOL for transaction fees.';
      }

      return {
        success: false,
        error: errorMsg,
        inputAmount: amountSol,
      };
    }
  }

  // Mock swap for devnet testing (simulates Jupiter response)
  private async executeMockSwap(
    inputMint: string,
    outputMint: string,
    amountSol: number
  ): Promise<TradeResult> {
    console.log(`🧪 MOCK SWAP: ${amountSol} SOL (devnet mode)`);

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Generate fake output amount (simulate price)
    // For testing: 1 SOL ≈ 1,000,000 tokens (typical memecoin ratio)
    const mockPrice = 0.000001; // $0.000001 per token
    const outputAmount = inputMint === SOL_MINT
      ? amountSol / mockPrice  // Buying tokens
      : amountSol * mockPrice; // Selling tokens

    // Fake tx hash
    const mockTxHash = `MOCK_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // Update state
    this.lastTradeTime = Date.now();

    console.log(`✅ MOCK Swap: ${amountSol} → ${outputAmount.toLocaleString()} | TX: ${mockTxHash}`);

    return {
      success: true,
      txHash: mockTxHash,
      inputAmount: amountSol,
      outputAmount,
      priceImpact: 0.5 + Math.random() * 1, // Random 0.5-1.5%
    };
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
