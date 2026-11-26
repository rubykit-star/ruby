// Ruby hosted MCP: one URL for any MCP client (Claude, Claude Code, Cursor, VS Code, ChatGPT…). Streamable HTTP, JSON responses.
// Read only: it reads Robinhood Chain and answers in Markdown. It holds no key, signs nothing, stores nothing, and takes no fee.
import { rpc, logs, tokenInfo, EXPLORER, DEAD, ZERO, T_TRANSFER, isAddr, short } from "../lib/chain.mjs";
import { readFlow, RUBY_POOL } from "../lib/flow.mjs";
import { replicate } from "../lib/replicate.mjs";
import { readLocker, PONS_V2_LOCKER } from "../lib/locker.mjs";
import { readV4, POOL_MANAGER, isPoolId } from "../lib/poolv4.mjs";
import { readAave, readWallet } from "../lib/lend.mjs";
import { readProofs, sha256hex, PROOF } from "../lib/proof.mjs";

const VERSION = "0.9.0", RUBY = "0x48447ce272824776c7f21d8741dba38ca1586475";
const f = (x, d = 4) => (x == null || !isFinite(x) ? "–" : x === 0 ? "0" : Math.abs(x) >= 1 ? x.toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) >= 1000 ? 0 : d }) : x.toPrecision(4).replace(/0+$/, ""));
const pct = (x) => (x == null ? "–" : (Math.round(x * 100) / 100).toFixed(2) + "%");
const utc = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 19).replace("T", " ") + " UTC" : "–");
const A = (a) => `[${short(a)}](${EXPLORER}/address/${a})`, TX = (h) => `[${short(h)}](${EXPLORER}/tx/${h})`;
const need = (ok, msg) => { if (!ok) throw new Error(msg); };

