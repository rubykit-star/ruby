// Ruby hosted MCP: one URL for any MCP client (Claude, Claude Code, Cursor, VS Code, ChatGPT…). Streamable HTTP, JSON responses.
// Read only: it reads Robinhood Chain and answers in Markdown. It holds no key, signs nothing, stores nothing, and takes no fee.
import { TOOLS } from "../lib/tools.mjs";

const VERSION = "0.11.0";

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
