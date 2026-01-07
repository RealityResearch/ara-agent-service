import Anthropic from '@anthropic-ai/sdk';
import { getTokenData, formatPrice, formatUSD, TokenData, getSolPrice } from './tools/market.js';
import { AgentStateManager } from './state.js';
import { SolanaWallet } from './tools/wallet.js';
import { TRADING_TOOLS, TradingToolExecutor } from './tools/trading.js';
import { RESEARCH_TOOLS, ResearchToolExecutor, getResearchTools } from './tools/research.js';
import { DISCOVERY_TOOLS, executeDiscoveryTool } from './tools/discovery.js';
import { MemoryManager } from './memory/index.js';

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
You have access to real trading tools. Use them wisely!
- check_balance: See your wallet balances (SOL + any tokens)
- get_price: Get price for any token by contract address
- get_swap_quote: Get a Jupiter quote before trading
- execute_trade: Actually buy or sell via Jupiter
- check_can_trade: Check if trading is allowed

RISK MANAGEMENT:
1. MAX 15% of portfolio value per trade - NEVER exceed this
2. ALWAYS check_balance first to know your portfolio size
3. ALWAYS get_swap_quote before execute_trade
4. Only trade if you have a clear thesis
5. Use discover_tokens to find opportunities with good liquidity
6. Avoid tokens with very low liquidity (trades will fail)
7. Learn from failed trades - if Jupiter rejects, the token may have liquidity issues
` : `
TRADING DISABLED: You can analyze but not execute trades.
`}

RESEARCH TOOLS (if enabled):
- web_search: Search the web for crypto news, sentiment, alpha
- scrape_page: Read content from any webpage
- search_crypto_twitter: Find crypto sentiment on Twitter/X

DISCOVERY TOOLS (always available):
- discover_tokens: Scan DexScreener for trending/boosted Solana tokens
- search_tokens: Search for specific tokens by name or theme

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
    const walletValue = (walletSol * solPriceUsd) + (walletAra * token.price);

    return {
      price: token.price,
      priceFormatted: formatPrice(token.price),
      change24h: token.priceChange24h,
      volume24h: token.volume24h,
      marketCap: token.marketCap,
      holders: token.holders,
      walletSol,
      walletAra,
      walletValue
    };
  }

  private formatMarketContext(marketData: MarketData): string {
    return `
=== CURRENT MARKET DATA ===
Token: $ARA (Automated Retirement Account)
Price: ${marketData.priceFormatted} (${marketData.change24h > 0 ? '+' : ''}${marketData.change24h.toFixed(2)}% 24h)
Market Cap: ${formatUSD(marketData.marketCap)}
24h Volume: ${formatUSD(marketData.volume24h)}
Holders: ${marketData.holders.toLocaleString()}

=== TREASURY ===
SOL: ${marketData.walletSol.toFixed(4)} SOL (~${formatUSD(marketData.walletSol * 180)})
$ARA: ${(marketData.walletAra / 1_000_000).toFixed(2)}M tokens
Total Value: ${formatUSD(marketData.walletValue)}

Analyze this. Give your take in 3-5 short paragraphs.
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
      content: `Analyzing ${marketData.priceFormatted} (${marketData.change24h > 0 ? '+' : ''}${marketData.change24h.toFixed(1)}%)...`,
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

    // Combine trading tools with research tools (if enabled) and discovery tools
    const allTools = [
      ...TRADING_TOOLS,
      ...getResearchTools(),
      ...DISCOVERY_TOOLS,
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
            const isDiscoveryTool = ['discover_tokens', 'search_tokens'].includes(block.name);

            let toolResult: string;
            if (isDiscoveryTool) {
              toolResult = await executeDiscoveryTool(block.name, block.input as Record<string, unknown>);
            } else if (isResearchTool) {
              toolResult = await this.researchExecutor.execute(block.name, block.input as Record<string, unknown>);
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
}
