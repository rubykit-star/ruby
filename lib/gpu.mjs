// ruby gpu <payee | x402 url> [wallet]: Ruby GPU Spend. What is spent on a GPU network (or any per-call API) on Robinhood Chain.
// Give it the provider's x402 endpoint (Ruby reads the 402 offer to learn the payee and the price) or the payee address.
// Ruby then reads, from the chain, every USDG payment that payee received over the last 7 days: jobs paid per day, USDG,
// payers, price per job, and which payments settled the x402 way (an EIP-3009 authorization in the same transaction).
// With a wallet, it shows what that wallet (say, your AI) spent with this provider, and flags bursts.
// Read only. Payments made with prepaid credits or other tokens are not visible as jobs.
import { RPC, rpc, EXPLORER, USDG, T_TRANSFER, isAddr, short } from "./chain.mjs";
import { frontmatter, write, table, safeName } from "./note.mjs";
import { T_AUTH_USED } from "./x402.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), hx = (n) => "0x" + n.toString(16), pad = (a) => "0x" + a.toLowerCase().slice(2).padStart(64, "0"), ad = (t) => ("0x" + t.slice(26)).toLowerCase();
const usd = (n) => (n == null ? "–" : n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : 6 }));
const DAY = 86400;

async function batch(calls, size = 25) {
  const out = [];
  for (let i = 0; i < calls.length; i += size) {
    const part = calls.slice(i, i + size); if (i) await sleep(250);
    for (let k = 0; k < 7; k++) {
      try { const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(part.map(([m, p], j) => ({ jsonrpc: "2.0", id: j, method: m, params: p }))), signal: AbortSignal.timeout(30000) });
        if (r.status === 429 || r.status >= 500) throw new Error("busy"); const j = await r.json(); if (!Array.isArray(j)) throw new Error("busy"); j.sort((a, b) => a.id - b.id); out.push(...j.map((x) => x.result ?? null)); break; }
      catch (e) { if (k === 6) throw e; await sleep(1200 * (k + 1)); }
    }
  }
  return out;
}
// a block range, split in two whenever the node times out or caps the range
async function range(filter, a, e) {
  try { return await rpc("eth_getLogs", [{ ...filter, fromBlock: hx(a), toBlock: hx(e) }]); }
  catch (err) { const msg = err.message || ""; if (e - a > 5000 && /only \d+ are allowed|timed? ?out|timeout|too many results|response size/i.test(msg)) { const m = (a + e) >> 1; const [x, y] = await Promise.all([range(filter, a, m), range(filter, m + 1, e)]); return x.concat(y); } throw err; }
}
async function logsSince(filter, from, to) { const W = []; for (let a = from; a <= to; a += 1_000_000) W.push([a, Math.min(to, a + 999_999)]); const out = [];
  for (let i = 0; i < W.length; i += 4) (await Promise.all(W.slice(i, i + 4).map(([a, e]) => range(filter, a, e)))).forEach((r) => out.push(...r)); return out; }

// the provider's 402 offer: who gets paid, how much, in what
export async function readOffer(url) {
  let r; try { r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) }); } catch (e) { throw new Error(`could not reach ${url}: ${e.message}`); }
  if (r.status !== 402) throw new Error(`${url} answered ${r.status}, not 402: no x402 offer to read. Use the payee address instead.`);
  let o = null; try { const j = await r.clone().json(); o = j.accepts && j.accepts[0]; } catch {}
  if (!o) { const h = r.headers.get("payment-required") || r.headers.get("x-payment-required"); if (h) try { o = JSON.parse(Buffer.from(h, "base64").toString("utf8")).accepts[0]; } catch {} }
  if (!o) throw new Error("402 without an x402 offer");
  const asset = String(o.asset || "").toLowerCase(), amount = o.amount ?? o.maxAmountRequired;
  return { url, payTo: String(o.payTo || "").toLowerCase(), network: o.network, asset, scheme: o.scheme, price: asset === USDG && amount != null ? Number(BigInt(amount)) / 1e6 : null, usdg: asset === USDG, robinhood: o.network === "eip155:4663" };
}

