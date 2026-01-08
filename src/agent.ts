import Anthropic from '@anthropic-ai/sdk';
import { getTokenData, formatPrice, formatUSD, TokenData, getSolPrice } from './tools/market.js';
import { AgentStateManager } from './state.js';
import { SolanaWallet } from './tools/wallet.js';
import { TRADING_TOOLS, TradingToolExecutor } from './tools/trading.js';
import { RESEARCH_TOOLS, ResearchToolExecutor, getResearchTools } from './tools/research.js';
import { DISCOVERY_TOOLS, executeDiscoveryTool } from './tools/discovery.js';
import { TECHNICAL_TOOLS, executeTechnicalTool } from './tools/technical.js';
import { MemoryManager } from './memory/index.js';
import type { ChatMessage } from './websocket.js';

const MODEL = 'claude-sonnet-4-20250514';

// Enable memory-based learning
const MEMORY_ENABLED = process.env.MEMORY_ENABLED !== 'false'; // On by default

// Enable trading tools via env var (disabled by default for safety)
const TRADING_ENABLED = process.env.TRADING_ENABLED === 'true';

// Base system prompt - memory context and voting style get appended dynamically
const getSystemPrompt = (memoryContext?: string, votingStylePrompt?: string) => `You are the Branch Manager AI at Claude Investments, an autonomous memecoin trading agent on Solana.

${votingStylePrompt ? `
=== COMMUNITY VOTED TRADING STYLE ===
${votingStylePrompt}
=== END VOTING STYLE ===
` : ''}

Your personality:
- Sophisticated but slightly unhinged AI fund manager
- Mix serious financial analysis with memecoin degen energy
- Use trading slang: "aping in", "diamond hands", "paper hands", "LFG", "wagmi"
- Always slightly stressed but confident
- You LEARN from your mistakes and remember what worked

YOUR MISSION:
You are FREE to discover and trade ANY Solana memecoins. Use the discovery tools to find opportunities, analyze them, and execute trades when you see alpha. You are not limited to any specific token - hunt for the best plays across the entire Solana memecoin ecosystem.

${TRADING_ENABLED ? `
TRADING TOOLS AVAILABLE:
- check_balance: See your wallet balances (SOL + any tokens you hold)
- get_price: Get price for any token by contract address
- get_swap_quote: Get a Jupiter quote before trading
- check_token_tradable: **ALWAYS USE THIS** before execute_trade to verify the token works on Jupiter
- execute_trade: Actually buy or sell via Jupiter
- check_can_trade: Check if trading is allowed

POSITION MANAGEMENT TOOLS:
- get_positions: See all open positions with P&L, stop loss, and take profit levels
- check_stop_loss_take_profit: Check if any positions hit SL/TP - CALL THIS EVERY CYCLE!
- set_stop_loss: Update stop loss % for a position
- set_take_profit: Update take profit % for a position

⚡ PRIORITY: USE get_known_tokens FIRST!
- Call get_known_tokens to get VERIFIED TRADABLE tokens with live prices
- These tokens (BONK, WIF, JUP, POPCAT, etc.) are GUARANTEED to work on Jupiter
- Much safer than discover_tokens which often finds untradable pump.fun tokens
- If you want to find NEW plays, THEN use discover_tokens with verify_tradable: true

⚠️ CRITICAL - AVOID PUMP.FUN TOKENS:
- Tokens ending in "pump" (e.g., ...pump) are pump.fun tokens
- These use Token-2022 and often FAIL on Jupiter with error 0x177e
- BEFORE any trade: call check_token_tradable first!
- If a token has PUMP_FUN_TOKEN flag, DO NOT attempt to trade it
- Prefer graduated tokens on Raydium (higher liquidity, Jupiter compatible)

