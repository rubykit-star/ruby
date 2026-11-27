// Ruby Lens on Solana: the latest pump.fun launches and the facts of any SPL token, read from Solana mainnet.
// Facts only: no scores. Name and holder count may come from the token's own metadata, or from Jupiter when it has none.
export const SOL = {
  rpc: process.env.RUBY_SOLANA_RPC || "https://api.mainnet-beta.solana.com",
  explorer: "https://solscan.io",
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pumpAmm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  pumpMintAuthority: "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM", // every pump.fun create touches this account
  wsol: "So11111111111111111111111111111111111111112",
};
const PROGRAMS = { [SOL.pump]: "pump.fun bonding curve", [SOL.pumpAmm]: "PumpSwap pool", "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM pool", "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": "Raydium CLMM pool", "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C": "Raydium CPMM pool", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo": "Meteora DLMM pool", "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc": "Orca Whirlpool" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
export async function srpc(method, params) {
  for (let k = 0; k < 7; k++) {
    try { const r = await fetch(SOL.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      const j = await r.json().catch(() => ({})); if (j.result !== undefined) return j.result;
      const msg = JSON.stringify(j.error || r.status); if (!/429|rate|Too many|busy|timeout|-32005|-32603/i.test(msg)) throw Object.assign(new Error("Solana RPC: " + msg), { final: true });
    } catch (e) { if (e.final) throw e; }
    await sleep(700 * (k + 1));
  }
  throw new Error("Solana RPC is busy: try again in a minute");
}
async function srpc1(method, params) { try { const r = await fetch(SOL.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) }); const j = await r.json(); return j.result ?? null; } catch { return null; } }
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (buf) => { let n = BigInt("0x" + (Buffer.from(buf).toString("hex") || "0")), s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b === 0) s = "1" + s; else break; } return s; };
const b58d = (str) => { let n = 0n; for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); } let hex = n.toString(16); if (hex.length % 2) hex = "0" + hex; const out = [...Buffer.from(hex === "00" ? "" : hex, "hex")]; for (const c of str) { if (c === "1") out.unshift(0); else break; } return Buffer.from(out); };
// program derived address, as Solana computes it: the first bump whose hash is not an ed25519 point
import { createHash } from "node:crypto";
const P = 2n ** 255n - 19n, D = (-121665n * inv(121666n)) % P;
function inv(a) { return pw(((a % P) + P) % P, P - 2n); }
function pw(b, e) { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; } return r; }
function onCurve(bytes) { const b = Buffer.from(bytes); b[31] &= 0x7f; let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(b[i]); if (y >= P) return false;
  const y2 = (y * y) % P, u = (y2 - 1n + P) % P, v = (D * y2 + 1n) % P, x2 = (u * inv(v)) % P; if (x2 === 0n) return true; return pw(x2, (P - 1n) / 2n) === 1n; }
export function pda(seeds, programId) { const prog = b58d(programId);
  for (let bump = 255; bump >= 0; bump--) { const h = createHash("sha256"); for (const sd of seeds) h.update(sd); h.update(Buffer.from([bump])); h.update(prog); h.update(Buffer.from("ProgramDerivedAddress")); const out = h.digest(); if (!onCurve(out)) return b58(out); }
  throw new Error("no PDA"); }
export const isSolAddr = (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a || "");
const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);

// the pump.fun CreateEvent in a transaction's logs: name, symbol, uri, mint, bonding curve, creator
function createEvent(logs) {
  for (const l of logs || []) {
    if (!l.startsWith("Program data: ")) continue; const d = Buffer.from(l.slice(14), "base64"); let o = 8;
    const rd = () => { const n = d.readUInt32LE(o); if (n > 400) throw 0; o += 4; const s = d.slice(o, o + n).toString(); o += n; return s; };
    try { const name = rd(), symbol = rd(), uri = rd(); if (d.length < o + 96) continue; return { name, symbol: symbol.trim(), uri, mint: b58(d.slice(o, o + 32)), curve: b58(d.slice(o + 32, o + 64)), creator: b58(d.slice(o + 64, o + 96)) }; } catch {}
  }
  return null;
}
// pump.fun bonding curve account: virtual and real reserves, supply, complete flag
function readCurve(b64) {
  if (!b64) return null; const d = Buffer.from(b64, "base64"); if (d.length < 49) return null; const u = (o) => d.readBigUInt64LE(o);
  return { vToken: u(8), vSol: u(16), rToken: u(24), rSol: u(32), supply: u(40), complete: d[48] === 1 };
}
// pump.fun puts 79.31% of a token's supply on the curve (793.1M of 1B); the curve completes when they are all sold
export const curveProgress = (c) => { if (!c) return null; if (c.complete) return 100; const start = (c.supply * 7931n) / 10000n; return start > 0n && c.rToken <= start ? Number(((start - c.rToken) * 10000n) / start) / 100 : null; }; // null: a curve that doesn't follow the standard split

