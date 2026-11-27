// ruby mcp: a memory server for AI agents over stdio (Model Context Protocol, JSON-RPC, one message per line).
// The agent can clip tokens, write daily and radar notes, remember things and recall them, all as Markdown in the vault.
// It can also prepare a seal for a note (the user sends it from their own wallet) and verify a seal on chain. Ruby never signs.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { isAddr } from "./chain.mjs";
import { clip } from "./clip.mjs";
import { daily } from "./daily.mjs";
import { radarNote } from "./launches.mjs";
import { frontmatter, write, safeName } from "./note.mjs";
import { prepare, verify } from "./seal.mjs";
import { pool } from "./pool.mjs";
import { poolV4, isPoolId } from "./poolv4.mjs";
import { lockerNote } from "./locker.mjs";
import { lendNote } from "./lend.mjs";
import { flowNote, RUBY_POOL } from "./flow.mjs";
import { replicateNote } from "./replicate.mjs";
import { gpuNote } from "./gpu.mjs";
import { prepareProof, checkProof, PROOF } from "./proof.mjs";

const TOOLS = [
  { name: "ruby_clip", description: "Write a fact note about a Robinhood Chain token from its contract address (verification, owner, first mint, supply, burns, holders, price) and return it.", inputSchema: { type: "object", properties: { address: { type: "string", description: "token contract address 0x…" } }, required: ["address"] } },
  { name: "ruby_daily", description: "Write today's note for a wallet (balances, value in USDG, last 24 hours of token transfers) and return it. Read only: needs only the address.", inputSchema: { type: "object", properties: { address: { type: "string" }, label: { type: "string" } }, required: ["address"] } },
  { name: "ruby_radar", description: "Write a note of the latest Pons launchpad launches on Robinhood Chain (dev buy, dev holdings and sales, buys and sells, traders) and return it.", inputSchema: { type: "object", properties: { count: { type: "number", description: "how many launches, up to 40" } } } },
  { name: "ruby_pool", description: "Write a fact note about a pool on Robinhood Chain and return it. Give a DLMM pair address (0x + 40 hex) for a liquidity book pool, or a Uniswap V4 pool id (0x + 64 hex) for a V4 pool: tokens, price, liquidity, fees or hook, and the last 24 hours of swaps. Read only.", inputSchema: { type: "object", properties: { address: { type: "string", description: "DLMM pair address 0x… (40 hex) or Uniswap V4 pool id 0x… (64 hex)" } }, required: ["address"] } },
  { name: "ruby_locker", description: "For a token launched on Pons and graduated to Uniswap V4: what the Pons V2 launch locker holds for it (the position NFT and who owns it, the position's share of the pool's liquidity, the token supply locked) and whether the locker's verified ABI has any function that could move them out. Read only.", inputSchema: { type: "object", properties: { address: { type: "string", description: "token contract 0x…" } }, required: ["address"] } },
  { name: "ruby_lens_new", description: "Ruby Lens: the latest token launches on Robinhood Chain's Pons launchpad, newest first: buys and sells, traders, the creator's buy and share, ETH in the curve and progress to its target.", inputSchema: { type: "object", properties: { count: { type: "number", description: "1 to 20 (default 10)" } } } },
  { name: "ruby_lens_check", description: "Ruby Lens: every fact Ruby can read about one token on Robinhood Chain: Sourcify, owner, launch and creator, bonding curve progress or the Pons V2 locker once graduated, trading, holders, burned share, live price.", inputSchema: { type: "object", properties: { token: { type: "string", description: "token contract 0x…" } }, required: ["token"] } },
  { name: "ruby_gpu", description: "Ruby GPU Spend: what is spent on a GPU network (or any per-call API) on Robinhood Chain over the last 7 days, read from the chain. Give its x402 endpoint URL (Ruby reads the 402 offer for the payee and price) or the payee address. Returns paid calls per day, how many settled the x402 way, USDG received, payers, price per call and the biggest payers. With a wallet (for example your AI's), also what that wallet spent there, with a warning on bursts. Payments with prepaid credits or other tokens are not visible.", inputSchema: { type: "object", properties: { target: { type: "string", description: "x402 endpoint URL, or the payee address 0x…" }, wallet: { type: "string", description: "optional wallet 0x… to see what it spent" } }, required: ["target"] } },
  { name: "ruby_replicate", description: "Re-run claims about a token on Robinhood Chain and return a verdict per claim: replicated, not replicated, or can't check. Checks it can read: liquidity locked (Pons V2 launch locker), top N holders under X%, largest holder under X%, a wallet holds X% or nothing, X% burned, over N holders, total supply, no direct transfers between the top N holders, verified source on Sourcify. Everything is read at one pinned block, holder shares are confirmed a second way with balanceOf, and the result is a plain-text certificate with its sha256 that can be recorded with RubyProof. Anything else is marked can't check, never guessed.", inputSchema: { type: "object", properties: { token: { type: "string", description: "token contract 0x…" }, claims: { type: "string", description: "the claims, one per line, e.g. 'LP 100% locked\ntop 10 under 30%\n0x… holds 0%'" } }, required: ["token", "claims"] } },
  { name: "ruby_flow", description: "The latest swaps in a Uniswap V4 pool on Robinhood Chain, newest first: buy or sell, amounts, time in UTC, the wallet that actually received or sent the token (not the router), what that wallet is (wallet, 7702 smart wallet, contract, the pool's hook, or a high-volume sender such as a bot or exchange) and its current share of supply. With no pool, reads the RUBY pool. Facts only, no scores.", inputSchema: { type: "object", properties: { pool: { type: "string", description: "optional Uniswap V4 pool id 0x… (64 hex)" }, count: { type: "number", description: "how many swaps, 5 to 200 (default 40)" } } } },
  { name: "ruby_lend", description: "Lending markets on Robinhood Chain read from their contracts: the Aave V3 market (assets, LTV, supplied, borrowed, rates, price feeds and when they last updated) and Morpho (markets lending the real USDG, utilisation, oracles). With a wallet: its positions in both, health factor and how far the collateral price can fall before liquidation. Read only, never advice.", inputSchema: { type: "object", properties: { wallet: { type: "string", description: "optional wallet 0x… to check its positions" } } } },
  { name: "ruby_remember", description: "Save something worth remembering as a Markdown note in the vault's Memory folder.", inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["title", "body"] } },
  { name: "ruby_recall", description: "Search every note in the vault for words and return the best matching notes with a snippet.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "ruby_seal_prepare", description: "Prepare a seal for one note in the vault: returns its SHA-256 and the exact transaction data. Ruby does not sign or send anything: the user sends 0 ETH from their own wallet to itself with this data (rubykit.cc/seal simulates it first). Never ask for a private key.", inputSchema: { type: "object", properties: { path: { type: "string", description: "note path in the vault, e.g. Memory/2026-11-25 plan.md" } }, required: ["path"] } },
  { name: "ruby_verify", description: "Check a seal on Robinhood Chain mainnet: is this note byte for byte the one sealed in that transaction? Read only. Writes a Seals/ note when it matches.", inputSchema: { type: "object", properties: { path: { type: "string" }, tx: { type: "string", description: "seal transaction hash 0x… (64 hex)" } }, required: ["path", "tx"] } },
  { name: "ruby_proof_prepare", description: "Prepare a Ruby Proof: the on-chain record that an answer you gave was made from a note in the vault, read at that note's block. Returns the answer's and the source's SHA-256 and the exact transaction data. Ruby does not sign or send anything: the user sends it from their own wallet (rubykit.cc/proof simulates it first). Hash the answer exactly as you will show it.", inputSchema: { type: "object", properties: { answer: { type: "string", description: "the exact answer text" }, source_path: { type: "string", description: "the vault note the answer came from, e.g. Pools/TSLA-USDG 0x2bbd.md" }, kind: { type: "string", description: "short label, e.g. pool, clip, radar" } }, required: ["answer", "source_path"] } },
  { name: "ruby_proof_check", description: "Check whether an exact answer was recorded as a Ruby Proof on Robinhood Chain: who recorded it, at which block, from which source block, and (if a source note is given) whether the source matches. Read only.", inputSchema: { type: "object", properties: { answer: { type: "string" }, source_path: { type: "string" } }, required: ["answer"] } },
  { name: "ruby_read", description: "Read one note from the vault by its path, for example Tokens/NVDA 0xd060.md.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
];

function walk(dir, out = []) { if (!fs.existsSync(dir)) return out; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".md")) out.push(p); } return out; }
function inside(vault, rel) { const p = path.resolve(vault, rel); if (!p.startsWith(path.resolve(vault) + path.sep)) throw new Error("path is outside the vault"); return p; }

