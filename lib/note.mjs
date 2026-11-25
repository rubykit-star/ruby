// Markdown notes with YAML frontmatter: plain files any editor can open
import fs from "node:fs";
import path from "node:path";
const yamlVal = (v) => (v === null || v === undefined ? "" : typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) ? "[" + v.map((x) => JSON.stringify(String(x))).join(", ") + "]" : JSON.stringify(String(v)));
export function frontmatter(obj) { return "---\n" + Object.entries(obj).map(([k, v]) => `${k}: ${yamlVal(v)}`).join("\n") + "\n---\n"; }
export function readFrontmatter(file) {
  const t = fs.readFileSync(file, "utf8"); const m = t.match(/^---\n([\s\S]*?)\n---/); if (!m) return {};
  const o = {}; for (const line of m[1].split("\n")) { const i = line.indexOf(":"); if (i < 0) continue; const k = line.slice(0, i).trim(); let v = line.slice(i + 1).trim(); try { v = JSON.parse(v); } catch {} o[k] = v; } return o;
}
export function write(vault, rel, body) { const f = path.join(vault, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; }
export const table = (head, rows) => `| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n` + rows.map((r) => `| ${r.join(" | ")} |`).join("\n") + "\n";
export const safeName = (s) => String(s).replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "token";
