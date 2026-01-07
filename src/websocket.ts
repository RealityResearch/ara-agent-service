import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import type { ThoughtMessage } from './agent.js';
import type { AgentState } from './state.js';

export type QuestionHandler = (question: string, from: string) => string;

export class ThoughtBroadcaster {
  private wss: WebSocketServer;
  private httpServer: ReturnType<typeof createServer>;
  private clients: Set<WebSocket> = new Set();
  private onQuestion: QuestionHandler | null = null;
  private queueLength: () => number = () => 0;

  constructor(port: number = 8080) {
    // Create HTTP server for health checks
    this.httpServer = createServer((req, res) => {
      if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          service: 'ara-agent-service',
          clients: this.clients.size,
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

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'status',
        content: 'Connected to Claude Investments Branch Manager',
        timestamp: Date.now(),
        model: 'claude-sonnet-4-20250514'
      }));

      // Handle incoming messages (questions)
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
        } catch (error) {
          console.error('Error parsing client message:', error);
        }
      });

      ws.on('close', () => {
        console.log('Client disconnected');
        this.clients.delete(ws);
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

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    this.wss.close();
    this.httpServer.close();
  }
}