const TOOLS = [
  { name: "ruby_block", description: "The latest Robinhood Chain block: number, time in UTC and gas price.", inputSchema: { type: "object", properties: {} },
    run: async () => { const b = await rpc("eth_getBlockByNumber", ["latest", false]), g = await rpc("eth_gasPrice", []);
      return `Robinhood Chain mainnet (4663)\n- block ${parseInt(b.number, 16).toLocaleString("en-US")}\n- time ${utc(parseInt(b.timestamp, 16))}\n- gas price ${(Number(BigInt(g)) / 1e9).toFixed(4)} gwei`; } },
  { name: "ruby_flow", description: "The latest swaps in a Uniswap V4 pool on Robinhood Chain (default: the RUBY pool), newest first: time in UTC, buy or sell, amounts, the wallet that actually traded (not the router), what that wallet is and its share of supply.", inputSchema: { type: "object", properties: { pool: { type: "string", description: "optional Uniswap V4 pool id 0x… (64 hex)" }, count: { type: "number", description: "5 to 100 swaps (default 25)" } } },
    run: async (a) => { const pool = a.pool || RUBY_POOL; need(isPoolId(pool), "pool must be a Uniswap V4 pool id 0x… (64 hex)"); const t = await readFlow(pool, { count: Math.max(5, Math.min(100, a.count | 0 || 25)) }), S = t.summary;
      return `# ${t.symbol} / ${t.quoteSymbol} · last ${S.swaps} swaps\nRead at block ${t.head.toLocaleString("en-US")}. ${S.buys} buys / ${S.sells} sells · ${t.quoteSymbol} in ${f(S.boughtQuote)} · out ${f(S.soldQuote)} · ${S.wallets} wallets · ${utc(S.from)} → ${utc(S.to)}\n\n| time (UTC) | side | ${t.symbol} | ${t.quoteSymbol} | wallet | what it is | holds now | tx |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n` +
        t.rows.map((r) => `| ${r.time ? new Date(r.time * 1000).toISOString().slice(11, 19) : r.block} | ${r.side} | ${f(r.token)} | ${f(r.quote)} | ${r.wallet ? A(r.wallet) : "?"} | ${r.label ? r.label.kind : "–"} | ${r.label && r.label.share != null ? pct(r.label.share) : "–"} | ${TX(r.tx)} |`).join("\n") + `\n\nThe Swap event names the router, so the wallet is read from the token transfers in the same transaction.`; } },
  { name: "ruby_replicate", description: "Re-run claims about a token on Robinhood Chain: a verdict per claim (replicated, not replicated, can't check) and a plain-text certificate with its sha256. Checks: liquidity locked (Pons V2 launch locker), top N holders under X%, largest holder under X%, a wallet holds X% or nothing, X% burned, over N holders, total supply, no direct transfers between the top N holders, verified source on Sourcify.", inputSchema: { type: "object", properties: { token: { type: "string", description: "token contract 0x…" }, claims: { type: "string", description: "claims, one per line or separated by semicolons" } }, required: ["token", "claims"] },
    run: async (a) => { need(isAddr(a.token), "token must be 0x… (40 hex)"); need(a.claims && String(a.claims).trim(), "claims are required"); const R = await replicate(a.token, String(a.claims));
      return `# ${R.symbol} · claims re-run at block ${R.block.toLocaleString("en-US")}\n\n| verdict | claim | what the chain says |\n| --- | --- | --- |\n` + R.results.map((r) => `| ${r.verdict} | ${r.claim.replace(/\|/g, "/")} | ${r.value.replace(/\|/g, "/")} |`).join("\n") +
        `\n\n${R.confirmed ? `Holder shares from ${R.transfers.toLocaleString("en-US")} Transfer logs; top ${R.confirmed.checked} confirmed with balanceOf (${R.confirmed.mismatches} mismatches).\n\n` : ""}Certificate (sha256 ${R.certificateSha}):\n\`\`\`\n${R.certificate}\`\`\`\nRecord it on chain at https://rubykit.cc/replicate (simulated first, signed in your own wallet).`; } },
  { name: "ruby_locker", description: "What the Pons V2 launch locker holds for a graduated token: whether it owns the pool's position NFT, that position's share of the pool's liquidity, the locked token supply, and any locker function that could move them.", inputSchema: { type: "object", properties: { token: { type: "string", description: "token contract 0x…" } }, required: ["token"] },
    run: async (a) => { need(isAddr(a.token), "token must be 0x… (40 hex)"); const R = await readLocker(a.token), sup = R.totalSupply > 0n ? Number((R.supplyLocked * 1000000n) / R.totalSupply) / 10000 : null;
      if (!R.locked) return `${short(a.token)} has no lock in the Pons V2 launch locker ${A(PONS_V2_LOCKER)}.`;
      const share = R.poolLiquidity > 0n ? Number((R.positionLiquidity * 1000000n) / R.poolLiquidity) / 10000 : null;
      return `# Pons V2 launch locker · ${short(a.token)}\n- position NFT #${R.tokenId} owned by ${R.nftOwner === PONS_V2_LOCKER ? "the locker ✓" : A(R.nftOwner)}\n- share of the pool's active liquidity: ${pct(share)}\n- range: ticks ${R.tickLower} to ${R.tickUpper}\n- tokens locked: ${pct(sup)} of supply\n- locker functions that could move funds: ${R.movers.length ? R.movers.join(", ") : "none in its verified ABI"}\n- locker source on Sourcify: ${R.sources.locker.match || "not verified"}\n\nLocker ${A(PONS_V2_LOCKER)} · pool id \`${R.poolId}\``; } },
  { name: "ruby_holders", description: "The top holders of a token on Robinhood Chain from every Transfer log: count, largest wallet, top 10 and top 20 shares. The pool manager, the Pons V2 launch locker and burn addresses are not counted as holders.", inputSchema: { type: "object", properties: { token: { type: "string", description: "token contract 0x… (default: RUBY)" } } },
    run: async (a) => { const tok = (a.token || RUBY).toLowerCase(); need(isAddr(tok), "token must be 0x… (40 hex)"); const head = parseInt(await rpc("eth_blockNumber", []), 16), info = await tokenInfo(tok); need(info.totalSupply, "not a token");
      const L = await logs({ address: tok, topics: [T_TRANSFER] }, 0, head), bal = new Map(), ad = (t) => "0x" + t.slice(26).toLowerCase(); for (const l of L) { const v = BigInt(l.data); bal.set(ad(l.topics[1]), (bal.get(ad(l.topics[1])) || 0n) - v); bal.set(ad(l.topics[2]), (bal.get(ad(l.topics[2])) || 0n) + v); }
      const skip = new Set([POOL_MANAGER, PONS_V2_LOCKER, DEAD, ZERO]), s = (v) => Number((v * 1000000n) / info.totalSupply) / 10000, R = [...bal].filter(([x, v]) => v > 0n && !skip.has(x)).sort((x, y) => (y[1] > x[1] ? 1 : -1)), sum = (n) => R.slice(0, n).reduce((t, [, v]) => t + v, 0n);
      return `# ${info.symbol || short(tok)} holders at block ${head.toLocaleString("en-US")}\n- holders: ${R.length.toLocaleString("en-US")} (from ${L.length.toLocaleString("en-US")} transfers)\n- largest wallet: ${pct(s(sum(1)))}\n- top 10: ${pct(s(sum(10)))}\n- top 20: ${pct(s(sum(20)))}\n- pool manager: ${pct(s(bal.get(POOL_MANAGER) || 0n))} · launch locker: ${pct(s(bal.get(PONS_V2_LOCKER) || 0n))} · burned (0x…dead): ${pct(s(bal.get(DEAD) || 0n))}\n\n| # | wallet | share |\n| --- | --- | --- |\n` + R.slice(0, 15).map(([x, v], i) => `| ${i + 1} | ${A(x)} | ${pct(s(v))} |`).join("\n"); } },
  { name: "ruby_pool", description: "A Uniswap V4 pool on Robinhood Chain read straight from the PoolManager: its two tokens, fee, tick spacing, hook, current tick, price and active liquidity.", inputSchema: { type: "object", properties: { pool: { type: "string", description: "Uniswap V4 pool id 0x… (64 hex), default: the RUBY pool" } } },
    run: async (a) => { const id = a.pool || RUBY_POOL; need(isPoolId(id), "pool must be a Uniswap V4 pool id 0x… (64 hex)"); const P = await readV4(id);
      const sym = async (t) => (t === ZERO ? { symbol: "ETH", decimals: 18 } : tokenInfo(t)), [X, Y] = await Promise.all([sym(P.c0), sym(P.c1)]), price = (Number(P.sqrtP) / 2 ** 96) ** 2 * 10 ** ((X.decimals ?? 18) - (Y.decimals ?? 18));
      return `# ${X.symbol} / ${Y.symbol} · Uniswap V4\n- pool id \`${P.id}\`\n- fee in key: ${(P.key.fee & 0x800000) ? "dynamic (set by the hook)" : P.key.fee / 1e4 + "%"} · tick spacing ${P.key.tickSpacing}\n- hook: ${P.key.hooks === ZERO ? "none" : A(P.key.hooks)}\n- current tick ${P.tick} · 1 ${X.symbol} = ${f(price, 8)} ${Y.symbol}\n- active liquidity ${P.liquidity.toLocaleString("en-US")}\n- created at block ${P.initBlock.toLocaleString("en-US")} · ${TX(P.initTx)}\n- read at block ${P.head.toLocaleString("en-US")}`; } },
  { name: "ruby_lend", description: "Lending on Robinhood Chain. With no wallet: the Aave V3 market's assets with LTV, supplied, borrowed, borrow rate and price-feed age. With a wallet: its Aave health factor and its Morpho positions with LTV and how far the price can fall before liquidation.", inputSchema: { type: "object", properties: { wallet: { type: "string", description: "optional wallet 0x…" } } },
    run: async (a) => { if (a.wallet) { need(isAddr(a.wallet), "wallet must be 0x… (40 hex)"); const W = await readWallet(a.wallet);
        return `# Lending positions · ${short(a.wallet)} at block ${W.block.toLocaleString("en-US")}\n- Aave V3: ${W.aave && (W.aave.debtUsd > 0 || W.aave.collateralUsd > 0) ? `collateral $${f(W.aave.collateralUsd, 2)} · debt $${f(W.aave.debtUsd, 2)} · health factor ${W.aave.hf == null ? "no debt" : W.aave.hf.toFixed(3)}` : "no position"}\n` + (W.morpho.length ? W.morpho.map((p) => `- Morpho ${p.collSym}/${p.loanSym}: collateral ${f(p.collateral)} · borrowed ${f(p.borrowed)} · LTV ${p.ltvNow == null ? "–" : p.ltvNow.toFixed(2) + "%"} of ${p.lltv}% · ${p.health == null ? "no debt" : p.health >= 1 ? ((1 - 1 / p.health) * 100).toFixed(1) + "% price drop to liquidation" : "past liquidation"}`).join("\n") : "- Morpho: no position"); }
      const R = await readAave(); return `# ${R.name} · Aave V3\n\n| asset | max LTV | supplied (USD) | borrowed (USD) | borrow APR | feed updated |\n| --- | --- | --- | --- | --- | --- |\n` + R.reserves.map((r) => `| ${r.sym} | ${r.ltv}% | ${f(r.suppliedUsd, 0)} | ${f(r.borrowedUsd, 0)} | ${r.borrowApr.toFixed(2)}% | ${r.age == null ? "–" : r.age < 3600 ? Math.round(r.age / 60) + " min ago" : (r.age / 3600).toFixed(1) + " h ago"} |`).join("\n"); } },
  { name: "ruby_proof_check", description: "Is this exact text (an answer, a note or a Ruby Replicate certificate) recorded in the RubyProof contract on Robinhood Chain? Hashes it with sha256 and looks it up.", inputSchema: { type: "object", properties: { text: { type: "string", description: "the exact text" } }, required: ["text"] },
    run: async (a) => { need(a.text, "text is required"); const h = sha256hex(Buffer.from(String(a.text), "utf8")), P = await readProofs({ answerHash: h });
      return `sha256 ${h}\n` + (P.length ? P.map((p) => `- recorded at block ${p.block.toLocaleString("en-US")} by ${A(p.prover)} · kind ${p.kind} · ${TX(p.tx)}`).join("\n") : `Not recorded in RubyProof ${A(PROOF)}. One changed character gives a different hash.`); } },
];

