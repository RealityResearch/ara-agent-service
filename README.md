# $ARA Agent Service

Autonomous AI trading agent for Claude Investments ($ARA) - powered by Claude.

## Features

- Real-time market analysis via Claude AI
- WebSocket server for live thought streaming
- Pump.fun API integration for price/volume data
- Q&A system for community questions

## Setup

```bash
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm run dev
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Yes |
| `WS_PORT` | WebSocket server port (default: 8080) | No |
| `ANALYSIS_INTERVAL` | Ms between analyses (default: 30000) | No |
| `CONTRACT_ADDRESS` | Token contract address | No |
| `CREATOR_WALLET` | Creator wallet to track | No |

## Deploy to Railway

1. Connect this repo to Railway
2. Set environment variables in Railway dashboard
3. Deploy

The service will start the WebSocket server automatically.

## Connect Frontend

Set in your Vercel environment:
```
NEXT_PUBLIC_AGENT_WS_URL=wss://your-railway-url.railway.app
```
