// ruby playbook: saved tasks that write a report note, run by hand or on a schedule.
// A playbook is a fixed list of Ruby's read-only tools: no AI and no key needed, so every number is a read, never a guess.
// Each run is compared with the last run of the same playbook ("since last run"). An optional "agent" step adds a summary
// written by Ruby Agent with your own OPENROUTER_API_KEY.
import fs from "node:fs";
import path from "node:path";
import { TOOLS, RUBY } from "./tools.mjs";
import { lensCheck, progressOf } from "./lens.mjs";
import { isAddr } from "./chain.mjs";
import { frontmatter, write, safeName } from "./note.mjs";

const tool = (n) => TOOLS.find((t) => t.name === n);
export const BUILT_IN = {
  token: { about: "a daily report on one token: Ruby Lens facts, the pool's latest swaps once graduated, the locker claim re-run, and what changed since the last run", needs: "token" },
};

// the numbers compared from run to run
function metrics(R) {
  const L = R.launch, H = R.holders || {};
  return { holders: H.count ?? null, top10: H.top10 ?? null, burned: R.burned ?? null, price: R.price ?? null, graduated: !!R.locker, poolShare: R.locker ? R.locker.poolShare : null, supplyLocked: R.locker ? R.locker.supplyLocked : null,
    curveProgress: L && !R.locker ? progressOf(L.curveEth, L.target) : null, trades: L ? L.buys + L.sells : null, traders: L ? L.traders : null, creatorHolds: L ? L.devHolds : null, block: R.now };
}
const LABEL = { holders: "holders", top10: "top 10 share", burned: "burned", price: "price (USDG)", poolShare: "locker's share of pool liquidity", supplyLocked: "supply locked", curveProgress: "curve progress", trades: "trades on the curve", traders: "traders on the curve", creatorHolds: "creator holds" };
const PCT = new Set(["top10", "burned", "poolShare", "supplyLocked", "curveProgress", "creatorHolds"]);
function fmtVal(k, v) { if (v == null) return "–"; if (k === "price") return Number(v).toPrecision(4); if (PCT.has(k)) return Number(v).toFixed(2) + "%"; return Number(v).toLocaleString("en-US"); }
function diff(prev, now) {
  if (!prev) return "First run of this playbook: the next run will show what changed.";
  const rows = [];
  for (const k of Object.keys(LABEL)) {
    const a = prev[k], b = now[k]; if (a == null && b == null) continue;
    let ch = "–"; if (a != null && b != null) { const d = b - a; ch = d === 0 ? "no change" : k === "price" ? `${d > 0 ? "+" : ""}${(((b - a) / a) * 100).toFixed(2)}%` : PCT.has(k) ? `${d > 0 ? "+" : ""}${d.toFixed(2)} pts` : `${d > 0 ? "+" : ""}${d.toLocaleString("en-US")}`; }
    rows.push(`| ${LABEL[k]} | ${fmtVal(k, a)} | ${fmtVal(k, b)} | ${ch} |`);
  }
  if (prev.graduated === false && now.graduated) rows.push("| graduated | no | yes | it graduated since the last run |");
  return `Since the last run at block ${Number(prev.block).toLocaleString("en-US")}:\n\n| | last run | now | change |\n| --- | --- | --- | --- |\n${rows.join("\n")}`;
}

const statePath = (vault) => path.join(vault, "Playbooks", ".state.json");
const readState = (vault) => { try { return JSON.parse(fs.readFileSync(statePath(vault), "utf8")); } catch { return {}; } };
const saveState = (vault, s) => { fs.mkdirSync(path.dirname(statePath(vault)), { recursive: true }); fs.writeFileSync(statePath(vault), JSON.stringify(s, null, 2)); };

