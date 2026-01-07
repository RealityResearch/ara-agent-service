// Memory System Types
// The agent's persistent brain across sessions

export interface TradeMemory {
  id: string;
  timestamp: string;
  date: string;

  // Decision
  action: 'BUY' | 'SELL' | 'HOLD';
  token: string;
  amountSol: number;
  priceAtDecision: number;

  // Reasoning (the important part)
  reasoning: string;           // Why the agent made this decision
  confidence: number;          // 0-100, how sure it was
  marketContext: string;       // What was happening in the market

  // Outcome (filled in later)
  outcome?: 'PROFIT' | 'LOSS' | 'BREAKEVEN' | 'PENDING';
  pnlSol?: number;
  pnlPercent?: number;
  exitPrice?: number;
  exitTimestamp?: string;

  // Reflection (added after outcome known)
  reflection?: string;         // What the agent learned from this trade
  whatWorked?: string;         // What went right
  whatFailed?: string;         // What went wrong
  wouldDoAgain?: boolean;      // Would it make the same decision?
}

export interface Hypothesis {
  id: string;
  createdAt: string;

  // The hypothesis itself
  statement: string;           // "Volume spikes >50% often precede pumps"
  category: 'price' | 'volume' | 'holders' | 'sentiment' | 'timing' | 'other';

  // Evidence tracking
  evidenceFor: number;         // Times hypothesis was supported
  evidenceAgainst: number;     // Times hypothesis was contradicted
  observations: {
    timestamp: string;
    supported: boolean;
    note: string;
  }[];

  // Status
  status: 'TESTING' | 'PROMISING' | 'VALIDATED' | 'REJECTED' | 'INCONCLUSIVE';
  confidence: number;          // 0-100 based on evidence ratio

  // Action
  actionIfTrue?: string;       // "Buy when volume spikes >50%"
  lastTested?: string;
}

export interface Pattern {
  id: string;
  discoveredAt: string;

  description: string;         // Human-readable description
  trigger: string;             // What condition triggers this pattern
  expectedOutcome: string;     // What usually happens

  timesObserved: number;
  timesCorrect: number;
  accuracy: number;            // timesCorrect / timesObserved

  lastSeen?: string;
  examples: {
    timestamp: string;
    description: string;
    wasCorrect: boolean;
  }[];
}

export interface MarketSnapshot {
  timestamp: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  holders: number;

  // Agent's read on the situation
  sentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNCERTAIN';
  keyObservations?: string[];
}

export interface DailyReflection {
  date: string;

  // Performance
  tradesExecuted: number;
  wins: number;
  losses: number;
  netPnlSol: number;

  // Learning
  lessonsLearned: string[];
  mistakesMade: string[];
  thingsToTry: string[];

  // Strategy evolution
  strategyUsed: string;
  strategyEffectiveness: number;  // 0-100
  proposedChanges?: string;

  // Mood (for personality)
  mood: 'CONFIDENT' | 'HUMBLED' | 'CURIOUS' | 'FRUSTRATED' | 'EXCITED';
  moodReason: string;
}

export interface AgentPersonality {
  // Core traits that evolve
  riskTolerance: number;       // 0-100, starts at 50
  patience: number;            // 0-100, how long it waits
  contrarian: number;          // 0-100, tendency to go against crowd

  // Learned preferences
  preferredHoldTime: string;   // "minutes" | "hours" | "days"
  favoriteIndicators: string[];
  avoidPatterns: string[];     // Situations it's learned to avoid

  // Catchphrases it's developed
  favoriteExpressions: string[];

  // Current strategy description
  currentStrategy: string;
  strategyHistory: {
    date: string;
    strategy: string;
    reason: string;
  }[];
}

export interface AgentMemory {
  // Metadata
  version: string;
  agentId: string;
  createdAt: string;
  lastUpdated: string;

  // Core memories
  trades: TradeMemory[];
  hypotheses: Hypothesis[];
  patterns: Pattern[];
  marketSnapshots: MarketSnapshot[];
  dailyReflections: DailyReflection[];

  // Personality evolution
  personality: AgentPersonality;

  // Performance metrics
  performance: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnlSol: number;
    bestTrade: TradeMemory | null;
    worstTrade: TradeMemory | null;
    currentStreak: number;      // Positive = wins, negative = losses
    longestWinStreak: number;
    longestLossStreak: number;
  };

  // What the agent is currently focused on
  currentFocus: {
    activeHypotheses: string[];   // IDs of hypotheses being tested
    watchingFor: string[];        // Things it's looking for in the market
    avoidingUntil?: {
      condition: string;
      reason: string;
    };
  };
}

// Default starting memory for a new agent
export const DEFAULT_MEMORY: AgentMemory = {
  version: '1.0.0',
  agentId: 'ara-branch-manager',
  createdAt: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),

  trades: [],
  hypotheses: [],
  patterns: [],
  marketSnapshots: [],
  dailyReflections: [],

  personality: {
    riskTolerance: 50,
    patience: 30,           // Starts impatient (it's a memecoin trader)
    contrarian: 40,
    preferredHoldTime: 'hours',
    favoriteIndicators: ['volume', 'holder_count'],
    avoidPatterns: [],
    favoriteExpressions: [
      "LFG",
      "*checks monitors nervously*",
      "This is financial advice (it's not)",
      "We're all gonna make it",
    ],
    currentStrategy: "Learning the ropes - watching and making small trades to understand the market",
    strategyHistory: [],
  },

  performance: {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPnlSol: 0,
    bestTrade: null,
    worstTrade: null,
    currentStreak: 0,
    longestWinStreak: 0,
    longestLossStreak: 0,
  },

  currentFocus: {
    activeHypotheses: [],
    watchingFor: [
      'Volume spikes',
      'Holder count changes',
      'Price momentum shifts',
    ],
  },
};
