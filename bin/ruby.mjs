#!/usr/bin/env node
// Ruby Brain Kit: an on-chain second brain for Robinhood Chain, written as plain Markdown files.
//   ruby init [folder]                 create a Ruby vault from the template
//   ruby daily [wallet] [--label name] today's note for a wallet (or every wallet in ruby.json)
//   ruby clip <token>                  a note of facts about a token, from its contract address
//   ruby radar [--count 15]            a note of the latest launchpad launches, read from their events
//   ruby mcp                           a memory server for AI agents (MCP over stdio)
//   ruby footprint <wallet>            what the public can read about a wallet: counterparties, hours, holdings, approvals
//   ruby lock | ruby unlock            encrypt or decrypt every note in the vault with a password (AES-256-GCM)
//   ruby watch [0x…]                  follow wallets and tokens live: dev sells, launches, big moves (or "watchlist" in ruby.json)
//   ruby seal <note>                   the SHA-256 and the exact data to seal a note from your own wallet
//   ruby verify <note> <tx>            check a seal on chain: the note is unchanged since that block
// Options: --vault <folder> (default: the current folder). Read only: Ruby never signs and never asks for a key.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAddr } from "../lib/chain.mjs";
import { daily } from "../lib/daily.mjs";
import { clip } from "../lib/clip.mjs";
import { radarNote } from "../lib/launches.mjs";
import { serve } from "../lib/mcp.mjs";
import { footprint } from "../lib/footprint.mjs";
import { lock, unlock, askPassword } from "../lib/vaultlock.mjs";
import { prepare, verify } from "../lib/seal.mjs";
import { runWatch } from "../lib/watch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), TEMPLATE = path.join(here, "..", "vault");
const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf("--" + k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf("--" + k); if (i < 0) return false; args.splice(i, 1); return true; };
const vaultArg = opt("vault"), label = opt("label"), count = opt("count"), days = opt("days"), minutes = opt("minutes"), minEth = opt("min-eth"), minPct = opt("min-pct"), once = flag("once"), [cmd, target] = args;
const vault = path.resolve(vaultArg || (cmd === "init" && target) || ".");
const say = (m) => process.stderr.write("· " + m + "\n");

function copyDir(src, dst) { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name); if (e.isDirectory()) copyDir(s, d); else if (!fs.existsSync(d)) fs.copyFileSync(s, d); } }
function config() { const f = path.join(vault, "ruby.json"); if (!fs.existsSync(f)) return { wallets: [], watch: [] }; try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { throw new Error("ruby.json is not valid JSON"); } }

async function main() {
  if (cmd === "init") { copyDir(TEMPLATE, vault); console.log(`Ruby vault ready at ${vault}\nNext: add your wallet to ruby.json, then run: ruby daily`); return; }
  if (cmd === "clip") { if (!isAddr(target)) throw new Error("usage: ruby clip <token contract address 0x…>"); const f = await clip(target, vault, { log: say }); console.log("wrote " + path.relative(process.cwd(), f)); return; }
  if (cmd === "radar") { const f = await radarNote(vault, { count: Math.min(40, Number(count) || 15), log: say }); console.log("wrote " + path.relative(process.cwd(), f)); return; }
  if (cmd === "mcp") { await serve(vault); return; }
  if (cmd === "footprint") { if (!isAddr(target)) throw new Error("usage: ruby footprint <wallet 0x…>"); const f = await footprint(target, vault, { watch: config().watch || [], days: Math.min(365, Number(days) || 30), log: say }); console.log("wrote " + path.relative(process.cwd(), f)); return; }
  if (cmd === "watch") { const items = [...args.slice(1).filter((a) => isAddr(a)), ...((config().watchlist) || [])]; const r = await runWatch([...new Set(items.map((a) => a.toLowerCase()))], vault, { once, minutes: Math.min(720, Number(minutes) || 30), minEth: Number(minEth) || 0.1, minPct: Number(minPct) || 1, log: say }); if (r?.file) console.log("wrote " + path.relative(process.cwd(), r.file)); return; }
  if (cmd === "seal") { if (!target || !fs.existsSync(target)) throw new Error("usage: ruby seal <note.md>"); const p = prepare(target);
    console.log(`note     ${p.file} (${p.bytes} bytes)\nsha256   ${p.hash}\n\nTo seal it, send 0 ETH from your wallet to the same wallet on Robinhood Chain with this data:\n${p.data}\n\nThe Ruby website does this for you, simulated first, signed in your wallet. Then check it with: ruby verify ${p.file} 0x…tx`); return; }
  if (cmd === "verify") { const tx = args[2]; if (!target || !fs.existsSync(target) || !tx) throw new Error("usage: ruby verify <note.md> <transaction hash>"); const r = await verify(target, tx, vault);
    console.log(`${r.matches && r.ok ? "✓ sealed" : "✗ not a match"}\nnote      ${r.file} · sha256 ${r.hash}\non chain  ${r.onchain || "(no data)"}\nsealer    ${r.from}${r.selfSent ? " (sent to itself)" : ""}\nblock     ${r.block} · ${r.at.toISOString()}\ntx        ${r.tx}`); if (!r.matches) process.exitCode = 1; return; }
  if (cmd === "lock") { const pw = await askPassword("password: ", true); const n = lock(vault, pw, { log: say }); console.log(`locked ${n} note${n === 1 ? "" : "s"}. Keep the password safe: without it the notes cannot be opened.`); return; }
  if (cmd === "unlock") { const pw = await askPassword("password: "); const n = unlock(vault, pw, { log: say }); console.log(`unlocked ${n} note${n === 1 ? "" : "s"}`); return; }
  if (cmd === "daily") {
    const cfg = config(), list = target ? [{ address: target, label }] : cfg.wallets || [];
    if (!list.length) throw new Error("no wallet: run `ruby daily 0x…` or add wallets to ruby.json");
    for (const w of list) { if (!isAddr(w.address)) throw new Error("not an address: " + w.address); const f = await daily(w.address, vault, { label: w.label, watch: cfg.watch || [], log: say }); console.log("wrote " + path.relative(process.cwd(), f)); }
    return;
  }
  console.log(`Ruby Brain Kit · Robinhood Chain mainnet · read only

  ruby init [folder]                  create a Ruby vault from the template
  ruby daily [wallet] [--label name]  today's note for a wallet, or every wallet in ruby.json
  ruby clip <token>                   facts about a token, from its contract address
  ruby radar [--count 15]             the latest launchpad launches, as one note
  ruby mcp                            memory server for AI agents (MCP, stdio)
  ruby footprint <wallet>             what the public can read about a wallet
  ruby lock | ruby unlock             encrypt or decrypt every note with a password
  ruby watch [0x…] [--once]           follow wallets and tokens live: dev sells, launches, big moves
  ruby seal <note>                    the hash and data to seal a note on chain
  ruby verify <note> <tx>             check a seal: the note is unchanged since that block

  --vault <folder>   where notes are written (default: current folder)
  RUBY_RPC           use another Robinhood Chain RPC endpoint
  RUBY_PASSWORD      password for lock and unlock (otherwise typed, not shown)`);
}
main().catch((e) => { console.error("✗ " + (e.message || e)); process.exit(1); });
