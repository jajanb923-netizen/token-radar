// The token radar's model, version 4: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// strongest pre-token protocols below the floor by implied value, not by TVL alone. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures. No protocol name is ever special-cased:
// the same function scores every row. The formula, in full:
//
//   base        = tvl_usd x calibrated_multiple(category)
//                 The multiple is CALIBRATED from the snapshot's own live tokens, not fixed: for
//                 each category, the median market-cap-to-TVL ratio of the live-token protocols in
//                 that category (a live protocol counts when its mcap_usd and tvl_usd are both
//                 present and positive; a recorded market cap of zero is no price at all, so it
//                 carries no signal). A category needs at least 2 live protocols to earn its own
//                 multiple; fewer than that, and a category with no live protocol at all, falls back
//                 to the global median across all live protocols. But a median from two protocols is
//                 a noisy estimate — the ratio spread runs from 0.0003 to 400.2 across the 128 live
//                 protocols, and 8 of the 22 calibrated categories have exactly 2 live protocols —
//                 so the category median is SHRUNK toward the global median before it is used:
//                 multiple = (n x category median + k x global median) / (n + k), with k = 2. At
//                 the thinnest n = 2 the estimate is half category, half global; at n = 15 it is
//                 88% the category's own median, so well-measured categories barely move while the
//                 thinnest ones are pulled decisively toward the market. Every multiple is capped
//                 into [0.05, 2.0] after shrinking, so one outlier cannot dominate. Because the
//                 calibrated multiple now carries the category effect, there is NO separate category
//                 multiplier: adding one would double-count the same signal.
//   growth      = clamp(change_7d, -50, 150) per cent           (a 4448% week is capped: one spike
//                                                                must not outrank a whole protocol)
//   growthMult  = 1 + (growth / 100) x GROWTH_WEIGHT           (0.55; growth is a signal, not a
//                                                                guarantee, so it bends value, never
//                                                                doubles it outright)
//   maturity    = 0.55 + min(age_days, 1460) / 1460 x 0.55      (a protocol that has run tokenless for
//                                                                four years is worth more per TVL dollar
//                                                                than one listed last month; age unknown:
//                                                                365 days)
//   watchlist   = 1.30 when the slug is on the snapshot's watchlist, else 1.0
//                                                                (the house drew that floor itself: at
//                                                                least $50M of TVL, no token, not a
//                                                                wrapped, staked or bridged product of a
//                                                                token that trades. Being on it is the
//                                                                strongest single signal the snapshot
//                                                                carries.)
//   chains      = 1 + min(chains - 1, 4) x 0.03                 (a protocol live on more chains has more
//                                                                surface to farm; capped at +12%)
//   implied     = max(1, round(base x growthMult x maturity x watchlist x chains))
//
// On this snapshot the calibration finds 128 live protocols with a positive market cap. The global
// median is 0.2138. After shrinkage the base multiples run from 0.0721 (Liquid Staking) to 2.0
// (Token Locker, still capped — its raw median is 9.5204 from only 2 live protocols), with Dexs at
// 0.3226, RWA at 0.2637, Basis Trading at 0.5565, Canonical Bridge at 0.6399 and Cross Chain Bridge
// at 0.8849. The thinnest categories move the most: Derivatives 2.1619 to 1.1879, Staking Pool
// 0.0018 to 0.1078, Onchain Capital Allocator 0.0125 to 0.1132 — none of them sits on the floor or
// the cap because of two protocols alone any more. Nine categories on the board have no live
// protocol at all, so they take the global fallback. The calibration is recomputed from the snapshot
// on every run: nothing in it is a hard-coded number about a protocol or a category.
//
// Farm plans are derived from the same record: the protocol's category picks the plan's actions, its
// TVL sets the capital, its age sets the hold, its primary chain sets where the work happens, and a
// watchlist row or a fast-growing row gets one extra step. Every step names the protocol and its
// primary chain and carries what it costs and how long it takes.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. The base multiple is not one of them: it is
 * calibrated from the snapshot on every run (see Calibration), so it cannot be a fixed constant. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  watchlist_multiple: number;
  chain_step: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.55,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.55,
  maturity_days: 1460,
  unknown_age_days: 365,
  watchlist_multiple: 1.3,
  chain_step: 0.03,
  chain_cap: 4,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

