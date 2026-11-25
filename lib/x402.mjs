// ruby x402: every USDG transferWithAuthorization (EIP-3009) on Robinhood Chain, the way x402 payments settle.
// Pairs each AuthorizationUsed event with its USDG transfer. Not every EIP-3009 transfer is an x402 API call.
import { logs, head, isContract, short, EXPLORER, USDG, T_TRANSFER } from "./chain.mjs";
import { frontmatter, table, write } from "./note.mjs";
export const T_AUTH_USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const topicAddr = (t) => "0x" + t.slice(26);

export async function x402Pairs(from, to) {
  const au = await logs({ address: USDG, topics: [T_AUTH_USED] }, from, to); if (!au.length) return [];
  const auth = [...new Set(au.map((l) => l.topics[1]))], tr = [];
  for (let i = 0; i < auth.length; i += 100) tr.push(...(await logs({ address: USDG, topics: [T_TRANSFER, auth.slice(i, i + 100)] }, from, to, 100_000)));
  const byTx = new Map(tr.map((l) => [l.transactionHash + "|" + l.topics[1], l]));
  return au.map((a) => { const t = byTx.get(a.transactionHash + "|" + a.topics[1]); return t && { b: parseInt(a.blockNumber, 16), tx: a.transactionHash, from: topicAddr(t.topics[1]), to: topicAddr(t.topics[2]), v: Number(BigInt(t.data)) / 1e6 }; }).filter(Boolean).sort((x, y) => x.b - y.b);
}

export async function x402Note(vault, { hours = 24, log = () => {} } = {}) {
  const now = await head(), from = Math.max(0, now - Math.round((hours * 3600) / 0.106));
  log(`reading ${hours} h of USDG transfer-by-signature…`); const P = await x402Pairs(from, now);
  const vol = P.reduce((s, p) => s + p.v, 0), small = P.filter((p) => p.v < 1), top = new Map();
  for (const p of P) { const o = top.get(p.to) || { n: 0, v: 0 }; o.n++; o.v += p.v; top.set(p.to, o); }
  const topRows = []; for (const [a, o] of [...top].sort((x, y) => y[1].v - x[1].v).slice(0, 10)) topRows.push([`[${short(a)}](${EXPLORER}/address/${a})`, (await isContract(a)) ? "contract" : "wallet", String(o.n), o.v.toFixed(2)]);
  const f = (v) => (v < 1 ? v.toFixed(4) : v.toFixed(2)), day = new Date().toISOString().slice(0, 16).replace("T", " ");
  const body = `${frontmatter({ type: "x402", taken: new Date().toISOString(), block: now, hours, payments: P.length, usdg: +vol.toFixed(2), payers: new Set(P.map((p) => p.from)).size, payees: top.size, under_1_usdg: small.length, chain: "Robinhood Chain mainnet (4663)", tags: ["x402", "usdg"] })}
# x402 · ${day} UTC

USDG transfer-by-signature (EIP-3009) on Robinhood Chain mainnet over the last ${hours} hours, to block ${now.toLocaleString("en-US")}. x402 payments settle this way; wallets and apps also use it for gasless transfers, so not every line is an API call. Payments under 1 USDG look most like x402.

${table(["", ""], [["payments", String(P.length)], ["USDG moved", vol.toFixed(2)], ["payers", String(new Set(P.map((p) => p.from)).size)], ["payees", String(top.size)], ["under 1 USDG", String(small.length)]])}
## Who gets paid the most
${table(["payee", "kind", "payments", "USDG"], topRows)}
## Payments under 1 USDG (latest 30)
${small.length ? table(["block", "from", "to", "USDG", "tx"], small.slice(-30).reverse().map((p) => [p.b.toLocaleString("en-US"), short(p.from), short(p.to), f(p.v), `[${short(p.tx)}](${EXPLORER}/tx/${p.tx})`])) : "None in this window.\n"}
## Notes
- 
`;
  return write(vault, `X402/${day.replace(":", "")}.md`, body);
}
