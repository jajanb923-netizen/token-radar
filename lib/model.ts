// The token radar's model, version 2: one snapshot of the protocol universe in, one ranked board out.
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
//   base        = tvl_usd x BASE_MULTIPLE                       (0.25)
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
//   category    = a prior by the snapshot's own category field:
//                   1.15 for categories where a token launch is the norm and farming is established
//                        (DEXs, lending and CDPs, derivatives and perps, yield and curators, staking
//                        and restaking, launchpads, prediction markets)
//                   0.90 for categories where a farmable token is unlikely or the product is
//                        infrastructure (bridges, RWA, stablecoins, payments, wrapped BTC products)
//                   1.00 for everything else (including a null category)
//   chains      = 1 + min(chains - 1, 4) x 0.03                 (a protocol live on more chains has more
//                                                                surface to farm; capped at +12%)
//   implied     = max(1, round(base x growthMult x maturity x watchlist x category x chains))
//
// Farm plans are derived from the same record: the protocol's category picks the plan's actions, its
// TVL sets the capital, its age sets the hold, its primary chain sets where the work happens, and a
// watchlist row or a fast-growing row gets one extra step. Every step carries what it costs and how
// long it takes.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
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
  category_high: number;
  category_low: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
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
  category_high: 1.15,
  category_low: 0.9,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by implied value. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

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
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    watchlist_multiplier: number;
    category_multiplier: number;
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

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
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

/**
 * The category prior, from the snapshot's own category field. High for categories where a token
 * launch is the norm and farming is established; low for infrastructure and wrapped products, where a
 * farmable token of the protocol's own is unlikely; neutral for everything else. The low tier is
 * checked first so a wrapped product that also names staking lands low, not high.
 */
export function categoryMultiplier(category: string | null, model: ModelConstants): number {
  if (category === null) return 1;
  const c = category.toLowerCase();
  const low = ['bridge', 'rwa', 'stable', 'payment', 'card', 'privacy', 'cex', 'otc', 'reserve currency', 'nft marketplace', 'uncollateralized', 'restaked btc', 'anchor btc', 'decentralized btc'];
  for (const k of low) if (c.includes(k)) return model.category_low;
  const high = ['dex', 'lend', 'cdp', 'derivative', 'perpetual', 'yield', 'stak', 'restak', 'leveraged farm', 'farm', 'launchpad', 'option', 'synthetic', 'prediction', 'basis trading'];
  for (const k of high) if (c.includes(k)) return model.category_high;
  return 1;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  onWatchlist: boolean,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; watchlistMult: number; categoryMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const watchlistMult = onWatchlist ? model.watchlist_multiple : 1;
  const categoryMult = categoryMultiplier(protocol.category, model);
  const chainMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap) * model.chain_step;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * watchlistMult * categoryMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, watchlistMult, categoryMult, chainMult, age };
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
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
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
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, false, model) }))
    .sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS)
    .map((s) => s.p);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, watch.has(p.slug), model);
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
        base_multiple: model.base_multiple,
        growth_pct: s.v.growthPct,
        growth_multiplier: round4(s.v.growthMult),
        maturity_multiplier: round4(s.v.maturityMult),
        watchlist_multiplier: round4(s.v.watchlistMult),
        category_multiplier: round4(s.v.categoryMult),
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
 * and its chain and carries a concrete amount, so two rows of one category still read differently:
 * the capital, the chain and the name change with the row.
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
      weekly: `Make one swap or one LP adjustment on ${name} each week, alternating the direction.`,
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      main: `Supply ${money(capital)} of USDC to ${name} on ${chain} and keep the deposit open.`,
      second: `Borrow about ${money(loanAmt)} against the collateral and hold the loan for a week, then repay it.`,
      weekly: `Adjust the deposit or the loan once a week so the position stays active.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      main: `Bridge ${money(capital)} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
      second: `Bridge ${money(swapAmt)} back through ${name} so the address records volume in both directions.`,
      weekly: `Move a small amount across ${name} once a week, and leave most of the capital on the destination chain.`,
    };
  }
  if (c.includes('stak') || c.includes('restak')) {
    return {
      main: `Stake ${money(capital)} of the chain's staking asset through ${name} and keep the receipt token.`,
      second: `Deposit the receipt token into ${name}'s own vault, or the largest DeFi pool on ${chain}, so the position earns twice.`,
      weekly: `Check the staking rewards and restake or claim them once a week.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option') || c.includes('synthetic') || c.includes('basis trading')) {
    return {
      main: `Deposit ${money(capital)} of USDC as margin on ${name} and open one small hedged position.`,
      second: `Close and reopen the hedge weekly so the address shows repeated trading, and keep the position size modest.`,
      weekly: `Make one small trade on ${name} each week and keep the margin well below the deposit.`,
    };
  }
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) {
    return {
      main: `Deposit ${money(capital)} into a ${name} vault on ${chain} and keep the shares.`,
      second: `Move a portion of the deposit between two of ${name}'s vaults or strategies once, to show allocation activity.`,
      weekly: `Review the vault's yield and rebalance or top up once a week.`,
    };
  }
  if (c.includes('rwa') || c.includes('stable')) {
    return {
      main: `Mint or buy ${money(capital)} of ${name}'s yield-bearing asset on ${chain} and hold it.`,
      second: `Deposit that asset into ${name}'s staking or vault product so the address is recorded twice.`,
      weekly: `Check the yield and claim or compound it once a week.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      main: `Fund ${money(capital)} and place one position on a ${name} market with at least two weeks to resolve.`,
      second: `Place a second, smaller position of about ${money(swapAmt)} on a different ${name} market.`,
      weekly: `Add one small position a week on markets you already follow.`,
    };
  }
  if (c.includes('launchpad')) {
    return {
      main: `Stake or deposit ${money(capital)} through ${name} to qualify for its next launch allocation.`,
      second: `Join one launch or sale through ${name} and hold the allocation you receive.`,
      weekly: `Check ${name}'s upcoming launches each week and keep the qualifying deposit in place.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      main: `Buy ${money(capital)} of cover from ${name} on ${chain} and keep the policy active.`,
      second: `Stake a small amount of about ${money(swapAmt)} in ${name}'s cover pool, if it offers one.`,
      weekly: `Check the policy and the cover pool once a week.`,
    };
  }
  if (c.includes('payment') || c.includes('card')) {
    return {
      main: `Route ${money(capital)} of spending through ${name} on ${chain} over the next month.`,
      second: `Use ${name}'s card or checkout once a week for a real purchase.`,
      weekly: `Keep one small recurring payment running through ${name} each week.`,
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
    second: `Use ${name}'s main feature once with a small amount of about ${money(swapAmt)} after the deposit.`,
    weekly: `Make one qualifying action each week, such as a deposit, a swap or a vote.`,
  };
}

/**
 * A protocol's farm plan: seven steps, plus one when the row is on the watchlist and one when its
 * seven-day growth is fast. The plan is derived from the protocol's own record (category, chains, TVL,
 * age, growth, watchlist), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, rank: number, implied: number, onWatchlist: boolean, growthPct: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const a = actionsFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with ${p.name}, and keep its seed phrase offline.`,
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
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the ${money(capital)} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay to claim.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
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
      text: `${p.name} grew ${shown}% in 7 days, so the window is moving fast — start the position this week rather than next month.`,
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
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
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
