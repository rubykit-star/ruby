// ruby footprint <wallet>: what anyone can learn about a wallet from public chain data, so you can see your own exposure.
// Facts only: counterparties, active hours, holdings, open approvals. No guesses about who owns what.
import { MARKETS, USDG, EXPLORER, T_TRANSFER, rpc, logs, head, block, blockSecondsAgo, ethBalance, balanceOf, isContract, tokenInfo, fmt, amount, short, pad, topicAddr } from "./chain.mjs";
import { frontmatter, table, write } from "./note.mjs";

const T_APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const MAXU = (1n << 255n);

export async function footprint(wallet, vault, { watch = [], days = 30, log = () => {} } = {}) {
  wallet = wallet.toLowerCase(); const me = pad(wallet), win = await blockSecondsAgo(days * 86400), now = win.to, from = win.from;
  const tokens = new Map([[USDG, { sym: "USDG", dec: 6 }], ...Object.entries(MARKETS).filter(([s]) => s !== "ETH").map(([s, [a, d]]) => [a.toLowerCase(), { sym: s, dec: d }])]);
  for (const w of watch) { const a = w.toLowerCase(); if (!tokens.has(a)) { const i = await tokenInfo(a).catch(() => null); if (i?.decimals != null) tokens.set(a, { sym: i.symbol || short(a), dec: i.decimals }); } }
  // only the tokens this wallet holds now, plus USDG and "watch": a public RPC cannot scan every token's history quickly
  log("finding the tokens it holds…"); const bal0 = new Map(); for (const [a] of tokens) { const b = await balanceOf(a, wallet).catch(() => 0n); bal0.set(a, b); }
  const addrs = [...tokens.keys()].filter((a) => a === USDG || bal0.get(a) > 0n || watch.map((w) => w.toLowerCase()).includes(a));
  log(`reading ${days} days of transfers and approvals for ${addrs.length} token${addrs.length === 1 ? "" : "s"}…`);
  const outs = [], ins = [], apps = [];
  for (const a of addrs) { log("· " + tokens.get(a).sym); outs.push(...(await logs({ address: a, topics: [T_TRANSFER, me] }, from, now, 2_000_000))); ins.push(...(await logs({ address: a, topics: [T_TRANSFER, null, me] }, from, now, 2_000_000))); apps.push(...(await logs({ address: a, topics: [T_APPROVAL, me] }, from, now, 2_000_000))); }
  const nonce = parseInt(await rpc("eth_getTransactionCount", [wallet, "latest"]), 16), eth = await ethBalance(wallet);
  const all = [...outs.map((l) => ({ l, dir: "out", cp: topicAddr(l.topics[2]) })), ...ins.map((l) => ({ l, dir: "in", cp: topicAddr(l.topics[1]) }))].sort((a, b) => parseInt(a.l.blockNumber, 16) - parseInt(b.l.blockNumber, 16));

  // counterparties: who this wallet moves tokens with, most often first
  const cps = new Map(); for (const t of all) { const c = cps.get(t.cp) || { in: 0, out: 0 }; c[t.dir]++; cps.set(t.cp, c); }
  const top = [...cps.entries()].sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out)).slice(0, 10);
  log("labelling counterparties…"); const cpRows = []; for (const [a, c] of top) cpRows.push([`[${short(a)}](${EXPLORER}/address/${a})`, (await isContract(a)) ? "contract" : "wallet", String(c.in), String(c.out)]);

  // first seen and active hours, from block times (sampled for busy wallets)
  log("reading block times…"); const blocks = [...new Set(all.map((t) => parseInt(t.l.blockNumber, 16)))], sample = blocks.length > 150 ? blocks.filter((_, i) => i % Math.ceil(blocks.length / 150) === 0) : blocks;
  const times = []; for (const b of sample) { try { times.push(new Date(parseInt((await block(b)).timestamp, 16) * 1000)); } catch {} }
  const hours = Array(24).fill(0); times.forEach((d) => hours[d.getUTCHours()]++); const maxH = Math.max(...hours, 1);
  const first = all[0], firstTime = times.length ? new Date(Math.min(...times)) : null;

  // open approvals: the latest Approval per token and spender, checked against today's allowance
  log("checking open approvals…"); const last = new Map(); for (const l of apps) last.set(l.address.toLowerCase() + "|" + topicAddr(l.topics[2]), l);
  const open = []; for (const [k] of last) { const [tok, sp] = k.split("|"); try { const r = await rpc("eth_call", [{ to: tok, data: "0xdd62ed3e" + pad(wallet).slice(2) + pad(sp).slice(2) }, "latest"]); const v = BigInt(r); if (v > 0n) open.push({ tok, sp, v }); } catch {} }

  // holdings that anyone can see
  const held = []; for (const [a, t] of tokens) { const b = bal0.get(a) || 0n; if (b > 0n) held.push([t.sym, amount(b, t.dec)]); }

  const file = `Privacy/Footprint ${short(wallet).replace("…", "-")}.md`;
  const fm = frontmatter({ type: "footprint", wallet, taken: new Date().toISOString(), block: now, days, transactions_sent: nonce, token_transfers: all.length, counterparties: cps.size, open_approvals: open.length, chain: "Robinhood Chain mainnet (4663)", tags: ["privacy", "footprint"] });
  const bar = (n) => "█".repeat(Math.round((n / maxH) * 20)) || (n ? "▏" : "");
  const body = `${fm}
# Footprint · ${short(wallet)}

What anyone can read about [${wallet}](${EXPLORER}/address/${wallet}) from Robinhood Chain mainnet at block ${now.toLocaleString("en-US")}, looking back ${days} days. Everything here is public already; this note only gathers it so you can see it.

## At a glance
${table(["", ""], [
    ["transactions sent", nonce.toLocaleString("en-US")],
    ["ETH balance", amount(eth, 18) + " ETH"],
    ["token transfers seen", `${all.length.toLocaleString("en-US")} (${ins.length} in, ${outs.length} out)`],
    ["different counterparties", cps.size.toLocaleString("en-US")],
    ["first token transfer in this window", first ? `block ${parseInt(first.l.blockNumber, 16).toLocaleString("en-US")}${firstTime ? " · " + firstTime.toISOString().slice(0, 10) : ""} · [tx](${EXPLORER}/tx/${first.l.transactionHash})` : "none"],
    ["open approvals", String(open.length)],
  ])}
## Who it moves tokens with
${cpRows.length ? table(["counterparty", "kind", "in", "out"], cpRows) + "\nA wallet you send to or receive from often is publicly linked to you.\n" : "No token transfers.\n"}
## When it is active (UTC)
${times.length ? "```\n" + hours.map((n, h) => `${String(h).padStart(2, "0")}:00 ${bar(n)} ${n || ""}`).join("\n") + "\n```\n" + (blocks.length > sample.length ? `Sampled from ${sample.length} of ${blocks.length} blocks.\n` : "") + "Regular hours can hint at a time zone.\n" : "No activity to chart.\n"}
## What anyone can see it holds
${held.length ? table(["token", "balance"], held) : "No tracked tokens held.\n"}Native ETH: ${amount(eth, 18)}.

## Open approvals
${open.length ? table(["token", "spender", "allowance"], open.map((o) => [tokens.get(o.tok)?.sym || short(o.tok), `[${short(o.sp)}](${EXPLORER}/address/${o.sp})`, o.v >= MAXU ? "**unlimited**" : amount(o.v, tokens.get(o.tok)?.dec ?? 18)])) + "\nAn approval lets that spender move this token from the wallet until it is set back to 0. Revoke the ones you no longer use.\n" : "None on the tokens checked.\n"}
## Ways to show less
- Keep a separate wallet for each purpose: one that holds, one that trades, one that signs up for things.
- Fund a new wallet from a source that is not linked to your main one, and do not send between them directly.
- Revoke approvals you no longer need.
- This note covers the last ${days} days, for USDG, tokens the wallet holds now and tokens in \`ruby.json\` "watch" (run with --days 90 to look further back). Native ETH transfers leave no token log and are not counted here.

## Notes
- 
`;
  return write(vault, file, body);
}
