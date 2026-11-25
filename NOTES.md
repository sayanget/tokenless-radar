# Notes (build log, short)

## Snapshot (as_of 2026-11-14)
- 758 protocols, 40 on the watchlist, floor $50M. 128 trade (mcap > 0), 288 record a token with no cap, 342 record none.
- Median 7-day TVL change is -8.2%: a market-wide week down, so growth is used as points against that median, not raw.
- The house rule (categories, version marker, wrapped/staked/staking word, exchange prefix, no token, >= floor) rebuilt from
  the ten fields reproduces the watchlist 40 of 40, plus 20 protocols that pass every testable rule; the parentProtocol
  rule (not in the snapshot) must be what removed them. They are ranked as "off-list".
- Ledger: watchlist 40, off-list 20, early (below floor) 138, trades 128, recorded-no-cap 288, out by rule 144 = 758.
- Token share by listing age (rankable universe): <0.5y 26%, 0.5-1y 38%, 1-2y 39%, 2-3y 63%, 3-4y 86%, 4y+ 86%, undated 88%.

## Value multiple (92 traded comps, same exclusions as the board)
Held-out median miss, as a multiple (x = 10^median|log10 error|):

| step | leave-one-out | walk-forward (by listed_at, >= 30 train) | decision |
| --- | --- | --- | --- |
| flat multiple | x4.43 | x4.73 | base |
| + size (log TVL) | x3.48 | x2.35 | kept |
| + family (5, ridge-shrunk) | x2.93 | x2.76 | not kept: walk-forward worse |
| + age | x3.39 | x3.50 | not kept |
| + 7d growth | x3.42 | x2.48 | not kept |

Fitted: log10(cap/TVL) = -0.889 - 0.603 (log10 TVL - 8), so cap grows as TVL^0.40. Rule: a term is kept only if it
lowers BOTH held-out misses. P25-P75 range from leave-one-out residuals (x0.30 to x4.0); sequential walk-forward
coverage 11 of 28 (39%, 50% would be calibrated), so ranges run narrow; the page says so.

## Launch odds (life table, 383 dated peers, 10-fold log loss)
base rate 0.697; age as log days 0.640; age as days 0.610; days flat after 3y 0.613; days flat after 4y 0.608 (chosen);
+ size 0.596, + family 0.593, + 7d growth 0.590, all kept. First try (log + linear days together) fit best (0.587) but
made the share of peers with a token fall then rise with age, which no life table allows, so only rising shapes are tried.
odds(A) = (F(A+1y) - F(A)) / (1 - F(A)), clamped to [2%, 90%]. Undated protocols are read as 5 years old (88% of
undated record a token, like the 4y+ cohort), which puts them on the 2% floor.

## Farm verdict
drop = value if launched x odds(horizon) x airdrop share x deposit/(TVL+deposit); costs = gas (tx count x chain gas,
plus a bridge/on-ramp entry off Ethereum) + trading fees (DEX/perps) + risk charge (0.5%/yr at 2y+, up to 2%/yr new).
FARM if the drop covers costs 2x, MARGINAL from 1x. Defaults $10K, 6 months, 10%: FARM 10, MARGINAL 26, SKIP 162.
Finding: every FARM is below the floor. A deposit buys more of a small protocol, and small ones trade at a higher
cap/TVL (size curve). The large watchlist names lead on value, not on return per dollar.

## Iterations
1. Odds with log + linear age: rejected (non-monotone F). 2. Linear age: old tokenless protocols got 46-60% odds,
   against the 86% plateau in the data. 3. Linear age flat after 4y: chosen by held-out loss, credible shape.
