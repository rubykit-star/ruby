// ruby lock / ruby unlock: encrypt every note in the vault with a password, on your own machine.
// Format of a locked note (<name>.md.ruby): "RUBY1" | salt 16 | iv 12 | tag 16 | AES-256-GCM ciphertext. Key: scrypt(password, salt).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MAGIC = Buffer.from("RUBY1"), SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const key = (pw, salt) => crypto.scryptSync(pw, salt, 32, SCRYPT);
export function encrypt(buf, pw) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(pw, salt), iv); const ct = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]); }
export function decrypt(buf, pw) {
  if (buf.length < 49 || !buf.subarray(0, 5).equals(MAGIC)) throw new Error("not a locked Ruby note");
  const salt = buf.subarray(5, 21), iv = buf.subarray(21, 33), tag = buf.subarray(33, 49), d = crypto.createDecipheriv("aes-256-gcm", key(pw, salt), iv); d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(49)), d.final()]); } catch { throw new Error("wrong password, or the file was changed"); }
}
function walk(dir, ext, out = []) { if (!fs.existsSync(dir)) return out; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, ext, out); else if (e.name.endsWith(ext)) out.push(p); } return out; }

// lock: write the encrypted copy, prove it decrypts to the same bytes, only then remove the plain note
export function lock(vault, pw, { log = () => {} } = {}) {
  if (!pw || pw.length < 10) throw new Error("use a password of at least 10 characters");
  const files = walk(vault, ".md"); let n = 0;
  for (const f of files) { const plain = fs.readFileSync(f), enc = encrypt(plain, pw), out = f + ".ruby"; fs.writeFileSync(out, enc);
    if (!decrypt(fs.readFileSync(out), pw).equals(plain)) { fs.unlinkSync(out); throw new Error("could not verify " + f + ", left it as it was"); }
    fs.unlinkSync(f); n++; log("locked " + path.relative(vault, f)); }
  return n;
}
// unlock: check the password on the first file before touching anything
export function unlock(vault, pw, { log = () => {} } = {}) {
  const files = walk(vault, ".md.ruby"); if (!files.length) return 0;
  decrypt(fs.readFileSync(files[0]), pw);
  let n = 0; for (const f of files) { const out = f.slice(0, -5); if (fs.existsSync(out)) throw new Error(path.relative(vault, out) + " already exists in plain text; move it away first"); fs.writeFileSync(out, decrypt(fs.readFileSync(f), pw)); fs.unlinkSync(f); n++; log("unlocked " + path.relative(vault, out)); }
  return n;
}
// a password from RUBY_PASSWORD, or typed without echo
export async function askPassword(prompt, confirm) {
  if (process.env.RUBY_PASSWORD) return process.env.RUBY_PASSWORD;
  if (!process.stdin.isTTY) throw new Error("set RUBY_PASSWORD, or run this in a terminal to type it");
  const read = (q) => new Promise((res) => { process.stderr.write(q); const s = process.stdin; s.setRawMode(true); s.resume(); let v = "";
    const on = (b) => { for (const ch of b.toString("utf8")) { if (ch === "\r" || ch === "\n") { s.setRawMode(false); s.pause(); s.off("data", on); process.stderr.write("\n"); return res(v); } if (ch === "\u0003") { process.stderr.write("\n"); process.exit(130); } if (ch === "\u007f") v = v.slice(0, -1); else v += ch; } }; s.on("data", on); });
  const a = await read(prompt); if (confirm && (await read("again: ")) !== a) throw new Error("the passwords do not match"); return a;
}
