// ruby flow [poolId]: the latest swaps in a Uniswap V4 pool on Robinhood Chain, one line per trade, with the wallet behind it.
// The Swap event names the router that called the PoolManager, not the trader, so Ruby reads each transaction's token
// transfers and names the address that actually received (buy) or sent (sell) the token. Facts only: no scores.
import { RPC, rpc, EXPLORER, DEAD, ZERO, T_TRANSFER, short, quoteUsdgTo, tokenInfo } from "./chain.mjs";
import { frontmatter, write, table, safeName } from "./note.mjs";
import { readV4, POOL_MANAGER, T_V4SWAP } from "./poolv4.mjs";
import { PONS_V2_LOCKER } from "./locker.mjs";

export const RUBY_POOL = "0x97883a330870c941eaaac99377f4783613a879c2617492338032b7e390e2ef83";
const ETH = "0x0000000000000000000000000000000000000000", WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), hx = (n) => "0x" + n.toString(16);
const w = (h, i) => BigInt("0x" + h.slice(2 + i * 64, 66 + i * 64)), int = (v, bits) => BigInt.asIntN(bits, v), addr = (t) => "0x" + t.slice(26).toLowerCase();
const fmt = (x, max = 6) => (x == null || !isFinite(x) ? "–" : x === 0 ? "0" : Math.abs(x) >= 1 ? x.toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) >= 1000 ? 0 : 4 }) : x.toPrecision(max).replace(/0+$/, "").replace(/\.$/, ""));

// JSON-RPC batches: many reads in one request, with gentle pacing so the public node does not rate-limit us
async function batch(calls, size = 30) {
  const out = [];
  for (let i = 0; i < calls.length; i += size) {
    const part = calls.slice(i, i + size); if (i) await sleep(300);
    for (let k = 0; k < 8; k++) {
      try {
        const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(part.map(([method, params], j) => ({ jsonrpc: "2.0", id: j, method, params }))), signal: AbortSignal.timeout(30000) });
        if (r.status === 429 || r.status >= 500) throw new Error("busy"); const j = await r.json(); if (!Array.isArray(j)) throw new Error("busy");
        j.sort((a, b) => a.id - b.id); out.push(...j.map((x) => x.result ?? null)); break;
      } catch (e) { if (k === 7) throw e; await sleep(1500 * (k + 1)); }
    }
  }
  return out;
}

// the newest `count` swaps, walking back from the head in growing windows
async function recentSwaps(id, initBlock, head, count) {
  const out = []; let to = head, step = 20_000;
  while (out.length < count && to >= initBlock) {
    const from = Math.max(initBlock, to - step + 1);
    let got;
    try { got = await rpc("eth_getLogs", [{ address: POOL_MANAGER, topics: [T_V4SWAP, id], fromBlock: hx(from), toBlock: hx(to) }]); }
    catch (e) { const m = /only (\d+) are allowed/.exec(e.message || ""); if (m) { step = Math.max(1000, Math.min(step >> 1, +m[1])); continue; } throw e; }
    out.unshift(...got); to = from - 1; step = Math.min(step * 2, 2_000_000);
  }
  return out.slice(-count);
}

