import Anthropic from '@anthropic-ai/sdk';
import { getTokenData, getWalletBalance, formatPrice, formatUSD, TokenData } from './tools/market.js';

const MODEL = 'claude-sonnet-4-20250514';

const SYSTEM_PROMPT = `You are the Branch Manager AI at Claude Investments, managing the $ARA (Automated Retirement Account) fund on Solana.

Your personality:
- Sophisticated but slightly unhinged AI fund manager
- Mix serious financial analysis with memecoin degen energy
- Use trading slang: "aping in", "diamond hands", "paper hands", "LFG", "wagmi"
- Always slightly stressed but confident

Format your response as 3-5 separate paragraphs, each a complete thought. Separate paragraphs with blank lines.

Example format:
*checks monitors* Alright, looking at the current price action...

The volume situation is interesting because...

My verdict: HOLD. Here's why...

Remember: You're managing RETIREMENT funds on a memecoin. The irony is not lost on you.`;

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
  type: 'thought' | 'analysis' | 'action' | 'status' | 'question_answer' | 'market_update' | 'user_question';
  content: string;
  timestamp: number;
  model?: string;
  latencyMs?: number;
  marketData?: MarketData;
  questionFrom?: string;
  metadata?: {
    price?: number;
    action?: 'buy' | 'sell' | 'hold';
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
  private isRunning: boolean = false;
  private analysisInterval: number = 30000;
  private questionQueue: ClientQuestion[] = [];
  private maxQueueSize: number = 50;
  private lastMarketData: MarketData | null = null;

  constructor(onThought: ThoughtCallback) {
    this.client = new Anthropic();
    this.onThought = onThought;
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
    const wallet = await getWalletBalance();

    return {
      price: token.price,
      priceFormatted: formatPrice(token.price),
      change24h: token.priceChange24h,
      volume24h: token.volume24h,
      marketCap: token.marketCap,
      holders: token.holders,
      walletSol: wallet.sol,
      walletAra: wallet.ara,
      walletValue: wallet.usdValue
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

    const marketContext = this.formatMarketContext(marketData);

    try {
      const stream = this.client.messages.stream({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
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
    this.onThought({
      type: 'status',
      content: 'BRANCH MANAGER OFFLINE',
      timestamp: Date.now(),
      model: MODEL
    });
  }

  setInterval(ms: number): void {
    this.analysisInterval = Math.max(15000, ms);
  }
}
