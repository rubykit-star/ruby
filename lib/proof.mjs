// Ruby Proof: a public record on Robinhood Chain that an answer (often an AI's) was made from a given source,
// read at a given block. Only hashes go on chain. Ruby never signs: it prepares the data, you send it from your wallet.
// Contract: RubyProof, verified on Sourcify (exact match). No owner, no admin, no upgrade, no funds.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { rpc, logs, head, block, EXPLORER, short } from "./chain.mjs";
import { frontmatter, write, readFrontmatter, table } from "./note.mjs";

export const PROOF = "0x0cc3335d87c21ba7b6bdadb79f356a05c13fba02";
export const PROOF_BLOCK = 123114651; // deployment block
export const T_PROVED = "0xb90d70600762281214595c6c7815b98d92c639f0b93ec934e481fe9ad59f6113";
const SEL_PROVE = "0x47b99798", SEL_COUNT = "0x06661abd";

export const sha256hex = (buf) => "0x" + crypto.createHash("sha256").update(buf).digest("hex");
const w = (n) => BigInt(n).toString(16).padStart(64, "0");
const kind32 = (k) => { const b = Buffer.from(String(k || "note").slice(0, 32), "utf8"); return "0x" + Buffer.concat([b, Buffer.alloc(32 - b.length)]).toString("hex"); };
const kindText = (h) => Buffer.from(h.slice(2), "hex").toString("utf8").replace(/\0+$/, "");

// the answer's hash, the source's hash, the source block (from the note's frontmatter when it has one) and the exact call data
export async function prepareProof({ answer, sourceFile, kind }) {
  if (!answer || !String(answer).trim()) throw new Error("the answer is empty");
  if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error("no such source note");
  const answerHash = sha256hex(Buffer.from(String(answer), "utf8")), src = fs.readFileSync(sourceFile), sourceHash = sha256hex(src);
  const fm = readFrontmatter(sourceFile), now = await head();
  let sourceBlock = Number(fm.block) || now; if (sourceBlock > now) sourceBlock = now;
  const k = kind || fm.type || "note";
  const data = SEL_PROVE + answerHash.slice(2) + sourceHash.slice(2) + w(sourceBlock) + kind32(k).slice(2);
  return { to: PROOF, value: "0", data, answerHash, sourceHash, sourceBlock, kind: k, bytes: src.length };
}

// every proof on chain, optionally only those for one answer hash or one prover
export async function readProofs({ answerHash, prover } = {}) {
  const topics = [T_PROVED, prover ? "0x" + w(prover) : null, answerHash || null];
  const L = await logs({ address: PROOF, topics }, PROOF_BLOCK, await head());
  return L.map((l) => { const d = l.data.slice(2); return { prover: "0x" + l.topics[1].slice(26), answerHash: l.topics[2], sourceHash: l.topics[3], sourceBlock: parseInt(d.slice(0, 64), 16), kind: kindText("0x" + d.slice(64, 128)), index: parseInt(d.slice(128, 192), 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash }; });
}

// is this answer (and optionally this source) on chain?
export async function checkProof({ answer, sourceFile }) {
  const answerHash = sha256hex(Buffer.from(String(answer || ""), "utf8")), sourceHash = sourceFile && fs.existsSync(sourceFile) ? sha256hex(fs.readFileSync(sourceFile)) : null;
  const found = await readProofs({ answerHash });
  return { answerHash, sourceHash, found: found.map((p) => ({ ...p, sourceMatches: sourceHash ? p.sourceHash === sourceHash : null })) };
}

// a note with every proof and the totals
export async function proofsNote(vault, { log = () => {} } = {}) {
  log("reading every proof…");
  const all = await readProofs(), now = await head(), total = BigInt(await rpc("eth_call", [{ to: PROOF, data: SEL_COUNT }, "latest"]));
  const provers = new Set(all.map((p) => p.prover)), kinds = {}; for (const p of all) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
  const at = new Date(), fm = frontmatter({ type: "proofs", taken: at.toISOString(), block: now, proofs: Number(total), provers: provers.size, contract: PROOF, chain: "Robinhood Chain mainnet (4663)", tags: ["proof", "robinhood-chain"] });
  const body = `
# Ruby Proof · ${at.toISOString().replace("T", " ").slice(0, 16)} UTC

Every proof recorded in [RubyProof](${EXPLORER}/address/${PROOF}) on Robinhood Chain mainnet, read at block ${now.toLocaleString("en-US")}. A proof says: this address recorded, at this block, that an answer with hash A was made from a source with hash S read at block B. It does not say the answer is true.

|  |  |
| --- | --- |
| proofs | ${total} |
| provers | ${provers.size} |
| kinds | ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(" · ") || "–"} |

${all.length ? table(["#", "prover", "answer sha256", "source sha256", "source block", "kind", "tx"], all.slice(-50).reverse().map((p) => [String(p.index), `[${short(p.prover)}](${EXPLORER}/address/${p.prover})`, "`" + p.answerHash.slice(0, 12) + "…`", "`" + p.sourceHash.slice(0, 12) + "…`", p.sourceBlock.toLocaleString("en-US"), p.kind, `[${short(p.tx)}](${EXPLORER}/tx/${p.tx})`])) : "No proofs yet.\n"}
## Notes
-
`;
  return write(vault, `Proofs/${at.toISOString().slice(0, 16).replace(":", "")}.md`, fm + body);
}
