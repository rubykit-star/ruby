// ruby replicate <token> "<claims>": re-run claims about a token against Robinhood Chain and write a certificate.
// Each claim is matched to a check Ruby can read from the chain (liquidity lock, holder shares, a wallet's balance, burn,
// supply, holder count, links between top holders, verified source). Every value is read at one pinned block; holder
// shares are computed from every Transfer log and then confirmed a second way with balanceOf. A claim Ruby cannot read
// from the chain is marked "can't check", never guessed. The certificate is plain text: hash it, and record it on chain
// with RubyProof if you want (`ruby proof <certificate> <claims note> --kind replicate`).
import crypto from "node:crypto";
import { RPC, rpc, EXPLORER, DEAD, ZERO, T_TRANSFER, short, sourcify, tokenInfo } from "./chain.mjs";
import { frontmatter, write, table, safeName } from "./note.mjs";
import { POOL_MANAGER } from "./poolv4.mjs";
import { readLocker, PONS_V2_LOCKER } from "./locker.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), hx = (n) => "0x" + n.toString(16);
const pad = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0"), ad = (t) => "0x" + t.slice(26).toLowerCase();
export const sha256 = (s) => "0x" + crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const pct = (x) => (x == null ? "–" : (Math.round(x * 100) / 100).toFixed(2) + "%");

async function batch(calls, size = 30) {
  const out = [];
  for (let i = 0; i < calls.length; i += size) {
    const part = calls.slice(i, i + size); if (i) await sleep(300);
    for (let k = 0; k < 8; k++) {
      try { const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(part.map(([m, p], j) => ({ jsonrpc: "2.0", id: j, method: m, params: p }))), signal: AbortSignal.timeout(30000) });
        if (r.status === 429 || r.status >= 500) throw new Error("busy"); const j = await r.json(); if (!Array.isArray(j)) throw new Error("busy"); j.sort((a, b) => a.id - b.id); out.push(...j.map((x) => x.result ?? null)); break; }
      catch (e) { if (k === 7) throw e; await sleep(1500 * (k + 1)); }
    }
  }
  return out;
}
async function allLogs(filter, to) {
  const out = []; let step = 9_000_000;
  for (let a = 0; a <= to;) { const e = Math.min(to, a + step - 1);
    try { out.push(...(await rpc("eth_getLogs", [{ ...filter, fromBlock: hx(a), toBlock: hx(e) }]))); a = e + 1; }
    catch (err) { const m = /only (\d+) are allowed/.exec(err.message || ""); if (m) { step = Math.max(2000, Math.min(step >> 1, +m[1])); continue; } throw err; } }
  return out;
}

