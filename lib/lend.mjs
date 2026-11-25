// ruby lend [wallet]: lending markets on Robinhood Chain, read from their contracts. Ruby lends nothing and holds nothing.
// Two venues found live on chain: an Aave V3 pool (it names its market with getMarketId) and Morpho (one contract, many markets).
// With a wallet: its positions in both, with how far each is from liquidation. Facts, never advice.
import { rpc, logs, head, EXPLORER, short, USDG } from "./chain.mjs";
import { frontmatter, write, table, safeName } from "./note.mjs";

export const AAVE_POOL = "0x433e21dc2bf027910b1635653c2eb630bc7dad43", AAVE_PROVIDER = "0x6758efc446ee8bde7670b93a6df799dffe8f8969", MORPHO = "0x9d53d5e3bd5e8d4cbfa6db1ca238aea02e651010";
const S = { market: "0x5c60e39a", position: "0x93c52062", params: "0x2c3c9157", price: "0xa035b1fe", account: "0xbf92857c", reserves: "0xd1946dbc", reserve: "0x35ea6a75", marketId: "0x568ef470",
  oracle: "0xfca513a8", assetPrice: "0xb3596f07", source: "0x92bf2be0", round: "0xfeaf968c", desc: "0x7284e416", symbol: "0x95d89b41", decimals: "0x313ce567", supply: "0x18160ddd" };
const T_CREATE = "0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac", T_SUPPLY = "0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0",
  T_BORROW = "0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43", T_COLL = "0xa3b9472a1399e17e123f3c2e6586c23e504184d504de59cdaa2b375e880c6184";
const RPC = process.env.RUBY_RPC || "https://rpc.mainnet.chain.robinhood.com", sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (h) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0"), words = (h) => (h && h.length > 2 ? h.slice(2).match(/.{64}/g) || [] : []), big = (w) => BigInt("0x" + w), addr = (w) => "0x" + w.slice(24);
const str = (h) => { try { const b = h.slice(2); if (b.length === 64) return Buffer.from(b, "hex").toString("utf8").replace(/\0+$/, ""); const k = parseInt(b.slice(64, 128), 16); return Buffer.from(b.slice(128, 128 + k * 2), "hex").toString("utf8"); } catch { return null; } };
const fmt = (x, d = 2) => (x == null || !isFinite(x) ? "–" : x.toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) >= 1000 ? 0 : d }));
// many eth_calls in one JSON-RPC batch; the node accepts batches
async function batch(calls, size = 40) {
  const out = []; for (let i = 0; i < calls.length; i += size) { const part = calls.slice(i, i + size); if (i) await sleep(350);
    for (let k = 0; k < 8; k++) { try { const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(part.map((c, j) => ({ jsonrpc: "2.0", id: j, method: "eth_call", params: [c, "latest"] }))), signal: AbortSignal.timeout(30000) });
        if (r.status === 429) throw new Error("busy"); const j = await r.json(); if (!Array.isArray(j)) throw new Error("busy"); j.sort((a, b) => a.id - b.id); out.push(...j.map((x) => x.result || "0x")); break; } catch (e) { if (k === 7) throw e; await sleep(1500 * (k + 1)); } } }
  return out; }
const tokenMeta = async (list) => { const u = [...new Set(list)].filter((a) => a && a !== "0x0000000000000000000000000000000000000000"); const r = await batch(u.flatMap((a) => [{ to: a, data: S.symbol }, { to: a, data: S.decimals }]));
  const m = new Map(); u.forEach((a, i) => m.set(a, { sym: str(r[2 * i]) || short(a), dec: r[2 * i + 1] && r[2 * i + 1] !== "0x" ? Number(BigInt(r[2 * i + 1])) : 18 })); return m; };

