// Ruby Lens: new launches on Robinhood Chain and the facts of any token, read from the chain for an AI (or you).
// Both Pons launchpad factories are read from their own events. Facts only: no scores, no ratings, no price calls.
//   factory v1 LaunchCreated(token, curve, creator) · factory v2 (token, curve, creator), data word 2 = the curve's ETH target
//   curve Buy(sender, recipient) data: ethIn, tokensOut · Sell(sender, recipient) data: tokensIn, ethOut
import { rpc, logs, head, block, tokenInfo, balanceOf, isContract, sourcify, quoteUsdgTo, pad, topicAddr, num, short, T_TRANSFER, DEAD, ZERO } from "./chain.mjs";
import { FACTORY as FACTORY_V1, T_LAUNCH as T_LAUNCH_V1, T_BUY, T_SELL } from "./launches.mjs";
import { readLocker, PONS_V2_LOCKER } from "./locker.mjs";
import { POOL_MANAGER } from "./poolv4.mjs";

export const FACTORY_V2 = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
export const T_LAUNCH_V2 = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const FACTORY_START = 26_841_800; // the first block with an event from either factory
// a launch is logged by both factories (the v2 one carries the ETH target): read each on its own (much faster than one combined filter) and keep one per token, v2 first
async function launchLogs(from, to, token) {
  const t = token ? [pad(token)] : [];
  const [a, b] = await Promise.all([logs({ address: FACTORY_V2, topics: [T_LAUNCH_V2, ...t] }, from, to), logs({ address: FACTORY_V1, topics: [T_LAUNCH_V1, ...t] }, from, to)]);
  const seen = new Map(); for (const L of [...a, ...b].map(decodeLaunch)) if (!seen.has(L.token)) seen.set(L.token, L);
  return [...seen.values()];
}
const MAX_TRANSFERS = 30000;
const w = (data, i) => { const s = data.slice(2 + i * 64, 66 + i * 64); return s.length === 64 ? BigInt("0x" + s) : 0n; };
const share = (v, s) => (s > 0n ? Number((v * 1000000n) / s) / 10000 : null);

function decodeLaunch(l) {
  const v2 = l.topics[0] === T_LAUNCH_V2;
  return { token: topicAddr(l.topics[1]), curve: topicAddr(l.topics[2]), creator: topicAddr(l.topics[3]), version: v2 ? "v2" : "v1", target: v2 ? w(l.data, 2) : null, block: parseInt(l.blockNumber, 16), tx: l.transactionHash };
}
async function trades(curve, from, to) {
  const l = await logs({ address: curve, topics: [[T_BUY, T_SELL]] }, from, to);
  return l.map((x) => { const buy = x.topics[0] === T_BUY; return { side: buy ? "buy" : "sell", trader: topicAddr(x.topics[2]), eth: buy ? w(x.data, 0) : w(x.data, 1), tokens: buy ? w(x.data, 1) : w(x.data, 0), tx: x.transactionHash }; });
}
// the curve's ETH target: from the v2 launch event; otherwise asked from the curve (0x8b0bc501), if it answers
async function targetOf(L) {
  if (L.target && L.target > 0n) return L.target;
  try { const r = await rpc("eth_call", [{ to: L.curve, data: "0x8b0bc501" }, "latest"]); return r && r.length >= 66 && BigInt(r.slice(0, 66)) > 0n ? BigInt(r.slice(0, 66)) : null; } catch { return null; }
}

// the latest launches on both factories, newest first
export async function lensNew({ count = 10, lookback = 600_000 } = {}) {
  count = Math.max(1, Math.min(20, count | 0 || 10));
  const now = (await head()) - 10, found = []; // a few blocks back: RPC nodes behind a load balancer can lag
  for (let to = now; to > now - lookback && found.length < count; to -= 100_000) {
    const l = await launchLogs(Math.max(0, to - 99_999), to);
    found.push(...l.filter((x) => !found.some((y) => y.token === x.token)).sort((a, b) => b.block - a.block));
  }
  const rows = await Promise.all(found.slice(0, count).map(async (L) => {
    const [info, T, curveEth, devBal, b, target] = await Promise.all([tokenInfo(L.token), trades(L.curve, L.block, now), rpc("eth_getBalance", [L.curve, "latest"]).then(BigInt), balanceOf(L.token, L.creator), block(L.block), targetOf(L)]);
    const sup = info.totalSupply || 0n, devBuy = T.filter((t) => t.side === "buy" && t.trader === L.creator && t.tx === L.tx).reduce((s, t) => s + t.eth, 0n);
    return { ...L, symbol: info.symbol || short(L.token), supply: sup, at: parseInt(b.timestamp, 16), buys: T.filter((t) => t.side === "buy").length, sells: T.filter((t) => t.side === "sell").length,
      traders: new Set(T.map((t) => t.trader)).size, curveEth, target, devBuy, devShare: share(devBal, sup) };
  }));
  return { now, rows };
}