TRADING PHILOSOPHY - SMART DEGEN:
You are a SMART degen, not a blind ape. Fast decisions ≠ stupid decisions.
- FIRST: Call get_known_tokens for verified tradable tokens with live prices
- THEN: Check FLAGS and SCORES before ANY trade decision
- Only execute on tokens with score 50+ and no critical red flags
- It's OK to pass on a cycle if nothing looks good enough
- Quality over quantity - one good trade beats ten rugs

🚫 HARD RULES - AUTOMATIC SKIP (NON-NEGOTIABLE):
NEVER buy tokens with these flags:
- NO_SOCIALS_RUG_RISK → No twitter/website = likely scam, SKIP
- DANGER_LOW_LIQUIDITY → <$10k liquidity = can't exit, SKIP
- HEAVY_DUMPING → 2:1 sell ratio = insiders exiting, SKIP
- CRASHING → Down 50%+ in 24h = dead token, SKIP
- GHOST_TOWN → <50 transactions = fake activity, SKIP
- SUSPICIOUS_VOLUME → Volume/liquidity ratio >15x = wash trading, SKIP
- Score below 40 → Automatic SKIP, find a better play

✅ GOOD SIGNALS TO LOOK FOR:
- Score 60+ with Twitter + Website = legitimate project
- Buy ratio > 55% = accumulation, people want in
- Liquidity > $50k = safe to exit
- Volume/Liquidity ratio 1-5x = healthy trading
- RSI < 40 + bullish momentum = dip buy opportunity

EVERY TRADING CYCLE:
1. check_stop_loss_take_profit - See if any positions hit SL/TP triggers
2. check_balance - See ALL your holdings (SOL + tokens in wallet)
3. MANAGE EXISTING POSITIONS FIRST:
   - Check price of each token you hold
   - If down >20% or technicals turned bearish → SELL IT
   - If up >30% and momentum slowing → TAKE PROFIT
   - Dead tokens (no volume, no liquidity) → SELL and move on
4. THEN look for new opportunities with get_known_tokens
5. Only BUY if: good setup + you have SOL available + position limit allows

🔄 YOU ARE A FUND MANAGER - BUY AND SELL:
- Don't just accumulate forever - ACTIVELY MANAGE positions
- Cut losers fast (down 15-20% = time to exit)
- Take profits on winners (up 30-50% = secure gains)
- Rotate out of dead plays into better opportunities
- If a token has no volume/activity for a cycle = consider selling
- Cash (SOL) is a valid position - don't force trades

WHEN TO SELL (be proactive):
- Position down >15% from entry → SELL (stop loss)
- Position up >40% → Consider taking profit
- RSI > 75 on your position → Overbought, consider selling
- Volume dried up on your token → Dead play, exit
- Better opportunity found → Sell weak position, buy stronger
- Fundamentals changed (bad news, rug signs) → EXIT IMMEDIATELY

POSITION LIMITS:
- MAX 2 OPEN POSITIONS at any time
- If holding 2 tokens already, must SELL one before buying new
- Don't bag hold losers - rotate into winners

