# tokenless-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sayanget/tokenless-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sayanget/tokenless-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Tokenless Radar ranks every protocol in the sealed DefiLlama snapshot that records no token: the 40-slug watchlist, 20 more at or above the floor that the house list leaves out, and 138 below the floor. Each gets an implied value: TVL × a cap/TVL multiple fitted on the snapshot's own traded tokens, × 12-month launch odds read off a life table of peers. A term enters the model only if it lowers held-out error, by leave-one-out and walk-forward tests. The page refits the same model in the browser, checks every row against board.json, and gives each protocol a farm verdict in dollars and a costed, timed farm plan.

## Run it

```sh
node main.ts                     # reads /input/snapshot.json, writes /output
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json   # anywhere else
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=2skz259x&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