/** How many pre-token protocols below the watchlist floor the early radar carries, by implied value. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A live protocol counts toward the calibration only when both figures are present and positive. */
export const CALIBRATION_MIN_LIVE = 2;

/** The shrinkage pseudo-count: each category's median is blended with this many observations at the
 * global median. k = 2 is the size of the smallest calibrated sample, so the thinnest category (n = 2)
 * is weighted exactly half on its own median and half on the global one; a category with 15 live
 * protocols keeps 88% of its own median. Smaller k leaves a two-protocol median in charge; larger k
 * drags even well-measured categories toward the global median and flattens the ranking. */
export const SHRINKAGE_K = 2;

/** The band every calibrated multiple is capped into, so one outlier cannot dominate. */
export const CALIBRATION_FLOOR = 0.05;
export const CALIBRATION_CAP = 2.0;

/** One category's calibrated multiple, from the snapshot's own live tokens. */
export interface CalibrationEntry {
  category: string;
  multiple: number;
  median: number;
  live_count: number;
}

/** The calibration: the global fallback and the per-category multiples, all from the snapshot. */
export interface Calibration {
  global_multiple: number;
  global_median: number;
  global_live_count: number;
  min_live_count: number;
  shrinkage_k: number;
  multiple_floor: number;
  multiple_cap: number;
  categories: CalibrationEntry[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    calibration_source: 'category' | 'global';
    calibration_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    watchlist_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A multiple capped into the calibration band. */
function clampMultiple(x: number): number {
  return Math.min(CALIBRATION_CAP, Math.max(CALIBRATION_FLOOR, x));
}

/**
 * Calibrate the base multiple from the snapshot's own live tokens. A live protocol counts when its
 * market cap and its TVL are both present and positive: a recorded market cap of zero is no price at
 * all, so it carries no signal and is left out. Each category with at least CALIBRATION_MIN_LIVE
 * live protocols earns its own multiple — but not its raw median: the median is shrunk toward the
 * global median first, multiple = (n x median + SHRINKAGE_K x global median) / (n + SHRINKAGE_K),
 * then capped into [CALIBRATION_FLOOR, CALIBRATION_CAP]. A median from two protocols is a noisy
 * estimate of a heavy-tailed ratio, so the shrinkage pulls the thinnest categories halfway to the
 * market while leaving well-measured ones nearly alone. Every other category takes the global median
 * across all live protocols, capped the same way. The result is recomputed on every run.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const globalMedian = live.length > 0 ? median(live.map((p) => p.mcap_usd! / p.tvl_usd)) : 0;
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = byCategory.get(p.category);
    if (list === undefined) byCategory.set(p.category, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const categories: CalibrationEntry[] = [];
  for (const [category, ratios] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (ratios.length < CALIBRATION_MIN_LIVE) continue;
    const med = median(ratios);
    const shrunk = (ratios.length * med + SHRINKAGE_K * globalMedian) / (ratios.length + SHRINKAGE_K);
    categories.push({ category, multiple: round4(clampMultiple(shrunk)), median: round4(med), live_count: ratios.length });
  }
  return {
    global_multiple: round4(clampMultiple(globalMedian)),
    global_median: round4(globalMedian),
    global_live_count: live.length,
    min_live_count: CALIBRATION_MIN_LIVE,
    shrinkage_k: SHRINKAGE_K,
    multiple_floor: CALIBRATION_FLOOR,
    multiple_cap: CALIBRATION_CAP,
    categories,
  };
}

/** The calibrated base multiple a category gets, and where it came from. */
export function multipleFor(category: string | null, calibration: Calibration): { multiple: number; source: 'category' | 'global'; n: number } {
  if (category !== null) {
    const entry = calibration.categories.find((e) => e.category === category);
    if (entry !== undefined) return { multiple: entry.multiple, source: 'category', n: entry.live_count };
  }
  return { multiple: calibration.global_multiple, source: 'global', n: calibration.global_live_count };
}

/** The multipliers and the implied value one protocol gets under `model` and `calibration`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  onWatchlist: boolean,
  model: ModelConstants,
  calibration: Calibration,
): { implied: number; baseMultiple: number; calibrationSource: 'category' | 'global'; calibrationN: number; growthPct: number; growthMult: number; maturityMult: number; watchlistMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const watchlistMult = onWatchlist ? model.watchlist_multiple : 1;
  const chainMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap) * model.chain_step;
  const { multiple: baseMultiple, source: calibrationSource, n: calibrationN } = multipleFor(protocol.category, calibration);
  const base = protocol.tvl_usd * baseMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * watchlistMult * chainMult));
  return { implied, baseMultiple, calibrationSource, calibrationN, growthPct, growthMult, maturityMult, watchlistMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Money in whole dollars, with commas, for a farm step's text. */
function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, calibration: Calibration = calibrate(snapshot)): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries
  // (it cannot, but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by implied value, capped.
  // Scoring them first, then taking the top, means the early rows are the strongest candidates by the
  // same model that ranks the board, not merely the largest by TVL.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, false, model, calibration) }))
    .sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS)
    .map((s) => s.p);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, watch.has(p.slug), model, calibration);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const rank = i + 1;
    return {
      rank,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      watchlist: watch.has(s.p.slug),
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      model: {
        base_multiple: round4(s.v.baseMultiple),
        calibration_source: s.v.calibrationSource,
        calibration_n: s.v.calibrationN,
        growth_pct: s.v.growthPct,
        growth_multiplier: round4(s.v.growthMult),
        maturity_multiplier: round4(s.v.maturityMult),
        watchlist_multiplier: round4(s.v.watchlistMult),
        chain_multiplier: round4(s.v.chainMult),
        age_days: s.v.age,
      },
      farm_steps: farmSteps(s.p, s.v.age, rank, s.v.implied, watch.has(s.p.slug), s.v.growthPct).map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One category's three working actions: the main position, the second action, and the weekly habit. */
interface PlanActions {
  main: string;
  second: string;
  weekly: string;
}

/**
 * The plan's three working actions, picked by the protocol's category. Every action names the protocol
 * and its primary chain and carries a concrete amount, so two rows of one category still read
 * differently: the capital, the chain and the name change with the row.
 */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): PlanActions {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const swapAmt = Math.max(10, Math.round(capital / 5));
  const loanAmt = Math.max(10, Math.round(capital / 5));
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm') || c.includes('farm')) {
    return {
      main: `Provide ${money(capital)} of liquidity to ${name}'s largest pool on ${chain} and keep the LP position open.`,
      second: `Swap ${money(swapAmt)} through ${name} on ${chain} so the address records trading activity, not just a deposit.`,
      weekly: `Make one swap or one LP adjustment on ${name} on ${chain} each week, alternating the direction.`,
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      main: `Supply ${money(capital)} of USDC to ${name} on ${chain} and keep the deposit open.`,
      second: `Borrow about ${money(loanAmt)} against the collateral on ${name} on ${chain} and hold the loan for a week, then repay it.`,
      weekly: `Adjust the deposit or the loan on ${name} on ${chain} once a week so the position stays active.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      main: `Bridge ${money(capital)} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
      second: `Bridge ${money(swapAmt)} back through ${name} to the chain you started from, so the address records volume in both directions.`,
      weekly: `Move a small amount across ${name} once a week, and leave most of the capital on ${chain}.`,
    };
  }
  if (c.includes('stak') || c.includes('restak')) {
    return {
      main: `Stake ${money(capital)} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`,
      second: `Deposit the receipt token into ${name}'s own vault, or the largest DeFi pool on ${chain}, so the position earns twice.`,
      weekly: `Check the staking rewards on ${name} on ${chain} and restake or claim them once a week.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option') || c.includes('synthetic') || c.includes('basis trading')) {
    return {
      main: `Deposit ${money(capital)} of USDC as margin on ${name} on ${chain} and open one small hedged position.`,
      second: `Close and reopen the hedge on ${name} on ${chain} weekly so the address shows repeated trading, and keep the position size modest.`,
      weekly: `Make one small trade on ${name} on ${chain} each week and keep the margin well below the deposit.`,
    };
  }
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) {
    return {
      main: `Deposit ${money(capital)} into a ${name} vault on ${chain} and keep the shares.`,
      second: `Move a portion of the deposit between two of ${name}'s vaults or strategies on ${chain} once, to show allocation activity.`,
      weekly: `Review the vault's yield on ${name} on ${chain} and rebalance or top up once a week.`,
    };
  }
  if (c.includes('rwa') || c.includes('stable')) {
    return {
      main: `Mint or buy ${money(capital)} of ${name}'s yield-bearing asset on ${chain} and hold it.`,
      second: `Deposit that asset into ${name}'s staking or vault product on ${chain} so the address is recorded twice.`,
      weekly: `Check the yield on ${name} on ${chain} and claim or compound it once a week.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      main: `Fund ${money(capital)} and place one position on a ${name} market on ${chain} with at least two weeks to resolve.`,
      second: `Place a second, smaller position of about ${money(swapAmt)} on a different ${name} market on ${chain}.`,
      weekly: `Add one small position a week on ${name} on ${chain}, on markets you already follow.`,
    };
  }
  if (c.includes('launchpad')) {
    return {
      main: `Stake or deposit ${money(capital)} through ${name} on ${chain} to qualify for its next launch allocation.`,
      second: `Join one launch or sale through ${name} on ${chain} and hold the allocation you receive.`,
      weekly: `Check ${name}'s upcoming launches on ${chain} each week and keep the qualifying deposit in place.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      main: `Buy ${money(capital)} of cover from ${name} on ${chain} and keep the policy active.`,
      second: `Stake a small amount of about ${money(swapAmt)} in ${name}'s cover pool on ${chain}, if it offers one.`,
      weekly: `Check the policy and the cover pool on ${name} on ${chain} once a week.`,
    };
  }
  if (c.includes('payment') || c.includes('card')) {
    return {
      main: `Route ${money(capital)} of spending through ${name} on ${chain} over the next month.`,
      second: `Use ${name}'s card or checkout on ${chain} once a week for a real purchase.`,
      weekly: `Keep one small recurring payment running through ${name} on ${chain} each week.`,
    };
  }
  if (c.includes('chain')) {
    return {
      main: `Bridge ${money(capital)} of USDC to ${name} and use its native apps, its DEX and its lending market, with the funds.`,
      second: `Interact with at least two apps on ${name} so the address is active across the chain, not just in one place.`,
      weekly: `Make one transaction on ${name} each week.`,
    };
  }
  return {
    main: `Deposit ${money(capital)} of USDC into ${name} on ${chain} and keep the position open.`,
    second: `Use ${name}'s main feature on ${chain} once with a small amount of about ${money(swapAmt)} after the deposit.`,
    weekly: `Make one qualifying action on ${name} on ${chain} each week, such as a deposit, a swap or a vote.`,
  };
}

