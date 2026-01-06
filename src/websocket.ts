import { WebSocketServer, WebSocket } from 'ws';
import type { ThoughtMessage } from './agent.js';

export type QuestionHandler = (question: string, from: string) => string;

export class ThoughtBroadcaster {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private onQuestion: QuestionHandler | null = null;
  private queueLength: () => number = () => 0;

  constructor(port: number = 8080) {
    this.wss = new WebSocketServer({ port });

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

    console.log(`WebSocket server running on ws://localhost:${port}`);
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

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    this.wss.close();
  }
}
