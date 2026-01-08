// Basic tests for trading tools
// Run with: npm test

import { PositionManager } from '../tokens.js';
import { existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const POSITIONS_FILE = join(__dirname, '..', '..', '..', 'data', 'positions.json');

// Clean up positions file before tests
if (existsSync(POSITIONS_FILE)) {
  unlinkSync(POSITIONS_FILE);
  console.log('🧹 Cleaned up positions.json for testing\n');
}

console.log('🧪 Running Trading Tools Tests\n');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  // Clean positions file before each test
  if (existsSync(POSITIONS_FILE)) {
    unlinkSync(POSITIONS_FILE);
  }

  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error}`);
    failed++;
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (actual >= expected) {
        throw new Error(`Expected ${actual} to be less than ${expected}`);
      }
    },
    not: {
      toBeNull() {
        if (actual === null || actual === undefined) {
          throw new Error(`Expected value but got ${actual}`);
        }
      }
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
  };
}

// === PositionManager Tests ===

console.log('--- PositionManager ---\n');

test('should create empty position manager', () => {
  const pm = new PositionManager(15, 50);
  expect(pm.getAllPositions().length).toBe(0);
});

test('should open a position', () => {
  const pm = new PositionManager(15, 50);
  const position = pm.openPosition(
    'test-token-address',
    'TEST',
    1000,       // amount
    0.001,      // entry price
    0.1         // cost basis (SOL)
  );

  expect(position.tokenSymbol).toBe('TEST');
  expect(position.amount).toBe(1000);
  expect(position.entryPrice).toBe(0.001);
  expect(position.costBasis).toBe(0.1);
  expect(pm.getAllPositions().length).toBe(1);
});

test('should calculate stop loss correctly (15% below entry)', () => {
  const pm = new PositionManager(15, 50);
  const position = pm.openPosition('addr', 'TEST', 100, 1.0, 0.1);

  // Stop loss should be 15% below $1.00 = $0.85
  expect(position.stopLoss).toBe(0.85);
});

test('should calculate take profit correctly (50% above entry)', () => {
  const pm = new PositionManager(15, 50);
  const position = pm.openPosition('addr', 'TEST', 100, 1.0, 0.1);

  // Take profit should be 50% above $1.00 = $1.50
  expect(position.takeProfit).toBe(1.5);
});

test('should update price and detect stop loss trigger', () => {
  const pm = new PositionManager(15, 50);
  pm.openPosition('addr', 'TEST', 100, 1.0, 0.1);

  // Price drops to $0.80 (below stop loss of $0.85)
  const result = pm.updatePrice('addr', 0.80);

  expect(result.shouldSell).toBe(true);
  expect(result.reason).toBe('stop_loss');
});

test('should update price and detect take profit trigger', () => {
  const pm = new PositionManager(15, 50);
  pm.openPosition('addr', 'TEST', 100, 1.0, 0.1);

  // Price rises to $1.60 (above take profit of $1.50)
  const result = pm.updatePrice('addr', 1.60);

  expect(result.shouldSell).toBe(true);
  expect(result.reason).toBe('take_profit');
});

test('should not trigger sell when price is in range', () => {
  const pm = new PositionManager(15, 50);
  pm.openPosition('addr', 'TEST', 100, 1.0, 0.1);

  // Price at $1.20 (between stop loss and take profit)
  const result = pm.updatePrice('addr', 1.20);

  expect(result.shouldSell).toBe(false);
});

test('should close position and calculate P&L', () => {
  const pm = new PositionManager(15, 50);
  pm.openPosition('addr', 'TEST', 100, 1.0, 0.1); // Bought for 0.1 SOL

  // Close at profit - received 0.15 SOL
  const result = pm.closePosition('addr', 1.5, 0.15);

  expect(result).not.toBeNull();
  // Use approximate comparison for floating point
  expect(Math.abs(result!.pnlSol - 0.05) < 0.0001).toBe(true);
  expect(Math.abs(result!.pnlPercent - 50) < 0.001).toBe(true); // 50% gain
  expect(pm.getAllPositions().length).toBe(0);
});

test('should track multiple positions', () => {
  const pm = new PositionManager(15, 50);

  pm.openPosition('addr1', 'TEST1', 100, 1.0, 0.1);
  pm.openPosition('addr2', 'TEST2', 200, 2.0, 0.2);

  expect(pm.getAllPositions().length).toBe(2);

  const pos1 = pm.getPosition('addr1');
  const pos2 = pm.getPosition('addr2');

  expect(pos1?.tokenSymbol).toBe('TEST1');
  expect(pos2?.tokenSymbol).toBe('TEST2');
});

test('should serialize and deserialize correctly', () => {
  const pm = new PositionManager(15, 50);
  pm.openPosition('addr', 'TEST', 100, 1.0, 0.1);

  const json = pm.toJSON();

  // Clean file before restoring
  if (existsSync(POSITIONS_FILE)) {
    unlinkSync(POSITIONS_FILE);
  }

  const restored = PositionManager.fromJSON(json);

  expect(restored.getAllPositions().length).toBe(1);
  expect(restored.getAllPositions()[0].tokenSymbol).toBe('TEST');
});

// === Summary ===

// Clean up after all tests
if (existsSync(POSITIONS_FILE)) {
  unlinkSync(POSITIONS_FILE);
}

console.log('\n' + '═'.repeat(40));
console.log(`Tests: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(40));

if (failed > 0) {
  process.exit(1);
}