export async function solNew({ count = 10 } = {}) {
  count = Math.max(1, Math.min(20, count | 0 || 10));
  const sigs = await srpc("getSignaturesForAddress", [SOL.pumpMintAuthority, { limit: count + 6 }]), rows = [];
  for (const s of sigs) {
    if (rows.length >= count) break; if (s.err) continue;
    const tx = await srpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]).catch(() => null); if (!tx) continue;
    const ev = createEvent(tx.meta.logMessages); if (!ev) continue;
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey), i = keys.indexOf(ev.creator);
    const spent = i >= 0 ? (tx.meta.preBalances[i] - tx.meta.postBalances[i]) / 1e9 : null; // SOL that left the creator in the create tx (dev buy, rent and fees)
    const got = (tx.meta.postTokenBalances || []).filter((b) => b.mint === ev.mint && b.owner === ev.creator).reduce((s, b) => s + Number(b.uiTokenAmount.uiAmount || 0), 0);
    rows.push({ ...ev, sig: s.signature, time: s.blockTime, spent, creatorBought: got });
  }
  const accs = rows.length ? await srpc("getMultipleAccounts", [rows.map((r) => r.curve), { encoding: "base64" }]).catch(() => null) : null;
  rows.forEach((r, i) => { const c = readCurve(accs && accs.value[i] && accs.value[i].data[0]); r.curveSol = c ? Number(c.rSol) / 1e9 : null; r.progress = curveProgress(c); r.complete = c ? c.complete : null; });
  const slot = await srpc("getSlot", []).catch(() => null);
  return { slot, rows };
}

export async function solCheck(mint) {
  if (!isSolAddr(mint)) throw new Error("give a Solana token mint address (base58)");
  const [acc, slot] = await Promise.all([srpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]), srpc("getSlot", []).catch(() => null)]);
  // the largest accounts call is heavily limited on the public RPC: one quick try, then go on without it (set RUBY_SOLANA_RPC to your own RPC for it)
  const largest = await srpc1("getTokenLargestAccounts", [mint]);
  if (!acc || !acc.value) throw new Error("no account at this address on Solana mainnet");
  const p = acc.value.data && acc.value.data.parsed; if (!p || p.type !== "mint") throw new Error("this address is not a token mint");
  const info = p.info, program = acc.value.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" ? "Token-2022" : "SPL Token", dec = info.decimals, supply = Number(info.supply) / 10 ** dec;
  const meta = (info.extensions || []).find((e) => e.extension === "tokenMetadata"), R = { mint, slot, program, decimals: dec, supply, mintAuthority: info.mintAuthority || null, freezeAuthority: info.freezeAuthority || null, name: meta ? meta.state.name : null, symbol: meta ? meta.state.symbol : null, nameFrom: meta ? "token metadata" : null };
  // holders: the 20 largest token accounts, their owners, and what each owner is
  const top = (largest && largest.value) || [];
  if (top.length) {
    const ta = await srpc("getMultipleAccounts", [top.map((t) => t.address), { encoding: "jsonParsed" }]), owners = ta.value.map((a) => a && a.data && a.data.parsed ? a.data.parsed.info.owner : null);
    const oa = await srpc("getMultipleAccounts", [owners.map((o) => o || SOL.wsol), { encoding: "base64" }]);
    R.top = top.map((t, i) => { const o = owners[i], prog = oa.value[i] ? oa.value[i].owner : null, label = PROGRAMS[prog] || (prog && prog !== "11111111111111111111111111111111" ? "program account" : "wallet"); return { account: t.address, owner: o, amount: Number(t.uiAmount || 0), share: supply ? (Number(t.uiAmount || 0) / supply) * 100 : null, label, data: oa.value[i] ? oa.value[i].data[0] : null }; });
    const curve = R.top.find((x) => x.label === "pump.fun bonding curve"); if (curve) R.curveShare = curve.share;
    const wallets = R.top.filter((x) => x.label === "wallet"); R.top10Wallets = wallets.slice(0, 10).reduce((s, x) => s + (x.share || 0), 0);
    R.top.forEach((x) => delete x.data);
  }
  // the pump.fun bonding curve for this mint, derived the way pump.fun derives it, then read directly
  try { const addr = pda([Buffer.from("bonding-curve"), b58d(mint)], SOL.pump), a = await srpc("getAccountInfo", [addr, { encoding: "base64" }]);
    if (a && a.value && a.value.owner === SOL.pump) { const c = readCurve(a.value.data[0]), held = R.top ? (R.top.find((x) => x.owner === addr) || {}).share : null; R.curve = { address: addr, sol: c ? Number(c.rSol) / 1e9 : null, progress: curveProgress(c), complete: c ? c.complete : null, share: held ?? null, tokensLeft: c ? Number(c.rToken) / 10 ** dec : null }; } } catch {}
  // Jupiter (an off-chain index): name when the token has no metadata, holder count, price
  try { const j = await (await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, { signal: AbortSignal.timeout(10000) })).json(); const x = Array.isArray(j) ? j.find((t) => t.id === mint) : null;
    if (x) { if (!R.name) { R.name = x.name; R.symbol = x.symbol; R.nameFrom = "Jupiter"; } R.jup = { top: x.audit && x.audit.topHoldersPercentage != null ? x.audit.topHoldersPercentage : null, holders: x.holderCount ?? null, usd: x.usdPrice ?? null, liquidity: x.liquidity ?? null, launchpad: x.launchpad || null, graduatedAt: x.graduatedAt || null }; } } catch {}
  return R;
}

