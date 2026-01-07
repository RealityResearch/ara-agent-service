// Agent State Manager - Tracks performance, evolution, and trade history
// This data is persisted in memory and broadcast via WebSocket

export interface PerformanceData {
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  even: number;
  totalPnlSol: number;
  totalPnlUsd: number;
  walletBalanceSol: number;
  walletBalanceUsd: number;
  walletAddress: string | null;  // Agent's trading wallet address
  openPositions: number;
  maxPositions: number;
  avgHoldTime: string;
  bestTrade: number;
  worstTrade: number;
  currentStreak: number;
  streakType: 'win' | 'loss' | 'none';
}

export interface BotStats {
  experience: number;
  accuracy: number;
  analysis: number;
  adaptation: number;
  riskMgmt: number;
}

export interface EvolutionData {
  currentXp: number;
  totalXpEarned: number;
  stats: BotStats;
  recentGains: BotStats;
  cyclesCompleted: number;
  uptime: string;
}

export interface DetailedTrade {
  id: string;
  timestamp: string;
  date: string;
  token: string;
  tokenSymbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number | null;
  amountSol: number;
  pnlSol: number;
  pnlPercent: number;
  holdTime: string;
  status: 'open' | 'closed' | 'pending';
  result: 'win' | 'loss' | 'even' | 'open';
  txHash: string;
  reasoning: string;
}

export interface BotLevel {
  name: string;
  minXp: number;
  maxXp: number;
  icon: string;
}

export const BOT_LEVELS: BotLevel[] = [
  { name: 'Intern', minXp: 0, maxXp: 100, icon: '👶' },
  { name: 'Junior Analyst', minXp: 100, maxXp: 500, icon: '📊' },
  { name: 'Associate', minXp: 500, maxXp: 1500, icon: '💼' },
  { name: 'Senior Trader', minXp: 1500, maxXp: 4000, icon: '📈' },
  { name: 'VP of Trading', minXp: 4000, maxXp: 10000, icon: '🎯' },
  { name: 'Managing Director', minXp: 10000, maxXp: 25000, icon: '👔' },
  { name: 'Partner', minXp: 25000, maxXp: 50000, icon: '🏆' },
  { name: 'Legend', minXp: 50000, maxXp: 999999, icon: '👑' },
];

export function getCurrentLevel(xp: number): BotLevel {
  for (let i = BOT_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= BOT_LEVELS[i].minXp) {
      return BOT_LEVELS[i];
    }
  }
  return BOT_LEVELS[0];
}

export function getLevelProgress(xp: number): number {
  const level = getCurrentLevel(xp);
  const progressInLevel = xp - level.minXp;
  const levelRange = level.maxXp - level.minXp;
  return Math.min((progressInLevel / levelRange) * 100, 100);
}

export interface AgentState {
  performance: PerformanceData;
  evolution: EvolutionData;
  tradeHistory: DetailedTrade[];
}

export type StateUpdateCallback = (state: AgentState) => void;

export class AgentStateManager {
  private state: AgentState;
  private startTime: number;
  private onUpdate: StateUpdateCallback | null = null;

  constructor() {
    this.startTime = Date.now();
    this.state = this.getInitialState();
  }

  private getInitialState(): AgentState {
    return {
      performance: {
        winRate: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        even: 0,
        totalPnlSol: 0,
        totalPnlUsd: 0,
        walletBalanceSol: 0,
        walletBalanceUsd: 0,
        walletAddress: null,
        openPositions: 0,
        maxPositions: 3,
        avgHoldTime: '—',
        bestTrade: 0,
        worstTrade: 0,
        currentStreak: 0,
        streakType: 'none',
      },
      evolution: {
        currentXp: 0,
        totalXpEarned: 0,
        stats: {
          experience: 0,
          accuracy: 0,
          analysis: 0,
          adaptation: 0,
          riskMgmt: 0,
        },
        recentGains: {
          experience: 0,
          accuracy: 0,
          analysis: 0,
          adaptation: 0,
          riskMgmt: 0,
        },
        cyclesCompleted: 0,
        uptime: '0m',
      },
      tradeHistory: [],
    };
  }

  setUpdateCallback(callback: StateUpdateCallback): void {
    this.onUpdate = callback;
  }

  private notifyUpdate(): void {
    if (this.onUpdate) {
      this.onUpdate(this.getState());
    }
  }

