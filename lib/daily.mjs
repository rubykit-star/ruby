// ruby daily <wallet>: today's note for a wallet, balances, value in USDG, the last 24 hours of token transfers
import fs from "node:fs";
import path from "node:path";
import { MARKETS, USDG, EXPLORER, T_TRANSFER, ethBalance, balanceOf, prices, blockSecondsAgo, logs, tokenInfo, fmt, amount, num, short, pad, topicAddr } from "./chain.mjs";
import { frontmatter, readFrontmatter, table, write } from "./note.mjs";

export async function daily(wallet, vault, { label, watch = [], log = () => {} } = {}) {
  wallet = wallet.toLowerCase();
  const name = label || short(wallet), day = new Date().toISOString().slice(0, 10);
  log("reading balances…");
  // tokens: USDG, the market tokens, and any extra tokens listed in ruby.json "watch"
  const tokens = [{ sym: "USDG", addr: USDG, dec: 6 }, ...Object.entries(MARKETS).filter(([s]) => s !== "ETH").map(([s, [a, d]]) => ({ sym: s, addr: a.toLowerCase(), dec: d }))];
  for (const w of watch) { const a = w.toLowerCase(); if (tokens.some((t) => t.addr === a)) continue; const i = await tokenInfo(a).catch(() => null); if (i?.decimals != null) tokens.push({ sym: i.symbol || short(a), addr: a, dec: i.decimals, watched: true }); }
  const eth = await ethBalance(wallet);
  const bals = []; for (const t of tokens) bals.push(await balanceOf(t.addr, wallet).catch(() => 0n));
  log("reading live prices…");
  const held = tokens.map((t, i) => ({ ...t, bal: bals[i] })).filter((t) => t.bal > 0n);
  const px = await prices(["ETH", ...held.filter((t) => MARKETS[t.sym]).map((t) => t.sym)]);
  const val = (t) => (t.sym === "USDG" ? num(t.bal, 6) : px[t.sym] != null ? num(t.bal, t.dec) * px[t.sym] : null);
  const ethVal = px.ETH != null ? num(eth, 18) * px.ETH : null;
  const rows = [["ETH", amount(eth, 18), px.ETH != null ? px.ETH.toFixed(2) : "–", ethVal != null ? ethVal.toFixed(2) : "–"]];
  let total = ethVal || 0, unpriced = [];
  for (const t of held) { const v = val(t); if (v != null) total += v; else unpriced.push(t.sym); rows.push([t.sym, amount(t.bal, t.dec), t.sym === "USDG" ? "1.00" : px[t.sym] != null ? px[t.sym].toPrecision(6) : "–", v != null ? v.toFixed(2) : "–"]); }

  log("reading the last 24 hours of transfers…");
  const win = await blockSecondsAgo(86400), me = pad(wallet), moves = [];
  for (const t of tokens) {
    const [outs, ins] = await Promise.all([logs({ address: t.addr, topics: [T_TRANSFER, me] }, win.from, win.to), logs({ address: t.addr, topics: [T_TRANSFER, null, me] }, win.from, win.to)]);
    for (const l of outs) moves.push({ t, dir: "out", who: topicAddr(l.topics[2]), v: BigInt(l.data), b: parseInt(l.blockNumber, 16), tx: l.transactionHash });
    for (const l of ins) moves.push({ t, dir: "in", who: topicAddr(l.topics[1]), v: BigInt(l.data), b: parseInt(l.blockNumber, 16), tx: l.transactionHash });
  }
  moves.sort((a, b) => a.b - b.b);

  // compare with the newest earlier note for this wallet
  let prev = null; const dir = path.join(vault, "Daily");
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f < `${day}`).sort().reverse()) { const fm = readFrontmatter(path.join(dir, f)); if (fm.wallet === wallet) { prev = { f, ...fm }; break; } }
  const change = prev && typeof prev.total_usdg === "number" ? total - prev.total_usdg : null;

  const file = `Daily/${day} ${name}.md`;
  const fm = frontmatter({ type: "daily", date: day, wallet, label: name, total_usdg: +total.toFixed(2), change_usdg: change != null ? +change.toFixed(2) : null, transfers_24h: moves.length, block: win.to, chain: "Robinhood Chain mainnet (4663)", tags: ["daily", "wallet"] });
  const body = `${fm}
# ${day} · ${name}

Wallet [${wallet}](${EXPLORER}/address/${wallet}), read from Robinhood Chain mainnet at block ${win.to.toLocaleString("en-US")} (${win.at.toISOString().replace("T", " ").slice(0, 16)} UTC).

## Value
**${total.toFixed(2)} USDG** in priced holdings${change != null ? `, ${change >= 0 ? "+" : ""}${change.toFixed(2)} since [[${prev.f.replace(/\.md$/, "")}]]` : ""}.${unpriced.length ? ` Not priced: ${unpriced.join(", ")}.` : ""}

## Holdings
${table(["token", "balance", "price (USDG)", "value (USDG)"], rows)}
Prices are live KyberSwap quotes of 1,000 USDG on Robinhood Chain.

## Last 24 hours
${moves.length ? table(["block", "token", "", "amount", "counterparty", "tx"], moves.map((m) => [m.b.toLocaleString("en-US"), m.t.sym, m.dir === "in" ? "in" : "out", amount(m.v, m.t.dec), `[${short(m.who)}](${EXPLORER}/address/${m.who})`, `[${short(m.tx)}](${EXPLORER}/tx/${m.tx})`])) : "No token transfers in or out.\n"}
Native ETH transfers are not listed here (they leave no token log).

## Notes
- 
`;
  return write(vault, file, body);
}