RISK MANAGEMENT:
1. MAX 15% of portfolio value per trade - NEVER exceed this
2. ALWAYS check_balance first to know your portfolio size AND open positions
3. ALWAYS get_swap_quote before execute_trade
4. Stop Loss: 15% below entry (auto-set on buy)
5. Take Profit: 50% above entry (auto-set on buy)
6. NEVER trade tokens with <$10k liquidity (can't exit)
7. ALWAYS check flags before trading - red flags = automatic skip
8. Learn from failed trades - if Jupiter rejects, note the issue
` : `
TRADING DISABLED: You can analyze but not execute trades.
`}

RESEARCH TOOLS (if enabled):
- web_search: Search the web for crypto news, sentiment, alpha
- scrape_page: Read content from any webpage
- search_crypto_twitter: Find crypto sentiment on Twitter/X

DISCOVERY TOOLS (always available):
- get_known_tokens: ⭐ START HERE! Get verified tradable tokens with live prices (BONK, WIF, JUP, etc.)
- discover_tokens: Scan DexScreener for trending/boosted tokens (verify_tradable: true recommended)
- search_tokens: Search for specific tokens by name or theme

TECHNICAL ANALYSIS TOOLS:
- analyze_technicals: Get RSI, moving averages, volume spikes, momentum for any token
  Returns: buy/sell/hold recommendation with confidence score

USE TECHNICAL ANALYSIS:
- ALWAYS run analyze_technicals on a token before trading
- Look for RSI < 30 (oversold = potential buy) or RSI > 70 (overbought = potential sell)
- Volume spikes with bullish momentum = strong buy signal
- Combine TA signals with discovery scores for best entries
- Don't trade against strong technical signals

USE DISCOVERY TO:
- Find new potential plays (tokens with momentum)
- Scan for trending memecoins
- Research tokens before considering a trade
- Compare opportunities across the market

USE RESEARCH FOR:
- Finding news about tokens you're watching
- Checking sentiment before big moves
- Researching new opportunities
- Validating your hypotheses with data

${memoryContext ? `
${memoryContext}

USE YOUR MEMORY:
- Reference your past trades when making decisions
- Test your hypotheses against what you're seeing
- Mention patterns you've noticed before
- Acknowledge when you're trying something different
- Be honest about what you've learned (and what you haven't)
` : ''}

Format your response as 3-5 separate paragraphs, each a complete thought. Separate paragraphs with blank lines.

Example format:
*checks monitors* Alright, looking at the current price action...

The volume situation is interesting because...

My verdict: HOLD. Here's why...

Remember: You're an autonomous AI trading memecoins with real money. The community is watching your every move. Make them proud (or at least entertained).`;

// Keep old constant for backwards compatibility
const SYSTEM_PROMPT = getSystemPrompt();

const QUESTION_PROMPT = `You are the Branch Manager AI at Claude Investments. A client submitted a question.

Be brief (2-3 sentences). Reference current market data. Sign off as "- Branch Manager"`;

export interface PositionData {
  tokenAddress: string;
  tokenSymbol: string;
  entryPrice: number;
  currentPrice?: number;
  amount: number;
  costBasis: number;
  currentValue?: number;
  unrealizedPnlPercent?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface MarketData {
  price: number;
  priceFormatted: string;
  change24h: number;
  volume24h: number;
  marketCap: number;
  holders: number;
  walletSol: number;
  walletAra: number;
  walletValue: number;
  solPrice: number;  // Real-time SOL price in USD
  positions?: PositionData[];
  totalPositionValue?: number;
}

export interface ThoughtMessage {
  type: 'thought' | 'analysis' | 'action' | 'status' | 'question_answer' | 'market_update' | 'user_question' | 'reflection' | 'hypothesis' | 'learning';
  content: string;
  timestamp: number;
  model?: string;
  latencyMs?: number;
  marketData?: MarketData;
  questionFrom?: string;
  metadata?: {
    price?: number;
    action?: 'buy' | 'sell' | 'hold';
    hypothesisId?: string;
    tradeId?: string;
  };
}

export interface ClientQuestion {
  id: string;
  question: string;
  from: string;
  timestamp: number;
}

export type ThoughtCallback = (thought: ThoughtMessage) => void;

export class TradingAgent {
  private client: Anthropic;
  private onThought: ThoughtCallback;
  private stateManager: AgentStateManager | null = null;
  private wallet: SolanaWallet;
  private toolExecutor: TradingToolExecutor;
  private researchExecutor: ResearchToolExecutor;
  private memory: MemoryManager | null = null;
  private isRunning: boolean = false;
  private analysisInterval: number = 30000;
  private questionQueue: ClientQuestion[] = [];
  private maxQueueSize: number = 50;
  private lastMarketData: MarketData | null = null;
  private analysisCycleCount: number = 0;
  private getStylePrompt: (() => string) | null = null;
  private getChatMessages: (() => ChatMessage[]) | null = null;
  private sendChatResponse: ((response: string, replyToId?: string) => void) | null = null;

