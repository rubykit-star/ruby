// ruby agent "<task>": an AI agent in your terminal that answers a task about Robinhood Chain by calling Ruby's read-only
// tools one after another, then writes the answer and every step it took as a note in your vault.
// It uses YOUR OpenRouter key from the OPENROUTER_API_KEY environment variable: Ruby never stores, prints or sends it
// anywhere but openrouter.ai. The tools only read the chain: the agent cannot sign, send or move anything.
import { TOOLS } from "./tools.mjs";
import { frontmatter, write, safeName } from "./note.mjs";

export const DEFAULT_MODEL = process.env.RUBY_AGENT_MODEL || "openrouter/free";
const OR = "https://openrouter.ai/api/v1/chat/completions";
const SYSTEM = `You are Ruby Agent, a read-only research agent for Robinhood Chain mainnet (chain ID 4663).
Answer the user's task by calling the tools. Rules:
- Only state facts a tool returned. Name the block number or transaction behind each number.
- If the tools cannot answer part of the task, say so plainly. Never guess, never invent addresses or numbers.
- Known on Robinhood Chain: the RUBY token is 0x48447ce272824776c7f21d8741dba38ca1586475; ruby_flow and ruby_pool read the RUBY / ETH Uniswap V4 pool by default. For any other token, use the address the user gives; if there is none, ask for it.
- Times are UTC. No price predictions, no financial advice, no scores.
- You cannot sign, send or move anything, and you never need a private key or seed phrase: never ask for one.
- Keep the final answer short and structured, in the user's language.`;

export async function runAgent(task, { model = DEFAULT_MODEL, steps = 8, key = process.env.OPENROUTER_API_KEY, log = () => {}, fetchImpl = fetch } = {}) {
  if (!task || !String(task).trim()) throw new Error('give the agent a task, e.g. ruby agent "is the liquidity of 0x… locked, and who sold it today?"');
  if (!key) throw new Error("set OPENROUTER_API_KEY in your environment first (your own key from openrouter.ai/keys). Ruby never stores or prints it.");
  steps = Math.max(1, Math.min(15, steps | 0 || 8));
  const tools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: String(task) }], trace = [];
  for (let i = 0; i < steps; i++) {
    log(i === 0 ? `asking ${model}…` : `step ${i + 1}: asking ${model} what to do next…`);
    const r = await fetchImpl(OR, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key, "x-title": "Ruby Agent" }, body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }) });
    let j; try { j = await r.json(); } catch { throw new Error(`OpenRouter answered ${r.status} without JSON`); }
    if (!r.ok || j.error) throw new Error(`OpenRouter: ${(j.error && (j.error.message || j.error)) || r.status}${r.status === 401 ? " (check your key)" : r.status === 402 ? " (this model needs credit: try a free one with --model)" : ""}`);
    const msg = j.choices && j.choices[0] && j.choices[0].message; if (!msg) throw new Error("OpenRouter returned no message");
    const calls = msg.tool_calls || [];
    if (!calls.length) return { answer: String(msg.content || "").trim() || "(the model returned an empty answer)", model: j.model || model, trace, steps: i + 1 };
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: calls });
    for (const c of calls) {
      const t = TOOLS.find((x) => x.name === c.function.name); let args = {}; try { args = JSON.parse(c.function.arguments || "{}"); } catch {}
      log(`  ${c.function.name} ${JSON.stringify(args)}`);
      let out; const t0 = Date.now();
      try { out = t ? await t.run(args) : `Error: no tool named ${c.function.name}`; } catch (e) { out = "Error: " + (e.message || String(e)); }
      trace.push({ tool: c.function.name, args, seconds: (Date.now() - t0) / 1000, error: out.startsWith("Error:"), result: out });
      messages.push({ role: "tool", tool_call_id: c.id, content: out.length > 12000 ? out.slice(0, 12000) + "\n…(cut)" : out });
    }
  }
  messages.push({ role: "user", content: "Stop calling tools now. Give your final answer from what the tools returned." });
  const r = await fetchImpl(OR, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key, "x-title": "Ruby Agent" }, body: JSON.stringify({ model, messages }) });
  const j = await r.json().catch(() => ({})); const msg = j.choices && j.choices[0] && j.choices[0].message;
  return { answer: String((msg && msg.content) || "").trim() || "(no final answer within the step limit)", model: j.model || model, trace, steps, limited: true };
}

export async function agentNote(vault, task, opts = {}) {
  const R = await runAgent(task, opts), when = new Date().toISOString();
  const fm = frontmatter({ type: "agent", task: String(task).slice(0, 300), model: R.model, steps: R.steps, tools_used: [...new Set(R.trace.map((s) => s.tool))], saved: when.slice(0, 16).replace("T", " ") + " UTC", chain: "Robinhood Chain mainnet (4663)", tags: ["agent", "robinhood-chain"] });
  const body = `
# Ruby Agent · ${String(task).slice(0, 80)}

${R.answer}

## How it got there
${R.trace.length ? R.trace.map((s, i) => `### ${i + 1}. \`${s.tool}\` ${Object.keys(s.args).length ? "`" + JSON.stringify(s.args) + "`" : ""} · ${s.seconds.toFixed(1)} s${s.error ? " · error" : ""}\n\n${s.result.split("\n").slice(0, 25).join("\n")}${s.result.split("\n").length > 25 ? "\n\n…" : ""}`).join("\n\n") : "The model answered without calling a tool, so nothing above was read from the chain."}

---
Model: ${R.model} via OpenRouter, with your own key. Tools: Ruby's read-only tools. ${R.limited ? "Stopped at the step limit." : ""}

## Notes
-
`;
  return { file: write(vault, `Research/${safeName(`Agent ${when.slice(0, 10)} ${String(task).slice(0, 40)}`)}.md`, fm + body), answer: R.answer, trace: R.trace, model: R.model };
}
