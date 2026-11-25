// ruby pool <poolId>: a fact note about a Uniswap V4 pool on Robinhood Chain.
// V4 pools have no contract of their own: every pool lives in one PoolManager and is named by a 32-byte pool id.
// Ruby reads the pool's key from its Initialize event and its live state straight from PoolManager storage (extsload).
import { rpc, logs, tokenInfo, sourcify, quoteUsdgTo, blockSecondsAgo, EXPLORER, USDG, short } from "./chain.mjs";
import { frontmatter, write, table, safeName } from "./note.mjs";
import { keccak256, hexBytes } from "./keccak.mjs";

export const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
export const T_INIT = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
export const T_V4SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
export const T_MODIFY = "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec";
const ETH = "0x0000000000000000000000000000000000000000", WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const w = (h, i) => BigInt("0x" + h.slice(2 + i * 64, 66 + i * 64)), int = (v, bits) => BigInt.asIntN(bits, v);
const addr = (t) => "0x" + t.slice(26).toLowerCase(), pad = (n) => BigInt(n).toString(16).padStart(64, "0");
const fmt = (x, max = 6) => (x === null || x === undefined || !isFinite(x) ? "–" : x === 0 ? "0" : Math.abs(x) >= 1 ? x.toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) >= 1000 ? 2 : 4 }) : x.toPrecision(max).replace(/0+$/, "").replace(/\.$/, ""));
export const isPoolId = (s) => /^0x[0-9a-fA-F]{64}$/.test(s || "");
const extsload = async (slot) => BigInt(await rpc("eth_call", [{ to: POOL_MANAGER, data: "0x1e2eaeaf" + slot.replace(/^0x/, "") }, "latest"]));
const meta = async (t) => (t === ETH ? { symbol: "ETH", name: "Ether (native)", decimals: 18 } : tokenInfo(t));

export async function readV4(poolId) {
  const id = poolId.toLowerCase(), head = parseInt(await rpc("eth_blockNumber", []), 16);
  let init = []; for (let to = head; to > 0 && !init.length; to -= 9_000_000) init = await rpc("eth_getLogs", [{ address: POOL_MANAGER, topics: [T_INIT, id], fromBlock: "0x" + Math.max(0, to - 8_999_999).toString(16), toBlock: "0x" + to.toString(16) }]);
  if (!init.length) throw new Error("no Uniswap V4 pool with this id in the PoolManager on Robinhood Chain");
  const l = init[0], c0 = addr(l.topics[2]), c1 = addr(l.topics[3]);
  const key = { fee: Number(w(l.data, 0)), tickSpacing: Number(int(w(l.data, 1), 24)), hooks: "0x" + l.data.slice(2 + 2 * 64 + 24, 2 + 3 * 64).toLowerCase() };
  const slot = keccak256(hexBytes(id + pad(6))), s0 = await extsload(slot), liq = await extsload("0x" + pad(BigInt(slot) + 3n));
  const sqrtP = s0 & ((1n << 160n) - 1n), tick = Number(int((s0 >> 160n) & 0xffffffn, 24)), protocolFee = Number((s0 >> 184n) & 0xffffffn), lpFee = Number((s0 >> 208n) & 0xffffffn);
  return { id, head, initBlock: parseInt(l.blockNumber, 16), initTx: l.transactionHash, c0, c1, key, sqrtP, tick, protocolFee, lpFee, liquidity: liq };
}

