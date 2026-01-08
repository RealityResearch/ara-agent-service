import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import type { ThoughtMessage } from './agent.js';
import type { AgentState } from './state.js';
import { VotingManager, TradingStyle, TRADING_STYLES } from './voting.js';

export type QuestionHandler = (question: string, from: string) => string;
export type VoteHandler = (visitorId: string, style: TradingStyle) => { success: boolean; message: string };

export interface ChatMessage {
  id: string;
  type: 'user' | 'bot';
  message: string;
  timestamp: number;
  anonId?: string;
  replyTo?: string;
}

export class ThoughtBroadcaster {
  private wss: WebSocketServer;
  private httpServer: ReturnType<typeof createServer>;
  private clients: Set<WebSocket> = new Set();
  private onQuestion: QuestionHandler | null = null;
  private queueLength: () => number = () => 0;
  private votingManager: VotingManager;

  // Chat system
  private chatHistory: ChatMessage[] = [];
  private pendingChatMessages: ChatMessage[] = [];
  private maxChatHistory = 100;

  constructor(port: number = 8080) {
    // Initialize voting system
    this.votingManager = new VotingManager();

    // Create HTTP server for health checks
    this.httpServer = createServer((req, res) => {
      if (req.url === '/' || req.url === '/health') {
        const voteStatus = this.votingManager.getStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          service: 'ara-agent-service',
          clients: this.clients.size,
          voting: voteStatus,
          pendingChat: this.pendingChatMessages.length,
          timestamp: Date.now()
        }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // Attach WebSocket server to HTTP server
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      console.log('Client connected');
      this.clients.add(ws);

      // Send welcome message with voting status
      const voteStatus = this.votingManager.getStatus();
      ws.send(JSON.stringify({
        type: 'status',
        content: `Connected to Claude Investments Branch Manager`,
        timestamp: Date.now(),
        model: 'claude-sonnet-4-20250514'
      }));

      // Send current voting state (keep for backwards compatibility)
      ws.send(JSON.stringify({
        type: 'vote_status',
        ...voteStatus,
        timestamp: Date.now()
      }));

      // Send chat history
      ws.send(JSON.stringify({
        type: 'chat_history',
        messages: this.chatHistory.slice(-50),
        timestamp: Date.now()
      }));

      // Send online count
      this.broadcastOnlineCount();

      // Send cached market data immediately (for portfolio chart)
      this.sendMarketDataToClient(ws);

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'question' && this.onQuestion) {
            const id = this.onQuestion(message.question, message.from || 'Anonymous');

            // Acknowledge receipt
            ws.send(JSON.stringify({
              type: 'question_received',
              content: `Your question has been submitted. Queue position: ${this.queueLength()}`,
              questionId: id,
              timestamp: Date.now()
            }));
          }

          // Handle votes (keep for backwards compatibility)
          if (message.type === 'vote' && message.visitorId && message.style) {
            const result = this.votingManager.vote(message.visitorId, message.style as TradingStyle);

            ws.send(JSON.stringify({
              type: 'vote_confirmed',
              success: result.success,
              message: result.message,
              timestamp: Date.now()
            }));

            this.broadcastVoteStatus();
          }

          // Handle chat messages
          if (message.type === 'chat_message' && message.message) {
            const chatMsg: ChatMessage = {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'user',
              message: `@${message.anonId || 'anon'}: ${message.message.slice(0, 280)}`,
              timestamp: message.timestamp || Date.now(),
              anonId: message.anonId,
            };

            // Add to history and pending queue
            this.chatHistory.push(chatMsg);
            this.pendingChatMessages.push(chatMsg);

            // Trim history if needed
            if (this.chatHistory.length > this.maxChatHistory) {
              this.chatHistory = this.chatHistory.slice(-this.maxChatHistory);
            }

            // Broadcast to all clients
            this.broadcastChatMessage(chatMsg);

            // Confirm to sender
            ws.send(JSON.stringify({
              type: 'chat_sent',
              id: chatMsg.id,
              timestamp: Date.now()
            }));
          }
        } catch (error) {
          console.error('Error parsing client message:', error);
        }
      });

      ws.on('close', () => {
        console.log('Client disconnected');
        this.clients.delete(ws);
        this.broadcastOnlineCount();
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });

    // Start HTTP server
    this.httpServer.listen(port, () => {
      console.log(`HTTP + WebSocket server running on port ${port}`);
    });
  }

  setQuestionHandler(handler: QuestionHandler, queueLengthFn: () => number): void {
    this.onQuestion = handler;
    this.queueLength = queueLengthFn;
  }

  broadcast(thought: ThoughtMessage): void {
    const message = JSON.stringify(thought);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  broadcastState(state: AgentState): void {
    const message = JSON.stringify({
      type: 'state_update',
      timestamp: Date.now(),
      performance: state.performance,
      evolution: state.evolution,
      tradeHistory: state.tradeHistory,
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  // Position data type for type safety
  private latestMarketData: {
    walletSol: number;
    walletValue: number;
    positions?: Array<{
      tokenAddress: string;
      tokenSymbol: string;
      entryPrice: number;
      currentPrice?: number;
      amount: number;
      costBasis: number;
      currentValue?: number;
      unrealizedPnlPercent?: number;
    }>;
    totalPositionValue?: number;
    timestamp: number;
  } | null = null;

  // Called by agent to update cached market data (with positions)
  updateMarketData(
    walletSol: number,
    walletValue: number,
    positions?: Array<{
      tokenAddress: string;
      tokenSymbol: string;
      entryPrice: number;
      currentPrice?: number;
      amount: number;
      costBasis: number;
      currentValue?: number;
      unrealizedPnlPercent?: number;
    }>,
    totalPositionValue?: number
  ): void {
    this.latestMarketData = {
      walletSol,
      walletValue,
      positions,
      totalPositionValue,
      timestamp: Date.now()
    };
  }

  // Send cached market data to a specific client (on connect)
  sendMarketDataToClient(client: WebSocket): void {
    if (this.latestMarketData && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'market_update',
        content: 'Market data update',
        timestamp: this.latestMarketData.timestamp,
        marketData: {
          walletSol: this.latestMarketData.walletSol,
          walletValue: this.latestMarketData.walletValue,
          positions: this.latestMarketData.positions,
          totalPositionValue: this.latestMarketData.totalPositionValue,
        }
      }));
    }
  }

  // Broadcast market update to all clients (for portfolio chart)
  broadcastMarketUpdate(
    walletSol: number,
    walletValue: number,
    positions?: Array<{
      tokenAddress: string;
      tokenSymbol: string;
      entryPrice: number;
      currentPrice?: number;
      amount: number;
      costBasis: number;
      currentValue?: number;
      unrealizedPnlPercent?: number;
    }>,
    totalPositionValue?: number
  ): void {
    this.updateMarketData(walletSol, walletValue, positions, totalPositionValue);

    const message = JSON.stringify({
      type: 'market_update',
      content: 'Market data update',
      timestamp: Date.now(),
      marketData: {
        walletSol,
        walletValue,
        positions,
        totalPositionValue,
      }
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  broadcastVoteStatus(): void {
    const status = this.votingManager.getStatus();
    const message = JSON.stringify({
      type: 'vote_status',
      ...status,
      timestamp: Date.now()
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  getVotingManager(): VotingManager {
    return this.votingManager;
  }

  getCurrentStylePrompt(): string {
    return this.votingManager.getStylePrompt();
  }

  // Chat system methods
  broadcastChatMessage(msg: ChatMessage): void {
    const message = JSON.stringify({
      type: 'chat_message',
      id: msg.id,
      from: msg.type,
      message: msg.message,
      timestamp: msg.timestamp,
      replyTo: msg.replyTo,
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  broadcastOnlineCount(): void {
    const message = JSON.stringify({
      type: 'online_count',
      count: this.clients.size,
      timestamp: Date.now()
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  // Get pending chat messages for the agent to respond to
  getPendingChatMessages(limit: number = 3): ChatMessage[] {
    // Get up to `limit` messages and clear them from pending
    const messages = this.pendingChatMessages.slice(0, limit);
    this.pendingChatMessages = this.pendingChatMessages.slice(limit);
    return messages;
  }

  // Check if there are pending messages
  hasPendingChatMessages(): boolean {
    return this.pendingChatMessages.length > 0;
  }

  // Add a bot response to chat
  addBotResponse(response: string, replyToId?: string): void {
    const botMsg: ChatMessage = {
      id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'bot',
      message: response,
      timestamp: Date.now(),
      replyTo: replyToId,
    };

    this.chatHistory.push(botMsg);

    // Trim history if needed
    if (this.chatHistory.length > this.maxChatHistory) {
      this.chatHistory = this.chatHistory.slice(-this.maxChatHistory);
    }

    // Broadcast to all clients
    this.broadcastChatMessage(botMsg);
  }

  // Discovery broadcasts
  broadcastDiscoveryScanning(): void {
    const message = JSON.stringify({
      type: 'discovery_scanning',
      timestamp: Date.now()
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  broadcastDiscoveryUpdate(tokens: any[]): void {
    const message = JSON.stringify({
      type: 'discovery_update',
      tokens,
      timestamp: Date.now()
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  broadcastDiscoveryThought(content: string, thoughtType: 'scanning' | 'analysis' | 'alert' | 'decision'): void {
    const message = JSON.stringify({
      type: 'discovery_thought',
      content,
      thoughtType,
      timestamp: Date.now()
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  close(): void {
    this.wss.close();
    this.httpServer.close();
  }
}
