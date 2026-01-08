// Environment variable validation and configuration
// Fails fast on startup if required config is missing

interface EnvConfig {
  // Required
  ANTHROPIC_API_KEY: string;

  // Optional with defaults
  PORT: number;
  WS_PORT: number;
  ANALYSIS_INTERVAL: number;
  AGENT_ENABLED: boolean;
  TRADING_ENABLED: boolean;
  MEMORY_ENABLED: boolean;

  // Optional - trading
  CONTRACT_ADDRESS: string | null;
  CREATOR_WALLET: string | null;
  SOLANA_PRIVATE_KEY: string | null;
  SOLANA_RPC_URL: string;
  HELIUS_API_KEY: string | null;

  // Optional - features
  FIRECRAWL_API_KEY: string | null;
  DISCOVERY_INTERVAL: number;
}

class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function validateEnv(): EnvConfig {
  const errors: string[] = [];

  // Required: ANTHROPIC_API_KEY
  if (!process.env.ANTHROPIC_API_KEY) {
    errors.push('ANTHROPIC_API_KEY is required');
  }

  // If trading is enabled, require wallet key
  const tradingEnabled = process.env.TRADING_ENABLED !== 'false';
  if (tradingEnabled && !process.env.SOLANA_PRIVATE_KEY) {
    errors.push('SOLANA_PRIVATE_KEY is required when TRADING_ENABLED=true');
  }

  // Validate numeric values
  const analysisInterval = parseInt(process.env.ANALYSIS_INTERVAL || '30000');
  if (isNaN(analysisInterval) || analysisInterval < 5000) {
    errors.push('ANALYSIS_INTERVAL must be a number >= 5000ms');
  }

  // Fail fast if any errors
  if (errors.length > 0) {
    console.error('\n❌ CONFIGURATION ERROR');
    console.error('═'.repeat(50));
    errors.forEach(err => console.error(`  • ${err}`));
    console.error('═'.repeat(50));
    console.error('\nRequired environment variables:');
    console.error('  ANTHROPIC_API_KEY     - Your Anthropic API key');
    console.error('  SOLANA_PRIVATE_KEY    - Base58 wallet key (if trading)');
    console.error('\nOptional:');
    console.error('  TRADING_ENABLED       - true/false (default: true)');
    console.error('  AGENT_ENABLED         - true/false (default: true)');
    console.error('  ANALYSIS_INTERVAL     - ms between cycles (default: 30000)');
    console.error('  SOLANA_RPC_URL        - Custom RPC endpoint');
    console.error('  HELIUS_API_KEY        - For premium RPC');
    console.error('');
    throw new ConfigError(`Missing required configuration: ${errors.join(', ')}`);
  }

  // Build validated config
  const config: EnvConfig = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    PORT: parseInt(process.env.PORT || process.env.WS_PORT || '8080'),
    WS_PORT: parseInt(process.env.WS_PORT || process.env.PORT || '8080'),
    ANALYSIS_INTERVAL: analysisInterval,
    AGENT_ENABLED: process.env.AGENT_ENABLED !== 'false',
    TRADING_ENABLED: tradingEnabled,
    MEMORY_ENABLED: process.env.MEMORY_ENABLED !== 'false',
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || null,
    CREATOR_WALLET: process.env.CREATOR_WALLET || null,
    SOLANA_PRIVATE_KEY: process.env.SOLANA_PRIVATE_KEY || null,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    HELIUS_API_KEY: process.env.HELIUS_API_KEY || null,
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || null,
    DISCOVERY_INTERVAL: parseInt(process.env.DISCOVERY_INTERVAL || '120000'),
  };

  // Log configuration summary
  console.log('\n📋 Configuration loaded:');
  console.log('─'.repeat(40));
  console.log(`  Agent:     ${config.AGENT_ENABLED ? '✅ Enabled' : '⏸️  Paused'}`);
  console.log(`  Trading:   ${config.TRADING_ENABLED ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`  Memory:    ${config.MEMORY_ENABLED ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`  Interval:  ${config.ANALYSIS_INTERVAL / 1000}s`);
  console.log(`  Port:      ${config.PORT}`);
  if (config.HELIUS_API_KEY) {
    console.log(`  RPC:       Helius (premium)`);
  } else {
    console.log(`  RPC:       ${config.SOLANA_RPC_URL.slice(0, 40)}...`);
  }
  console.log('─'.repeat(40));

  return config;
}

// Validate and export config
export const config = validateEnv();
export default config;
