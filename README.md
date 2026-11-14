# Token Radar

A token launch radar: ranks pre-token protocols by an implied value derived from
their own snapshot figures (TVL, seven-day growth, and how long they have run
with no token), and shows concrete farm plans for each one.

- `main.ts` — the entry program (Node 22, stdlib only). Reads `/input/snapshot.json`,
  writes `/output/board.json`, the dashboard data, copies `dashboard/` and
  `screenshots/` to `/output`, and writes `/output/dossier.json`.
- `dashboard/` — the static dashboard (index.html, app.css, app.js). No network.
- `screenshots/` — the three dashboard views (board, detail, filtered).
- `lib/model.ts` — the implied-value model (radar-3). Its base multiple is calibrated
  from the snapshot's own live tokens: each category's multiple is the median
  market-cap-to-TVL ratio of its live-token protocols (at least 2 live, else the
  global median), capped to 0.05–2.00; growth, maturity, watchlist and chain
  multipliers bend that base, and there is no separate category multiplier.
- `vendor/makefun-board.ts` — the kit's vendored dossier builder, unchanged.

Run locally: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>`

Built for the make.fun token-radar-01 bounty.
