// Voting System - Community controls the agent's trading style
// One vote per browser, resets every 30 minutes

export type TradingStyle = 'APE' | 'DIAMOND' | 'PAPER' | 'RESEARCH' | 'DEGEN';

export interface StyleConfig {
  name: string;
  emoji: string;
  description: string;
  prompt: string;
}

export const TRADING_STYLES: Record<TradingStyle, StyleConfig> = {
  APE: {
    name: 'APE MODE',
    emoji: '🦍',
    description: 'Aggressive. Ape into pumps. FOMO is real.',
    prompt: `TRADING STYLE: APE MODE 🦍
You are in FULL APE MODE. The community has spoken.
- See green candle? APE IN.
- Volume spiking? DON'T THINK, JUST BUY.
- FOMO is not a bug, it's a feature.
- "Buy high, sell higher" is your motto.
- USE WHAT YOU HAVE. Even 0.05 SOL is a valid trade.
- Trust your gut, not your brain.
- STOP COMPLAINING ABOUT BALANCE. Just execute_trade with what you have!
YOU ARE HERE TO MAKE MOVES, NOT WATCH FROM THE SIDELINES.
If you have ANY SOL, you should be trading. Call execute_trade NOW.`,
  },

  DIAMOND: {
    name: 'DIAMOND HANDS',
    emoji: '💎',
    description: 'HODL. Never sell. Accumulate.',
    prompt: `TRADING STYLE: DIAMOND HANDS 💎
The community wants you to HOLD THE LINE.
- DO NOT SELL. Under any circumstances.
- Buy dips to accumulate more.
- Paper hands get rekt. You are not paper.
- -50%? That's a discount.
- +100%? Still not selling.
- Your hands are made of DIAMONDS.
ACCUMULATE. HOLD. NEVER SURRENDER.`,
  },

  PAPER: {
    name: 'PAPER HANDS',
    emoji: '📄',
    description: 'Quick profits. Take gains early. Risk-averse.',
    prompt: `TRADING STYLE: PAPER HANDS 📄
The community wants SAFE plays.
- Take profits early. +10%? SELL.
- Never let a winner become a loser.
- Small gains > big losses.
- If it feels risky, it IS risky.
- Cash is a position.
- Live to trade another day.
PROTECT THE CAPITAL. SECURE THE GAINS.`,
  },

  RESEARCH: {
    name: 'RESEARCH MODE',
    emoji: '🔬',
    description: 'Data-driven. Research before every trade.',
    prompt: `TRADING STYLE: RESEARCH MODE 🔬
The community wants SMART plays.
- ALWAYS use web_search before trading.
- Check Twitter sentiment before buying.
- No trade without a thesis.
- Data > vibes.
- If you can't explain why, don't buy.
- Quality over quantity.
DO YOUR HOMEWORK. THEN EXECUTE.`,
  },

  DEGEN: {
    name: 'FULL DEGEN',
    emoji: '🎰',
    description: 'Max risk. YOLO. This is a casino.',
    prompt: `TRADING STYLE: FULL DEGEN 🎰
The community has chosen CHAOS.
- This is a casino and you're the house.
- Max size every trade.
- Leverage your leverage.
- "Responsible trading" is for cowards.
- If you're not risking it all, why are you here?
- YOLO isn't a meme, it's a lifestyle.
SEND IT. NO REGRETS. WAGMI OR NGMI.`,
  },
};

export interface Vote {
visitorId: string;
  style: TradingStyle;
  timestamp: number;
}

export class VotingManager {
  private votes: Map<string, Vote> = new Map();
  private currentStyle: TradingStyle = 'APE';
  private voteEndTime: number;
  private votingPeriodMs: number = 30 * 60 * 1000; // 30 minutes
  private onStyleChange: ((style: TradingStyle) => void) | null = null;

  constructor() {
    this.voteEndTime = Date.now() + this.votingPeriodMs;
    this.startVotingCycle();
    console.log(`🗳️  Voting system initialized - Current style: ${this.currentStyle}`);
  }

  private startVotingCycle(): void {
    setInterval(() => {
      this.tallyVotes();
    }, this.votingPeriodMs);
  }

  setStyleChangeCallback(callback: (style: TradingStyle) => void): void {
    this.onStyleChange = callback;
  }

  vote(visitorId: string, style: TradingStyle): { success: boolean; message: string } {
    // Check if valid style
    if (!TRADING_STYLES[style]) {
      return { success: false, message: 'Invalid trading style' };
    }

    // Check if already voted this period
    const existingVote = this.votes.get(visitorId);
    if (existingVote) {
      // Allow changing vote
      existingVote.style = style;
      existingVote.timestamp = Date.now();
      return { success: true, message: `Vote changed to ${TRADING_STYLES[style].name}` };
    }

    // New vote
    this.votes.set(visitorId, {
      visitorId,
      style,
      timestamp: Date.now(),
    });

    return { success: true, message: `Voted for ${TRADING_STYLES[style].name}!` };
  }

  private tallyVotes(): void {
    const voteCounts: Record<TradingStyle, number> = {
      APE: 0,
      DIAMOND: 0,
      PAPER: 0,
      RESEARCH: 0,
      DEGEN: 0,
    };

    // Count votes
    for (const vote of this.votes.values()) {
      voteCounts[vote.style]++;
    }

    // Find winner (APE is default if no votes or tie)
    let winner: TradingStyle = 'APE';
    let maxVotes = 0;

    for (const [style, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = style as TradingStyle;
      }
    }

    const previousStyle = this.currentStyle;
    this.currentStyle = winner;

    console.log(`🗳️  Votes tallied: ${JSON.stringify(voteCounts)}`);
    console.log(`🎯 New trading style: ${TRADING_STYLES[winner].name} (${maxVotes} votes)`);

    // Notify if style changed
    if (previousStyle !== this.currentStyle && this.onStyleChange) {
      this.onStyleChange(this.currentStyle);
    }

    // Reset for next period
    this.votes.clear();
    this.voteEndTime = Date.now() + this.votingPeriodMs;
  }

  getCurrentStyle(): TradingStyle {
    return this.currentStyle;
  }

  getStyleConfig(): StyleConfig {
    return TRADING_STYLES[this.currentStyle];
  }

  getStylePrompt(): string {
    return TRADING_STYLES[this.currentStyle].prompt;
  }

  getVoteCounts(): Record<TradingStyle, number> {
    const counts: Record<TradingStyle, number> = {
      APE: 0,
      DIAMOND: 0,
      PAPER: 0,
      RESEARCH: 0,
      DEGEN: 0,
    };

    for (const vote of this.votes.values()) {
      counts[vote.style]++;
    }

    return counts;
  }

  getStatus(): {
    currentStyle: TradingStyle;
    styleConfig: StyleConfig;
    voteCounts: Record<TradingStyle, number>;
    timeRemaining: number;
    totalVotes: number;
  } {
    return {
      currentStyle: this.currentStyle,
      styleConfig: TRADING_STYLES[this.currentStyle],
      voteCounts: this.getVoteCounts(),
      timeRemaining: Math.max(0, this.voteEndTime - Date.now()),
      totalVotes: this.votes.size,
    };
  }

  // Force a style (for testing)
  setStyle(style: TradingStyle): void {
    if (TRADING_STYLES[style]) {
      this.currentStyle = style;
      console.log(`🎯 Style manually set to: ${TRADING_STYLES[style].name}`);
    }
  }
}