export async function readAave() {
  const [mid, orw, rl] = await batch([{ to: AAVE_PROVIDER, data: S.marketId }, { to: AAVE_PROVIDER, data: S.oracle }, { to: AAVE_POOL, data: S.reserves }]);
  const oracle = addr(words(orw)[0]), assets = words(rl).slice(2).map(addr), meta = await tokenMeta(assets);
  const rd = await batch(assets.flatMap((a) => [{ to: AAVE_POOL, data: S.reserve + pad(a) }, { to: oracle, data: S.assetPrice + pad(a) }, { to: oracle, data: S.source + pad(a) }]));
  const rows = assets.map((a, i) => { const w = words(rd[3 * i]); const cfg = big(w[0]); return { asset: a, ...meta.get(a), ltv: Number(cfg & 0xffffn) / 100, lt: Number((cfg >> 16n) & 0xffffn) / 100, supplyApr: Number(big(w[2])) / 1e25, borrowApr: Number(big(w[4])) / 1e25, aToken: addr(w[8]), debtToken: addr(w[10]), price: Number(BigInt(rd[3 * i + 1] || "0x0")) / 1e8, source: addr(words(rd[3 * i + 2])[0] || "0".repeat(64)) }; });
  const tot = await batch(rows.flatMap((r) => [{ to: r.aToken, data: S.supply }, { to: r.debtToken, data: S.supply }, { to: r.source, data: S.round }, { to: r.source, data: S.desc }]));
  const now = Math.floor(Date.now() / 1000);
  rows.forEach((r, i) => { r.supplied = Number(BigInt(tot[4 * i] || "0x0")) / 10 ** r.dec; r.borrowed = Number(BigInt(tot[4 * i + 1] || "0x0")) / 10 ** r.dec; const rw = words(tot[4 * i + 2]); r.updatedAt = rw.length >= 4 ? Number(big(rw[3])) : null; r.age = r.updatedAt ? now - r.updatedAt : null; r.feed = str(tot[4 * i + 3]) || null; r.suppliedUsd = r.supplied * r.price; r.borrowedUsd = r.borrowed * r.price; });
  return { name: str(mid) || "Aave V3 market", pool: AAVE_POOL, provider: AAVE_PROVIDER, oracle, reserves: rows };
}

export async function morphoMarketIds() { const h = await head(); const L = await logs({ address: MORPHO, topics: [T_CREATE] }, 0, h); return L.map((l) => ({ id: l.topics[1], block: parseInt(l.blockNumber, 16), loan: addr(l.data.slice(2, 66)), coll: addr(l.data.slice(66, 130)), oracle: addr(l.data.slice(130, 194)), lltv: Number(BigInt("0x" + l.data.slice(258, 322))) / 1e16 })); }
export async function readMorpho({ top = 30 } = {}) {
  const ids = await morphoMarketIds(), st = await batch(ids.map((m) => ({ to: MORPHO, data: S.market + m.id.slice(2) })));
  ids.forEach((m, i) => { const w = words(st[i]); m.supplyRaw = w.length ? big(w[0]) : 0n; m.borrowRaw = w.length ? big(w[2]) : 0n; m.borrowShares = w.length ? big(w[3]) : 0n; });
  const meta = await tokenMeta(ids.flatMap((m) => [m.loan, m.coll]));
  ids.forEach((m) => { const L = meta.get(m.loan) || { sym: "?", dec: 18 }, C = meta.get(m.coll) || { sym: "–", dec: 18 }; m.loanSym = L.sym; m.collSym = C.sym; m.supply = Number(m.supplyRaw) / 10 ** L.dec; m.borrow = Number(m.borrowRaw) / 10 ** L.dec; m.util = m.supply ? (m.borrow / m.supply) * 100 : 0; });
  // match the real USDG by address: any token can call itself "USDG"
  const usdgLike = ids.filter((m) => m.loan === USDG && m.supply >= 1000).sort((a, b) => b.supply - a.supply);
  const lookalikes = ids.filter((m) => m.loan !== USDG && m.loanSym === "USDG" && m.supply > 0).length;
  return { morpho: MORPHO, markets: ids.length, active: ids.filter((m) => m.supply > 0).length, usdgSupplied: usdgLike.reduce((s, m) => s + m.supply, 0), usdgBorrowed: usdgLike.reduce((s, m) => s + m.borrow, 0), lookalikes, top: usdgLike.slice(0, top) };
}

