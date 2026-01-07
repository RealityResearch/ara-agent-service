import { discoverTokens } from './dist/tools/discovery.js';

console.log('🔍 Scanning for high-conviction plays (>50k liq, high volume)...\n');

const result = await discoverTokens({
  minLiquidity: 50000,
  minVolume24h: 100000,
  maxAge: 48,
  minBuys24h: 500,
  chainId: 'solana'
});

// Filter for best opportunities
const topPicks = result.filter(t => {
  const buyRatio = t.txns24h.buys / (t.txns24h.buys + t.txns24h.sells);
  const notDumping = !t.flags.includes('DUMPING');
  return t.score >= 80 && buyRatio > 0.5 && notDumping;
});

console.log('=== TOP PICKS FOR 2X TARGET ===\n');

for (const t of topPicks.slice(0, 8)) {
  const buyRatio = (t.txns24h.buys / (t.txns24h.buys + t.txns24h.sells) * 100).toFixed(0);
  const volLiqRatio = (t.volume24h / t.liquidity).toFixed(1);
  console.log(`📈 ${t.name} (${t.symbol}) - SCORE: ${t.score}/100`);
  console.log(`   Price: $${t.priceUsd.toFixed(8)} | 24h: ${t.priceChange24h >= 0 ? '+' : ''}${t.priceChange24h.toFixed(1)}%`);
  console.log(`   Liquidity: $${(t.liquidity/1000).toFixed(0)}K | Volume: $${(t.volume24h/1000).toFixed(0)}K (Vol/Liq: ${volLiqRatio}x)`);
  console.log(`   Buys: ${t.txns24h.buys} | Sells: ${t.txns24h.sells} (Buy ratio: ${buyRatio}%)`);
  console.log(`   Age: ${Math.floor((Date.now() - t.pairCreatedAt) / 3600000)}h | Boost: ${t.boostAmount || 0}`);
  if (t.flags.length > 0) console.log(`   ⚠️ ${t.flags.join(', ')}`);
  console.log(`   🔗 ${t.address}`);
  console.log('');
}

console.log(`\nFound ${topPicks.length} tokens matching criteria (>$50k liq, >$100k vol, >500 buys, not dumping)`);
