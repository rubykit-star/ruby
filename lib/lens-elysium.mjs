// Ruby Lens on Elysium (Kinetiq's L2 for Hyperliquid, chain 99901): the latest launchpad launches and the facts of any token.
// The public RPC allows 2,000 blocks per log query and rate-limits, so history is read in small windows and capped. Facts only.
import { keccak256, hexBytes } from "./keccak.mjs";

export const ELY = {
  id: 99901, name: "Elysium", native: "HYPE",
  rpc: process.env.RUBY_ELYSIUM_RPC || "https://rpc.elysium.kinetiq.xyz",
  explorer: "https://elysium.kinetiq.xyz/explorer",
  launchpad: "0x38d3ef3a06d18fa3286fb5deafe611be725fcd15", // the busiest token launcher on Elysium (not verified on Sourcify)
  tLaunch: "0x4961817ce3ab7655aeb0a1693c07f08a5b793c56901461b33bb3753758244c6f", // (token, creator, poolId)
  poolManager: "0xe2e105d3f7209a9da11f83ccf3e7398a753823f1", // Uniswap V4 PoolManager on Elysium
  maxRange: 2000, window: 400,
};
const T_INIT = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438", T_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", T_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f", T_MODIFY = "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec";
const ZERO = "0x0000000000000000000000000000000000000000", DEAD = "0x000000000000000000000000000000000000dead";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pad = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0"), ad = (t) => "0x" + t.slice(26).toLowerCase();
export const isEvmAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");
let id = 0, lastCall = 0;
export async function erpc(method, params) {
  for (let k = 0; k < 8; k++) {
    const wait = lastCall + 120 - Date.now(); if (wait > 0) await sleep(wait); lastCall = Date.now();
    try { const r = await fetch(ELY.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      const j = await r.json().catch(() => ({})); if (j.result !== undefined) return j.result;
      const msg = (j.error && j.error.message) || String(r.status); if (!/rate|limit exceeded|busy|timeout|429|5\d\d/i.test(msg) || /logs count limit|block range/i.test(msg)) throw Object.assign(new Error(msg), { final: true });
    } catch (e) { if (e.final) throw e; }
    await sleep(600 * (k + 1));
  }
  throw new Error("Elysium RPC is busy: try again in a minute");
}
// logs from..to in windows the public RPC accepts; a window with too many logs is split in two
export async function elogs(filter, from, to, { step = ELY.window } = {}) {
  const out = [];
  async function get(a, b) { try { out.push(...(await erpc("eth_getLogs", [{ ...filter, fromBlock: "0x" + a.toString(16), toBlock: "0x" + b.toString(16) }]))); }
    catch (e) { if (/logs count limit|block range/i.test(e.message) && b > a) { const m = Math.floor((a + b) / 2); await get(a, m); await get(m + 1, b); } else throw e; } }
  for (let a = from; a <= to; a += step) await get(a, Math.min(to, a + step - 1));
  return out;
}
const call = (to, data, block = "latest") => erpc("eth_call", [{ to, data }, block]).catch(() => null);
const str = (h) => { try { const b = h.slice(2), k = parseInt(b.slice(64, 128), 16); return Buffer.from(b.slice(128, 128 + k * 2), "hex").toString(); } catch { return null; } };
async function tokenInfo(t) { const [n, s, d, ts, o] = await Promise.all([call(t, "0x06fdde03"), call(t, "0x95d89b41"), call(t, "0x313ce567"), call(t, "0x18160ddd"), call(t, "0x8da5cb5b")]);
  return { name: n && str(n), symbol: s && str(s), decimals: d && d !== "0x" ? Number(BigInt(d)) : null, supply: ts && ts !== "0x" ? BigInt(ts) : null, owner: o && o.length >= 66 ? ad(o.slice(0, 66)) : null }; }
const bal = async (t, w) => { const r = await call(t, "0x70a08231" + pad(w).slice(2)); return r && r !== "0x" ? BigInt(r) : 0n; };
const share = (v, s) => (s && s > 0n ? Number((v * 1000000n) / s) / 10000 : null);
const head = async () => parseInt(await erpc("eth_blockNumber", []), 16) - 3;
const int = (h, i, bits) => BigInt.asIntN(bits, BigInt("0x" + h.slice(2 + i * 64, 66 + i * 64)));
// a swap from the swapper's side (positive = taken out of the pool), as token and HYPE amounts
const side = (data, tokenIs0) => { const a0 = int(data, 0, 128), a1 = int(data, 1, 128); return tokenIs0 ? { tok: a0, hype: a1 } : { tok: a1, hype: a0 }; };
const decodeLaunch = (l) => ({ token: ad(l.topics[1]), creator: ad(l.topics[2]), poolId: l.topics[3], block: parseInt(l.blockNumber, 16), tx: l.transactionHash });

// the pool's live state from the PoolManager's storage (Uniswap V4 StateLibrary: pools mapping at slot 6)
async function poolState(poolId, tokenIs0 = false) {
  const slot = keccak256(hexBytes(poolId.slice(2) + "6".padStart(64, "0"))), liqSlot = "0x" + (BigInt(slot) + 3n).toString(16).padStart(64, "0");
  const [s0, lq] = await Promise.all([call(ELY.poolManager, "0x1e2eaeaf" + slot.slice(2)), call(ELY.poolManager, "0x1e2eaeaf" + liqSlot.slice(2))]);
  if (!s0 || s0 === "0x" || BigInt(s0) === 0n) return null; const w = BigInt(s0), sqrtP = w & ((1n << 160n) - 1n), tick = Number(BigInt.asIntN(24, (w >> 160n) & 0xffffffn));
  const p = Number(sqrtP) / 2 ** 96, c1per0 = p * p; // price of currency0 in currency1
  const hypePerToken = tokenIs0 ? c1per0 : c1per0 ? 1 / c1per0 : null; return { tick, hypePerToken, liquidity: lq ? BigInt(lq) : 0n };
}
// the launch transaction: the creator's first buy and who added the liquidity
async function launchTx(L) {
  const rc = await erpc("eth_getTransactionReceipt", [L.tx]); let buyHype = 0, buyTokens = 0, lp = null, tokenIs0 = false, quote = null;
  const init = rc.logs.find((l) => l.address.toLowerCase() === ELY.poolManager && l.topics[0] === T_INIT && l.topics[1] === L.poolId);
  if (init) { const c0 = ad(init.topics[2]), c1 = ad(init.topics[3]); tokenIs0 = c0 === L.token; quote = tokenIs0 ? c1 : c0; }
  for (const l of rc.logs) { if (l.address.toLowerCase() !== ELY.poolManager || l.topics[1] !== L.poolId) continue;
    if (l.topics[0] === T_SWAP) { const s = side(l.data, tokenIs0); if (s.tok > 0n) { buyHype += Number(-s.hype) / 1e18; buyTokens += Number(s.tok) / 1e18; } }
    if (l.topics[0] === T_MODIFY && !lp) lp = ad(l.topics[2]); }
  return { buyHype, buyTokens, lp, tokenIs0, quote };
}

export async function elyNew({ count = 10 } = {}) {
  count = Math.max(1, Math.min(20, count | 0 || 10));
  const now = await head(), found = [];
  for (let to = now; found.length < count && to > now - 60000; to -= ELY.maxRange) found.push(...(await elogs({ address: ELY.launchpad, topics: [ELY.tLaunch] }, Math.max(0, to - ELY.maxRange + 1), to, { step: ELY.maxRange })).map(decodeLaunch).reverse());
  const rows = [];
  for (const L of found.slice(0, count)) {
    const [I, b, T] = await Promise.all([tokenInfo(L.token), erpc("eth_getBlockByNumber", ["0x" + L.block.toString(16), false]), launchTx(L)]), P = await poolState(L.poolId, T.tokenIs0);
    const creatorNow = await bal(L.token, L.creator);
    rows.push({ ...L, symbol: I.symbol, name: I.name, supply: I.supply, at: parseInt(b.timestamp, 16), creatorBuyHype: T.buyHype, creatorShareNow: share(creatorNow, I.supply), hypePerToken: P ? P.hypePerToken : null, lp: T.lp });
  }
  return { now, rows };
}

// find the block a contract was created in: binary search on its code (the RPC serves historical state)
async function createdAt(addr, hi) { let lo = 0; while (lo < hi) { const m = Math.floor((lo + hi) / 2), c = await erpc("eth_getCode", [addr, "0x" + m.toString(16)]); if (c && c !== "0x") hi = m; else lo = m + 1; } return lo; }
export const HISTORY_CAP = 40000; // blocks read for holders and trades (about 1.5 hours on Elysium); older history is left to the explorer

export async function elyCheck(token, { log = () => {} } = {}) {
  token = token.toLowerCase(); if (!isEvmAddr(token)) throw new Error("give a token contract 0x… (40 hex)");
  const now = await head(), code = await erpc("eth_getCode", [token, "latest"]); if (!code || code === "0x") throw new Error("no contract at this address on Elysium mainnet");
  log("reading the token…"); const I = await tokenInfo(token); if (I.decimals == null || I.supply == null) throw new Error("this contract does not answer like an ERC-20 token");
  log("finding when it was created…"); const born = await createdAt(token, now);
  const ev = (await elogs({ address: ELY.launchpad, topics: [ELY.tLaunch, pad(token)] }, born, Math.min(now, born + 50), { step: 51 })).map(decodeLaunch)[0] || null;
  const verified = await fetch(`https://sourcify.dev/server/v2/contract/${ELY.id}/${token}`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).then((j) => j.match || null).catch(() => null);
  const R = { token, now, born, ...I, verified, burned: share((await bal(token, DEAD)) + (await bal(token, ZERO)), I.supply), launch: null, holders: null };
  const from = born, to = now, capped = to - from > HISTORY_CAP, start = capped ? null : from;
  if (ev) { log("reading the launch and the pool…"); const [b, T, creatorNow] = await Promise.all([erpc("eth_getBlockByNumber", ["0x" + ev.block.toString(16), false]), launchTx(ev), bal(token, ev.creator)]), P = await poolState(ev.poolId, T.tokenIs0);
    R.launch = { ...ev, at: parseInt(b.timestamp, 16), creatorBuyHype: T.buyHype, creatorBuyTokens: T.buyTokens, lp: T.lp, pool: P, creatorShareNow: share(creatorNow, I.supply) };
    if (start != null) { log("reading the pool's swaps…"); const sw = await elogs({ address: ELY.poolManager, topics: [T_SWAP, ev.poolId] }, start, to);
      const rows = sw.map((l) => side(l.data, T.tokenIs0)); R.launch.buys = rows.filter((x) => x.tok > 0n).length; R.launch.sells = rows.filter((x) => x.tok < 0n).length; R.launch.volumeHype = rows.reduce((s, x) => s + Math.abs(Number(x.hype)) / 1e18, 0); } }
  if (start != null) { log("reading every transfer for the holders…"); const tl = await elogs({ address: token, topics: [T_TRANSFER] }, start, to); const m = new Map();
    for (const l of tl) { const v = BigInt(l.data), f = ad(l.topics[1]), t = ad(l.topics[2]); m.set(f, (m.get(f) || 0n) - v); m.set(t, (m.get(t) || 0n) + v); }
    const skip = new Set([ZERO, DEAD, ELY.poolManager, ELY.launchpad, R.launch && R.launch.lp].filter(Boolean)), list = [...m].filter(([a, v]) => v > 0n && !skip.has(a)).sort((a, b) => (b[1] > a[1] ? 1 : -1));
    const sold = R.launch ? tl.filter((l) => ad(l.topics[1]) === R.launch.creator).reduce((s, l) => s + BigInt(l.data), 0n) : 0n; if (R.launch) R.launch.creatorSent = share(sold, I.supply);
    R.holders = { count: list.length, transfers: tl.length, inPool: share(m.get(ELY.poolManager) || 0n, I.supply), top10: share(list.slice(0, 10).reduce((s, [, v]) => s + v, 0n), I.supply), top: list.slice(0, 10).map(([a, v]) => ({ addr: a, share: share(v, I.supply), creator: R.launch && a === R.launch.creator })) };
    for (const x of R.holders.top) { const c = await erpc("eth_getCode", [x.addr, "latest"]).catch(() => "0x"); x.contract = !!c && c !== "0x"; }
    R.holders.top10Wallets = R.holders.top.filter((x) => !x.contract).reduce((s, x) => s + (x.share || 0), 0);
  } else R.holders = { tooOld: true, blocks: to - from };
  return R;
}

// Markdown
const f = (x, d = 4) => (x == null || !isFinite(x) ? "–" : Number(x).toLocaleString("en-US", { maximumFractionDigits: d }));
const pct = (x) => (x == null ? "–" : Number(x).toFixed(2) + "%"), sh = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const A = (a) => `[${sh(a)}](${ELY.explorer}/address/${a})`, TX = (h) => `[${sh(h)}](${ELY.explorer}/tx/${h})`;
const utc = (s) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
export function elyNewMd(N) {
  return `# Ruby Lens · Elysium · latest ${N.rows.length} launches\nRead at block ${N.now.toLocaleString("en-US")} from the events of Elysium's busiest token launcher ${A(ELY.launchpad)}. Each launch opens a Uniswap V4 pool with HYPE. Facts only, no scores.\n\n| launched (UTC) | token | creator | creator bought | creator holds now | price (HYPE) |\n| --- | --- | --- | --- | --- | --- |\n` +
    N.rows.map((r) => `| ${utc(r.at).slice(5, 16)} | [${(r.symbol || sh(r.token)).replace(/\|/g, "")}](${ELY.explorer}/token/${r.token}) | ${A(r.creator)} | ${f(r.creatorBuyHype)} HYPE | ${pct(r.creatorShareNow)} | ${r.hypePerToken == null ? "–" : r.hypePerToken.toPrecision(3)} |`).join("\n") +
    "\n\nCheck any of them with ruby_lens_check and network elysium.";
}
export function elyCheckMd(R) {
  const L = R.launch, H = R.holders, S = [`# Ruby Lens · Elysium · ${R.symbol || sh(R.token)}${R.name && R.name !== R.symbol ? " · " + R.name : ""}`, `Read at block ${R.now.toLocaleString("en-US")} on Elysium mainnet (99901). Facts only, no score.`, "",
    `- contract ${A(R.token)} · source on Sourcify: ${R.verified || "not verified"} · owner: ${R.owner === null ? "no owner() function" : R.owner === ZERO ? "renounced (0x0)" : A(R.owner)}`,
    `- supply ${f(Number(R.supply) / 10 ** R.decimals, 0)} · burned ${pct(R.burned)} · created at block ${R.born.toLocaleString("en-US")}`];
  if (L) S.push(`- launched ${utc(L.at)} by ${A(L.creator)} on the launcher ${A(ELY.launchpad)} · ${TX(L.tx)}`,
    `- creator: bought ${f(L.creatorBuyHype)} HYPE at launch${L.creatorSent != null ? ` · sent ${pct(L.creatorSent)} of supply since` : ""} · holds ${pct(L.creatorShareNow)} now`,
    `- pool: Uniswap V4, pool id \`${L.poolId.slice(0, 18)}…\`${L.pool ? ` · 1 ${R.symbol || "token"} ≈ ${L.pool.hypePerToken.toPrecision(4)} HYPE · tick ${L.pool.tick}` : ""} · liquidity added by ${L.lp ? A(L.lp) : "–"} (the launcher's hook, source not verified: Ruby can't say if it can remove it)`,
    L.buys != null ? `- trades in the pool: ${L.buys} buys / ${L.sells} sells · ${f(L.volumeHype, 2)} HYPE volume` : `- trades: older than the last ${HISTORY_CAP.toLocaleString("en-US")} blocks, not rebuilt from the public RPC`);
  else S.push("- not launched by the launcher Ruby reads (no launch event at its creation)");
  if (H && H.count != null) S.push(`- holders: ${H.count.toLocaleString("en-US")} (from ${H.transfers.toLocaleString("en-US")} transfers) · top 10 hold ${pct(H.top10)}, of which wallets ${pct(H.top10Wallets)} · ${pct(H.inPool)} in the V4 pool`, ...(H.top.length ? ["", "| # | holder | share | what it is |", "| --- | --- | --- | --- |"] : []), ...H.top.map((x, i) => `| ${i + 1} | ${A(x.addr)} | ${pct(x.share)} | ${x.creator ? "creator" : x.contract ? "contract" : "wallet"} |`));
  else if (H && H.tooOld) S.push(`- holders: the token is ${H.blocks.toLocaleString("en-US")} blocks old, more than the ${HISTORY_CAP.toLocaleString("en-US")} Ruby reads from the public RPC. See the explorer.`);
  return S.join("\n");
}