export async function readWallet(wallet) {
  wallet = wallet.toLowerCase();
  const [acc] = await batch([{ to: AAVE_POOL, data: S.account + pad(wallet) }]); const a = words(acc).map(big);
  const aave = a.length >= 6 ? { collateralUsd: Number(a[0]) / 1e8, debtUsd: Number(a[1]) / 1e8, availableUsd: Number(a[2]) / 1e8, lt: Number(a[3]) / 100, ltv: Number(a[4]) / 100, hf: a[1] > 0n ? Number(a[5]) / 1e18 : null } : null;
  const h = await head(), user = "0x" + pad(wallet); const evs = [];
  for (const [t, pos] of [[T_SUPPLY, 3], [T_BORROW, 2], [T_COLL, 3]]) { const topics = [t, null, null, null]; topics[pos] = user; while (topics.length && topics[topics.length - 1] === null) topics.pop(); evs.push(...(await logs({ address: MORPHO, topics }, 0, h).catch(() => []))); }
  const ids = [...new Set(evs.map((l) => l.topics[1]))]; const morpho = [];
  if (ids.length) {
    const r = await batch(ids.flatMap((id) => [{ to: MORPHO, data: S.position + id.slice(2) + pad(wallet) }, { to: MORPHO, data: S.market + id.slice(2) }, { to: MORPHO, data: S.params + id.slice(2) }]));
    const ps = ids.map((id, i) => { const p = words(r[3 * i]).map(big), m = words(r[3 * i + 1]).map(big), k = words(r[3 * i + 2]); return { id, supplyShares: p[0] || 0n, borrowShares: p[1] || 0n, collateral: p[2] || 0n, tSA: m[0] || 0n, tSS: m[1] || 0n, tBA: m[2] || 0n, tBS: m[3] || 0n, loan: addr(k[0]), coll: addr(k[1]), oracle: addr(k[2]), lltv: Number(big(k[4])) / 1e16 }; }).filter((p) => p.supplyShares > 0n || p.borrowShares > 0n || p.collateral > 0n);
    const meta = await tokenMeta(ps.flatMap((p) => [p.loan, p.coll])), pr = await batch(ps.map((p) => ({ to: p.oracle, data: S.price })));
    ps.forEach((p, i) => { const L = meta.get(p.loan) || { sym: "?", dec: 18 }, C = meta.get(p.coll) || { sym: "–", dec: 18 };
      const supplyAssets = (p.supplyShares * (p.tSA + 1n)) / (p.tSS + 1000000n), borrowAssets = (p.borrowShares * (p.tBA + 1n) + (p.tBS + 1000000n) - 1n) / (p.tBS + 1000000n); // Morpho's virtual shares, rounding the debt up
      const price = BigInt(pr[i] && pr[i] !== "0x" ? pr[i] : "0x0"), collInLoan = (p.collateral * price) / 10n ** 36n;
      const ltvNow = collInLoan > 0n ? (Number(borrowAssets) / Number(collInLoan)) * 100 : null;
      morpho.push({ id: p.id, loanSym: L.sym, collSym: C.sym, lltv: p.lltv, supplied: Number(supplyAssets) / 10 ** L.dec, borrowed: Number(borrowAssets) / 10 ** L.dec, collateral: Number(p.collateral) / 10 ** C.dec, collateralInLoan: Number(collInLoan) / 10 ** L.dec, ltvNow, health: ltvNow ? p.lltv / ltvNow : null, oracle: p.oracle }); }); }
  return { wallet, aave, morpho, block: h };
}

