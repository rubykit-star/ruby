// ruby seal / ruby verify: prove a note existed, unchanged, at a point in time.
// A seal is a 0 ETH transaction from your wallet to itself whose data is "ruby-seal:" + the note's SHA-256.
// Ruby never signs: you send the seal from your own wallet (the website does it with simulation first). Verify is read only.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { rpc, block, EXPLORER, short } from "./chain.mjs";
import { write, frontmatter } from "./note.mjs";

export const PREFIX = "ruby-seal:";
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
export const sealData = (hash) => "0x" + Buffer.from(PREFIX + hash, "utf8").toString("hex");

export function prepare(file) { const buf = fs.readFileSync(file), hash = sha256(buf); return { file, bytes: buf.length, hash, data: sealData(hash) }; }

export async function verify(file, txHash, vault) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("the transaction hash must be 0x + 64 hex characters");
  const { hash, bytes } = prepare(file), [tx, rc] = await Promise.all([rpc("eth_getTransactionByHash", [txHash]), rpc("eth_getTransactionReceipt", [txHash])]);
  if (!tx || !rc) throw new Error("no such transaction on Robinhood Chain mainnet");
  const raw = Buffer.from((tx.input || "0x").slice(2), "hex"), onchain = raw.subarray(0, PREFIX.length).toString("utf8") === PREFIX ? raw.toString("utf8") : "", b = await block(parseInt(rc.blockNumber, 16)), at = new Date(parseInt(b.timestamp, 16) * 1000);
  const r = { file: path.basename(file), bytes, hash, tx: txHash, from: tx.from.toLowerCase(), to: (tx.to || "").toLowerCase(), block: parseInt(rc.blockNumber, 16), at, ok: rc.status === "0x1",
    matches: onchain === PREFIX + hash, selfSent: tx.from.toLowerCase() === (tx.to || "").toLowerCase(), onchain: onchain ? onchain.slice(0, 80) : raw.length ? `not a Ruby seal (${raw.length} bytes of contract call data)` : "" };
  if (vault && r.matches && r.ok) {
    write(vault, `Seals/${r.at.toISOString().slice(0, 10)} ${path.basename(file).replace(/\.md$/, "")}.md`, frontmatter({ type: "seal", note: path.basename(file), sha256: hash, tx: txHash, sealer: r.from, block: r.block, sealed_at: r.at.toISOString(), tags: ["seal"] }) +
      `\n# Seal · ${path.basename(file)}\n\nThis note's SHA-256 \`${hash}\` was written to Robinhood Chain mainnet by [${short(r.from)}](${EXPLORER}/address/${r.from}) at block ${r.block.toLocaleString("en-US")} (${r.at.toISOString().replace("T", " ").slice(0, 19)} UTC).\n\nTransaction: [${short(txHash)}](${EXPLORER}/tx/${txHash})\n\nChange one character of the note and the hash no longer matches.\n`);
  }
  return r;
}
