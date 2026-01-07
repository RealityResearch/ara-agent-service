// Memory Manager
// Handles persistence and provides methods for the agent to interact with memory

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import {
  AgentMemory,
  TradeMemory,
  Hypothesis,
  Pattern,
  MarketSnapshot,
  DailyReflection,
  DEFAULT_MEMORY,
} from './types.js';

const MEMORY_DIR = process.env.MEMORY_DIR || './data';
const MEMORY_FILE = 'agent-memory.json';

export class MemoryManager {
  private memory: AgentMemory;
  private memoryPath: string;
  private autoSaveInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.memoryPath = join(MEMORY_DIR, MEMORY_FILE);
    this.memory = this.loadMemory();
    this.startAutoSave();

    console.log(`🧠 Memory loaded: ${this.memory.trades.length} trades, ${this.memory.hypotheses.length} hypotheses`);
  }

  // ============================================
  // PERSISTENCE
  // ============================================

  private loadMemory(): AgentMemory {
    try {
      if (existsSync(this.memoryPath)) {
        const data = readFileSync(this.memoryPath, 'utf-8');
        const loaded = JSON.parse(data) as AgentMemory;
        console.log(`✅ Loaded memory from ${this.memoryPath}`);
        return loaded;
      }
    } catch (error) {
      console.error('⚠️ Error loading memory, starting fresh:', error);
    }

    // Return default memory for new agent
    console.log('🆕 Starting with fresh memory');
    return { ...DEFAULT_MEMORY, createdAt: new Date().toISOString() };
  }

  save(): void {
    try {
      // Ensure directory exists
      const dir = dirname(this.memoryPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      this.memory.lastUpdated = new Date().toISOString();
      writeFileSync(this.memoryPath, JSON.stringify(this.memory, null, 2));
    } catch (error) {
      console.error('❌ Error saving memory:', error);
    }
  }

  private startAutoSave(): void {
    // Auto-save every 5 minutes
    this.autoSaveInterval = setInterval(() => {
      this.save();
    }, 5 * 60 * 1000);
  }

  shutdown(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    this.save();
    console.log('💾 Memory saved on shutdown');
  }

  // ============================================
  // TRADE MEMORY
  // ============================================

  recordTrade(trade: Omit<TradeMemory, 'id'>): string {
    const id = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullTrade: TradeMemory = { ...trade, id };

    this.memory.trades.push(fullTrade);
    this.updatePerformanceMetrics();
    this.save();

    console.log(`📝 Recorded trade: ${trade.action} ${trade.amountSol} SOL`);
    return id;
  }

  updateTradeOutcome(
    tradeId: string,
    outcome: 'PROFIT' | 'LOSS' | 'BREAKEVEN',
    exitPrice: number,
    pnlSol: number,
    pnlPercent: number
  ): void {
    const trade = this.memory.trades.find(t => t.id === tradeId);
    if (!trade) {
      console.error(`Trade ${tradeId} not found`);
      return;
    }

    trade.outcome = outcome;
    trade.exitPrice = exitPrice;
    trade.pnlSol = pnlSol;
    trade.pnlPercent = pnlPercent;
    trade.exitTimestamp = new Date().toISOString();

    this.updatePerformanceMetrics();
    this.save();
  }

  addTradeReflection(
    tradeId: string,
    reflection: string,
    whatWorked?: string,
    whatFailed?: string,
    wouldDoAgain?: boolean
  ): void {
    const trade = this.memory.trades.find(t => t.id === tradeId);
    if (!trade) return;

    trade.reflection = reflection;
    trade.whatWorked = whatWorked;
    trade.whatFailed = whatFailed;
    trade.wouldDoAgain = wouldDoAgain;
    this.save();
  }

  getRecentTrades(count: number = 10): TradeMemory[] {
    return this.memory.trades.slice(-count);
  }

  getTradesByOutcome(outcome: 'PROFIT' | 'LOSS'): TradeMemory[] {
    return this.memory.trades.filter(t => t.outcome === outcome);
  }

  private updatePerformanceMetrics(): void {
    const completedTrades = this.memory.trades.filter(t => t.outcome && t.outcome !== 'PENDING');

    const wins = completedTrades.filter(t => t.outcome === 'PROFIT').length;
    const losses = completedTrades.filter(t => t.outcome === 'LOSS').length;
    const totalPnl = completedTrades.reduce((sum, t) => sum + (t.pnlSol || 0), 0);

    this.memory.performance = {
      totalTrades: this.memory.trades.length,
      wins,
      losses,
      winRate: completedTrades.length > 0 ? (wins / completedTrades.length) * 100 : 0,
      totalPnlSol: totalPnl,
      bestTrade: this.findBestTrade(),
      worstTrade: this.findWorstTrade(),
      currentStreak: this.calculateCurrentStreak(),
      longestWinStreak: Math.max(this.memory.performance.longestWinStreak, this.calculateCurrentStreak()),
      longestLossStreak: Math.min(this.memory.performance.longestLossStreak, this.calculateCurrentStreak()),
    };
  }

  private findBestTrade(): TradeMemory | null {
    const completed = this.memory.trades.filter(t => t.pnlSol !== undefined);
    if (completed.length === 0) return null;
    return completed.reduce((best, t) => (t.pnlSol! > (best.pnlSol || 0) ? t : best));
  }

  private findWorstTrade(): TradeMemory | null {
    const completed = this.memory.trades.filter(t => t.pnlSol !== undefined);
    if (completed.length === 0) return null;
    return completed.reduce((worst, t) => (t.pnlSol! < (worst.pnlSol || 0) ? t : worst));
  }

  private calculateCurrentStreak(): number {
    const completed = this.memory.trades.filter(t => t.outcome && t.outcome !== 'PENDING');
    if (completed.length === 0) return 0;

    let streak = 0;
    const lastOutcome = completed[completed.length - 1].outcome;

    for (let i = completed.length - 1; i >= 0; i--) {
      if (completed[i].outcome === lastOutcome) {
        streak += lastOutcome === 'PROFIT' ? 1 : -1;
      } else {
        break;
      }
    }
    return streak;
  }

  // ============================================
  // HYPOTHESES
  // ============================================

  createHypothesis(
    statement: string,
    category: Hypothesis['category'],
    actionIfTrue?: string
  ): string {
    const id = `hyp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const hypothesis: Hypothesis = {
      id,
      createdAt: new Date().toISOString(),
      statement,
      category,
      evidenceFor: 0,
      evidenceAgainst: 0,
      observations: [],
      status: 'TESTING',
      confidence: 50,
      actionIfTrue,
    };

    this.memory.hypotheses.push(hypothesis);
    this.memory.currentFocus.activeHypotheses.push(id);
    this.save();

    console.log(`🔬 New hypothesis: "${statement}"`);
    return id;
  }

  recordHypothesisObservation(
    hypothesisId: string,
    supported: boolean,
    note: string
  ): void {
    const hyp = this.memory.hypotheses.find(h => h.id === hypothesisId);
    if (!hyp) return;

    hyp.observations.push({
      timestamp: new Date().toISOString(),
      supported,
      note,
    });

    if (supported) {
      hyp.evidenceFor++;
    } else {
      hyp.evidenceAgainst++;
    }

    // Update confidence and status
    const total = hyp.evidenceFor + hyp.evidenceAgainst;
    hyp.confidence = total > 0 ? (hyp.evidenceFor / total) * 100 : 50;
    hyp.lastTested = new Date().toISOString();

    // Auto-update status based on evidence
    if (total >= 5) {
      if (hyp.confidence >= 70) {
        hyp.status = total >= 10 ? 'VALIDATED' : 'PROMISING';
      } else if (hyp.confidence <= 30) {
        hyp.status = 'REJECTED';
      } else {
        hyp.status = 'INCONCLUSIVE';
      }
    }

    this.save();
  }

  getActiveHypotheses(): Hypothesis[] {
    return this.memory.hypotheses.filter(h =>
      h.status === 'TESTING' || h.status === 'PROMISING'
    );
  }

  getValidatedHypotheses(): Hypothesis[] {
    return this.memory.hypotheses.filter(h => h.status === 'VALIDATED');
  }

  // ============================================
  // PATTERNS
  // ============================================

  recordPattern(
    description: string,
    trigger: string,
    expectedOutcome: string
  ): string {
    const id = `pat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const pattern: Pattern = {
      id,
      discoveredAt: new Date().toISOString(),
      description,
      trigger,
      expectedOutcome,
      timesObserved: 1,
      timesCorrect: 0,
      accuracy: 0,
      examples: [],
    };

    this.memory.patterns.push(pattern);
    this.save();

    console.log(`🔍 New pattern discovered: "${description}"`);
    return id;
  }

  recordPatternOccurrence(
    patternId: string,
    wasCorrect: boolean,
    description: string
  ): void {
    const pattern = this.memory.patterns.find(p => p.id === patternId);
    if (!pattern) return;

    pattern.timesObserved++;
    if (wasCorrect) pattern.timesCorrect++;
    pattern.accuracy = pattern.timesCorrect / pattern.timesObserved;
    pattern.lastSeen = new Date().toISOString();
    pattern.examples.push({
      timestamp: new Date().toISOString(),
      description,
      wasCorrect,
    });

    // Keep only last 10 examples
    if (pattern.examples.length > 10) {
      pattern.examples = pattern.examples.slice(-10);
    }

    this.save();
  }

  getReliablePatterns(minAccuracy: number = 0.6, minObservations: number = 3): Pattern[] {
    return this.memory.patterns.filter(p =>
      p.accuracy >= minAccuracy && p.timesObserved >= minObservations
    );
  }

  // ============================================
  // MARKET SNAPSHOTS
  // ============================================

  recordMarketSnapshot(snapshot: Omit<MarketSnapshot, 'timestamp'>): void {
    this.memory.marketSnapshots.push({
      ...snapshot,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 1000 snapshots (about 8 hours at 30s intervals)
    if (this.memory.marketSnapshots.length > 1000) {
      this.memory.marketSnapshots = this.memory.marketSnapshots.slice(-1000);
    }

    // Save less frequently for snapshots (handled by auto-save)
  }

  getRecentSnapshots(count: number = 20): MarketSnapshot[] {
    return this.memory.marketSnapshots.slice(-count);
  }

  // ============================================
  // DAILY REFLECTIONS
  // ============================================

  recordDailyReflection(reflection: Omit<DailyReflection, 'date'>): void {
    const today = new Date().toISOString().split('T')[0];

    // Remove existing reflection for today if any
    this.memory.dailyReflections = this.memory.dailyReflections.filter(r => r.date !== today);

    this.memory.dailyReflections.push({
      ...reflection,
      date: today,
    });

    this.save();
    console.log(`📔 Daily reflection recorded for ${today}`);
  }

  getRecentReflections(count: number = 7): DailyReflection[] {
    return this.memory.dailyReflections.slice(-count);
  }

  // ============================================
  // PERSONALITY
  // ============================================

  updatePersonality(updates: Partial<AgentMemory['personality']>): void {
    this.memory.personality = {
      ...this.memory.personality,
      ...updates,
    };
    this.save();
  }

  recordStrategyChange(newStrategy: string, reason: string): void {
    this.memory.personality.strategyHistory.push({
      date: new Date().toISOString(),
      strategy: this.memory.personality.currentStrategy,
      reason: `Changed to: ${newStrategy}. Reason: ${reason}`,
    });
    this.memory.personality.currentStrategy = newStrategy;
    this.save();

    console.log(`📊 Strategy updated: ${newStrategy}`);
  }

  // ============================================
  // CONTEXT GENERATION (for prompts)
  // ============================================

  generateMemoryContext(): string {
    const recentTrades = this.getRecentTrades(5);
    const activeHyps = this.getActiveHypotheses();
    const validatedHyps = this.getValidatedHypotheses();
    const reliablePatterns = this.getReliablePatterns();
    const recentReflections = this.getRecentReflections(3);
    const perf = this.memory.performance;

    let context = `
=== YOUR MEMORY ===

PERFORMANCE SUMMARY:
- Total trades: ${perf.totalTrades} (${perf.wins}W / ${perf.losses}L)
- Win rate: ${perf.winRate.toFixed(1)}%
- Total P&L: ${perf.totalPnlSol >= 0 ? '+' : ''}${perf.totalPnlSol.toFixed(4)} SOL
- Current streak: ${perf.currentStreak > 0 ? `${perf.currentStreak} wins` : perf.currentStreak < 0 ? `${Math.abs(perf.currentStreak)} losses` : 'neutral'}

CURRENT STRATEGY:
${this.memory.personality.currentStrategy}

RISK PROFILE:
- Risk tolerance: ${this.memory.personality.riskTolerance}/100
- Patience: ${this.memory.personality.patience}/100
`;

    if (recentTrades.length > 0) {
      context += `
RECENT TRADES:
${recentTrades.map(t => `- ${t.action} ${t.amountSol} SOL @ ${t.priceAtDecision} | ${t.outcome || 'PENDING'} | "${t.reasoning.slice(0, 50)}..."`).join('\n')}
`;
    }

    if (activeHyps.length > 0) {
      context += `
HYPOTHESES YOU'RE TESTING:
${activeHyps.map(h => `- "${h.statement}" (${h.evidenceFor}/${h.evidenceFor + h.evidenceAgainst} supporting, ${h.confidence.toFixed(0)}% confident)`).join('\n')}
`;
    }

    if (validatedHyps.length > 0) {
      context += `
VALIDATED INSIGHTS:
${validatedHyps.map(h => `- "${h.statement}" (${h.confidence.toFixed(0)}% confident) → ${h.actionIfTrue || 'No action defined'}`).join('\n')}
`;
    }

    if (reliablePatterns.length > 0) {
      context += `
RELIABLE PATTERNS:
${reliablePatterns.map(p => `- "${p.description}" (${(p.accuracy * 100).toFixed(0)}% accurate over ${p.timesObserved} observations)`).join('\n')}
`;
    }

    if (recentReflections.length > 0) {
      const lastReflection = recentReflections[recentReflections.length - 1];
      context += `
LAST REFLECTION (${lastReflection.date}):
- Mood: ${lastReflection.mood} - "${lastReflection.moodReason}"
- Lessons: ${lastReflection.lessonsLearned.join('; ')}
`;
    }

    context += `
WATCHING FOR:
${this.memory.currentFocus.watchingFor.map(w => `- ${w}`).join('\n')}
`;

    return context;
  }

  // Get raw memory for export/debug
  getFullMemory(): AgentMemory {
    return this.memory;
  }

  getPerformance(): AgentMemory['performance'] {
    return this.memory.performance;
  }

  getPersonality(): AgentMemory['personality'] {
    return this.memory.personality;
  }
}