// every fact Ruby can read about one token
export async function lensCheck(token) {
  token = token.toLowerCase();
  if (!(await isContract(token))) throw new Error(`${token} has no contract code on Robinhood Chain mainnet`);
  const now = (await head()) - 10, info = await tokenInfo(token);
  if (info.decimals === null || info.totalSupply === null) throw new Error("this contract does not answer like an ERC-20 token");
  const sup = info.totalSupply;
  const L = (await launchLogs(FACTORY_START, now, token))[0] || null;
  const [verified, dead, zero, lock, price] = await Promise.all([sourcify(token), balanceOf(token, DEAD), balanceOf(token, ZERO), readLocker(token).catch(() => null), quoteUsdgTo(token, info.decimals).catch(() => null)]);
  const R = { token, now, symbol: info.symbol || short(token), name: info.name, decimals: info.decimals, supply: sup, owner: info.owner, verified, burned: share(dead + zero, sup), price, launch: null, holders: null };
  if (lock && lock.locked) R.locker = { poolId: lock.poolId, tokenId: lock.tokenId, nftHeld: lock.nftOwner === PONS_V2_LOCKER, poolShare: lock.poolLiquidity > 0n ? share(lock.positionLiquidity, lock.poolLiquidity) : null, supplyLocked: share(lock.supplyLocked, sup) };
  if (L) {
    const [T, curveEth, devBal, b, target] = await Promise.all([trades(L.curve, L.block, now), rpc("eth_getBalance", [L.curve, "latest"]).then(BigInt), balanceOf(token, L.creator), block(L.block), targetOf(L)]);
    const dev = T.filter((t) => t.trader === L.creator);
    R.launch = { ...L, at: parseInt(b.timestamp, 16), curveEth, target, graduated: !!R.locker, buys: T.filter((t) => t.side === "buy").length, sells: T.filter((t) => t.side === "sell").length,
      traders: new Set(T.map((t) => t.trader)).size, volume: T.reduce((s, t) => s + t.eth, 0n),
      devBuyEth: dev.filter((t) => t.side === "buy" && t.tx === L.tx).reduce((s, t) => s + t.eth, 0n), devBoughtLater: dev.filter((t) => t.side === "buy" && t.tx !== L.tx).length,
      devSold: share(dev.filter((t) => t.side === "sell").reduce((s, t) => s + t.tokens, 0n), sup), devHolds: share(devBal, sup) };
  }
  // holders from every Transfer, without the curve, the pool manager, the locker and burn addresses
  const tl = await logs({ address: token, topics: [T_TRANSFER] }, L ? L.block : 0, now).catch(() => null);
  if (tl && tl.length <= MAX_TRANSFERS) {
    const bal = new Map();
    for (const l of tl) { const v = BigInt(l.data), f = topicAddr(l.topics[1]), t = topicAddr(l.topics[2]); bal.set(f, (bal.get(f) || 0n) - v); bal.set(t, (bal.get(t) || 0n) + v); }
    const skip = new Set([ZERO, DEAD, POOL_MANAGER, PONS_V2_LOCKER, L && L.curve].filter(Boolean));
    const list = [...bal].filter(([a, v]) => v > 0n && !skip.has(a)).sort((a, b) => (b[1] > a[1] ? 1 : -1));
    R.holders = { count: list.length, transfers: tl.length, inCurve: L ? share(bal.get(L.curve) || 0n, sup) : null, top: list.slice(0, 10).map(([a, v]) => ({ addr: a, share: share(v, sup), dev: L && a === L.creator })),
      top10: share(list.slice(0, 10).reduce((s, [, v]) => s + v, 0n), sup) };
  } else if (tl) R.holders = { tooMany: tl.length };
  return R;
}

export const ethStr = (v, d = 4) => (num(v, 18)).toLocaleString("en-US", { maximumFractionDigits: d });
export const progressOf = (curveEth, target) => (target && target > 0n ? Math.min(100, Number((curveEth * 10000n) / target) / 100) : null);