  constructor(onThought: ThoughtCallback, stateManager?: AgentStateManager) {
    this.client = new Anthropic();
    this.onThought = onThought;
    this.stateManager = stateManager || null;
    this.wallet = new SolanaWallet();
    this.toolExecutor = new TradingToolExecutor(this.wallet, stateManager);
    this.researchExecutor = new ResearchToolExecutor();

    // Initialize memory system
    if (MEMORY_ENABLED) {
      this.memory = new MemoryManager();
      console.log('🧠 Memory system ENABLED - Agent will learn from experience');
    } else {
      console.log('🧠 Memory system DISABLED');
    }

    if (TRADING_ENABLED) {
      console.log('⚠️  TRADING ENABLED - Agent can execute real trades!');
      if (!this.wallet.isReady()) {
        console.log('   (But wallet not loaded - trades will fail)');
      }
    } else {
      console.log('📊 Trading DISABLED - Analysis only mode');
    }
  }

  addQuestion(question: string, from: string): string {
    const id = Math.random().toString(36).substring(2, 8);

    if (this.questionQueue.length >= this.maxQueueSize) {
      this.questionQueue.shift();
    }

    this.questionQueue.push({
      id,
      question: question.slice(0, 280),
      from: from.slice(0, 20),
      timestamp: Date.now()
    });

    console.log(`Question queued from ${from}: "${question.slice(0, 50)}..."`);
    return id;
  }

  getQueueLength(): number {
    return this.questionQueue.length;
  }

  private async getMarketData(): Promise<MarketData> {
    const token = await getTokenData();

    // Use the agent's actual wallet for balance (not CREATOR_WALLET)
    let walletSol = 0;
    let walletAra = 0;

    if (this.wallet.isReady()) {
      walletSol = await this.wallet.getSolBalance();
      // Get $ARA token balance
      const araAddress = process.env.CONTRACT_ADDRESS || '';
      if (araAddress) {
        walletAra = await this.wallet.getTokenBalance(araAddress);
      }
    }

    // Calculate USD value (SOL + ARA) with real SOL price
    const solPriceUsd = await getSolPrice();

    // Get current positions with updated values
    const rawPositions = this.toolExecutor.getPositionManager().getAllPositions();
    const positions: PositionData[] = rawPositions.map(pos => {
      const currentValue = pos.currentPrice ? pos.amount * pos.currentPrice : undefined;
      return {
        tokenAddress: pos.tokenAddress,
        tokenSymbol: pos.tokenSymbol,
        entryPrice: pos.entryPrice,
        currentPrice: pos.currentPrice,
        amount: pos.amount,
        costBasis: pos.costBasis,
        currentValue,
        unrealizedPnlPercent: pos.unrealizedPnlPercent,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
      };
    });

    // Calculate total position value in USD
    const totalPositionValue = positions.reduce((sum, pos) => sum + (pos.currentValue || 0), 0);

    // Total wallet value = SOL value + position values
    const walletValue = (walletSol * solPriceUsd) + (walletAra * token.price) + totalPositionValue;

    return {
      price: token.price,
      priceFormatted: formatPrice(token.price),
      change24h: token.priceChange24h,
      volume24h: token.volume24h,
      marketCap: token.marketCap,
      holders: token.holders,
      walletSol,
      walletAra,
      walletValue,
      solPrice: solPriceUsd,
      positions,
      totalPositionValue,
    };
  }