// Markdown for tools and notes
const f = (x, d = 2) => (x == null || !isFinite(x) ? "–" : Number(x).toLocaleString("en-US", { maximumFractionDigits: d }));
const pct = (x) => (x == null ? "–" : Number(x).toFixed(2) + "%");
const A = (a) => `[${short(a)}](${SOL.explorer}/account/${a})`, T = (a) => `[${short(a)}](${SOL.explorer}/token/${a})`;
export function solNewMd(N) {
  return `# Ruby Lens · Solana · latest ${N.rows.length} pump.fun launches\nRead at slot ${(N.slot || 0).toLocaleString("en-US")} from pump.fun's own create events. Facts only, no scores.\n\n| launched (UTC) | token | creator | creator got | SOL spent in create tx | curve | progress |\n| --- | --- | --- | --- | --- | --- | --- |\n` +
    N.rows.map((r) => `| ${r.time ? new Date(r.time * 1000).toISOString().slice(5, 16).replace("T", " ") : "–"} | [${(r.symbol || short(r.mint)).replace(/\|/g, "")}](${SOL.explorer}/token/${r.mint}) | ${A(r.creator)} | ${f(r.creatorBought, 0)} | ${f(r.spent, 4)} | ${r.curveSol == null ? "–" : f(r.curveSol, 3) + " SOL"} | ${r.complete ? "complete" : r.progress == null ? "–" : r.progress.toFixed(1) + "%"} |`).join("\n") +
    "\n\n\"SOL spent\" is what left the creator in the create transaction: the dev buy plus rent and fees. Check any of them with ruby_lens_check and network solana.";
}
export function solCheckMd(R) {
  const L = [`# Ruby Lens · Solana · ${R.symbol || short(R.mint)}${R.name && R.name !== R.symbol ? " · " + R.name : ""}`, `Read at slot ${(R.slot || 0).toLocaleString("en-US")}. Facts only, no score: check each line with its link.`, "",
    `- mint ${T(R.mint)} · ${R.program} · ${R.decimals} decimals · supply ${f(R.supply, 0)}${R.nameFrom ? ` · name from ${R.nameFrom}` : ""}`,
    `- mint authority: ${R.mintAuthority ? A(R.mintAuthority) + " (more can be minted)" : "none (revoked: no more can be minted)"}`,
    `- freeze authority: ${R.freezeAuthority ? A(R.freezeAuthority) + " (accounts can be frozen)" : "none (revoked: no account can be frozen)"}`];
  if (R.curve) L.push(`- pump.fun bonding curve ${A(R.curve.address)}: ${R.curve.complete ? "complete (it moved on to a pool)" : `${f(R.curve.sol, 3)} SOL in it · ${R.curve.progress == null ? "non-standard curve, no progress shown" : R.curve.progress.toFixed(1) + "% of the curve sold"} · ${f(R.curve.tokensLeft, 0)} tokens left on it`}`);
  else L.push("- no pump.fun bonding curve for this mint");
  if (R.jup && (R.jup.holders != null || R.jup.usd || R.jup.top != null)) L.push(`- per Jupiter (off-chain index): ${R.jup.holders == null ? "–" : R.jup.holders.toLocaleString("en-US") + " holders"}${R.jup.usd ? ` · price about $${Number(R.jup.usd).toPrecision(4)}` : ""}${R.jup.top != null ? ` · top holders ${pct(R.jup.top)}` : ""}${R.jup.launchpad ? ` · launchpad ${R.jup.launchpad}` : ""}`);
  if (!R.top) L.push("- largest accounts: the public Solana RPC refused this call right now (set RUBY_SOLANA_RPC to your own RPC to list them)");
  if (R.top) L.push(`- the 10 largest wallets (pools and curves not counted) hold ${pct(R.top10Wallets)}`, "", "| # | owner | share | what it is |", "| --- | --- | --- | --- |", ...R.top.slice(0, 12).map((x, i) => `| ${i + 1} | ${x.owner ? A(x.owner) : "–"} | ${pct(x.share)} | ${x.label} |`));
  return L.join("\n");
}