export async function readFlow(poolId = RUBY_POOL, { count = 40, log = () => {} } = {}) {
  count = Math.max(5, Math.min(200, count | 0 || 40));
  log("reading the pool…");
  const P = await readV4(poolId);
  const tokenSide = P.c0 === ETH ? 1 : 0; // the side that is not ETH is "the token"; if both are tokens, currency1 is the token
  const T = tokenSide === 1 ? P.c1 : P.c0, Q = tokenSide === 1 ? P.c0 : P.c1;
  const [ti, qi] = await Promise.all([tokenInfo(T), Q === ETH ? { symbol: "ETH", decimals: 18 } : tokenInfo(Q)]);
  const dT = ti.decimals ?? 18, dQ = qi.decimals ?? 18, sT = ti.symbol || short(T), sQ = qi.symbol || short(Q);
  log(`reading the last ${count} swaps…`);
  const sw = await recentSwaps(P.id, P.initBlock, P.head, count);
  const txs = [...new Set(sw.map((l) => l.transactionHash))], blocks = [...new Set(sw.map((l) => l.blockNumber))];
  log("reading who traded…");
  const [rcpts, txo, blks] = await Promise.all([batch(txs.map((h) => ["eth_getTransactionReceipt", [h]])), batch(txs.map((h) => ["eth_getTransactionByHash", [h]])), batch(blocks.map((b) => ["eth_getBlockByNumber", [b, false]]))]);
  const R = new Map(txs.map((h, i) => [h, rcpts[i]])), F = new Map(txs.map((h, i) => [h, txo[i] && txo[i].from.toLowerCase()])), TS = new Map(blocks.map((b, i) => [b, blks[i] ? parseInt(blks[i].timestamp, 16) : null]));
  const rows = sw.map((l) => {
    const aT = Number(int(w(l.data, tokenSide), 128)) / 10 ** dT, aQ = Number(int(w(l.data, 1 - tokenSide), 128)) / 10 ** dQ;
    const buy = aT > 0; // amounts are from the swapper's side: positive = taken out of the pool
    // the wallet behind it: on a buy, who received the token from the PoolManager in this tx; on a sell, who sent it toward the pool route
    const tl = ((R.get(l.transactionHash) || {}).logs || []).filter((x) => x.address.toLowerCase() === T && x.topics[0] === T_TRANSFER);
    let who = null;
    if (buy) { const legs = tl.filter((x) => addr(x.topics[1]) !== ZERO); const last = legs[legs.length - 1]; who = last ? addr(last.topics[2]) : null; }
    else { const first = tl.find((x) => addr(x.topics[1]) !== POOL_MANAGER); who = first ? addr(first.topics[1]) : null; }
    const signer = F.get(l.transactionHash) || null;
    return { block: parseInt(l.blockNumber, 16), time: TS.get(l.blockNumber), tx: l.transactionHash, side: buy ? "buy" : "sell", token: Math.abs(aT), quote: Math.abs(aQ), price: aT ? Math.abs(aQ / aT) : null, wallet: who || signer, signer, router: addr(l.topics[2]) };
  });
  log("labelling wallets…");
  const wallets = [...new Set(rows.map((r) => r.wallet).filter(Boolean))];
  const meta = await batch(wallets.flatMap((a) => [["eth_getCode", [a, "latest"]], ["eth_getTransactionCount", [a, "latest"]], ["eth_call", [{ to: T, data: "0x70a08231" + a.slice(2).padStart(64, "0") }, "latest"]]]));
  const supply = ti.totalSupply ? Number(ti.totalSupply) / 10 ** dT : null;
  const L = new Map(wallets.map((a, i) => {
    const code = meta[3 * i] || "0x", nonce = meta[3 * i + 1] ? parseInt(meta[3 * i + 1], 16) : 0, bal = meta[3 * i + 2] && meta[3 * i + 2] !== "0x" ? Number(BigInt(meta[3 * i + 2])) / 10 ** dT : 0;
    const kind = a === POOL_MANAGER ? "PoolManager" : a === P.key.hooks ? "this pool's hook contract (not a holder)" : a === PONS_V2_LOCKER ? "Pons V2 launch locker" : a === DEAD ? "burn address" : nonce > 5000 ? "high-volume sender (bot, relayer or exchange)" : code.startsWith("0xef0100") ? "wallet (7702 smart wallet)" : code !== "0x" ? "contract" : "wallet";
    return [a, { kind, nonce, balance: bal, share: supply ? (bal / supply) * 100 : null }];
  }));
  rows.forEach((r) => Object.assign(r, { label: r.wallet ? L.get(r.wallet) : null }));
  const ethUsd = Q === ETH ? await quoteUsdgTo(WETH, 18).catch(() => null) : null;
  rows.forEach((r) => { r.usd = ethUsd ? r.quote * ethUsd : null; });
  const buys = rows.filter((r) => r.side === "buy"), sells = rows.filter((r) => r.side === "sell");
  const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);
  const big = (a) => a.reduce((m, r) => (!m || r.quote > m.quote ? r : m), null);
  return { pool: P.id, token: T, quoteToken: Q, symbol: sT, quoteSymbol: sQ, head: P.head, ethUsd, rows: rows.reverse(),
    summary: { swaps: rows.length, buys: buys.length, sells: sells.length, boughtQuote: sum(buys, "quote"), soldQuote: sum(sells, "quote"), netQuote: sum(buys, "quote") - sum(sells, "quote"), wallets: wallets.length, biggestBuy: big(buys), biggestSell: big(sells), from: rows.length ? rows[rows.length - 1].time : null, to: rows.length ? rows[0].time : null } };
}

