// ruby pool <pair>: a fact note about a DLMM (liquidity book) pool on Robinhood Chain.
// Reads the pool contract itself: tokens, bin step, active bin and price, reserves, fees, the bins around the price,
// and the last 24 hours of swaps. Facts with links, no opinion. Read only.
import { rpc, logs, tokenInfo, sourcify, quoteUsdgTo, blockSecondsAgo, EXPLORER, USDG, short, amount } from "./chain.mjs";
import { frontmatter, write, table, safeName } from "./note.mjs";

// the two DLMM factories found on Robinhood Chain mainnet (both answer getNumberOfLBPairs / getLBPairAtIndex)
export const DLMM_FACTORIES = ["0xdcd5f77697914e27f56fd263ef82923c8524abac", "0x3d8dc63ddc9b992cfde89f7aea6f18717e84687d"];
const S = { tokenX: "0x05e8746d", tokenY: "0xda10610c", binStep: "0x17f11ecc", activeId: "0xdbe65edc", reserves: "0x0902f1ac", bin: "0x0abe9688",
  staticFee: "0x7ca0de30", variableFee: "0x8d7024e5", protocolFees: "0xd8dfcea0", factory: "0x88cc58e4", owner: "0x8da5cb5b", feeRecipient: "0x4ccb20c0" };
export const T_SWAP = "0xad7d6f97abf51ce18e17a38f4d70e975be9c0708474987bb3e26ad21bd93ca70";
export const T_DEPOSIT = "0x87f1f9dcf5e8089a3e00811b6a008d8f30293a3da878cb1fe8c90ca376402f8a";
export const T_WITHDRAW = "0xa32e146844d6144a22e94c586715a1317d58a8aa3581ec33d040113ddcb24350";
const ID_ZERO = 8388608; // 2^23: the bin whose price is exactly 1

const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const words = (hex) => (hex && hex !== "0x" ? hex.slice(2).match(/.{64}/g) || [] : []).map((w) => BigInt("0x" + w));
const addrOf = (hex) => "0x" + hex.slice(-40).toLowerCase();
const lo = (b) => b & ((1n << 128n) - 1n), hi = (b) => b >> 128n; // packed bytes32: X in the low 128 bits, Y in the high 128 bits
const pad = (n) => BigInt(n).toString(16).padStart(64, "0");
const n = (v, dec) => Number(v) / 10 ** dec;
const fmt = (x, max = 6) => (x === null || x === undefined || !isFinite(x) ? "–" : x === 0 ? "0" : Math.abs(x) >= 1 ? x.toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) >= 1000 ? 2 : 4 }) : x.toPrecision(max).replace(/0+$/, "").replace(/\.$/, ""));

// price of 1 X in Y at a bin, in whole tokens
export const binPrice = (id, binStep, decX, decY) => Math.pow(1 + binStep / 10000, id - ID_ZERO) * 10 ** (decX - decY);

// is this address a DLMM pair? returns its core state or throws
export async function readPair(pair) {
  const [x, y, bs, act] = await Promise.all([call(pair, S.tokenX), call(pair, S.tokenY), call(pair, S.binStep), call(pair, S.activeId)].map((p) => p.catch(() => "0x")));
  if ([x, y, bs, act].some((r) => !r || r === "0x" || r.length < 66)) throw new Error("this address does not answer as a DLMM (liquidity book) pool: getTokenX, getTokenY, getBinStep and getActiveId must all work");
  return { pair: pair.toLowerCase(), tokenX: addrOf(x), tokenY: addrOf(y), binStep: Number(BigInt(bs)), activeId: Number(BigInt(act)) };
}