export async function call(vault, name, a = {}) {
  const rel = (f) => path.relative(vault, f), text = (f) => `${rel(f)}\n\n${fs.readFileSync(f, "utf8")}`;
  if (name === "ruby_clip") { if (!isAddr(a.address)) throw new Error("address must be 0x… (40 hex characters)"); return text(await clip(a.address, vault)); }
  if (name === "ruby_daily") { if (!isAddr(a.address)) throw new Error("address must be 0x… (40 hex characters)"); return text(await daily(a.address, vault, { label: a.label })); }
  if (name === "ruby_pool") { if (isPoolId(a.address)) return text(await poolV4(a.address, vault)); if (!isAddr(a.address)) throw new Error("give a DLMM pair address (0x + 40 hex) or a Uniswap V4 pool id (0x + 64 hex)"); return text(await pool(a.address, vault)); }
  if (name === "ruby_lens_new" || name === "ruby_lens_check") { const { TOOLS: T } = await import("./tools.mjs"); return T.find((t) => t.name === name).run(a); }
  if (name === "ruby_gpu") { if (!a.target) throw new Error("target is required: an x402 endpoint URL or a payee 0x…"); return text(await gpuNote(vault, String(a.target), { wallet: a.wallet || null })); }
  if (name === "ruby_replicate") { if (!isAddr(a.token)) throw new Error("token must be 0x… (40 hex characters)"); if (!a.claims || !String(a.claims).trim()) throw new Error("claims are required, one per line"); return text(await replicateNote(vault, a.token, String(a.claims))); }
  if (name === "ruby_flow") { if (a.pool && !isPoolId(a.pool)) throw new Error("pool must be a Uniswap V4 pool id 0x… (64 hex characters)"); return text(await flowNote(vault, { pool: a.pool || RUBY_POOL, count: a.count || 40 })); }
  if (name === "ruby_lend") { if (a.wallet && !isAddr(a.wallet)) throw new Error("wallet must be 0x… (40 hex characters)"); return text(await lendNote(vault, { wallet: a.wallet || null })); }
  if (name === "ruby_locker") { if (!isAddr(a.address)) throw new Error("address must be 0x… (40 hex characters)"); return text(await lockerNote(a.address, vault)); }
  if (name === "ruby_radar") return text(await radarNote(vault, { count: Math.min(40, Number(a.count) || 15) }));
  if (name === "ruby_remember") {
    if (!a.title || !a.body) throw new Error("title and body are required");
    const day = new Date().toISOString().slice(0, 10), f = write(vault, `Memory/${day} ${safeName(a.title).slice(0, 80)}.md`, frontmatter({ type: "memory", title: a.title, saved: new Date().toISOString(), tags: ["memory", ...(a.tags || [])] }) + `\n# ${a.title}\n\n${a.body}\n`);
    return "saved " + rel(f);
  }
  if (name === "ruby_recall") {
    const words = String(a.query || "").toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) throw new Error("query is empty");
    const hits = walk(vault).map((f) => { const t = fs.readFileSync(f, "utf8"), low = t.toLowerCase(); const score = words.reduce((s, w) => s + (low.split(w).length - 1) + (rel(f).toLowerCase().includes(w) ? 5 : 0), 0); const i = low.indexOf(words[0]); return { f, score, snip: t.slice(Math.max(0, i - 80), i + 160).replace(/\s+/g, " ") }; })
      .filter((h) => h.score > 0).sort((x, y) => y.score - x.score).slice(0, Math.min(20, Number(a.limit) || 8));
    return hits.length ? hits.map((h) => `${rel(h.f)} (score ${h.score})\n  …${h.snip}…`).join("\n") : "no note matches";
  }
  if (name === "ruby_seal_prepare") { const p = inside(vault, a.path || ""); if (!fs.existsSync(p)) throw new Error("no such note"); const r = prepare(p);
    return `note    ${rel(p)} (${r.bytes} bytes)\nsha256  ${r.hash}\ndata    ${r.data}\n\nNothing was signed or sent. To seal it, the user sends 0 ETH from their own wallet to the same wallet on Robinhood Chain mainnet with the data above, for example at rubykit.cc/seal (simulated first). Then call ruby_verify with the transaction hash.`; }
  if (name === "ruby_verify") { const p = inside(vault, a.path || ""); if (!fs.existsSync(p)) throw new Error("no such note"); const r = await verify(p, String(a.tx || ""), vault);
    return `${r.matches && r.ok ? "sealed: the note is unchanged since this block" : "not a match: the note differs from what was sealed, or the transaction is not its seal"}\nnote      ${rel(p)} · sha256 ${r.hash}\non chain  ${r.onchain || "(no data)"}\nsealer    ${r.from}${r.selfSent ? " (sent to itself)" : ""}\nblock     ${r.block} · ${r.at.toISOString()}\ntx        ${r.tx}`; }
  if (name === "ruby_proof_prepare") { const src = inside(vault, a.source_path || ""); if (!fs.existsSync(src)) throw new Error("no such note"); const p = await prepareProof({ answer: a.answer, sourceFile: src, kind: a.kind });
    return `answer sha256  ${p.answerHash}\nsource sha256  ${p.sourceHash} (${rel(src)})\nsource block   ${p.sourceBlock}\nkind           ${p.kind}\nto             ${PROOF} (RubyProof, Robinhood Chain mainnet)\nvalue          0\ndata           ${p.data}\n\nNothing was signed or sent. The user records it from their own wallet, for example at rubykit.cc/proof (simulated first). Then ruby_proof_check finds it.`; }
  if (name === "ruby_proof_check") { const src = a.source_path ? inside(vault, a.source_path) : null; const r = await checkProof({ answer: a.answer, sourceFile: src });
    return r.found.length ? r.found.map((f) => `proof #${f.index} by ${f.prover} at block ${f.block} · source block ${f.sourceBlock} · kind ${f.kind}${f.sourceMatches === null ? "" : f.sourceMatches ? " · source matches" : " · source differs"} · tx ${f.tx}`).join("\n") : `no proof of this exact answer (sha256 ${r.answerHash}) on Robinhood Chain`; }
  if (name === "ruby_read") { const p = inside(vault, a.path || ""); if (!fs.existsSync(p)) throw new Error("no such note"); return fs.readFileSync(p, "utf8"); }
  throw new Error("unknown tool " + name);
}

export async function serve(vault) {
  const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue; let m; try { m = JSON.parse(line); } catch { continue; }
    const reply = (result) => m.id !== undefined && send({ jsonrpc: "2.0", id: m.id, result }), fail = (code, message) => m.id !== undefined && send({ jsonrpc: "2.0", id: m.id, error: { code, message } });
    if (m.method === "initialize") reply({ protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "ruby", version: "0.13.0" }, instructions: "Ruby is a read-only second brain for Robinhood Chain. Notes are Markdown files in the vault. Ruby never signs: ruby_seal_prepare only returns data for the user to send from their own wallet. Never ask the user for a private key." });
    else if (m.method === "tools/list") reply({ tools: TOOLS });
    else if (m.method === "tools/call") { try { reply({ content: [{ type: "text", text: await call(vault, m.params?.name, m.params?.arguments || {}) }] }); } catch (e) { reply({ content: [{ type: "text", text: "error: " + (e.message || e) }], isError: true }); } }
    else if (m.method === "ping") reply({});
    else if (m.id !== undefined && !String(m.method || "").startsWith("notifications/")) fail(-32601, "method not found: " + m.method);
  }
}