/**
 * A protocol's farm plan: seven steps, plus one when the row is on the watchlist and one when its
 * seven-day growth is fast. The plan is derived from the protocol's own record (category, chains, TVL,
 * age, growth, watchlist), never from a hand-written list of names. Every step names the protocol and
 * its primary chain.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, rank: number, implied: number, onWatchlist: boolean, growthPct: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const a = actionsFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with ${p.name} on ${chain}, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: a.main,
      cost: `${money(capital)} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: a.second,
      cost: `about $${capital >= 150 ? 5 : 2} of gas`,
      time: '10 minutes',
    },
    {
      text: a.weekly,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position on ${chain} for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the ${money(capital)} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay to claim.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction on ${chain} in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  if (onWatchlist) {
    steps.push({
      text: `Priority: ${p.name} ranks #${rank} on this radar with an implied value of ${money(implied)} — if you farm only a few protocols, farm this one first.`,
      cost: 'no extra cost',
      time: 'no extra time',
    });
  }
  if (growthPct > 20) {
    // The step names the growth the snapshot actually recorded; the model still caps it at 150%
    // for the value (see the formula), so the two agree on the direction and the model on the size.
    const raw = p.change_7d ?? growthPct;
    const shown = raw >= 100 ? String(Math.round(raw)) : raw.toFixed(1);
    steps.push({
      text: `${p.name} grew ${shown}% in 7 days, so the window is moving fast — start the position on ${chain} this week rather than next month.`,
      cost: 'no extra cost',
      time: 'this week',
    });
  }
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot);
  const board = buildBoard(snapshot, model, calibration);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