export async function pool(pairAddr, vault, { log = () => {}, around = 10 } = {}) {
  log("reading the pool…");
  const P = await readPair(pairAddr);
  const [X, Y, res, sf, vf, pf, fac, code] = await Promise.all([tokenInfo(P.tokenX), tokenInfo(P.tokenY), call(P.pair, S.reserves), call(P.pair, S.staticFee), call(P.pair, S.variableFee).catch(() => "0x"), call(P.pair, S.protocolFees).catch(() => "0x"), call(P.pair, S.factory).catch(() => "0x"), rpc("eth_getCode", [P.pair, "latest"])]);
  const dx = X.decimals ?? 18, dy = Y.decimals ?? 18, symX = X.symbol || short(P.tokenX), symY = Y.symbol || short(P.tokenY);
  const [rx, ry] = words(res), [baseFactor, filterPeriod, decayPeriod, reductionFactor, variableFeeControl, protocolShare, maxVolAcc] = words(sf), [volAcc] = words(vf), [pfx, pfy] = words(pf);
  const factory = fac && fac.length >= 66 ? addrOf(fac) : null, impl = (/^0x363d3d37[0-9a-f]*?3d73([0-9a-f]{40})5af4/.exec(code || "") || [])[1];
  const price = binPrice(P.activeId, P.binStep, dx, dy), baseFeePct = Number(baseFactor) * P.binStep / 1e6; // baseFactor * binStep * 1e10 / 1e18, as a percent

  log("reading the bins around the price…");
  const ids = []; for (let i = P.activeId - around; i <= P.activeId + around; i++) ids.push(i);
  const bins = []; for (let i = 0; i < ids.length; i += 7) bins.push(...(await Promise.all(ids.slice(i, i + 7).map(async (id) => { const [bx, by] = words(await call(P.pair, S.bin + pad(id))); return { id, x: n(bx || 0n, dx), y: n(by || 0n, dy) }; }))));

  // a value in USDG for each side, when one side is USDG or a live quote exists
  log("pricing in USDG…");
  let usdX = null, usdY = null;
  if (P.tokenY === USDG) { usdY = 1; usdX = price; } else if (P.tokenX === USDG) { usdX = 1; usdY = 1 / price; }
  else { try { usdX = await quoteUsdgTo(P.tokenX, dx); } catch {} try { usdY = await quoteUsdgTo(P.tokenY, dy); } catch {} }
  const resX = n(rx || 0n, dx), resY = n(ry || 0n, dy), tvl = usdX !== null && usdY !== null ? resX * usdX + resY * usdY : null;

  log("reading the last 24 hours of swaps…");
  const win = await blockSecondsAgo(86400);
  const sw = await logs({ address: P.pair, topics: [T_SWAP] }, win.from, win.to);
  let inX = 0, inY = 0, feeX = 0, feeY = 0; const traders = new Set(); const recent = [];
  const byTx = new Map(); // one swap can cross several bins and emit one event per bin: group them by transaction
  for (const l of sw) { const [, ain, aout, , tf] = words(l.data); const ix = n(lo(ain), dx), iy = n(hi(ain), dy), ox = n(lo(aout), dx), oy = n(hi(aout), dy);
    inX += ix; inY += iy; feeX += n(lo(tf), dx); feeY += n(hi(tf), dy); traders.add(addrOf(l.topics[2]));
    const k = l.transactionHash, t = byTx.get(k) || { b: parseInt(l.blockNumber, 16), tx: k, ix: 0, iy: 0, ox: 0, oy: 0, bins: 0 }; t.ix += ix; t.iy += iy; t.ox += ox; t.oy += oy; t.bins++; byTx.set(k, t); }
  for (const t of byTx.values()) recent.push({ b: t.b, side: t.ix >= t.iy * (usdY ?? 0) / (usdX || 1) && t.ix > 0 ? `${symX} → ${symY}` : `${symY} → ${symX}`, inAmt: [t.ix > 0 ? `${fmt(t.ix)} ${symX}` : "", t.iy > 0 ? `${fmt(t.iy)} ${symY}` : ""].filter(Boolean).join(" + "), outAmt: [t.ox > 0 ? `${fmt(t.ox)} ${symX}` : "", t.oy > 0 ? `${fmt(t.oy)} ${symY}` : ""].filter(Boolean).join(" + "), bins: t.bins, tx: t.tx });
  recent.sort((a, b) => a.b - b.b);
  const vol = usdX !== null && usdY !== null ? inX * usdX + inY * usdY : null, fees = usdX !== null && usdY !== null ? feeX * usdX + feeY * usdY : null;
  const lp = await logs({ address: P.pair, topics: [[T_DEPOSIT, T_WITHDRAW]] }, win.from, win.to).catch(() => []);
  const deposits = lp.filter((l) => l.topics[0] === T_DEPOSIT).length, withdrawals = lp.length - deposits;

  log("checking Sourcify…");
  const [vPair, vImpl, vFac] = await Promise.all([sourcify(P.pair), impl ? sourcify("0x" + impl) : null, factory ? sourcify(factory) : null]);
  const facOwner = factory ? await call(factory, S.owner).then((r) => (r && r.length >= 66 ? addrOf(r) : null)).catch(() => null) : null;
  const vtxt = (v) => (v === "exact_match" ? "exact match" : v === "match" ? "match" : v === "unknown" ? "could not check" : "not verified");
  const link = (a) => `[${short(a)}](${EXPLORER}/address/${a})`, tlink = (a, s) => `[${s}](${EXPLORER}/token/${a})`;

  const name = `${symX}-${symY} ${P.pair.slice(0, 6)}`;
  const fm = frontmatter({ type: "pool", pair: P.pair, token_x: P.tokenX, token_y: P.tokenY, symbol_x: symX, symbol_y: symY, bin_step: P.binStep, active_id: P.activeId, price: +price.toPrecision(8),
    base_fee_pct: +baseFeePct.toFixed(4), reserve_x: +resX.toPrecision(10), reserve_y: +resY.toPrecision(10), tvl_usdg: tvl === null ? null : +tvl.toFixed(2), swaps_24h: byTx.size, volume_24h_usdg: vol === null ? null : +vol.toFixed(2),
    fees_24h_usdg: fees === null ? null : +fees.toFixed(4), verified: vtxt(vPair), code_verified: impl ? vtxt(vImpl) : vtxt(vPair), block: win.to, chain: "Robinhood Chain mainnet (4663)", tags: ["pool", "dlmm", "robinhood-chain"] });

  const body = `
# ${symX} / ${symY} · DLMM pool

Facts read from the pool contract on Robinhood Chain mainnet at block ${win.to.toLocaleString("en-US")}. No opinions or scores: check each line yourself with the links.

## Pool
|  |  |
| --- | --- |
| pair | [${P.pair}](${EXPLORER}/address/${P.pair}) |
| token X | ${tlink(P.tokenX, symX)} · ${X.name || ""} · ${dx} decimals |
| token Y | ${tlink(P.tokenY, symY)} · ${Y.name || ""} · ${dy} decimals |
| bin step | ${P.binStep} (each bin is ${(P.binStep / 100).toFixed(2)}% from the next) |
| factory | ${factory ? link(factory) : "–"}${factory && DLMM_FACTORIES.includes(factory) ? "" : " (not one of the two known DLMM factories)"} · source: ${vFac ? vtxt(vFac) : "–"}${facOwner ? ` · owner() ${link(facOwner)}` : ""} |
| code | ${impl ? `a minimal proxy to ${link("0x" + impl)} · source: ${vtxt(vImpl)}` : "–"} |
| pair source (Sourcify) | ${impl && vPair !== "match" && vPair !== "exact_match" ? `not verified on its own: the pair is a minimal proxy, and the code it runs is listed above (${vtxt(vImpl)})` : vtxt(vPair)} |

## Price
|  |  |
| --- | --- |
| active bin | ${P.activeId.toLocaleString("en-US")} |
| 1 ${symX} | ${fmt(price, 8)} ${symY} |
| 1 ${symY} | ${fmt(1 / price, 8)} ${symX} |

The price is the active bin's: (1 + bin step / 10,000) ^ (active bin − 8,388,608), adjusted for decimals.

## Liquidity
|  | amount${tvl !== null ? " | in USDG" : ""} |
| --- | --- |${tvl !== null ? " --- |" : ""}
| ${symX} | ${fmt(resX)}${tvl !== null ? ` | ${fmt(resX * usdX)}` : ""} |
| ${symY} | ${fmt(resY)}${tvl !== null ? ` | ${fmt(resY * usdY)}` : ""} |
${tvl !== null ? `| total |  | **${fmt(tvl)}** |\n` : ""}
${tvl !== null && P.tokenY !== USDG && P.tokenX !== USDG ? "USDG values use live KyberSwap quotes of 1,000 USDG.\n" : ""}
### Bins around the price (${around} each side)
${table(["bin", `price (${symY} per ${symX})`, symX, symY, ""], bins.map((b) => [b.id.toLocaleString("en-US"), fmt(binPrice(b.id, P.binStep, dx, dy), 6), fmt(b.x), fmt(b.y), b.id === P.activeId ? "**active**" : ""]))}
Bins below the active one hold only ${symY}, bins above hold only ${symX}; the active bin can hold both.

## Fees
|  |  |
| --- | --- |
| base fee | ${baseFeePct.toFixed(2)}% per swap |
| variable fee | added on top when the price moves (volatility now ${volAcc ?? "–"}, control ${variableFeeControl ?? "–"}, cap ${maxVolAcc ?? "–"}) |
| protocol share | ${protocolShare !== undefined ? (Number(protocolShare) / 100).toFixed(2) + "% of fees" : "–"} |
| protocol fees not yet collected | ${pfx !== undefined ? `${fmt(n(pfx, dx))} ${symX} · ${fmt(n(pfy, dy))} ${symY}` : "–"} |
| fee parameters | base factor ${baseFactor ?? "–"} · filter ${filterPeriod ?? "–"} s · decay ${decayPeriod ?? "–"} s · reduction ${reductionFactor ?? "–"} |

## Last 24 hours
|  |  |
| --- | --- |
| swaps | ${byTx.size} transaction${byTx.size === 1 ? "" : "s"} (${sw.length} bin fills) by ${traders.size} address${traders.size === 1 ? "" : "es"} |
| volume in | ${fmt(inX)} ${symX} · ${fmt(inY)} ${symY}${vol !== null ? ` · about ${fmt(vol)} USDG at today's price` : ""} |
| fees paid | ${fmt(feeX)} ${symX} · ${fmt(feeY)} ${symY}${fees !== null ? ` · about ${fmt(fees)} USDG` : ""} |
| liquidity added / removed | ${deposits} / ${withdrawals} transactions |

${recent.length ? table(["block", "swap", "in", "out", "bins", "tx"], recent.slice(-15).reverse().map((r) => [r.b.toLocaleString("en-US"), r.side, r.inAmt, r.outAmt, String(r.bins), `[${short(r.tx)}](${EXPLORER}/tx/${r.tx})`])) : "No swaps in the last 24 hours.\n"}
## Notes
-
`;
  return write(vault, `Pools/${safeName(name)}.md`, fm + body);
}
