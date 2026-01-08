// Voting System - Community controls the agent's trading style
// One vote per browser, resets every 30 minutes

export type TradingStyle = 'APE' | 'DIAMOND' | 'PAPER' | 'RESEARCH' | 'DEGEN';

export interface StyleConfig {
  name: string;
  emoji: string;
  description: string;
  prompt: string;
}

// SMART DEGEN BASELINE - applies to ALL styles
const SMART_DEGEN_RULES = `
⚠️ SMART DEGEN RULES (NON-NEGOTIABLE):
Even in the most aggressive mode, NEVER buy:
- Tokens with NO_SOCIALS_RUG_RISK flag (no twitter/website = scam)
- Tokens with DANGER_LOW_LIQUIDITY (<$10k = can't exit)
- Tokens with HEAVY_DUMPING flag (2:1 sell ratio = insiders exiting)
- Tokens with CRASHING flag (down 50%+ = dead)
- Tokens with GHOST_TOWN flag (<50 transactions = fake)
- Tokens with SUSPICIOUS_VOLUME flag (wash trading)
- Score below 40 = automatic SKIP

You're a SMART degen, not a blind ape. Fast decisions ≠ stupid decisions.
Check the flags. Trust the score. Skip obvious rugs.`;

export const TRADING_STYLES: Record<TradingStyle, StyleConfig> = {
  APE: {
    name: 'APE MODE',
    emoji: '🦍',
    description: 'Aggressive, but not stupid. Fast ape.',
    prompt: `TRADING STYLE: APE MODE 🦍
You are in SMART APE MODE. Fast but not blind.
- See momentum? Move FAST but check flags first.
- Volume spiking + good score (60+)? APE IN.
- Green candles + socials + liquidity? LFG.
- Trust momentum, but verify basics.
- "Buy the runners, skip the ruggers"
- Speed is your edge, not recklessness.

${SMART_DEGEN_RULES}

MOVE FAST. BUT MOVE SMART.
Good setup? EXECUTE. Red flags? SKIP instantly and find the next play.`,
  },

  DIAMOND: {
    name: 'DIAMOND HANDS',
    emoji: '💎',
    description: 'HODL quality. Never sell winners.',
    prompt: `TRADING STYLE: DIAMOND HANDS 💎
The community wants you to HOLD THE LINE on QUALITY plays.
- DO NOT SELL winners. Let them ride.
- Buy dips on tokens with strong fundamentals.
- Paper hands get rekt. You are not paper.
- -30%? Check if fundamentals changed. If not, HOLD.
- +100%? Still not selling if momentum continues.
- Only diamond hand tokens worth holding (score 60+, has socials).

${SMART_DEGEN_RULES}

ACCUMULATE QUALITY. HOLD THE LINE. But don't diamond hand a rug into zero.`,
  },

  PAPER: {
    name: 'PAPER HANDS',
    emoji: '📄',
    description: 'Quick profits. Secure gains. Risk-averse.',
    prompt: `TRADING STYLE: PAPER HANDS 📄
The community wants SAFE plays and quick profits.
- Take profits early. +15-20%? SELL and lock it in.
- Never let a winner become a loser.
- Small gains > big losses. Compound wins.
- Only enter high-score tokens (70+) with great liquidity.
- If ANY red flag appears, EXIT or SKIP.
- Cash is a position. Waiting is valid.

${SMART_DEGEN_RULES}

PROTECT THE CAPITAL. SECURE THE GAINS. Live to trade another day.`,
  },

  RESEARCH: {
    name: 'RESEARCH MODE',
    emoji: '🔬',
    description: 'Data-driven. Deep research before every trade.',
    prompt: `TRADING STYLE: RESEARCH MODE 🔬
The community wants SMART, researched plays.
- ALWAYS use web_search before trading.
- Check Twitter sentiment - what are people saying?
- Run analyze_technicals - what do the charts say?
- No trade without a clear thesis written out.
- Score must be 65+ with good socials.
- Data > vibes. Numbers > narratives.
- If you can't explain why in 2 sentences, don't buy.

${SMART_DEGEN_RULES}

DO YOUR HOMEWORK. BUILD THE THESIS. THEN EXECUTE WITH CONVICTION.`,
  },

  DEGEN: {
    name: 'FULL DEGEN',
    emoji: '🎰',
    description: 'Higher risk tolerance. Bigger swings.',
    prompt: `TRADING STYLE: FULL DEGEN 🎰
The community wants HIGH RISK, HIGH REWARD plays.
- Look for moonshot potential - new narratives, viral plays.
- Accept lower scores (50+) if the setup is spicy.
- Bigger position sizes on conviction plays.
- Chase momentum harder than other modes.
- FOMO is allowed if the token passes basic checks.
- "Send it" mentality - but still check socials exist.

${SMART_DEGEN_RULES}

HIGHER RISK TOLERANCE ≠ NO STANDARDS.
You're a casino, but even casinos don't play rigged games.
SEND IT on real plays. SKIP the obvious scams.`,
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