export async function lendNote(vault, { wallet, log = () => {} } = {}) {
  log("reading the Aave V3 market…"); const A = await readAave();
  log("reading every Morpho market…"); const M = await readMorpho();
  let W = null; if (wallet) { log("reading the wallet's positions…"); W = await readWallet(wallet); }
  const h = await head(), link = (a) => `[${short(a)}](${EXPLORER}/address/${a})`, age = (s) => (s == null ? "–" : s < 3600 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h");
  const fm = frontmatter({ type: "lend", block: h, aave_market: A.name, aave_supplied_usd: Math.round(A.reserves.reduce((s, r) => s + r.suppliedUsd, 0)), aave_borrowed_usd: Math.round(A.reserves.reduce((s, r) => s + r.borrowedUsd, 0)), morpho_markets: M.markets, morpho_usdg_supplied: Math.round(M.usdgSupplied), morpho_usdg_borrowed: Math.round(M.usdgBorrowed), wallet: W ? W.wallet : null, chain: "Robinhood Chain mainnet (4663)", tags: ["lend", "robinhood-chain"] });
  let body = `
# Lending on Robinhood Chain

Read from the lending contracts on Robinhood Chain mainnet at block ${h.toLocaleString("en-US")}. Ruby lends nothing and holds nothing. Facts with links, never advice.

## ${A.name} (Aave V3)
Pool ${link(A.pool)} · price oracle ${link(A.oracle)}

${table(["asset", "max LTV", "liquidation at", "supplied", "borrowed", "supply APR", "borrow APR", "price (USD)", "price feed", "updated"], A.reserves.map((r) => [r.sym, r.ltv + "%", r.lt + "%", fmt(r.supplied) + ` (~$${fmt(r.suppliedUsd, 0)})`, fmt(r.borrowed) + ` (~$${fmt(r.borrowedUsd, 0)})`, r.supplyApr.toFixed(2) + "%", r.borrowApr.toFixed(2) + "%", fmt(r.price, 4), `${r.feed || ""} ${link(r.source)}`, age(r.age) + " ago"]))}
Prices come from the pool's own oracle. "Updated" is the feed's last round: many feeds only update when the price moves past a threshold or a set time passes.

## Morpho
Contract ${link(M.morpho)} · ${M.markets} markets created, ${M.active} with funds. Real USDG (${link(USDG)}) lent in markets above 1,000 USDG: about ${fmt(M.usdgSupplied, 0)} supplied, ${fmt(M.usdgBorrowed, 0)} borrowed.${M.lookalikes ? ` ${M.lookalikes} other markets lend a different token that also calls itself "USDG"; they are left out.` : ""}

${table(["market", "liquidation LTV", "USDG supplied", "USDG borrowed", "utilisation", "oracle"], M.top.map((m) => [`${m.collSym} / ${m.loanSym}`, m.lltv + "%", fmt(m.supply, 0), fmt(m.borrow, 0), m.util.toFixed(1) + "%", link(m.oracle)]))}
Each Morpho market has its own oracle chosen by whoever created it. Read the oracle before you rely on a market.
`;
  if (W) { body += `
## Wallet ${link(W.wallet)}
${W.aave && (W.aave.collateralUsd > 0 || W.aave.debtUsd > 0) ? table(["", ""], [["Aave collateral", "$" + fmt(W.aave.collateralUsd)], ["Aave debt", "$" + fmt(W.aave.debtUsd)], ["can still borrow", "$" + fmt(W.aave.availableUsd)], ["health factor", W.aave.hf == null ? "no debt" : W.aave.hf.toFixed(3) + (W.aave.hf < 1 ? " · below 1: can be liquidated" : "")], ["liquidation threshold", W.aave.lt + "%"]]) : "No position in the Aave V3 market.\n"}
${W.morpho.length ? table(["Morpho market", "collateral", "borrowed", "supplied", "LTV now", "liquidation LTV", "room"], W.morpho.map((p) => [`${p.collSym} / ${p.loanSym}`, `${fmt(p.collateral, 4)} ${p.collSym} (~${fmt(p.collateralInLoan)} ${p.loanSym})`, fmt(p.borrowed) + " " + p.loanSym, fmt(p.supplied) + " " + p.loanSym, p.ltvNow == null ? "–" : p.ltvNow.toFixed(2) + "%", p.lltv + "%", p.health == null ? "no debt" : p.health >= 1 ? `${((1 - 1 / p.health) * 100).toFixed(1)}% price drop to liquidation` : "past liquidation"])) : "No position in Morpho markets.\n"}
"Room" is how far the collateral's price can fall, all else equal, before the position reaches its liquidation LTV.
`; }
  body += "\n## Notes\n- \n";
  return write(vault, `Research/${safeName("Lending " + (W ? short(W.wallet) + " " : "") + new Date().toISOString().slice(0, 10))}.md`, fm + body);
}
