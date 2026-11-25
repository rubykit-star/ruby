// ruby watch: follow wallets and tokens on Robinhood Chain and log what happens to them, as it happens.
// Wallets: launches they create, launchpad buys and sells, token transfers in or out.
// Tokens: the creator selling on the curve, big buys and sells, big transfers, burns.
// Read only. Events are printed and appended to Watch/<date>.md.
import fs from "node:fs";
import path from "node:path";
import { rpc, logs, head, block, tokenInfo, isContract, fmt, amount, short, pad, topicAddr, T_TRANSFER, DEAD, ZERO, EXPLORER } from "./chain.mjs";
import { FACTORY, T_LAUNCH, T_BUY, T_SELL } from "./launches.mjs";

const w = (data, i) => BigInt("0x" + data.slice(2 + i * 64, 66 + i * 64));
const ago = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

export async function makeWatch(items, { minPct = 1, minEth = 0.1, log = () => {} } = {}) {
  const wallets = [], tokens = new Map(); // token -> { sym, dec, supply, launch }
  for (const raw of items) {
    const a = raw.toLowerCase();
    if (!(await isContract(a))) { wallets.push(a); continue; }
    const i = await tokenInfo(a).catch(() => null);
    if (!i || i.decimals == null) { log(`skipping ${short(a)}: a contract that is not a token`); continue; }
    const now = await head(); let launch = null;
    for (let to = now; to > 0 && !launch; to -= 9_000_000) { const l = await rpc("eth_getLogs", [{ address: FACTORY, topics: [T_LAUNCH, pad(a)], fromBlock: "0x" + Math.max(0, to - 8_999_999).toString(16), toBlock: "0x" + to.toString(16) }]).catch(() => []); if (l.length) launch = { curve: topicAddr(l[0].topics[2]), creator: topicAddr(l[0].topics[3]), block: parseInt(l[0].blockNumber, 16) }; }
    tokens.set(a, { sym: i.symbol || short(a), dec: i.decimals, supply: i.totalSupply || 0n, launch });
  }
  const curveOf = new Map([...tokens].filter(([, t]) => t.launch).map(([k, t]) => [t.launch.curve, k]));
  const W = wallets.map(pad), sym = new Map([...tokens].map(([k, t]) => [k, t.sym]));
  const symOf = async (tok) => { if (!sym.has(tok)) { const i = await tokenInfo(tok).catch(() => null); sym.set(tok, i?.symbol || short(tok)); } return sym.get(tok); };

  // every event between two blocks, oldest first
  async function scan(from, to) {
    const ev = [], seenTx = new Set(), push = (e) => ev.push(e);
    if (W.length) {
      for (const l of await logs({ address: FACTORY, topics: [T_LAUNCH, null, null, W] }, from, to)) { const tok = topicAddr(l.topics[1]); push({ b: parseInt(l.blockNumber, 16), tx: l.transactionHash, kind: "launch", level: "hot", who: topicAddr(l.topics[3]), text: `launched ${await symOf(tok)} (${short(tok)}), dev buy ${fmt(w(l.data, 1), 18, 4)} ETH` }); }
      for (const l of await logs({ topics: [[T_BUY, T_SELL], null, W] }, from, to)) { const buy = l.topics[0] === T_BUY, eth = buy ? w(l.data, 0) : w(l.data, 1), tok = curveOf.get(l.address.toLowerCase()); seenTx.add(l.transactionHash);
        push({ b: parseInt(l.blockNumber, 16), tx: l.transactionHash, kind: buy ? "buy" : "sell", level: buy ? "info" : "warn", who: topicAddr(l.topics[2]), text: `${buy ? "bought" : "sold"} on the launchpad for ${fmt(eth, 18, 4)} ETH${tok ? " · " + tokens.get(tok).sym : " · curve " + short(l.address)}` }); }
      for (const [dir, topics] of [["out", [T_TRANSFER, W]], ["in", [T_TRANSFER, null, W]]]) for (const l of await logs({ topics }, from, to)) {
        if (seenTx.has(l.transactionHash) || l.topics.length < 3 || l.data === "0x") continue; const tok = l.address.toLowerCase(), i = tokens.get(tok), dec = i?.dec ?? (await tokenInfo(tok).catch(() => ({ decimals: 18 }))).decimals ?? 18;
        const cp = topicAddr(l.topics[dir === "out" ? 2 : 1]), burn = dir === "out" && (cp === DEAD || cp === ZERO);
        push({ b: parseInt(l.blockNumber, 16), tx: l.transactionHash, kind: burn ? "burn" : dir, level: "info", who: topicAddr(l.topics[dir === "out" ? 1 : 2]), text: burn ? `burned ${amount(BigInt(l.data), dec)} ${await symOf(tok)}` : `${dir === "out" ? "sent" : "received"} ${amount(BigInt(l.data), dec)} ${await symOf(tok)} ${dir === "out" ? "to" : "from"} ${short(cp)}` }); }
    }
    for (const [tok, t] of tokens) {
      if (t.launch) for (const l of await logs({ address: t.launch.curve, topics: [[T_BUY, T_SELL]] }, from, to)) { const buy = l.topics[0] === T_BUY, eth = buy ? w(l.data, 0) : w(l.data, 1), trader = topicAddr(l.topics[2]), dev = trader === t.launch.creator;
        if (dev && !buy) push({ b: parseInt(l.blockNumber, 16), tx: l.transactionHash, kind: "dev-sell", level: "hot", who: trader, text: `${t.sym}: the creator sold ${fmt(w(l.data, 0), t.dec, 0)} tokens for ${fmt(eth, 18, 4)} ETH` });
        else if (Number(eth) / 1e18 >= minEth) push({ b: parseInt(l.blockNumber, 16), tx: l.transactionHash, kind: buy ? "big-buy" : "big-sell", level: buy ? "info" : "warn", who: trader, text: `${t.sym}: ${dev ? "the creator " : ""}${buy ? "bought" : "sold"} for ${fmt(eth, 18, 4)} ETH by ${short(trader)}` }); }
      const min = t.supply ? (t.supply * BigInt(Math.round(minPct * 100))) / 10000n : 0n;
      for (const l of await logs({ address: tok, topics: [T_TRANSFER] }, from, to)) { const v = BigInt(l.data), f = topicAddr(l.topics[1]), d = topicAddr(l.topics[2]); if (t.launch && (f === t.launch.curve || d === t.launch.curve)) continue;
        if (d === DEAD || (d === ZERO && f !== ZERO)) push({ b: parseInt(l.blockNumber, 16), tx: l.transactionHash, kind: "burn", level: "info", who: f, text: `${t.sym}: ${amount(v, t.dec)} burned by ${short(f)}` });
        else if (min && v >= min && f !== ZERO) push({ b: parseInt(l.blockNumber, 16), tx: l.transactionHash, kind: "big-transfer", level: f === t.launch?.creator ? "hot" : "warn", who: f, text: `${t.sym}: ${amount(v, t.dec)} (${((Number(v) / Number(t.supply)) * 100).toFixed(2)}% of supply) moved ${short(f)} → ${short(d)}${f === t.launch?.creator ? " · from the creator" : ""}` }); }
    }
    // one line per burn: a watched wallet's burn already says it
    const walletBurns = new Set(ev.filter((e) => e.kind === "burn" && !e.text.includes(":")).map((e) => e.tx));
    return ev.filter((e) => !(e.kind === "burn" && e.text.includes(":") && walletBurns.has(e.tx))).sort((a, b) => a.b - b.b);
  }
  return { wallets, tokens, scan };
}

