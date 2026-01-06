import 'dotenv/config';
import { TradingAgent } from './agent.js';
import { ThoughtBroadcaster } from './websocket.js';

// Railway uses PORT, fallback to WS_PORT or 8080
const WS_PORT = parseInt(process.env.PORT || process.env.WS_PORT || '8080');
const ANALYSIS_INTERVAL = parseInt(process.env.ANALYSIS_INTERVAL || '30000');

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

  // Initialize trading agent
  const agent = new TradingAgent((thought) => {
    // Log to console with emoji prefix
    const prefix = {
      thought: '💭',
      analysis: '📊',
      action: '⚡',
      status: '📡',
      question_answer: '💬',
      market_update: '📈',
      user_question: '❓'
    }[thought.type] || '📝';

    const latencyStr = thought.latencyMs ? ` [${thought.latencyMs}ms]` : '';
    console.log(`${prefix}${latencyStr} ${thought.content.slice(0, 80)}${thought.content.length > 80 ? '...' : ''}`);

    // Broadcast to connected clients
    broadcaster.broadcast(thought);
  });

  // Wire up question handler
  broadcaster.setQuestionHandler(
    (question, from) => agent.addQuestion(question, from),
    () => agent.getQueueLength()
  );

  agent.setInterval(ANALYSIS_INTERVAL);

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

  // Start the agent
  try {
    await agent.start();
  } catch (error) {
    console.error('Fatal error:', error);
    broadcaster.close();
    process.exit(1);
  }
}

main();
