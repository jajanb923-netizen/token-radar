# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jajanb923-netizen/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jajanb923-netizen/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: ranks pre-token protocols by an implied value derived from
their own snapshot figures (TVL, seven-day growth, and how long they have run
with no token), and shows concrete farm plans for each one.

- `main.ts` — the entry program (Node 22, stdlib only). Reads `/input/snapshot.json`,
  writes `/output/board.json`, the dashboard data, copies `dashboard/` and
  `screenshots/` to `/output`, and writes `/output/dossier.json`.
- `dashboard/` — the static dashboard (index.html, app.css, app.js). No network.
- `screenshots/` — the three dashboard views (board, detail, filtered).
- `lib/model.ts` — the implied-value model (radar-4). Its base multiple is calibrated
  from the snapshot's own live tokens: each category's multiple starts as the median
  market-cap-to-TVL ratio of its live-token protocols (at least 2 live, else the
  global median), then is shrunk toward the global median — (n × median + 2 × global
  median) / (n + 2) — so a two-protocol median cannot dominate, and capped to
  0.05–2.00; growth, maturity, watchlist and chain multipliers bend that base, and
  there is no separate category multiplier.
- `vendor/makefun-board.ts` — the kit's vendored dossier builder, unchanged.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=vttfhgk4&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