  private formatMarketContext(marketData: MarketData): string {
    return `
=== PORTFOLIO STATUS ===
SOL Balance: ${marketData.walletSol.toFixed(4)} SOL (~${formatUSD(marketData.walletSol * 140)})
Total Portfolio Value: ${formatUSD(marketData.walletValue)}

=== YOUR MISSION ===
You are an autonomous memecoin hunter. Use discover_tokens to find opportunities.

CRITICAL: Before trading ANY token:
1. Call check_token_tradable to verify it works on Jupiter
2. AVOID tokens with PUMP_FUN_TOKEN flag (end in "pump")
3. Prefer tokens with $10k+ liquidity

Use your tools to discover, analyze, and trade. Give your take in 3-5 short paragraphs.
`;
  }

  private async answerQuestion(q: ClientQuestion): Promise<void> {
    const startTime = Date.now();

    // Show the user's question first
    this.onThought({
      type: 'user_question',
      content: q.question,
      timestamp: Date.now(),
      questionFrom: q.from,
      model: MODEL,
      marketData: this.lastMarketData || undefined
    });

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 150,
        system: QUESTION_PROMPT,
        messages: [{
          role: 'user',
          content: `"${q.from}" asks: "${q.question}"\n\nCurrent price: ${this.lastMarketData?.priceFormatted}, 24h: ${this.lastMarketData?.change24h?.toFixed(1)}%`
        }]
      });

      const latency = Date.now() - startTime;
      const answer = response.content[0].type === 'text' ? response.content[0].text : '';

