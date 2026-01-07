import 'dotenv/config';
import { TradingAgent } from './agent.js';
import { ThoughtBroadcaster } from './websocket.js';
import { AgentStateManager } from './state.js';
import { discoverTokens, DiscoveredToken } from './tools/discovery.js';

// Railway uses PORT, fallback to WS_PORT or 8080
const WS_PORT = parseInt(process.env.PORT || process.env.WS_PORT || '8080');
const ANALYSIS_INTERVAL = parseInt(process.env.ANALYSIS_INTERVAL || '30000');
const AGENT_ENABLED = process.env.AGENT_ENABLED !== 'false'; // Set to 'false' to pause

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     $ARA - AUTOMATED RETIREMENT ACCOUNT                   ║
║     Branch Manager AI v1.0.0                              ║
║                                                           ║
║     "The Future of Investing is Here"                     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Initialize WebSocket broadcaster
  const broadcaster = new ThoughtBroadcaster(WS_PORT);

  // Initialize state manager
  const stateManager = new AgentStateManager();

  // Wire state updates to broadcaster
  stateManager.setUpdateCallback((state) => {
    broadcaster.broadcastState(state);
  });

  // Initialize trading agent with state manager
  const agent = new TradingAgent(
    (thought) => {
      // Log to console with emoji prefix
      const prefix = {
        thought: '💭',
        analysis: '📊',
        action: '⚡',
        status: '📡',
        question_answer: '💬',
        market_update: '📈',
        user_question: '❓',
        reflection: '🪞',
        hypothesis: '🔬',
        learning: '📚'
      }[thought.type] || '📝';

      const latencyStr = thought.latencyMs ? ` [${thought.latencyMs}ms]` : '';
      console.log(`${prefix}${latencyStr} ${thought.content.slice(0, 80)}${thought.content.length > 80 ? '...' : ''}`);

      // Broadcast to connected clients
      broadcaster.broadcast(thought);
    },
    stateManager
  );

  // Wire up question handler
  broadcaster.setQuestionHandler(
    (question, from) => agent.addQuestion(question, from),
    () => agent.getQueueLength()
  );

  agent.setInterval(ANALYSIS_INTERVAL);

  // Connect voting system to agent
  agent.setStylePromptGetter(() => broadcaster.getCurrentStylePrompt());

  // Announce style changes
  broadcaster.getVotingManager().setStyleChangeCallback((style) => {
    const config = broadcaster.getVotingManager().getStatus().styleConfig;
    agent.addQuestion(`The community has spoken! Trading style changed to ${config.emoji} ${config.name}`, 'System');
  });

  // Discovery Scanner - runs every 2 minutes
  const DISCOVERY_INTERVAL = parseInt(process.env.DISCOVERY_INTERVAL || '120000');
  let lastDiscoveryTokens: DiscoveredToken[] = [];

  async function runDiscoveryScan() {
    if (!AGENT_ENABLED) return;

    try {
      broadcaster.broadcastDiscoveryScanning();
      broadcaster.broadcastDiscoveryThought('Initiating DexScreener scan for potential 2x plays...', 'scanning');

      const tokens = await discoverTokens({
        minLiquidity: 10000,      // $10k - tradeable liquidity
        minVolume24h: 20000,      // $20k - shows activity
        maxAge: 168,              // 7 days - catch newer plays
        minBuys24h: 50,           // Some interest
        chainId: 'solana'
      });

      // Light filter - let agent evaluate more opportunities
      const topPicks = tokens.filter(t => {
        const buyRatio = t.txns24h.buys / (t.txns24h.buys + t.txns24h.sells);
        const notDumping = !t.flags.includes('DUMPING');
        return t.score >= 50 && buyRatio > 0.4 && notDumping;
      });

      broadcaster.broadcastDiscoveryThought(
        `Scan complete. Found ${tokens.length} tokens, ${topPicks.length} passing strict filters.`,
        'analysis'
      );

      // Broadcast discovery results
      broadcaster.broadcastDiscoveryUpdate(topPicks);

      // Check for new high-score tokens
      const newHighScorers = topPicks.filter(t => {
        const wasPresent = lastDiscoveryTokens.find(lt => lt.address === t.address);
        return t.score >= 90 && !wasPresent;
      });

      for (const token of newHighScorers) {
        const buyRatio = Math.round(token.txns24h.buys / (token.txns24h.buys + token.txns24h.sells) * 100);
        broadcaster.broadcastDiscoveryThought(
          `🚨 NEW HIGH-SCORE TOKEN: ${token.symbol} (${token.score}/100) - ${token.priceChange24h >= 0 ? '+' : ''}${token.priceChange24h.toFixed(0)}% 24h, ${buyRatio}% buys, $${(token.liquidity/1000).toFixed(0)}K liq`,
          'alert'
        );
      }

      // Analyze top pick
      if (topPicks.length > 0) {
        const top = topPicks[0];
        const volLiqRatio = (top.volume24h / top.liquidity).toFixed(1);
        const buyRatio = Math.round(top.txns24h.buys / (top.txns24h.buys + top.txns24h.sells) * 100);

        broadcaster.broadcastDiscoveryThought(
          `Top opportunity: ${top.symbol} - Score ${top.score}, ${volLiqRatio}x vol/liq turnover, ${buyRatio}% buy pressure. ${top.flags.length > 0 ? 'Flags: ' + top.flags.join(', ') : 'No warning flags.'}`,
          'decision'
        );
      }

      lastDiscoveryTokens = topPicks;

    } catch (error) {
      console.error('Discovery scan error:', error);
      broadcaster.broadcastDiscoveryThought(
        `Scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'alert'
      );
    }
  }

  // Run first scan after 10 seconds, then every DISCOVERY_INTERVAL
  setTimeout(() => {
    runDiscoveryScan();
    setInterval(runDiscoveryScan, DISCOVERY_INTERVAL);
  }, 10000);

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    agent.stop();
    broadcaster.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    agent.stop();
    broadcaster.close();
    process.exit(0);
  });

  // Start the agent (or idle if disabled)
  if (AGENT_ENABLED) {
    try {
      await agent.start();
    } catch (error) {
      console.error('Fatal error:', error);
      broadcaster.close();
      process.exit(1);
    }
  } else {
    console.log('⏸️  Agent PAUSED - set AGENT_ENABLED=true to resume');
    console.log('   Health check still running on port', WS_PORT);
  }
}

main();
