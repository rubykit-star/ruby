// Ruby Pass: hold at least 1,000,000 RUBY and sign one free message (no transaction) to unlock holder perks.
// The balance is read from Robinhood Chain every time; nothing is locked, sent or staked, and the signature moves no funds.
import { keccak256 } from "./keccak.mjs";
import { balanceOf } from "./chain.mjs";

export const RUBY = "0x48447ce272824776c7f21d8741dba38ca1586475";
export const PASS_MIN = 1_000_000n * 10n ** 18n; // 1,000,000 RUBY (18 decimals)
export const PASS_DAYS = 30; // a signed pass is good for 30 days, as long as the wallet still holds the minimum

export const passMessage = (addr, iso = new Date().toISOString()) => `Ruby Pass\nwallet: ${addr.toLowerCase()}\nsigned: ${iso}\nThis signature is free and moves no funds.`;

// secp256k1, just enough to recover the signer of a personal_sign message
const SP = 2n ** 256n - 2n ** 32n - 977n, SN = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const md = (a, m = SP) => ((a % m) + m) % m, pw = (b, e, m = SP) => { let r = 1n; b = md(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }, inv = (a, m = SP) => pw(a, m - 2n, m);
const add = (P, Q) => { if (!P) return Q; if (!Q) return P; if (P[0] === Q[0] && md(P[1] + Q[1]) === 0n) return null; const l = P[0] === Q[0] ? md(3n * P[0] * P[0] * inv(2n * P[1])) : md((Q[1] - P[1]) * inv(Q[0] - P[0])); const x = md(l * l - P[0] - Q[0]); return [x, md(l * (P[0] - x) - P[1])]; };
const mul = (P, k) => { let R = null; while (k > 0n) { if (k & 1n) R = add(R, P); P = add(P, P); k >>= 1n; } return R; };
const bytes = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));

export function recoverPersonal(msg, sig) {
  const m = new TextEncoder().encode(msg), pre = new TextEncoder().encode("\x19Ethereum Signed Message:\n" + m.length), all = new Uint8Array(pre.length + m.length); all.set(pre); all.set(m, pre.length);
  const z = BigInt(keccak256(all)), h = String(sig).replace(/^0x/, ""); if (!/^[0-9a-f]{130}$/i.test(h)) throw new Error("bad signature");
  const r = BigInt("0x" + h.slice(0, 64)), s = BigInt("0x" + h.slice(64, 128)); let v = parseInt(h.slice(128, 130), 16); if (v >= 27) v -= 27;
  if (r <= 0n || r >= SN || s <= 0n || s >= SN) throw new Error("bad signature");
  let y = pw(md(r * r * r + 7n), (SP + 1n) / 4n); if ((y & 1n) !== BigInt(v & 1)) y = SP - y;
  const ri = inv(r, SN), Q = add(mul([r, y], md(s * ri, SN)), mul(G, md(-z * ri, SN))); if (!Q) throw new Error("bad signature");
  return "0x" + keccak256(bytes(Q[0].toString(16).padStart(64, "0") + Q[1].toString(16).padStart(64, "0"))).slice(-40);
}

// a pass key is base64 of {"msg","sig"}; returns { ok, addr, balance, reason }
export async function checkPass(key, { now = Date.now(), balance = (a) => balanceOf(RUBY, a) } = {}) {
  let p; try { p = JSON.parse(Buffer.from(String(key), "base64").toString("utf8")); } catch { return { ok: false, reason: "not a Ruby Pass key" }; }
  const addr = (String(p.msg || "").match(/^wallet: (0x[0-9a-f]{40})$/m) || [])[1], at = Date.parse((String(p.msg || "").match(/^signed: (.+)$/m) || [])[1] || "");
  if (!String(p.msg || "").startsWith("Ruby Pass\n") || !addr || !at) return { ok: false, reason: "not a Ruby Pass message" };
  if (at > now + 5 * 60e3 || now - at > PASS_DAYS * 864e5) return { ok: false, addr, reason: `signed more than ${PASS_DAYS} days ago: sign a new one` };
  let signer; try { signer = recoverPersonal(p.msg, p.sig); } catch { return { ok: false, addr, reason: "bad signature" }; }
  if (signer !== addr) return { ok: false, addr, reason: "signed by a different wallet" };
  const bal = await balance(addr); return bal >= PASS_MIN ? { ok: true, addr, balance: bal } : { ok: false, addr, balance: bal, reason: "holds less than 1,000,000 RUBY right now" };
}
