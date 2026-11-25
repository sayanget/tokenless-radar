/* Tokenless Radar: the farm verdict and the farm plan. The page and main.ts load this same file.
   A verdict nets the modelled drop against gas, fees and a risk charge for one deposit and horizon;
   a plan is built from the protocol's category, main chain, TVL and age, never from its name. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RadarFarm = factory();
})(this, function () {
  'use strict';

  var DEFAULTS = { deposit: 10000, months: 6, dropShare: 0.1 };
  var TBILL = 0.04; // a T-bill's yield a year, for scale only: the deposit's own yield is not in the snapshot
  // Assumed gas per transaction in USD by main chain; any chain not named is priced as an L2.
  var GAS = { Ethereum: 2.5, Bitcoin: 1.5, Tron: 1, Binance: 0.1, Avalanche: 0.1, Polygon: 0.02, Solana: 0.01, Sui: 0.01, Aptos: 0.01, Stellar: 0.01, Algorand: 0.01, Ripple: 0.01 };
  var L2_GAS = 0.05;

  function chainOf(row) { return row.chains && row.chains.length ? row.chains[0] : 'its main chain'; }
  function gasPerTx(row) { var g = GAS[chainOf(row)]; return g === undefined ? L2_GAS : g; }
  function usd(n) {
    var a = Math.abs(n), s = n < 0 ? '\u2212$' : '$';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + Math.round(a / 1e3) + 'K';
    if (a >= 10) return s + String(Math.round(a)).replace(/\B(?=(\d{3})+$)/g, ',');
    return s + a.toFixed(2);
  }
  /** riskCharge: expected loss a year, 2% for a protocol listed today falling to 0.5% at two years (an assumption). */
  function riskRate(ageDays) {
    var a = ageDays === null ? 730 : ageDays;
    return 0.005 + 0.015 * Math.max(0, 1 - a / 730);
  }
  /** What the plan does, by category; each kind sets its own transactions a month. */
  function actionOf(row, s) {
    var c = row.category || '', d = usd(s.deposit), name = row.name, chain = chainOf(row);
    if (/Curator|Allocator|^Yield|Farm|Options Vault|Indexes|Leveraged/.test(c)) return { kind: 'vault', monthly: 1, text: 'Deposit ' + d + ' USDC into the ' + name + ' vault with the most TVL on ' + chain + '; hold the vault shares and do not loop them.' };
    if (c === 'CDP') return { kind: 'cdp', monthly: 1, text: 'Lock collateral worth ' + d + ' in ' + name + ' on ' + chain + ' and mint its stablecoin at no more than 35% loan-to-value; park the minted stable in its savings module.' };
    if (/Lending|Collateral|CDP Manager/.test(c)) return { kind: 'lend', monthly: 1, text: 'Supply ' + d + ' USDC to ' + name + ' on ' + chain + ' and borrow nothing; if its points page counts borrowing, borrow at most 25% loan-to-value.' };
    if (/Dexs|Liquidity Manager|OTC/.test(c)) return { kind: 'dex', monthly: 2, text: 'Add ' + d + ' to the deepest stable-to-stable pool on ' + name + ' (' + chain + '), full range, so impermanent loss stays near zero; make one swap a week.' };
    if (/Derivatives|Options|Prediction/.test(c)) return { kind: 'perp', monthly: 4, text: 'Deposit ' + d + ' as margin on ' + name + ' (' + chain + ') and either fund its liquidity vault or hold a small hedged position; venues like this usually score volume and open interest.' };
    if (/RWA|Basis|Stablecoin|Stable|CeDeFi|DOR|Reserve/.test(c)) return { kind: 'stable', monthly: 1, text: 'Mint the yield-bearing token of ' + name + ' with ' + d + ' USDC on ' + chain + ' (clear its KYC or whitelist first) and stake it in the protocol\'s own module if it lists one.' };
    if (c === 'Chain') return { kind: 'chain', monthly: 3, text: 'Bridge ' + d + ' to ' + chain + ' through its canonical bridge, then use its two largest apps every month: one swap and one deposit.' };
    if (/Staking|Restaking|Governance/.test(c)) return { kind: 'stake', monthly: 1, text: 'Stake or delegate ' + d + ' through ' + name + ' on ' + chain + ' and keep the receipt token in the same wallet.' };
    if (c === 'Payments') return { kind: 'pay', monthly: 2, text: 'Fund a ' + d + ' channel or account through ' + name + ' on ' + chain + ' and route a few real payments each month.' };
    if (c === 'Insurance') return { kind: 'cover', monthly: 1, text: 'Provide ' + d + ' to the ' + name + ' cover pool on ' + chain + ', or buy cover on a position you already hold.' };
    return { kind: 'deposit', monthly: 1, text: 'Deposit ' + d + ' USDC into ' + name + ' on ' + chain + ' and keep the position open.' };
  }

  /** farmVerdict: modelled drop for this deposit and horizon, netted against gas, fees and the risk charge. */
  function farmVerdict(Model, model, row, s) {
    var act = actionOf(row, s), gas = gasPerTx(row), ethereum = chainOf(row) === 'Ethereum';
    var odds = Model.launchOdds(model.curve, row, s.months * 30.44);
    var share = s.deposit / (row.tvl_usd + s.deposit);
    var drop = row.value_if_launched * odds * s.dropShare * share;
    var txs = 3 + act.monthly * s.months + 2;
    var entry = ethereum ? 0 : 3 + 0.0005 * s.deposit; // bridge or on-ramp in, an assumption
    var fees = act.kind === 'perp' || act.kind === 'dex' ? 0.0005 * s.deposit * s.months : 0;
    var gasCost = txs * gas + entry;
    var risk = s.deposit * riskRate(row.age_days) * s.months / 12;
    var cost = gasCost + fees + risk, net = drop - cost, cover = drop / cost;
    var hours = 1 + (act.monthly > 1 ? 0.5 : 0.25) * s.months + 0.5;
    return {
      action: act, odds: odds, share: share, drop: drop, txs: txs, gasPerTx: gas, gas: gasCost, fees: fees, risk: risk, cost: cost,
      net: net, cover: cover, hours: hours, perHour: net / hours, dropApr: drop / s.deposit * 12 / s.months,
      verdict: cover >= 2 ? 'FARM' : cover >= 1 ? 'MARGINAL' : 'SKIP'
    };
  }

  /** farmPlan: numbered steps, each with what it costs and how long it takes, for this row and settings. */
  function farmPlan(row, v, s) {
    var chain = chainOf(row), g = v.gasPerTx, exitAt = row.tvl_usd * 0.7;
    var weekly = v.action.monthly > 1 ? 30 : 15;
    return [
      { step: 'Verify: open ' + row.name + ' on DefiLlama (defillama.com/protocol/' + row.slug + '), follow the website it lists, and match the ' + chain + ' contract you will approve against the protocol\'s own docs. Never claim from a link sent to you.', cost: '$0', time: '15 min' },
      { step: 'Wallet: make a fresh wallet for this farm only and fund it with ' + usd(s.deposit) + ' USDC on ' + chain + ' plus about ' + usd(Math.max(1, g * v.txs * 1.5)) + ' of the gas token; keep the seed offline.', cost: chain === 'Ethereum' ? '$0 if your USDC is already there' : usd(3 + 0.0005 * s.deposit) + ' to bridge or on-ramp', time: '20 min, plus up to 30 min for a bridge' },
      { step: 'Position: ' + v.action.text, cost: usd(3 * g) + ' gas (approve and deposit)', time: '20 min' },
      { step: 'Keep it counted: once a month for ' + s.months + ' months, open the points or rewards page, claim or compound if offered, and check the position is still open (' + v.action.monthly + ' transaction' + (v.action.monthly > 1 ? 's' : '') + ' a month).', cost: usd(v.action.monthly * g) + ' gas a month' + (v.fees > 0 ? ' plus about ' + usd(v.fees / s.months) + ' of trading fees' : ''), time: weekly + ' min a month' },
      { step: 'Exit rule: withdraw if TVL falls below ' + usd(exitAt) + ' (30% under the snapshot\'s ' + usd(row.tvl_usd) + '), if the protocol pauses withdrawals, or at month ' + s.months + '; then revoke every approval this wallet gave.', cost: usd(2 * g) + ' gas (withdraw and revoke)', time: '30 min' },
      { step: 'At launch: check eligibility only on the protocol\'s own domain, claim, and at once sell enough to cover the ' + usd(v.cost) + ' cost basis; hold the rest only if the token trades at or above the modelled ' + usd(row.value_if_launched) + ' cap.', cost: usd(2 * g) + ' gas (claim and swap) plus the swap\'s fee', time: '20 min on launch day' },
      { step: 'Ledger: log each transaction (date, hash, amount, gas). Cost basis ' + usd(v.cost) + ' (gas ' + usd(v.gas) + ', fees ' + usd(v.fees) + ', risk charge ' + usd(v.risk) + ') against a modelled drop of ' + usd(v.drop) + ': ' + v.verdict + ', the drop covers costs ' + v.cover.toFixed(1) + ' times.', cost: '$0', time: '5 min per transaction' }
    ];
  }
  function stepText(st, i) { return (i + 1) + '. ' + st.step + ' Cost: ' + st.cost + '. Time: ' + st.time + '.'; }

  return { DEFAULTS: DEFAULTS, TBILL: TBILL, GAS: GAS, L2_GAS: L2_GAS, farmVerdict: farmVerdict, farmPlan: farmPlan, stepText: stepText, riskRate: riskRate, usd: usd, chainOf: chainOf };
});