export async function readGpu(target, { wallet = null, days = 7, log = () => {} } = {}) {
  let offer = null, payTo = String(target || "").trim().toLowerCase();
  if (/^https?:\/\//i.test(target)) { log("reading the 402 offer…"); offer = await readOffer(target); payTo = offer.payTo; if (!offer.usdg || !offer.robinhood) throw new Error(`the offer asks for ${offer.asset} on ${offer.network}, not USDG on Robinhood Chain (eip155:4663): Ruby can only read USDG payments here`); }
  if (!isAddr(payTo)) throw new Error("give a payee address 0x… (40 hex) or an x402 endpoint URL");
  if (wallet && !isAddr(wallet)) throw new Error("wallet must be 0x… (40 hex)"); wallet = wallet ? wallet.toLowerCase() : null;
  const headB = await rpc("eth_getBlockByNumber", ["latest", false]), head = parseInt(headB.number, 16), now = parseInt(headB.timestamp, 16);
  const probe = await rpc("eth_getBlockByNumber", [hx(head - 1_000_000), false]), rate = (now - parseInt(probe.timestamp, 16)) / 1_000_000;
  const from = Math.max(0, head - Math.ceil((days * DAY + 3600) / rate));
  log(`reading USDG paid to ${short(payTo)} over ${days} days…`);
  const L = await logsSince({ address: USDG, topics: [T_TRANSFER, null, pad(payTo)] }, from, head);
  const txs = [...new Set(L.map((l) => l.transactionHash))], blocks = [...new Set(L.map((l) => l.blockNumber))];
  log(`checking ${txs.length} transactions…`);
  const capTx = txs.slice(-800), rc = await batch(capTx.map((h) => ["eth_getTransactionReceipt", [h]])), X402 = new Set(capTx.filter((h, i) => rc[i] && rc[i].logs.some((x) => x.address.toLowerCase() === USDG && x.topics[0] === T_AUTH_USED)));
  const capB = blocks.slice(-900), bt = await batch(capB.map((b) => ["eth_getBlockByNumber", [b, false]])), TS = new Map(capB.map((b, i) => [b, bt[i] ? parseInt(bt[i].timestamp, 16) : null]));
  const tsOf = (b) => TS.get(b) ?? Math.round(now - (head - parseInt(b, 16)) * rate), estimated = blocks.length > capB.length;
  let pays = L.map((l) => ({ t: tsOf(l.blockNumber), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, from: ad(l.topics[1]), usdg: Number(BigInt(l.data)) / 1e6, x402: capTx.includes(l.transactionHash) ? X402.has(l.transactionHash) : null }))
    .filter((p) => now - p.t < days * DAY);
  const all = pays; pays = all.filter((p) => p.x402 === true); const other = all.filter((p) => p.x402 === false), unchecked = all.filter((p) => p.x402 === null);
  const today = Math.floor(now / DAY), dayList = [...Array(days)].map((_, i) => today - days + 1 + i);
  const perDay = dayList.map((d) => { const P = pays.filter((p) => Math.floor(p.t / DAY) === d); return { day: new Date(d * DAY * 1000).toISOString().slice(0, 10), jobs: P.length, usdg: P.reduce((s, p) => s + p.usdg, 0) }; });
  const jobs = pays, prices = jobs.map((p) => p.usdg).sort((a, b) => a - b), med = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const payerMap = new Map(); for (const p of pays) { const m = payerMap.get(p.from) || { addr: p.from, jobs: 0, usdg: 0, last: 0 }; m.jobs++; m.usdg += p.usdg; m.last = Math.max(m.last, p.t); payerMap.set(p.from, m); }
  const top = [...payerMap.values()].sort((a, b) => b.usdg - a.usdg).slice(0, 10);
  const meta = await batch(top.flatMap((p) => [["eth_getCode", [p.addr, "latest"]], ["eth_getTransactionCount", [p.addr, "latest"]]]));
  top.forEach((p, i) => { const code = meta[2 * i] || "0x", n = meta[2 * i + 1] ? parseInt(meta[2 * i + 1], 16) : 0; p.kind = n > 5000 ? "high-volume sender (bot, relayer or exchange)" : code.startsWith("0xef0100") ? "wallet (7702 smart wallet)" : code !== "0x" ? "contract" : "wallet"; });
  let mine = null;
  if (wallet) { const P = pays.filter((p) => p.from === wallet).sort((a, b) => a.t - b.t), byDay = perDay.map((d) => ({ day: d.day, jobs: P.filter((p) => new Date(p.t * 1000).toISOString().slice(0, 10) === d.day).length, usdg: P.filter((p) => new Date(p.t * 1000).toISOString().slice(0, 10) === d.day).reduce((s, p) => s + p.usdg, 0) }));
    const flags = []; for (let i = 4; i < P.length; i++) if (P[i].t - P[i - 4].t <= 60 && !estimated) { flags.push(`5 payments within one minute at ${new Date(P[i].t * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC: check your AI is not stuck in a loop`); break; }
    const prev = byDay.slice(0, -1), avg = prev.reduce((s, d) => s + d.usdg, 0) / Math.max(1, prev.length), t = byDay[byDay.length - 1].usdg;
    if (avg > 0 && t > avg * 3) flags.push(`today ${usd(t)} USDG, more than 3× the daily average of ${usd(avg)}`);
    mine = { wallet, jobs: P.length, usdg: P.reduce((s, p) => s + p.usdg, 0), today: t, byDay, flags, last: P.length ? P[P.length - 1] : null }; }
  return { payTo, offer, head, now, days, estimated, total: { jobs: pays.length, usdg: pays.reduce((s, p) => s + p.usdg, 0), payers: payerMap.size, otherTransfers: other.length, otherUsdg: other.reduce((s, p) => s + p.usdg, 0), unchecked: unchecked.length, median: med, avg: jobs.length ? jobs.reduce((s, p) => s + p.usdg, 0) / jobs.length : null }, perDay, top, mine, recent: pays.slice(-15).reverse() };
}

export async function gpuNote(vault, target, { wallet = null, log = () => {} } = {}) {
  const M = await readGpu(target, { wallet, log }), T = M.total, A = (a) => `[${short(a)}](${EXPLORER}/address/${a})`;
  const fm = frontmatter({ type: "gpu-spend", payee: M.payTo, endpoint: M.offer ? M.offer.url : null, listed_price_usdg: M.offer ? M.offer.price : null, days: M.days, jobs: T.jobs, other_transfers: T.otherTransfers, usdg: +T.usdg.toFixed(6), payers: T.payers, wallet: M.mine ? M.mine.wallet : null, wallet_usdg: M.mine ? +M.mine.usdg.toFixed(6) : null, block: M.head, chain: "Robinhood Chain mainnet (4663)", tags: ["gpu", "x402", "robinhood-chain"] });
  const body = `
# GPU spend · ${short(M.payTo)} · last ${M.days} days

Every paid call to ${A(M.payTo)} on Robinhood Chain mainnet, read at block ${M.head.toLocaleString("en-US")}.${M.offer ? ` The 402 offer at ${M.offer.url} asks ${usd(M.offer.price)} USDG per call (${M.offer.scheme}, ${M.offer.network}).` : ""} Payments made with prepaid credits or other tokens are not visible here.

## Last ${M.days} days
|  |  |
| --- | --- |
| paid calls (settled the x402 way) | ${T.jobs.toLocaleString("en-US")} |
| USDG paid for calls | ${usd(T.usdg)} |
| other USDG transfers in (not x402) | ${T.otherTransfers} · ${usd(T.otherUsdg)} USDG${T.unchecked ? ` · ${T.unchecked} older transfers not checked` : ""} |
| payers | ${T.payers.toLocaleString("en-US")} |
| price per call | median ${usd(T.median)} · average ${usd(T.avg)} USDG |

${table(["day (UTC)", "paid calls", "USDG"], M.perDay.map((d) => [d.day, d.jobs, usd(d.usdg)]))}${M.estimated ? "Some times are estimated from block numbers.\n" : ""}
## Biggest payers
${T.payers ? table(["payer", "what it is", "calls", "USDG", "last (UTC)"], M.top.map((p) => [A(p.addr), p.kind, p.jobs, usd(p.usdg), new Date(p.last * 1000).toISOString().slice(0, 16).replace("T", " ")])) : "No payments in this window.\n"}
${M.mine ? `## Your wallet · ${A(M.mine.wallet)}
|  |  |
| --- | --- |
| calls paid | ${M.mine.jobs} |
| USDG spent | ${usd(M.mine.usdg)} |
| today (UTC) | ${usd(M.mine.today)} |

${table(["day (UTC)", "calls", "USDG"], M.mine.byDay.map((d) => [d.day, d.jobs, usd(d.usdg)]))}
${M.mine.flags.length ? M.mine.flags.map((f) => "- ⚠ " + f).join("\n") : "- nothing unusual: no burst of payments, today not far above the average"}
` : ""}
## Notes
-
`;
  return write(vault, `Research/${safeName(`GPU spend ${short(M.payTo)} ${new Date().toISOString().slice(0, 10)}`)}.md`, fm + body);
}