export async function poolV4(poolId, vault, { log = () => {} } = {}) {
  log("reading the V4 pool from PoolManager…");
  const P = await readV4(poolId);
  const [X, Y] = await Promise.all([meta(P.c0), meta(P.c1)]), dx = X.decimals ?? 18, dy = Y.decimals ?? 18, sx = X.symbol || short(P.c0), sy = Y.symbol || short(P.c1);
  const raw = (Number(P.sqrtP) / 2 ** 96) ** 2, price = raw * 10 ** (dx - dy); // 1 token0 in token1
  const L = Number(P.liquidity), sq = Number(P.sqrtP) / 2 ** 96, v0 = sq ? L / sq / 10 ** dx : 0, v1 = (L * sq) / 10 ** dy; // virtual amounts of the in-range liquidity at this price
  log("pricing in USDG…");
  const usd = async (t, d) => (t === USDG ? 1 : (await quoteUsdgTo(t === ETH ? WETH : t, d).catch(() => null)));
  const [u0, u1] = await Promise.all([usd(P.c0, dx), usd(P.c1, dy)]);
  const p0 = u0 ?? (u1 != null ? price * u1 : null), p1 = u1 ?? (u0 != null ? u0 / price : null);
  log("reading the last 24 hours of swaps…");
  const win = await blockSecondsAgo(86400);
  const sw = await logs({ address: POOL_MANAGER, topics: [T_V4SWAP, P.id] }, Math.max(win.from, P.initBlock), win.to);
  let vol0 = 0, vol1 = 0, buys1 = 0, sells1 = 0; const traders = new Set(), rows = [];
  for (const l of sw) { const a0 = Number(int(w(l.data, 0), 128)) / 10 ** dx, a1 = Number(int(w(l.data, 1), 128)) / 10 ** dy; vol0 += Math.abs(a0); vol1 += Math.abs(a1); traders.add(addr(l.topics[2]));
    // amounts are from the swapper's side: negative = paid into the pool, positive = taken out
    if (a1 > 0) buys1++; else sells1++; rows.push({ b: parseInt(l.blockNumber, 16), side: a1 > 0 ? `buy ${sy}` : `sell ${sy}`, a0, a1, tx: l.transactionHash }); }
  const volUsd = p0 != null ? vol0 * p0 : p1 != null ? vol1 * p1 : null;
  const mods = await logs({ address: POOL_MANAGER, topics: [T_MODIFY, P.id] }, P.initBlock, win.to).catch(() => []);
  log("checking Sourcify…");
  const [vHook, vPM] = await Promise.all([P.key.hooks !== ETH ? sourcify(P.key.hooks) : null, sourcify(POOL_MANAGER)]);
  const hookName = P.key.hooks !== ETH ? await fetch(`https://sourcify.dev/server/v2/contract/4663/${P.key.hooks}?fields=compilation`).then((r) => r.json()).then((j) => (j.compilation && j.compilation.name) || null).catch(() => null) : null;
  const link = (a) => `[${short(a)}](${EXPLORER}/address/${a})`, tok = (a, s) => (a === ETH ? "ETH (native)" : `[${s}](${EXPLORER}/token/${a})`), vt = (v) => (v === "exact_match" ? "exact match" : v === "match" ? "match" : "not verified");
  const dyn = (P.key.fee & 0x800000) !== 0;
  const fm = frontmatter({ type: "pool", dex: "uniswap-v4", pool_id: P.id, token_x: P.c0, token_y: P.c1, symbol_x: sx, symbol_y: sy, tick_spacing: P.key.tickSpacing, tick: P.tick, price: +price.toPrecision(8),
    fee: dyn ? "dynamic" : P.key.fee / 1e4 + "%", hooks: P.key.hooks, liquidity: P.liquidity.toString(), swaps_24h: sw.length, volume_24h_usdg: volUsd == null ? null : +volUsd.toFixed(2), block: win.to, chain: "Robinhood Chain mainnet (4663)", tags: ["pool", "uniswap-v4", "robinhood-chain"] });
  const body = `
# ${sx} / ${sy} · Uniswap V4 pool

Facts read from the Uniswap V4 PoolManager on Robinhood Chain mainnet at block ${win.to.toLocaleString("en-US")}. No opinions or scores: check each line yourself with the links.

## Pool
|  |  |
| --- | --- |
| pool id | \`${P.id}\` |
| PoolManager | ${link(POOL_MANAGER)} · source: ${vt(vPM)} (one contract holds every V4 pool's tokens) |
| currency 0 | ${tok(P.c0, sx)} · ${dx} decimals |
| currency 1 | ${tok(P.c1, sy)} · ${dy} decimals |
| fee in the key | ${dyn ? "dynamic (set by the hook)" : (P.key.fee / 1e4).toFixed(2) + "%"} |
| tick spacing | ${P.key.tickSpacing} |
| hooks | ${P.key.hooks === ETH ? "none" : `${link(P.key.hooks)} · ${hookName || "name unknown"} · source: ${vt(vHook)}`} |
| created | block ${P.initBlock.toLocaleString("en-US")} · [${short(P.initTx)}](${EXPLORER}/tx/${P.initTx}) |

A hook is a contract the pool calls on every swap or liquidity change. It can add fees or rules: read its source before trading.

## Price
|  |  |
| --- | --- |
| current tick | ${P.tick.toLocaleString("en-US")} |
| 1 ${sx} | ${fmt(price, 8)} ${sy} |
| 1 ${sy} | ${fmt(1 / price, 8)} ${sx} |
${p0 != null ? `| 1 ${sx} in USDG | ${fmt(p0, 6)} |\n` : ""}${p1 != null ? `| 1 ${sy} in USDG | ${fmt(p1, 6)} |\n` : ""}
From slot0: price = (sqrtPriceX96 / 2^96)^2, adjusted for decimals.${p0 != null || p1 != null ? " USDG values use a live KyberSwap quote." : ""}

## Liquidity at this price
|  |  |
| --- | --- |
| active liquidity (L) | ${P.liquidity.toLocaleString("en-US")} |
| as ${sx} | ${fmt(v0)} |
| as ${sy} | ${fmt(v1)} |
| liquidity changes since creation | ${mods.length} |

V4 keeps all pools' tokens in one PoolManager, so there is no per-pool balance to read. The amounts above are the virtual size of the liquidity that is active at the current price (L / √P and L × √P), not a full reserve count.

## Last 24 hours
|  |  |
| --- | --- |
| swaps | ${sw.length} by ${traders.size} sender${traders.size === 1 ? "" : "s"} (often routers) |
| ${sy} bought / sold | ${buys1} / ${sells1} swaps |
| volume | ${fmt(vol0)} ${sx} · ${fmt(vol1)} ${sy}${volUsd != null ? ` · about ${fmt(volUsd)} USDG` : ""} |

${rows.length ? table(["block", "swap", sx, sy, "tx"], rows.slice(-15).reverse().map((r) => [r.b.toLocaleString("en-US"), r.side, fmt(Math.abs(r.a0)), fmt(Math.abs(r.a1)), `[${short(r.tx)}](${EXPLORER}/tx/${r.tx})`])) : "No swaps in the last 24 hours.\n"}
## Notes
-
`;
  return write(vault, `Pools/${safeName(`${sx}-${sy} v4 ${P.id.slice(0, 8)}`)}.md`, fm + body);
}
