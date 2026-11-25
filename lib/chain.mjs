// Robinhood Chain mainnet: JSON-RPC, token reads and live prices. Read only: Ruby never signs and never holds a key.
export const RPC = process.env.RUBY_RPC || "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const CHAIN_ID = 4663;
export const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const T_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const DEAD = "0x000000000000000000000000000000000000dead", ZERO = "0x0000000000000000000000000000000000000000";
// stock, ETF and crypto tokens on Robinhood Chain, with their decimals
export const MARKETS = { ETH: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 18], BTC: ["0xcec185eb182c47d1ba1efc84e6959e18cd620be4", 8], NVDA: ["0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", 18], TSLA: ["0x322f0929c4625ed5bad873c95208d54e1c003b2d", 18], AAPL: ["0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", 18], AMZN: ["0x12f190a9f9d7d37a250758b26824b97ce941bf54", 18], GOOGL: ["0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", 18], META: ["0xc0d6457c16cc70d6790dd43521c899c87ce02f35", 18], MSFT: ["0xe93237c50d904957cf27e7b1133b510c669c2e74", 18], SPY: ["0x117cc2133c37b721f49de2a7a74833232b3b4c0c", 18], QQQ: ["0xd5f3879160bc7c32ebb4dc785f8a4f505888de68", 18], GLD: ["0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e", 18], COIN: ["0x6330d8c3178a418788df01a47479c0ce7ccf450b", 18], MSTR: ["0xec262a75e413fafd0df80480274532c79d42da09", 18] };
const UA = "ruby-brain-kit/0.1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let id = 0;
export async function rpc(method, params) {
  let last;
  for (let k = 0; k < 6; k++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json", "user-agent": UA }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status >= 500) throw new Error("RPC " + r.status);
      const j = await r.json();
      if (j.error) { if (/rate|too many/i.test(j.error.message)) throw new Error(j.error.message); throw Object.assign(new Error(j.error.message), { final: true }); }
      return j.result;
    } catch (e) { if (e.final) throw e; last = e; await sleep(600 * (k + 1)); }
  }
  throw last;
}

export const pad = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
export const topicAddr = (t) => "0x" + t.slice(26);
export const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");
export const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
export function fmt(v, dec, max = 6) {
  const s = BigInt(v).toString().padStart(dec + 1, "0"), i = s.slice(0, -dec) || "0", f = s.slice(-dec).slice(0, max).replace(/0+$/, "");
  return (i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")) + (f ? "." + f : "");
}
// like fmt, but tiny non-zero amounts keep their digits instead of showing 0
export const amount = (v, dec, max = 6) => { const s = fmt(v, dec, max); return s === "0" && BigInt(v) > 0n ? fmt(v, dec, dec) : s; };
export const num = (v, dec) => Number(BigInt(v)) / 10 ** dec;
const call = (to, data, block = "latest") => rpc("eth_call", [{ to, data }, block]);
export async function balanceOf(token, who) { const r = await call(token, "0x70a08231" + pad(who).slice(2)); return r && r !== "0x" ? BigInt(r) : 0n; }
export async function ethBalance(who) { return BigInt(await rpc("eth_getBalance", [who, "latest"])); }
export async function isContract(a) { const c = await rpc("eth_getCode", [a, "latest"]); return c && c !== "0x"; }

function abiString(hex) {
  if (!hex || hex === "0x") return null;
  const h = hex.slice(2);
  try {
    if (h.length === 64) return Buffer.from(h, "hex").toString("utf8").replace(/\0+$/, "") || null; // bytes32 style
    const len = parseInt(h.slice(64, 128), 16); return Buffer.from(h.slice(128, 128 + len * 2), "hex").toString("utf8");
  } catch { return null; }
}
export async function tokenInfo(token) {
  const safe = (p) => p.catch(() => null);
  const [name, symbol, decimals, supply, owner] = await Promise.all([safe(call(token, "0x06fdde03")), safe(call(token, "0x95d89b41")), safe(call(token, "0x313ce567")), safe(call(token, "0x18160ddd")), safe(call(token, "0x8da5cb5b"))]);
  return { name: abiString(name), symbol: abiString(symbol), decimals: decimals && decimals !== "0x" ? Number(BigInt(decimals)) : null, totalSupply: supply && supply !== "0x" ? BigInt(supply) : null,
    owner: owner && owner.length >= 66 ? topicAddr(owner.slice(0, 66)) : null };
}

// logs across any range: the node caps some queries (often 100k blocks, sometimes 10M) and says so; split and retry
export async function logs(filter, from, to, step = 9_000_000) {
  const out = [];
  for (let f = from; f <= to; ) {
    const e = Math.min(to, f + step - 1);
    try { out.push(...(await rpc("eth_getLogs", [{ ...filter, fromBlock: "0x" + f.toString(16), toBlock: "0x" + e.toString(16) }]))); f = e + 1; }
    catch (err) { const msg = err.message || "", m = /only (\d+) are allowed/.exec(msg); if ((!m && !/timed? ?out|timeout|too many results|response size/i.test(msg)) || step <= 1000) throw err; step = Math.max(1000, m ? Math.min(step >> 1, +m[1]) : step >> 2); }
  }
  return out;
}
export const head = async () => parseInt(await rpc("eth_blockNumber", []), 16);
export async function block(n) { return rpc("eth_getBlockByNumber", [typeof n === "number" ? "0x" + n.toString(16) : n, false]); }
// the block about `secs` seconds ago, from the chain's own recent pace
export async function blockSecondsAgo(secs) {
  const h = await block("latest"), n = parseInt(h.number, 16), probe = await block(n - 1_000_000);
  const rate = (parseInt(h.timestamp, 16) - parseInt(probe.timestamp, 16)) / 1_000_000; // seconds per block
  return { from: Math.max(0, n - Math.round(secs / rate)), to: n, secondsPerBlock: rate, at: new Date(parseInt(h.timestamp, 16) * 1000) };
}

// a live price from a real KyberSwap quote on Robinhood Chain: what 1,000 USDG buys
const KYBER = "https://aggregator-api.kyberswap.com/robinhood/api/v1";
export async function quoteUsdgTo(tokenAddr, dec, usdg = 1000) {
  const r = await fetch(`${KYBER}/routes?tokenIn=${USDG}&tokenOut=${tokenAddr}&amountIn=${BigInt(usdg) * 1_000_000n}`, { headers: { "x-client-id": "ruby", "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  let j; try { j = await r.json(); } catch { return null; }
  if (j.code !== 0 || !j.data?.routeSummary) return null;
  const out = num(j.data.routeSummary.amountOut, dec); return out > 0 ? usdg / out : null; // USDG per token
}
export async function prices(list = Object.keys(MARKETS)) {
  const res = {};
  for (const s of list) { try { res[s] = await quoteUsdgTo(MARKETS[s][0], MARKETS[s][1]); } catch { res[s] = null; } await sleep(120); }
  return res;
}

// Sourcify: is the source verified for this address on Robinhood Chain?
export async function sourcify(addr) {
  try { const r = await fetch(`https://sourcify.dev/server/v2/contract/${CHAIN_ID}/${addr}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) }); const j = await r.json(); return j.match || null; } catch { return "unknown"; }
}