// the built-in token playbook
export async function runTokenPlaybook(vault, token, { log = () => {}, agent = null } = {}) {
  if (/^\$?ruby$/i.test(String(token || "").trim())) token = RUBY;
  if (!isAddr(token)) throw new Error("give a token contract 0x… (or RUBY)");
  token = token.toLowerCase(); const key = "token:" + token, when = new Date().toISOString(), sections = [];
  log("Ruby Lens: every fact about the token…");
  const R = await lensCheck(token), M = metrics(R);
  sections.push(["Ruby Lens", await tool("ruby_lens_check").run({ token })]);
  if (R.locker) {
    log("the locker claim, re-run…");
    sections.push(["Claim re-run", await tool("ruby_replicate").run({ token, claims: "liquidity locked (Pons V2 launch locker)" })]);
    if (R.locker.poolId) { log("the pool's latest swaps…"); sections.push(["Latest swaps", await tool("ruby_flow").run({ pool: R.locker.poolId, count: 25 }).catch((e) => "Could not read the pool: " + e.message)]); }
  }
  const state = readState(vault), prev = state[key] && state[key].metrics;
  let summary = null;
  if (agent) { log("Ruby Agent: a short summary…"); const { runAgent } = await import("./agent.mjs"); summary = (await runAgent(`Summarise this report in 5 short bullet points. Use only these numbers, name the block, no advice:\n\n${sections.map(([h, b]) => `## ${h}\n${b}`).join("\n\n").slice(0, 14000)}`, { ...agent, steps: 1 })).answer; }
  const day = when.slice(0, 10), file = `Playbooks/${safeName(`${R.symbol} ${day} ${when.slice(11, 16).replace(":", "")}`)}.md`;
  const fm = frontmatter({ type: "playbook", playbook: "token", token, symbol: R.symbol, block: R.now, saved: when.slice(0, 16).replace("T", " ") + " UTC", chain: "Robinhood Chain mainnet (4663)", tags: ["playbook", "robinhood-chain"] });
  const body = `${fm}
# Playbook · ${R.symbol} · ${day}

Read at block ${R.now.toLocaleString("en-US")}, ${when.slice(0, 16).replace("T", " ")} UTC. Every number below is read from Robinhood Chain by Ruby's read-only tools: no AI wrote them.

## What changed
${diff(prev, M)}
${summary ? `\n## Summary by Ruby Agent\n${summary}\n\n_Written by ${agent.model || "the default model"} from the numbers below. Check them below._\n` : ""}
${sections.map(([h, b]) => `## ${h}\n${b.replace(/^# .*\n/, "")}`).join("\n\n")}

## Notes
-
`;
  const f = write(vault, file, body);
  state[key] = { metrics: M, file: path.relative(vault, f), at: when }; saveState(vault, state);
  return { file: f, symbol: R.symbol, metrics: M, prev };
}

// playbooks saved in ruby.json: { "playbooks": { "name": { "steps": [ { "tool": "ruby_lens_new", "args": { "count": 10 } }, { "agent": "task" } ] } } }
export async function runCustomPlaybook(vault, name, def, { log = () => {}, agent = null } = {}) {
  if (!def || !Array.isArray(def.steps) || !def.steps.length) throw new Error(`playbook "${name}" has no steps in ruby.json`);
  const when = new Date().toISOString(), parts = [];
  for (const [i, s] of def.steps.entries()) {
    if (s.agent) { if (!agent) { parts.push([`${i + 1}. Ruby Agent`, "Skipped: set OPENROUTER_API_KEY to run agent steps."]); continue; } log(`step ${i + 1}: Ruby Agent…`); const { runAgent } = await import("./agent.mjs"); parts.push([`${i + 1}. Ruby Agent · ${String(s.agent).slice(0, 80)}`, (await runAgent(String(s.agent), agent)).answer]); continue; }
    const t = tool(s.tool); if (!t) { parts.push([`${i + 1}. ${s.tool}`, `Error: no tool named ${s.tool}`]); continue; }
    log(`step ${i + 1}: ${s.tool}…`); let out; try { out = await t.run(s.args || {}); } catch (e) { out = "Error: " + e.message; }
    parts.push([`${i + 1}. ${s.tool}${s.args ? " `" + JSON.stringify(s.args) + "`" : ""}`, out.replace(/^# .*\n/, "")]);
  }
  const fm = frontmatter({ type: "playbook", playbook: name, steps: def.steps.length, saved: when.slice(0, 16).replace("T", " ") + " UTC", chain: "Robinhood Chain mainnet (4663)", tags: ["playbook", "robinhood-chain"] });
  return { file: write(vault, `Playbooks/${safeName(`${name} ${when.slice(0, 10)} ${when.slice(11, 16).replace(":", "")}`)}.md`, `${fm}\n# Playbook · ${name} · ${when.slice(0, 10)}\n\n${parts.map(([h, b]) => `## ${h}\n${b}`).join("\n\n")}\n\n## Notes\n- \n`) };
}

// "24h", "6h", "90m" → milliseconds (at least 10 minutes)
export function every(s) { const m = /^(\d+)\s*(m|h|d)$/i.exec(String(s || "").trim()); if (!m) throw new Error('--every takes a time like 24h, 6h or 90m'); const ms = Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2].toLowerCase()]; if (ms < 600e3) throw new Error("--every must be at least 10m"); return ms; }