// ---- claims: split the text into lines and recognise what each one asserts ----
const NUM = "(\\d+(?:\\.\\d+)?)";
const UNDER = "(?:under|below|less than|<|at most|max(?:imum)?)";
export function parseClaims(text) {
  const parts = String(text || "").split(/\n|;|,(?![\d])|\band\b/i).map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter((s) => s.length > 2);
  return parts.map((raw) => {
    const s = raw.toLowerCase();
    let m;
    if (/\b(lp|liquidity)\b/.test(s) && /\block(ed)?\b/.test(s)) { m = new RegExp(NUM + "\\s*%").exec(s); return { raw, kind: "lp_locked", min: m ? +m[1] : 100 }; }
    if ((m = new RegExp("top\\s*(\\d+)[^\\d%]{0,24}?" + UNDER + "\\s*" + NUM + "\\s*%").exec(s))) return { raw, kind: "top_under", n: +m[1], max: +m[2] };
    if ((m = new RegExp("(?:largest|biggest|top)\\s*(?:holder|wallet)[^\\d%]{0,24}?" + UNDER + "\\s*" + NUM + "\\s*%").exec(s))) return { raw, kind: "top_under", n: 1, max: +m[1] };
    if ((m = new RegExp("(0x[0-9a-f]{40})[^%]{0,40}?(?:holds?|owns?|has)\\s*(?:" + UNDER + "\\s*)?(?:(0|no|nothing|zero)\\b|" + NUM + "\\s*%)").exec(s))) return { raw, kind: "wallet_holds", wallet: m[1], max: m[2] ? 0 : +m[3], under: new RegExp(UNDER).test(s) };
    if ((m = new RegExp("(0x[0-9a-f]{40})[^.]{0,40}?(?:sold (?:all|everything)|holds? (?:no|nothing|zero))").exec(s))) return { raw, kind: "wallet_holds", wallet: m[1], max: 0 };
    if ((m = new RegExp(NUM + "\\s*%[^\\d]{0,12}burn").exec(s)) || (m = new RegExp("burn(?:ed|t)?[^\\d]{0,12}" + NUM + "\\s*%").exec(s))) return { raw, kind: "burned", min: +m[1] };
    if ((m = /(?:over|more than|>|at least)\s*([\d,]+)\s*holders/.exec(s)) || (m = /([\d,]+)\s*\+\s*holders/.exec(s))) return { raw, kind: "holders_over", n: +m[1].replace(/,/g, "") };
    if ((m = /supply[^\d]{0,12}([\d,.]+)\s*(b|bn|billion|m|million|k|thousand)?\b/.exec(s))) { const mult = { b: 1e9, bn: 1e9, billion: 1e9, m: 1e6, million: 1e6, k: 1e3, thousand: 1e3 }[m[2]] || 1; return { raw, kind: "supply", n: Math.round(parseFloat(m[1].replace(/,/g, "")) * mult) }; }
    if (/(no|zero|0)\s+(direct\s+)?(links?|transfers?)\s+(between|among)\s+(the\s+)?top|top\s*\d*\s*holders?\s+(are\s+)?not\s+linked|not\s+linked/.test(s)) { m = /top\s*(\d+)/.exec(s); return { raw, kind: "no_links", n: m ? +m[1] : 20 }; }
    if (/verified|source.*(public|open)|sourcify/.test(s)) return { raw, kind: "verified" };
    return { raw, kind: "unknown" };
  });
}

// ---- the reads ----
async function holderBook(token, block, log) {
  log("reading every transfer…");
  const L = await allLogs({ address: token, topics: [T_TRANSFER] }, block);
  const bal = new Map();
  for (const l of L) { const f = ad(l.topics[1]), t = ad(l.topics[2]), v = BigInt(l.data); bal.set(f, (bal.get(f) || 0n) - v); bal.set(t, (bal.get(t) || 0n) + v); }
  return { transfers: L, bal };
}