  private updateUptime(): void {
    const elapsed = Date.now() - this.startTime;
    const minutes = Math.floor(elapsed / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      this.state.evolution.uptime = `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      this.state.evolution.uptime = `${hours}h ${minutes % 60}m`;
    } else {
      this.state.evolution.uptime = `${minutes}m`;
    }
  }

  // Called after each analysis cycle
  recordAnalysisCycle(): void {
    this.state.evolution.cyclesCompleted++;
    this.updateUptime();

    // Gain XP for completing analysis
    const xpGain = 5 + Math.floor(Math.random() * 10);
    this.state.evolution.currentXp += xpGain;
    this.state.evolution.totalXpEarned += xpGain;

    // Update stats slightly
    this.state.evolution.recentGains = {
      experience: Math.floor(Math.random() * 3),
      accuracy: Math.floor(Math.random() * 2),
      analysis: Math.floor(Math.random() * 3),
      adaptation: Math.floor(Math.random() * 2),
      riskMgmt: Math.floor(Math.random() * 2),
    };

    this.state.evolution.stats.experience = Math.min(100, this.state.evolution.stats.experience + this.state.evolution.recentGains.experience);
    this.state.evolution.stats.accuracy = Math.min(100, this.state.evolution.stats.accuracy + this.state.evolution.recentGains.accuracy);
    this.state.evolution.stats.analysis = Math.min(100, this.state.evolution.stats.analysis + this.state.evolution.recentGains.analysis);
    this.state.evolution.stats.adaptation = Math.min(100, this.state.evolution.stats.adaptation + this.state.evolution.recentGains.adaptation);
    this.state.evolution.stats.riskMgmt = Math.min(100, this.state.evolution.stats.riskMgmt + this.state.evolution.recentGains.riskMgmt);

    this.notifyUpdate();
  }

  // Update wallet balance from market data
  updateWalletBalance(solBalance: number, usdValue: number, walletAddress?: string): void {
    this.state.performance.walletBalanceSol = solBalance;
    this.state.performance.walletBalanceUsd = usdValue;
    if (walletAddress) {
      this.state.performance.walletAddress = walletAddress;
    }
    this.notifyUpdate();
  }

  // Record a trade
  recordTrade(trade: Omit<DetailedTrade, 'id'>): void {
    const id = `t${Date.now().toString(36)}`;
    const fullTrade: DetailedTrade = { ...trade, id };

    // Add to history (keep last 50)
    this.state.tradeHistory.unshift(fullTrade);
    if (this.state.tradeHistory.length > 50) {
      this.state.tradeHistory.pop();
    }

    // Update performance stats
    this.state.performance.totalTrades++;

    if (trade.status === 'closed') {
      if (trade.result === 'win') {
        this.state.performance.wins++;
        this.state.performance.currentStreak = this.state.performance.streakType === 'win'
          ? this.state.performance.currentStreak + 1
          : 1;
        this.state.performance.streakType = 'win';

        // XP bonus for winning trade
        const xpBonus = 20 + Math.floor(trade.pnlPercent * 2);
        this.state.evolution.currentXp += xpBonus;
        this.state.evolution.totalXpEarned += xpBonus;
      } else if (trade.result === 'loss') {
        this.state.performance.losses++;
        this.state.performance.currentStreak = this.state.performance.streakType === 'loss'
          ? this.state.performance.currentStreak + 1
          : 1;
        this.state.performance.streakType = 'loss';
      } else {
        this.state.performance.even++;
        this.state.performance.currentStreak = 0;
        this.state.performance.streakType = 'none';
      }

      // Update PnL
      this.state.performance.totalPnlSol += trade.pnlSol;
      this.state.performance.totalPnlUsd = this.state.performance.totalPnlSol * 140; // Approximate

      // Update best/worst
      if (trade.pnlPercent > this.state.performance.bestTrade) {
        this.state.performance.bestTrade = trade.pnlPercent;
      }
      if (trade.pnlPercent < this.state.performance.worstTrade) {
        this.state.performance.worstTrade = trade.pnlPercent;
      }

      // Update win rate
      const totalDecided = this.state.performance.wins + this.state.performance.losses;
      this.state.performance.winRate = totalDecided > 0
        ? (this.state.performance.wins / totalDecided) * 100
        : 0;
    } else if (trade.status === 'open') {
      this.state.performance.openPositions = this.state.tradeHistory.filter(t => t.status === 'open').length;
    }

    this.notifyUpdate();
  }

  // Close an open trade
  closeTrade(tradeId: string, exitPrice: number, pnlSol: number, pnlPercent: number, holdTime: string): void {
    const trade = this.state.tradeHistory.find(t => t.id === tradeId);
    if (trade && trade.status === 'open') {
      trade.exitPrice = exitPrice;
      trade.pnlSol = pnlSol;
      trade.pnlPercent = pnlPercent;
      trade.holdTime = holdTime;
      trade.status = 'closed';
      trade.result = pnlPercent > 0.5 ? 'win' : pnlPercent < -0.5 ? 'loss' : 'even';

      // Re-record to update stats
      this.state.performance.openPositions = this.state.tradeHistory.filter(t => t.status === 'open').length;

      // Update running totals
      if (trade.result === 'win') {
        this.state.performance.wins++;
        this.state.performance.currentStreak = this.state.performance.streakType === 'win'
          ? this.state.performance.currentStreak + 1
          : 1;
        this.state.performance.streakType = 'win';
      } else if (trade.result === 'loss') {
        this.state.performance.losses++;
        this.state.performance.currentStreak = this.state.performance.streakType === 'loss'
          ? this.state.performance.currentStreak + 1
          : 1;
        this.state.performance.streakType = 'loss';
      } else {
        this.state.performance.even++;
      }

      this.state.performance.totalPnlSol += pnlSol;
      this.state.performance.totalPnlUsd = this.state.performance.totalPnlSol * 140;

      const totalDecided = this.state.performance.wins + this.state.performance.losses;
      this.state.performance.winRate = totalDecided > 0
        ? (this.state.performance.wins / totalDecided) * 100
        : 0;

      if (pnlPercent > this.state.performance.bestTrade) {
        this.state.performance.bestTrade = pnlPercent;
      }
      if (pnlPercent < this.state.performance.worstTrade) {
        this.state.performance.worstTrade = pnlPercent;
      }

      this.notifyUpdate();
    }
  }

  getState(): AgentState {
    this.updateUptime();
    return JSON.parse(JSON.stringify(this.state));
  }

  getPerformance(): PerformanceData {
    return { ...this.state.performance };
  }

  getEvolution(): EvolutionData {
    this.updateUptime();
    return { ...this.state.evolution };
  }

  getTradeHistory(): DetailedTrade[] {
    return [...this.state.tradeHistory];
  }
}