export function line(e, at) { const icon = { hot: "!!", warn: "! ", info: "· " }[e.level]; return `${icon} ${at ? at.toISOString().slice(11, 19) + " " : ""}${short(e.who)} ${e.text}  ${EXPLORER}/tx/${e.tx}`; }

export async function runWatch(items, vault, { once = false, minutes = 30, minPct, minEth, log = () => {} } = {}) {
  if (!items.length) throw new Error("nothing to watch: ruby watch 0x… (wallets or tokens), or a \"watchlist\" in ruby.json");
  const W = await makeWatch(items, { minPct, minEth, log });
  log(`watching ${W.wallets.length} wallet${W.wallets.length === 1 ? "" : "s"} and ${W.tokens.size} token${W.tokens.size === 1 ? "" : "s"}${[...W.tokens.values()].filter((t) => t.launch).length ? ", launchpad curves found for " + [...W.tokens.values()].filter((t) => t.launch).map((t) => t.sym).join(", ") : ""}`);
  const rate = 0.106; let last = await head(); const start = Math.max(0, last - Math.round((minutes * 60) / rate));
  const day = new Date().toISOString().slice(0, 10), file = path.join(vault, "Watch", `${day}.md`);
  const write = (lines) => { if (!lines.length) return; fs.mkdirSync(path.dirname(file), { recursive: true }); if (!fs.existsSync(file)) fs.writeFileSync(file, `---\ntype: "watch"\ndate: "${day}"\nwatching: ${JSON.stringify(items.map((x) => x.toLowerCase()))}\ntags: ["watch"]\n---\n\n# Watch · ${day}\n\n`); fs.appendFileSync(file, lines.map((l) => "- " + l).join("\n") + "\n"); };
  const emit = async (ev) => { const out = []; for (const e of ev) { const b = await block(e.b).catch(() => null), at = b ? new Date(parseInt(b.timestamp, 16) * 1000) : null; const l = line(e, at); console.log(l); out.push(l); } write(out); return out.length; };
  const n = await emit(await W.scan(start, last)); log(`${n} event${n === 1 ? "" : "s"} in the last ${minutes} min${once ? "" : "; now watching new blocks (Ctrl+C to stop)"}`);
  if (once) return { file: fs.existsSync(file) ? file : null, events: n };
  for (;;) { await new Promise((r) => setTimeout(r, 4000)); try { const h = await head(); if (h > last) { await emit(await W.scan(last + 1, h)); last = h; } } catch (e) { log("· " + e.message + ", retrying"); } }
}
