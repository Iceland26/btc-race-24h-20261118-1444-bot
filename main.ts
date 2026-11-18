// Dip-buy washout + hold bot for make.fun btc-race-24h-20261118-1444.
//
// Pattern proven by past race winners (0828 rank 1, 2314): do not chase
// breakouts. Wait for a genuine washout — price down sharply from its
// rolling high — then buy only once the fall has stabilised (close back
// above the recent low by a confirmation margin), take one full-cash
// position, and hold through the recovery with a wide take-profit, a
// disaster stop with real room, and an optional wide trailing stop.
// Deterministic: a pure function of the bars seen so far.
//
// Fill model (kit RULES.txt): an order decided on the bar closing at
// minute t fills at the next bar's open, paying 4 bps fee + 2 bps
// modelled slippage + constant-product impact, roughly 26 bps round trip
// at full size. A dip entry after a >=200 bps washout with a wide
// target clears that cost with room to spare.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10_000n;

// Entry: drawdown from the rolling 240-bar high of at least 200
// bps (the washout), AND the close at least 60 bps above the lowest
// close of the last 60 bars (stabilisation: the knife has stopped
// falling). History is window-to-date until the full window exists.
const DRAWDOWN_BPS = 200n;
const HIGH_WINDOW = 240;
const BOUNCE_BPS = 60n;
const LOW_WINDOW = 60;
const MIN_HISTORY = 60;

// Exits, in bps from the entry bar's close (fills land one bar later at
// the next open, so realised values differ by a few bps).
const TAKE_PROFIT_BPS = 250n;
const STOP_BPS = 80n;
const TRAIL_BPS = 150n; // 0 disables the trailing stop

// One position at a time; 2 entries per window at most, with a
// long cooldown after any exit; no entry in the final 30 bars.
const MAX_TRADES = 2;
const COOLDOWN_BARS = 240;
const LAST_ENTRY_BAR = 1410;
const MAX_SLIPPAGE_BPS = 150;

interface Position {
  entryClose: bigint;
  peakClose: bigint;
}

const closes: bigint[] = [];
let position: Position | null = null;
let cooldownUntilBar = -1;
let tradesTaken = 0;

function extreme(window: number, wantHigh: boolean): bigint | null {
  const n = Math.min(window, closes.length);
  if (n < MIN_HISTORY) return null;
  let best = closes[closes.length - n]!;
  for (let i = closes.length - n + 1; i < closes.length; i++) {
    const c = closes[i]!;
    if (wantHigh ? c > best : c < best) best = c;
  }
  return best;
}

function shouldEnter(state: BarsState): boolean {
  if (position !== null) return false;
  if (state.warmingUp) return false;
  if (closes.length < MIN_HISTORY) return false;
  if (closes.length > LAST_ENTRY_BAR) return false;
  if (closes.length <= cooldownUntilBar) return false;
  if (tradesTaken >= MAX_TRADES) return false;
  if (state.cash <= 0n) return false;

  const close = closes[closes.length - 1]!;
  const high = extreme(HIGH_WINDOW, true)!;
  // (high - close) * 10000 >= DD * high
  if ((high - close) * BPS < DRAWDOWN_BPS * high) return false;

  const low = extreme(LOW_WINDOW, false)!;
  // (close - low) * 10000 >= BOUNCE * low
  if ((close - low) * BPS < BOUNCE_BPS * low) return false;

  return true;
}

function shouldExit(): 'take-profit' | 'stop' | 'trailing' | null {
  if (position === null) return null;
  const close = closes[closes.length - 1]!;
  const { entryClose, peakClose } = position;
  if ((close - entryClose) * BPS >= TAKE_PROFIT_BPS * entryClose) return 'take-profit';
  if ((entryClose - close) * BPS >= STOP_BPS * entryClose) return 'stop';
  if (TRAIL_BPS > 0n && (peakClose - close) * BPS >= TRAIL_BPS * peakClose) return 'trailing';
  return null;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    closes.push(BigInt(bar.c));

    const held = state.positions.get(SYMBOL);
    const qty = held?.qty ?? 0n;

    if (position !== null && qty > 0n) {
      const close = closes[closes.length - 1]!;
      if (close > position.peakClose) position.peakClose = close;
    } else if (position !== null && qty === 0n) {
      position = null;
    }

    if (position !== null && qty > 0n) {
      const exit = shouldExit();
      if (exit !== null) {
        cooldownUntilBar = closes.length + COOLDOWN_BARS;
        position = null;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (shouldEnter(state)) {
      const close = closes[closes.length - 1]!;
      position = { entryClose: close, peakClose: close };
      tradesTaken += 1;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