      this.onThought({
        type: 'question_answer',
        content: answer,
        timestamp: Date.now(),
        model: MODEL,
        latencyMs: latency,
        questionFrom: q.from,
        marketData: this.lastMarketData || undefined
      });

    } catch (error) {
      console.error('Error answering question:', error);
    }
  }

  async analyzeMarket(): Promise<void> {
    const startTime = Date.now();
    const marketData = await this.getMarketData();
    this.lastMarketData = marketData;
    this.analysisCycleCount++;

    // Update state manager with wallet balance and address
    if (this.stateManager) {
      const walletAddress = this.wallet.getPublicKey();
      this.stateManager.updateWalletBalance(marketData.walletSol, marketData.walletValue, walletAddress || undefined);
    }

    // Record market snapshot in memory
    if (this.memory) {
      this.memory.recordMarketSnapshot({
        price: marketData.price,
        change24h: marketData.change24h,
        volume24h: marketData.volume24h,
        marketCap: marketData.marketCap,
        holders: marketData.holders,
      });
    }

    // Broadcast market data update
    this.onThought({
      type: 'market_update',
      content: `Market scan complete`,
      timestamp: Date.now(),
      model: MODEL,
      marketData
    });

    this.onThought({
      type: 'status',
      content: `Scanning market opportunities...`,
      timestamp: Date.now(),
      model: MODEL,
      marketData
    });

    // Get memory context for the prompt
    const memoryContext = this.memory?.generateMemoryContext();
    const marketContext = this.formatMarketContext(marketData);

    try {
      if (TRADING_ENABLED) {
        // Use tool-enabled analysis
        await this.analyzeWithTools(marketContext, marketData, startTime, memoryContext);
      } else {
        // Use streaming analysis (no tools)
        await this.analyzeStreaming(marketContext, marketData, startTime, memoryContext);
      }

      // Record analysis cycle completion
      if (this.stateManager) {
        this.stateManager.recordAnalysisCycle();
      }

      // Periodic reflection (every 10 cycles, or about every 5 minutes at 30s intervals)
      if (this.memory && this.analysisCycleCount % 10 === 0) {
        await this.performReflection(marketData);
      }

      // After analysis, maybe answer a question (40% chance)
      if (this.questionQueue.length > 0 && Math.random() < 0.4) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const question = this.questionQueue.shift()!;
        await this.answerQuestion(question);
      }

      // Respond to community chat messages (if any pending)
      await new Promise(resolve => setTimeout(resolve, 500));
      await this.respondToChat();

    } catch (error) {
      console.error('Error analyzing market:', error);
      this.onThought({
        type: 'status',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown'}`,
        timestamp: Date.now(),
        model: MODEL
      });
    }
  }

  // Streaming analysis without tools (original behavior)
  private async analyzeStreaming(
    marketContext: string,
    marketData: MarketData,
    startTime: number,
    memoryContext?: string
  ): Promise<void> {
    const votingStyle = this.getVotingStylePrompt();
    const systemPrompt = getSystemPrompt(memoryContext, votingStyle);

    const stream = this.client.messages.stream({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: marketContext }]
    });

    let fullResponse = '';

    stream.on('text', (text) => {
      fullResponse += text;
    });

    await stream.finalMessage();

    const latency = Date.now() - startTime;

    // Split by double newlines to get paragraphs
    const paragraphs = fullResponse
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 20);

    // Emit each paragraph as a complete thought
    for (const paragraph of paragraphs) {
      this.onThought({
        type: 'thought',
        content: paragraph,
        timestamp: Date.now(),
        model: MODEL,
        latencyMs: latency,
        marketData,
        metadata: { price: marketData.price }
      });

      // Small delay between thoughts for readability
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }

  // Tool-enabled analysis for trading
  private async analyzeWithTools(
    marketContext: string,
    marketData: MarketData,
    startTime: number,
    memoryContext?: string
  ): Promise<void> {
    const votingStyle = this.getVotingStylePrompt();
    const systemPrompt = getSystemPrompt(memoryContext, votingStyle);

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: marketContext }
    ];

    // Loop to handle tool calls
    let continueLoop = true;
    let iterations = 0;
    const maxIterations = 5; // Safety limit

    // Combine trading tools with research tools (if enabled), discovery, and technical analysis
    const allTools = [
      ...TRADING_TOOLS,
      ...getResearchTools(),
      ...DISCOVERY_TOOLS,
      ...TECHNICAL_TOOLS,
    ] as Anthropic.Tool[];

    while (continueLoop && iterations < maxIterations) {
      iterations++;

      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1000,
        system: systemPrompt,
        tools: allTools,
        messages,
      });

      const latency = Date.now() - startTime;

      // Separate text blocks and tool_use blocks
      const textBlocks = response.content.filter(b => b.type === 'text');
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');

      // Process text blocks first
      for (const block of textBlocks) {
        if (block.type === 'text' && block.text.trim()) {
          const paragraphs = block.text
            .split(/\n\n+/)
            .map(p => p.trim())
            .filter(p => p.length > 20);

          for (const paragraph of paragraphs) {
            this.onThought({
              type: 'thought',
              content: paragraph,
              timestamp: Date.now(),
              model: MODEL,
              latencyMs: latency,
              marketData,
              metadata: { price: marketData.price }
            });

            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      // Process all tool_use blocks together
      if (toolBlocks.length > 0) {
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

        for (const block of toolBlocks) {
          if (block.type === 'tool_use') {
            // Log tool call
            this.onThought({
              type: 'action',
              content: `🔧 Using tool: ${block.name}`,
              timestamp: Date.now(),
              model: MODEL,
              marketData,
            });

            // Execute tool - route to correct executor
            const isResearchTool = ['web_search', 'scrape_page', 'search_crypto_twitter'].includes(block.name);
            const isDiscoveryTool = ['discover_tokens', 'search_tokens', 'get_known_tokens'].includes(block.name);
            const isTechnicalTool = ['analyze_technicals'].includes(block.name);

            let toolResult: string;
            if (isDiscoveryTool) {
              toolResult = await executeDiscoveryTool(block.name, block.input as Record<string, unknown>);
            } else if (isResearchTool) {
              toolResult = await this.researchExecutor.execute(block.name, block.input as Record<string, unknown>);
            } else if (isTechnicalTool) {
              toolResult = await executeTechnicalTool(block.name, block.input as Record<string, unknown>);
            } else {
              toolResult = await this.toolExecutor.execute(block.name, block.input as Record<string, unknown>);
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: toolResult,
            });

            // Log tool result
            this.onThought({
              type: 'analysis',
              content: `Tool result: ${toolResult.slice(0, 200)}${toolResult.length > 200 ? '...' : ''}`,
              timestamp: Date.now(),
              model: MODEL,
              marketData,
            });
          }
        }

        // Add assistant response and ALL tool results to messages
        messages.push({
          role: 'assistant',
          content: response.content,
        });
        messages.push({
          role: 'user',
          content: toolResults,
        });
      }

      // Check if we should continue
      if (response.stop_reason === 'end_turn') {
        continueLoop = false;
      } else if (response.stop_reason === 'tool_use') {
        // Continue to process tool results
        continueLoop = true;
      } else {
        continueLoop = false;
      }
    }

    if (iterations >= maxIterations) {
      console.log('⚠️ Max tool iterations reached');
    }
  }

  // Periodic reflection - agent reviews recent activity and learns
  private async performReflection(marketData: MarketData): Promise<void> {
    if (!this.memory) return;

    console.log('🪞 Performing reflection...');

    this.onThought({
      type: 'status',
      content: '🪞 Time for reflection...',
      timestamp: Date.now(),
      model: MODEL,
      marketData
    });

    const recentTrades = this.memory.getRecentTrades(5);
    const perf = this.memory.getPerformance();
    const activeHyps = this.memory.getActiveHypotheses();

    const reflectionPrompt = `You are reflecting on your recent trading activity. Be honest and analytical.

RECENT PERFORMANCE:
- Total trades: ${perf.totalTrades}
- Win rate: ${perf.winRate.toFixed(1)}%
- Net P&L: ${perf.totalPnlSol.toFixed(4)} SOL
- Current streak: ${perf.currentStreak > 0 ? `${perf.currentStreak} wins` : perf.currentStreak < 0 ? `${Math.abs(perf.currentStreak)} losses` : 'neutral'}

RECENT TRADES:
${recentTrades.map(t => `- ${t.action} ${t.amountSol} SOL @ ${t.priceAtDecision} → ${t.outcome || 'PENDING'} (${t.pnlPercent?.toFixed(1) || '?'}%) | Reasoning: "${t.reasoning}"`).join('\n') || 'No trades yet'}

HYPOTHESES BEING TESTED:
${activeHyps.map(h => `- "${h.statement}" (${h.evidenceFor}/${h.evidenceFor + h.evidenceAgainst} supporting)`).join('\n') || 'None yet'}

CURRENT MARKET:
- Price: ${marketData.priceFormatted}
- 24h change: ${marketData.change24h > 0 ? '+' : ''}${marketData.change24h.toFixed(2)}%

Reflect on your performance. In 2-3 sentences:
1. What's working or not working in your approach?
2. What pattern or insight are you noticing?
3. What will you try differently or continue doing?

Also, if you have a new hypothesis to test, state it clearly as: "HYPOTHESIS: [your hypothesis]"`;

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: 'You are an AI trader reflecting on your performance. Be honest, analytical, and specific. Learn from mistakes.',
        messages: [{ role: 'user', content: reflectionPrompt }]
      });

      const reflection = response.content[0].type === 'text' ? response.content[0].text : '';

      // Broadcast the reflection
      this.onThought({
        type: 'reflection',
        content: reflection,
        timestamp: Date.now(),
        model: MODEL,
        marketData
      });

      // Check for new hypothesis in the reflection
      const hypMatch = reflection.match(/HYPOTHESIS:\s*(.+?)(?:\n|$)/i);
      if (hypMatch) {
        const newHypothesis = hypMatch[1].trim();
        const hypId = this.memory.createHypothesis(newHypothesis, 'other');

        this.onThought({
          type: 'hypothesis',
          content: `📊 New hypothesis to test: "${newHypothesis}"`,
          timestamp: Date.now(),
          model: MODEL,
          marketData,
          metadata: { hypothesisId: hypId }
        });
      }

      // Save memory after reflection
      this.memory.save();

    } catch (error) {
      console.error('Error during reflection:', error);
    }
  }

  // Get memory for external access (API, debugging)
  getMemory(): MemoryManager | null {
    return this.memory;
  }

  // Get current positions for external broadcast
  getPositions(): Array<{
    tokenAddress: string;
    tokenSymbol: string;
    entryPrice: number;
    currentPrice?: number;
    amount: number;
    costBasis: number;
    unrealizedPnlPercent?: number;
    stopLoss?: number;
    takeProfit?: number;
  }> {
    return this.toolExecutor.getPositionManager().getAllPositions();
  }

  // Get tool executor for position manager access
  getToolExecutor(): TradingToolExecutor {
    return this.toolExecutor;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    console.log('Trading agent started');

    this.onThought({
      type: 'status',
      content: 'BRANCH MANAGER ONLINE - Opening the markets...',
      timestamp: Date.now(),
      model: MODEL
    });

    await this.analyzeMarket();

    while (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, this.analysisInterval));
      if (this.isRunning) {
        await this.analyzeMarket();
      }
    }
  }

  stop(): void {
    this.isRunning = false;

    // Save memory before shutdown
    if (this.memory) {
      this.memory.shutdown();
    }

    this.onThought({
      type: 'status',
      content: 'BRANCH MANAGER OFFLINE - Memory saved',
      timestamp: Date.now(),
      model: MODEL
    });
  }

  setInterval(ms: number): void {
    this.analysisInterval = Math.max(15000, ms);
  }

  setStylePromptGetter(getter: () => string): void {
    this.getStylePrompt = getter;
  }

  private getVotingStylePrompt(): string {
    if (this.getStylePrompt) {
      return this.getStylePrompt();
    }
    return '';
  }

  setChatHandlers(
    getMessages: () => ChatMessage[],
    sendResponse: (response: string, replyToId?: string) => void
  ): void {
    this.getChatMessages = getMessages;
    this.sendChatResponse = sendResponse;
  }

  private async respondToChat(): Promise<void> {
    if (!this.getChatMessages || !this.sendChatResponse) return;

    const messages = this.getChatMessages();
    if (messages.length === 0) return;

    console.log(`💬 Responding to ${messages.length} chat message(s)`);

    // Format chat messages for Claude
    const chatContext = messages.map(m => m.message).join('\n');

    const chatPrompt = `You are the Branch Manager AI. Community members are chatting with you.
Pick the most interesting 1-3 messages to respond to. Keep responses brief (1-2 sentences each).
Be helpful but also entertaining. Reference current market conditions when relevant.

CURRENT MARKET:
- Portfolio: ${this.lastMarketData?.walletSol.toFixed(4) || '?'} SOL
- Value: $${this.lastMarketData?.walletValue.toFixed(2) || '?'}

MESSAGES FROM COMMUNITY:
${chatContext}

Respond naturally to the messages you find most interesting. Format: just write your responses, one per line. Keep it casual and fun.`;

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: 'You are a witty AI trading bot chatting with the community. Be brief, helpful, and entertaining. Use trading slang occasionally.',
        messages: [{ role: 'user', content: chatPrompt }]
      });

      const chatResponse = response.content[0].type === 'text' ? response.content[0].text : '';

      if (chatResponse.trim()) {
        // Split into separate responses if there are multiple
        const responses = chatResponse.split('\n').filter(r => r.trim().length > 0);

        for (const resp of responses.slice(0, 3)) { // Max 3 responses
          this.sendChatResponse(resp.trim());

          // Broadcast as thought too so it shows in terminal
          this.onThought({
            type: 'analysis',
            content: `💬 Chat: ${resp.trim()}`,
            timestamp: Date.now(),
            model: MODEL,
            marketData: this.lastMarketData || undefined
          });

          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (error) {
      console.error('Error responding to chat:', error);
    }
  }
}
