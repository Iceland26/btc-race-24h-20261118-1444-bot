// Washout-recovery violent-breakout bot for make.fun btc-race-24h-20261118-1444.
//
// Idea (written fresh in this session): a violent 5-bar surge only counts as a
// buy when it is also a bounce off a recent low, not a dead-cat bounce in a
// grind-down. Enter full cash on one position, exit on take-profit, a tight
// stop, or a trailing stop, then cool down before the next entry. No fallback
// trade, no clock, no randomness, no environment reads: every decision is a
// pure function of the bars seen so far, so two runs on the same data answer
// identically.
//
// Fill model the bot is built for (kit RULES.txt): an order decided on the bar
// closing at minute t fills at the next bar's open, paying 4 bps fee + 2 bps
// modelled slippage + constant-product price impact against that bar's open
// depth, so a full-size round trip costs roughly 26 bps. A trade must
// therefore catch a move clearly larger than that to be worth taking.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10_000n;

// Entry: close at least 90 bps above the close 5 bars ago (violent breakout)
// AND at least 60 bps above the lowest close of the last 120 bars (the surge
// is a recovery off a washout low, not a flicker inside a downtrend).
const BREAKOUT_BPS = 90n;
const BREAKOUT_LOOKBACK = 5;
const RECOVERY_BPS = 60n;
const LOW_WINDOW = 120;

// Exits, all measured in bps from the entry bar's close (the fill lands one
// bar later at the next open, so the realised exit differs by a few bps).
const TAKE_PROFIT_BPS = 250n;
const STOP_BPS = 30n;
const TRAIL_BPS = 60n;

// Risk controls: one trade at a time, 60 bars of cooldown after any exit,
// and no fresh entry in the final 10 bars (an entry that late cannot reach
// its target before the window flattens everything at the last close).
const COOLDOWN_BARS = 60;
const LAST_ENTRY_BAR = 1430;

// max_slippage_bps bounds the move from the latest close to the fill: the
// modelled slippage (2 bps) plus own price impact (about 7 bps full-size at
// the frozen pool depth) plus the open-vs-close gap. 150 bps is loose enough
// to never reject a genuine entry and tight enough to refuse a fill that has
// run far away from the close the decision was made on.
const MAX_SLIPPAGE_BPS = 150;

interface Position {
  entryClose: bigint;
  peakClose: bigint;
}

const closes: bigint[] = [];
let position: Position | null = null;
let cooldownUntilBar = -1;

function lowOf(window: number): bigint | null {
  if (closes.length < window) return null;
  let low = closes[closes.length - 1]!;
  for (let i = closes.length - window; i < closes.length; i++) {
    if (closes[i]! < low) low = closes[i]!;
  }
  return low;
}

function shouldEnter(state: BarsState): boolean {
  if (position !== null) return false;
  if (state.warmingUp) return false;
  if (closes.length < LOW_WINDOW) return false;
  if (closes.length > LAST_ENTRY_BAR) return false;
  if (closes.length <= cooldownUntilBar) return false;
  if (state.cash <= 0n) return false;

  const close = closes[closes.length - 1]!;
  const fiveAgo = closes[closes.length - 1 - BREAKOUT_LOOKBACK]!;
  // close >= fiveAgo * (1 + 90 bps), in integers: (close - fiveAgo) * 10000 >= 90 * fiveAgo
  if ((close - fiveAgo) * BPS < BREAKOUT_BPS * fiveAgo) return false;

  const low = lowOf(LOW_WINDOW)!;
  // close >= low * (1 + 60 bps)
  if ((close - low) * BPS < RECOVERY_BPS * low) return false;

  return true;
}

function shouldExit(): 'take-profit' | 'stop' | 'trailing' | null {
  if (position === null) return null;
  const close = closes[closes.length - 1]!;
  const { entryClose, peakClose } = position;
  if ((close - entryClose) * BPS >= TAKE_PROFIT_BPS * entryClose) return 'take-profit';
  if ((entryClose - close) * BPS >= STOP_BPS * entryClose) return 'stop';
  if ((peakClose - close) * BPS >= TRAIL_BPS * peakClose) return 'trailing';
  return null;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    closes.push(BigInt(bar.c));

    const held = state.positions.get(SYMBOL);
    const qty = held?.qty ?? 0n;

    // Keep the tracked peak honest with every close while long.
    if (position !== null && qty > 0n) {
      const close = closes[closes.length - 1]!;
      if (close > position.peakClose) position.peakClose = close;
    } else if (position !== null && qty === 0n) {
      // The position is gone (filled exit or end-of-window flatten): clear it.
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
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