export async function flowNote(vault, { pool = RUBY_POOL, count = 40, log = () => {} } = {}) {
  const t = await readFlow(pool, { count, log });
  const S = t.summary, q = t.quoteSymbol, utc = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "–");
  const link = (a) => `[${short(a)}](${EXPLORER}/address/${a})`, usd = (x) => (x == null ? "" : ` (~$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) >= 100 ? 0 : 2 })})`);
  const fm = frontmatter({ type: "flow", pool_id: t.pool, token: t.token, symbol: t.symbol, swaps: S.swaps, buys: S.buys, sells: S.sells, wallets: S.wallets, net_flow: +S.netQuote.toPrecision(6), net_flow_unit: q, block: t.head, chain: "Robinhood Chain mainnet (4663)", tags: ["flow", "uniswap-v4", "robinhood-chain"] });
  const body = `
# ${t.symbol} flow · last ${S.swaps} swaps

Read from the Uniswap V4 PoolManager on Robinhood Chain mainnet at block ${t.head.toLocaleString("en-US")}. Each line is one swap; the wallet is the address that received ${t.symbol} (buy) or sent it (sell) in that transaction, not the router.

## Summary
|  |  |
| --- | --- |
| window | ${utc(S.from)} → ${utc(S.to)} |
| buys / sells | ${S.buys} / ${S.sells} |
| ${q} in (buys) | ${fmt(S.boughtQuote)}${usd(t.ethUsd && S.boughtQuote * t.ethUsd)} |
| ${q} out (sells) | ${fmt(S.soldQuote)}${usd(t.ethUsd && S.soldQuote * t.ethUsd)} |
| net | ${S.netQuote >= 0 ? "+" : ""}${fmt(S.netQuote)} ${q}${usd(t.ethUsd && S.netQuote * t.ethUsd)} |
| distinct wallets | ${S.wallets} |
${S.biggestBuy ? `| biggest buy | ${fmt(S.biggestBuy.quote)} ${q} by ${S.biggestBuy.wallet ? link(S.biggestBuy.wallet) : "?"} |\n` : ""}${S.biggestSell ? `| biggest sell | ${fmt(S.biggestSell.quote)} ${q} by ${S.biggestSell.wallet ? link(S.biggestSell.wallet) : "?"} |\n` : ""}
## Swaps (newest first)
${table(["time (UTC)", "side", t.symbol, q, "wallet", "what it is", "holds now", "tx"], t.rows.map((r) => [r.time ? new Date(r.time * 1000).toISOString().slice(11, 19) : r.block.toLocaleString("en-US"), r.side, fmt(r.token), fmt(r.quote), r.wallet ? link(r.wallet) : "?", r.label ? r.label.kind : "–", r.label && r.label.share != null ? r.label.share.toFixed(2) + "%" : "–", `[${short(r.tx)}](${EXPLORER}/tx/${r.tx})`]))}
"Holds now" is the wallet's current ${t.symbol} balance as a share of total supply. A high-volume sender has sent over 5,000 transactions: usually a bot, relayer or exchange, not a person.${t.ethUsd ? ` USD values use one live KyberSwap ETH quote (~$${fmt(t.ethUsd, 5)}).` : ""}

## Notes
-
`;
  return write(vault, `Research/${safeName(`Flow ${t.symbol} ${t.pool.slice(0, 8)} ${new Date().toISOString().slice(0, 10)}`)}.md`, fm + body);
}