export async function replicate(token, claimsText, { log = () => {} } = {}) {
  token = token.toLowerCase();
  const claims = parseClaims(claimsText);
  if (!claims.length) throw new Error("write at least one claim, one per line");
  const block = parseInt(await rpc("eth_blockNumber", []), 16), tag = hx(block);
  const info = await tokenInfo(token); if (info.totalSupply == null) throw new Error("this address does not answer like a token");
  const dec = info.decimals ?? 18, sym = info.symbol || short(token), supply = info.totalSupply;
  const share = (v) => (supply > 0n ? Number((v * 1000000n) / supply) / 10000 : null);
  const balAt = async (who) => { const r = await rpc("eth_call", [{ to: token, data: "0x70a08231" + pad(who) }, tag]); return r && r !== "0x" ? BigInt(r) : 0n; };
  const needBook = claims.some((c) => ["top_under", "holders_over", "no_links"].includes(c.kind));
  let book = null, ranked = null, confirmed = null, special = new Set([POOL_MANAGER, PONS_V2_LOCKER, DEAD, ZERO]);
  if (needBook) {
    book = await holderBook(token, block, log);
    ranked = [...book.bal].filter(([a, v]) => v > 0n && !special.has(a)).sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
    log("confirming the top balances with balanceOf…");
    const top = ranked.slice(0, 25), on = await batch(top.map(([a]) => ["eth_call", [{ to: token, data: "0x70a08231" + pad(a) }, tag]]));
    const bad = top.filter(([, v], i) => (on[i] && on[i] !== "0x" ? BigInt(on[i]) : 0n) !== v).length;
    confirmed = { checked: top.length, mismatches: bad };
  }
  let lockerR = null;
  const results = [];
  for (const c of claims) {
    let verdict = "can't check", value = "Ruby can't read this from the chain", evidence = null;
    try {
      if (c.kind === "lp_locked") {
        lockerR = lockerR || (await readLocker(token));
        if (!lockerR.locked || !lockerR.positionLiquidity) { verdict = "not replicated"; value = "no position for this token in the Pons V2 launch locker"; }
        else { const sh = lockerR.poolLiquidity > 0n ? Number((lockerR.positionLiquidity * 1000000n) / lockerR.poolLiquidity) / 10000 : 0, held = lockerR.nftOwner === PONS_V2_LOCKER;
          verdict = held && sh >= c.min - 0.005 ? "replicated" : "not replicated"; value = `${pct(sh)} of pool liquidity in the Pons V2 locker${held ? "" : " (but the locker does not own the position NFT)"}${lockerR.movers.length ? ` · functions that could move it: ${lockerR.movers.join(", ")}` : " · no function to pull it out"}`; evidence = `${EXPLORER}/address/${PONS_V2_LOCKER}`; }
      } else if (c.kind === "top_under") {
        const sum = ranked.slice(0, c.n).reduce((s, [, v]) => s + v, 0n), sh = share(sum);
        verdict = sh <= c.max ? "replicated" : "not replicated"; value = `${c.n === 1 ? "the largest wallet holds" : `top ${c.n} hold`} ${pct(sh)} (pool, locker and burn not counted)`;
      } else if (c.kind === "wallet_holds") {
        const v = await balAt(c.wallet), sh = share(v);
        verdict = c.max === 0 ? (v === 0n ? "replicated" : "not replicated") : sh <= c.max ? "replicated" : "not replicated";
        value = `${short(c.wallet)} holds ${pct(sh)}${v === 0n ? " (zero)" : ""}`; evidence = `${EXPLORER}/address/${c.wallet}`;
      } else if (c.kind === "burned") {
        const [d, z] = await Promise.all([balAt(DEAD), balAt(ZERO)]), sh = share(d + z);
        verdict = sh >= c.min - 0.05 ? "replicated" : "not replicated"; value = `${pct(sh)} at the burn addresses (0x…dead and 0x0)`;
      } else if (c.kind === "holders_over") {
        verdict = ranked.length > c.n ? "replicated" : "not replicated"; value = `${ranked.length.toLocaleString("en-US")} wallets hold it (pool, locker and burn not counted)`;
      } else if (c.kind === "supply") {
        const whole = Number(supply / 10n ** BigInt(dec)); verdict = whole === c.n ? "replicated" : "not replicated"; value = `total supply ${whole.toLocaleString("en-US")}`;
      } else if (c.kind === "no_links") {
        const set = new Set(ranked.slice(0, c.n).map(([a]) => a)); const links = book.transfers.filter((l) => set.has(ad(l.topics[1])) && set.has(ad(l.topics[2])));
        verdict = links.length === 0 ? "replicated" : "not replicated"; value = `${links.length} direct transfer${links.length === 1 ? "" : "s"} between the top ${c.n} holders (token transfers only; plain ETH transfers are not visible)`;
      } else if (c.kind === "verified") {
        const m = await sourcify(token); verdict = m === "exact_match" || m === "match" ? "replicated" : m === "unknown" ? "can't check" : "not replicated"; value = m === "exact_match" ? "Sourcify: exact match" : m === "match" ? "Sourcify: match" : m === "unknown" ? "Sourcify did not answer" : "Sourcify: not verified"; evidence = `https://sourcify.dev/#/lookup/${token}`;
      }
    } catch (e) { verdict = "can't check"; value = "read failed: " + (e.message || e); }
    results.push({ claim: c.raw, kind: c.kind, verdict, value, evidence });
  }
  const claimsNote = claimsSource({ token, symbol: sym, block, claims: claims.map((c) => c.raw) });
  const cert = certificate({ token, symbol: sym, block, claimsSha: sha256(claimsNote), results, confirmed });
  return { token, symbol: sym, block, results, confirmed, transfers: book ? book.transfers.length : null, claimsNote, certificate: cert, certificateSha: sha256(cert), claimsSha: sha256(claimsNote) };
}

