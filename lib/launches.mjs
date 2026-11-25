// Launches on Robinhood Chain's Pons launchpad, read from its own events. Facts only: no scores.
//   factory LaunchCreated(token, curve, creator) data: creator, ethIn (dev buy), tokensOut
//   curve Buy(sender, recipient) data: ethIn, tokensOut, … · Sell(sender, recipient) data: tokensIn, ethOut, …
import { rpc, logs, head, block, tokenInfo, balanceOf, topicAddr, fmt, num, short, EXPLORER } from "./chain.mjs";
import { frontmatter, table, write } from "./note.mjs";

export const FACTORY = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";
export const T_LAUNCH = "0xdcacba5e347ae7abd91cb519eb877af8fa7774e347b85dd3ddcd24a2ba8cdf37";
export const T_BUY = "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455";
export const T_SELL = "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df";
const w = (data, i) => BigInt("0x" + data.slice(2 + i * 64, 66 + i * 64));

export function decodeLaunch(l) { return { token: topicAddr(l.topics[1]), curve: topicAddr(l.topics[2]), creator: topicAddr(l.topics[3]), devEth: w(l.data, 1), devTokens: w(l.data, 2), block: parseInt(l.blockNumber, 16), tx: l.transactionHash }; }
export function decodeTrade(l) { const buy = l.topics[0] === T_BUY; return { curve: l.address.toLowerCase(), side: buy ? "buy" : "sell", trader: topicAddr(l.topics[2]), eth: buy ? w(l.data, 0) : w(l.data, 1), tokens: buy ? w(l.data, 1) : w(l.data, 0), block: parseInt(l.blockNumber, 16), tx: l.transactionHash }; }

// the latest `count` launches, looking back up to `lookback` blocks
export async function recentLaunches(count = 20, lookback = 2_000_000) {
  const now = await head(), out = [];
  for (let to = now; to > now - lookback && out.length < count; to -= 200_000) {
    const from = Math.max(0, to - 199_999);
    const l = await logs({ address: FACTORY, topics: [T_LAUNCH] }, from, to);
    out.push(...l.map(decodeLaunch).reverse());
  }
  return { now, launches: out.slice(0, count) };
}

// trades on a set of curves since a block (address can be a list in eth_getLogs)
export async function tradesOn(curves, from, to) {
  const out = [];
  for (let i = 0; i < curves.length; i += 25) {
    const l = await logs({ address: curves.slice(i, i + 25), topics: [[T_BUY, T_SELL]] }, from, to);
    out.push(...l.map(decodeTrade));
  }
  return out;
}

// one launch, fully described from the chain
export async function describe(L, now) {
  const [info, trades, curveEth, devBal, b] = await Promise.all([tokenInfo(L.token), tradesOn([L.curve], L.block, now), rpc("eth_getBalance", [L.curve, "latest"]).then(BigInt), balanceOf(L.token, L.creator), block(L.block)]);
  const buys = trades.filter((t) => t.side === "buy"), sells = trades.filter((t) => t.side === "sell");
  const devSold = sells.filter((t) => t.trader === L.creator).reduce((s, t) => s + t.tokens, 0n);
  return { ...L, symbol: info.symbol || short(L.token), name: info.name, decimals: info.decimals ?? 18, supply: info.totalSupply || 0n, at: new Date(parseInt(b.timestamp, 16) * 1000),
    buys: buys.length, sells: sells.length, traders: new Set(trades.map((t) => t.trader)).size, volEth: trades.reduce((s, t) => s + t.eth, 0n), curveEth, devBal, devSold };
}

export async function radarNote(vault, { count = 15, log = () => {} } = {}) {
  log("reading the latest launches…");
  const { now, launches } = await recentLaunches(count);
  const rows = [];
  for (const L of launches) { log("· " + short(L.token)); rows.push(await describe(L, now)); }
  const pct = (v, s) => (s ? ((num(v, 18) / num(s, 18)) * 100).toFixed(2) + "%" : "–"), day = new Date().toISOString().slice(0, 16).replace("T", " ");
  const fm = frontmatter({ type: "radar", taken: new Date().toISOString(), block: now, launches: rows.length, chain: "Robinhood Chain mainnet (4663)", source: "Pons launchpad events", tags: ["radar", "launches"] });
  const body = `${fm}
# Launch radar · ${day} UTC

The latest ${rows.length} launches on the Pons launchpad, read from its events on Robinhood Chain mainnet at block ${now.toLocaleString("en-US")}. Facts only.

${table(["launched (UTC)", "token", "creator", "dev buy", "dev holds", "dev sold", "buys / sells", "traders", "ETH in curve"], rows.map((r) => [
    r.at.toISOString().slice(5, 16).replace("T", " "), `[${r.symbol}](${EXPLORER}/token/${r.token})`, `[${short(r.creator)}](${EXPLORER}/address/${r.creator})`,
    `${fmt(r.devEth, 18, 4)} ETH · ${pct(r.devTokens, r.supply)}`, pct(r.devBal, r.supply), r.devSold > 0n ? pct(r.devSold, r.supply) : "0", `${r.buys} / ${r.sells}`, String(r.traders), fmt(r.curveEth, 18, 3)]))}
Clip any of them for the full fact note: \`ruby clip 0x…\`.

## Notes
- 
`;
  return write(vault, `Radar/${day.replace(":", "")}.md`, body);
}
