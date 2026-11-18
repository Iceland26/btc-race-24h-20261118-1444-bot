# btc-race-24h-20261118-1444-bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Iceland26/btc-race-24h-20261118-1444-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Iceland26/btc-race-24h-20261118-1444-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A dip-buy washout bot that trades cbBTC (Coinbase Wrapped BTC) minute by minute against USDC. Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $250 in USDC.

## Strategy

One position at a time, full cash, long only — the pattern past races rewarded (deep-dip buys held through the recovery), not breakout chasing:

- **Enter** only after a genuine washout: the close is at least 200 bps below the highest close of the last 240 bars **and** at least 60 bps back above the lowest close of the last 60 bars (the fall has stabilised — no catching a knife still in free fall).
- **Exit** on take-profit (+250 bps from the entry close), a disaster stop (−80 bps, wide enough to survive dip noise), or a trailing stop (150 bps below the peak close since entry).
- **At most 2 entries** per window, with a 240-bar cooldown after any exit, and no fresh entry in the final 30 bars.
- **No fallback trade**: if no washout sets up, the bot holds cash and scores $0 rather than forcing exposure.

Every decision is a pure function of the bars seen so far — no clock, no randomness, no environment reads — so two runs on the same data produce identical orders. A full-size round trip costs roughly 26 bps (4 bps fee + 2 bps slippage + price impact), so a trade must catch a move clearly larger than that.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` on stdin/stdout (see `vendor/makefun-bars.ts`, the kit's SDK shim). Grade it locally with the competition kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot <repository> --driver docker
```

## Layout

- `main.ts` — the bot (entry, exits, cooldown, determinism).
- `vendor/makefun-bars.ts` — the kit's bars-replay SDK shim, copied byte-for-byte.
- `LICENSE` — MIT.

---

<sub>Entered on [make.fun](https://make.fun/?ref=006egfwh&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