// the exact texts that get hashed: the website builds the same bytes, so a certificate made in either place checks in both
export function claimsSource({ token, symbol, block, claims }) {
  return `---\ntype: "replicate-claims"\ntoken: "${token}"\nsymbol: "${symbol}"\nblock: ${block}\nchain: "Robinhood Chain mainnet (4663)"\n---\n` + claims.map((c, i) => `${i + 1}. ${c}`).join("\n") + "\n";
}
export function certificate({ token, symbol, block, claimsSha, results, confirmed }) {
  const n = (v) => results.filter((r) => r.verdict === v).length;
  return [`RUBY REPLICATE CERTIFICATE v1`, `chain: Robinhood Chain mainnet (4663)`, `token: ${token} (${symbol})`, `block: ${block}`, `claims sha256: ${claimsSha}`,
    `result: ${n("replicated")} replicated · ${n("not replicated")} not replicated · ${n("can't check")} can't check`,
    confirmed ? `confirmed: top ${confirmed.checked} balances from Transfer logs matched balanceOf (${confirmed.mismatches} mismatch${confirmed.mismatches === 1 ? "" : "es"})` : `confirmed: no holder math needed`,
    ...results.map((r, i) => `${i + 1}. ${r.verdict.toUpperCase()} | ${r.claim} | ${r.value}`)].join("\n") + "\n";
}

export async function replicateNote(vault, token, claimsText, { log = () => {} } = {}) {
  const R = await replicate(token, claimsText, { log });
  const base = safeName(`Replicate ${R.symbol} ${R.certificateSha.slice(2, 10)}`);
  const claimsFile = write(vault, `Replicate/${base} claims.md`, R.claimsNote), certFile = write(vault, `Replicate/${base} certificate.txt`, R.certificate);
  const icon = (v) => (v === "replicated" ? "✓ replicated" : v === "not replicated" ? "✗ not replicated" : "? can't check");
  const n = (v) => R.results.filter((r) => r.verdict === v).length;
  const fm = frontmatter({ type: "replicate", token: R.token, symbol: R.symbol, block: R.block, replicated: n("replicated"), not_replicated: n("not replicated"), cant_check: n("can't check"), certificate_sha256: R.certificateSha, claims_sha256: R.claimsSha, chain: "Robinhood Chain mainnet (4663)", tags: ["replicate", "robinhood-chain"] });
  const body = `
# ${R.symbol} · claims re-run

Every claim below was re-run against Robinhood Chain mainnet at block ${R.block.toLocaleString("en-US")}. A claim Ruby cannot read from the chain is marked "can't check", never guessed.

## Verdicts
${table(["#", "verdict", "claim", "what the chain says"], R.results.map((r, i) => [i + 1, icon(r.verdict), r.claim.replace(/\|/g, "/"), (r.evidence ? `[${r.value}](${r.evidence})` : r.value).replace(/\|/g, "/")]))}
${R.confirmed ? `Holder shares come from ${R.transfers.toLocaleString("en-US")} Transfer logs. Confirmed a second way: the top ${R.confirmed.checked} balances were read again with balanceOf at the same block, ${R.confirmed.mismatches} mismatch${R.confirmed.mismatches === 1 ? "" : "es"}.\n` : ""}
## Certificate
\`\`\`
${R.certificate}\`\`\`
- certificate sha256: \`${R.certificateSha}\`
- claims sha256: \`${R.claimsSha}\`
- files: \`Replicate/${base} certificate.txt\` and \`Replicate/${base} claims.md\`

Record it on chain with RubyProof (you sign, 0 ETH): \`ruby proof "Replicate/${base} certificate.txt" "Replicate/${base} claims.md" --kind replicate\`

## Notes
-
`;
  return write(vault, `Research/${safeName(`Replicate ${R.symbol} ${new Date().toISOString().slice(0, 10)} ${R.certificateSha.slice(2, 8)}`)}.md`, fm + body);
}