// best-effort fairness per instance: 60 calls a minute per IP
const hits = new Map();
const limited = (ip) => { const now = Date.now(), w = (hits.get(ip) || []).filter((t) => now - t < 60000); w.push(now); hits.set(ip, w); if (hits.size > 5000) hits.clear(); return w.length > 60; };

async function handle(m, ip) {
  const ok = (result) => ({ jsonrpc: "2.0", id: m.id, result }), err = (code, message) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  if (m.method === "initialize") return ok({ protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "ruby", version: VERSION },
    instructions: "Ruby reads Robinhood Chain and answers with facts and links. Read only: it never signs, never asks for a key and takes no fee. Every number has a block number or a transaction behind it." });
  if (m.method === "ping") return ok({});
  if (m.method === "tools/list") return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: true } })) });
  if (m.method === "tools/call") { const t = TOOLS.find((x) => x.name === m.params?.name); if (!t) return err(-32602, "unknown tool: " + m.params?.name);
    if (limited(ip)) return ok({ content: [{ type: "text", text: "Too many calls from this address: 60 a minute. Wait a moment, or run Ruby locally: npx -y github:rubykit-star/ruby mcp" }], isError: true });
    try { return ok({ content: [{ type: "text", text: await t.run(m.params?.arguments || {}) }] }); } catch (e) { return ok({ content: [{ type: "text", text: "Error: " + (e.message || String(e)) }], isError: true }); } }
  if (m.id === undefined) return null; // a notification
  return err(-32601, "method not found: " + m.method);
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "content-type, accept, mcp-session-id, mcp-protocol-version"); res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("allow", "POST"); return res.status(405).json({ name: "ruby", version: VERSION, mcp: "POST JSON-RPC here (Streamable HTTP)", tools: TOOLS.map((t) => t.name), add: "claude mcp add --transport http ruby https://" + (req.headers.host || "this-host") + "/mcp", readOnly: true }); }
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); } }
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  if (Array.isArray(body)) { const out = (await Promise.all(body.map((m) => handle(m, ip)))).filter(Boolean); return out.length ? res.status(200).json(out) : res.status(202).end(); }
  if (!body || typeof body !== "object") return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
  const r = await handle(body, ip); return r ? res.status(200).json(r) : res.status(202).end();
}
